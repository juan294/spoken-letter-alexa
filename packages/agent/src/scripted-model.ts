// A deterministic Strands model provider. It drives the same tool sequence a Bedrock model
// would (list, then get, then the structured reply) so the agent loop, the MCP client and
// the simulator can be tested and used offline without AWS. It is also the `dev:offline`
// model. It reads the JSON text block each MCP tool returns next to its spoken summary.
import {
  type BaseModelConfig,
  type Message,
  Model,
  ModelContentBlockDeltaEvent,
  ModelContentBlockStartEvent,
  ModelContentBlockStopEvent,
  ModelMessageStartEvent,
  ModelMessageStopEvent,
  type ModelStreamEvent,
  type StreamOptions,
} from "@strands-agents/sdk";

import { type SkillLocale, spanishPattern } from "@spoken-letter-alexa/shared";

import { SPANISH_LANGUAGE_LINE } from "./persona.ts";
import { type TurnOutput } from "./schema.ts";

const STRUCTURED_OUTPUT_TOOL = "strands_structured_output";

type StoryJson = { id: string; title: string; storyteller: string; durationSeconds?: number; artUrl?: string };
type ListJson = { stories: StoryJson[] };
type StoryWithAudioJson = StoryJson & { audio: { url: string } };
type ErrorJson = { error: string; message?: string };

type Block = { type: string; text?: string; name?: string; input?: unknown; toolUseId?: string; status?: string; content?: Block[] };

function blocks(message: Message): Block[] {
  return message.content as unknown as Block[];
}

/**
 * Finds the JSON object in a tool result that has `key`. Strands maps the MCP text
 * blocks to text and the `resource_link` to a json block, so the predicate matters.
 */
function firstJson<T extends object>(items: Block[] | undefined, key: keyof T & string): T | null {
  for (const item of items ?? []) {
    let candidate: unknown;
    if (item.type === "jsonBlock") candidate = (item as { json?: unknown }).json;
    else if (item.type === "textBlock" && item.text?.trim().startsWith("{")) {
      try {
        candidate = JSON.parse(item.text);
      } catch {
        continue;
      }
    }
    if (candidate && typeof candidate === "object" && key in candidate) return candidate as T;
  }
  return null;
}

const SPANISH_PLAY = spanishPattern(String.raw`\b(?:pon|ponme|ponla|reproduce|escuchar|escucha|oír|léeme)\b`);
// "más nueva" is the superlative ("the newest"), a play request like English "newest".
const SPANISH_LIST = spanishPattern(String.raw`\b(?:qué|cuál|cuáles|lista|disponibles?|(?<!más\s)nuev[ao]s?)\b`);
const SPANISH_NEXT = spanishPattern(String.raw`\b(?:otra|otro|siguiente|distinta)\b`);

function wantsPlayback(text: string): boolean {
  return (/\b(play|listen|hear|put on)\b/i.test(text) || SPANISH_PLAY.test(text))
    && !/\b(what|which|list|new|available)\b/i.test(text) && !SPANISH_LIST.test(text);
}

function wantsNext(text: string): boolean {
  return /\b(another|next|different|else)\b/i.test(text) || SPANISH_NEXT.test(text);
}

type Replies = {
  unreachable: string;
  none: string;
  listed: (count: number, title: string, storyteller: string) => string;
  playing: (title: string, storyteller: string) => string;
  unavailable: string;
  done: string;
};

/** The scripted replies; Spanish when the system prompt carries the Spanish language line (plan SS5). */
const REPLIES: Record<SkillLocale, Replies> = {
  "en-US": {
    unreachable: "I couldn't reach the family stories just now. Try again in a moment.",
    none: "No stories have been delivered yet. Deliver one in Spoken Letter first.",
    listed: (count, title, storyteller) => `You have ${count} delivered ${count === 1 ? "story" : "stories"}. The newest is "${title}" by ${storyteller}.`,
    playing: (title, storyteller) => `Here is "${title}" in ${storyteller}'s voice.`,
    unavailable: "That story's recording is not available right now. Try another one.",
    done: "Done.",
  },
  "es-ES": {
    unreachable: "No he podido acceder a las historias familiares. Inténtalo de nuevo en un momento.",
    none: "Todavía no te ha llegado ninguna historia. Primero envía una desde Spoken Letter.",
    listed: (count, title, storyteller) => `Tienes ${count} ${count === 1 ? "historia" : "historias"}. La más reciente es "${title}", de ${storyteller}.`,
    playing: (title, storyteller) => `Aquí tienes "${title}", con la voz de ${storyteller}.`,
    unavailable: "La grabación de esa historia no está disponible ahora mismo. Prueba con otra.",
    done: "Hecho.",
  },
};

