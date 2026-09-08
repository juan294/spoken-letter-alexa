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

import { type TurnOutput } from "./schema.ts";

const STRUCTURED_OUTPUT_TOOL = "strands_structured_output";

type StoryJson = { id: string; title: string; storyteller: string; durationSeconds?: number };
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

function wantsPlayback(text: string): boolean {
  return /\b(play|listen|hear|put on)\b/i.test(text) && !/\b(what|which|list|new|available)\b/i.test(text);
}

function wantsNext(text: string): boolean {
  return /\b(another|next|different|else)\b/i.test(text);
}

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
      events = emitReply({ say: "I couldn't reach the family stories just now. Try again in a moment.", play: null });
    } else if (previousToolUse.name === "list_family_stories") {
      const list = firstJson<ListJson>(toolResult.content, "stories");
      const stories = list?.stories ?? [];
      const newest = stories[0];
      if (!newest) {
        events = emitReply({ say: "No stories have been delivered yet. Deliver one in Spoken Letter first.", play: null });
      } else if (!wantsPlayback(userText)) {
        events = emitReply({
          say: `You have ${stories.length} delivered ${stories.length === 1 ? "story" : "stories"}. The newest is "${newest.title}" by ${newest.storyteller}.`,
          play: null,
        });
      } else {
        const offset = wantsNext(userText) ? playedCount(messages) : 0;
        const pick = stories[offset % stories.length] ?? newest;
        events = emitToolUse("get_family_story", { storyId: pick.id });
      }
    } else if (previousToolUse.name === "get_family_story") {
      const story = firstJson<StoryWithAudioJson>(toolResult.content, "audio");
      events = story
        ? emitReply({
            say: `Here is "${story.title}" in ${story.storyteller}'s voice.`,
            play: { url: story.audio.url, title: story.title, storyteller: story.storyteller, durationSeconds: story.durationSeconds ?? null },
          })
        : emitReply({ say: "That story's recording is not available right now. Try another one.", play: null });
    } else {
      events = emitReply({ say: "Done.", play: null });
    }
    for (const event of events) yield event;
    await Promise.resolve();
  }
}