/** Counts stories already played in the conversation so "another" moves on. */
function playedCount(messages: Message[]): number {
  let count = 0;
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const block of blocks(message)) if (block.type === "toolUseBlock" && block.name === "get_family_story") count += 1;
  }
  return count;
}

export class ScriptedModel extends Model {
  private config: BaseModelConfig = { modelId: "scripted" };

  updateConfig(modelConfig: BaseModelConfig): void {
    this.config = { ...this.config, ...modelConfig };
  }

  getConfig(): BaseModelConfig {
    return this.config;
  }

  async *stream(messages: Message[], options?: StreamOptions): AsyncIterable<ModelStreamEvent> {
    const last = messages.at(-1);
    const userText = [...messages].reverse().flatMap((m) => (m.role === "user" ? blocks(m) : [])).find((b) => b.type === "textBlock")?.text ?? "";
    const structuredTool = options?.toolSpecs?.find((spec) => spec.name === STRUCTURED_OUTPUT_TOOL)?.name;
    const replies = REPLIES[typeof options?.systemPrompt === "string" && options.systemPrompt.includes(SPANISH_LANGUAGE_LINE) ? "es-ES" : "en-US"];

    const toolResult = last?.role === "user" ? blocks(last).find((b) => b.type === "toolResultBlock") : undefined;
    const previousToolUse = toolResult
      ? [...messages].reverse().flatMap((m) => (m.role === "assistant" ? blocks(m) : [])).find((b) => b.type === "toolUseBlock")
      : undefined;

    const emitToolUse = (name: string, input: unknown): ModelStreamEvent[] => [
      new ModelMessageStartEvent({ type: "modelMessageStartEvent", role: "assistant" }),
      new ModelContentBlockStartEvent({
        type: "modelContentBlockStartEvent",
        start: { type: "toolUseStart", name, toolUseId: `tu_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}` },
      }),
      new ModelContentBlockDeltaEvent({ type: "modelContentBlockDeltaEvent", delta: { type: "toolUseInputDelta", input: JSON.stringify(input) } }),
      new ModelContentBlockStopEvent({ type: "modelContentBlockStopEvent" }),
      new ModelMessageStopEvent({ type: "modelMessageStopEvent", stopReason: "toolUse" }),
    ];
    const emitReply = (output: TurnOutput): ModelStreamEvent[] =>
      structuredTool
        ? emitToolUse(structuredTool, output)
        : [
            new ModelMessageStartEvent({ type: "modelMessageStartEvent", role: "assistant" }),
            new ModelContentBlockStartEvent({ type: "modelContentBlockStartEvent" }),
            new ModelContentBlockDeltaEvent({ type: "modelContentBlockDeltaEvent", delta: { type: "textDelta", text: JSON.stringify(output) } }),
            new ModelContentBlockStopEvent({ type: "modelContentBlockStopEvent" }),
            new ModelMessageStopEvent({ type: "modelMessageStopEvent", stopReason: "endTurn" }),
          ];

    let events: ModelStreamEvent[];
    if (!toolResult || !previousToolUse) {
      events = emitToolUse("list_family_stories", {});
    } else if (toolResult.status === "error" || firstJson<ErrorJson>(toolResult.content, "error")) {
      events = emitReply({ say: replies.unreachable, play: null });
    } else if (previousToolUse.name === "list_family_stories") {
      const list = firstJson<ListJson>(toolResult.content, "stories");
      const stories = list?.stories ?? [];
      const newest = stories[0];
      if (!newest) {
        events = emitReply({ say: replies.none, play: null });
      } else if (!wantsPlayback(userText)) {
        events = emitReply({ say: replies.listed(stories.length, newest.title, newest.storyteller), play: null });
      } else {
        const offset = wantsNext(userText) ? playedCount(messages) : 0;
        const pick = stories[offset % stories.length] ?? newest;
        events = emitToolUse("get_family_story", { storyId: pick.id });
      }
    } else if (previousToolUse.name === "get_family_story") {
      const story = firstJson<StoryWithAudioJson>(toolResult.content, "audio");
      events = story
        ? emitReply({
            say: replies.playing(story.title, story.storyteller),
            play: {
              id: story.id,
              url: story.audio.url,
              title: story.title,
              storyteller: story.storyteller,
              durationSeconds: story.durationSeconds ?? null,
              artUrl: story.artUrl ?? null,
            },
          })
        : emitReply({ say: replies.unavailable, play: null });
    } else {
      events = emitReply({ say: replies.done, play: null });
    }
    for (const event of events) yield event;
    await Promise.resolve();
  }
}
