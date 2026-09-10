import { emfEnvelope, log } from "@spoken-letter-alexa/shared";

import { AgentHttpError, type AgentClient } from "./agent-client.ts";
import { type AudioDirective, decodeStreamToken, playDirective, STOP_DIRECTIVE } from "./audio.ts";

type Slot = { name: string; value?: string };

export type AlexaRequestEnvelope = {
  version: string;
  session?: { new: boolean; sessionId: string; application: { applicationId: string }; user: { userId: string } };
  context: {
    System: { application: { applicationId: string }; user: { userId: string } };
    AudioPlayer?: { token?: string; offsetInMilliseconds?: number; playerActivity?: string };
  };
  request: {
    type: string;
    requestId: string;
    timestamp: string;
    locale?: string;
    intent?: { name: string; slots?: Record<string, Slot> };
    token?: string;
    offsetInMilliseconds?: number;
    /** `SessionEndedRequest` only: why the session ended. */
    reason?: string;
    /** `SessionEndedRequest` only: present when `reason` is `"ERROR"`. */
    error?: { type: string; message: string };
  };
};

type OutputSpeech = { type: "SSML"; ssml: string };

export type AlexaResponseEnvelope = {
  version: "1.0";
  response: {
    outputSpeech?: OutputSpeech;
    reprompt?: { outputSpeech: OutputSpeech };
    directives?: AudioDirective[];
    shouldEndSession?: boolean;
  };
};

export type HandlerOptions = {
  /** `context.System.application.applicationId` must match; Amazon's check for Lambda endpoints. */
  skillId: string;
  agent: AgentClient;
  /** Recording mode (phase-9.md section 3): called with every catch-all phrasing. */
  recordUtterance?: ((utterance: { locale: string; text: string }) => void) | undefined;
  /** Phase 1 section 3: `say` is model output, only logged for a deliberate recorded session. */
  logSay?: boolean | undefined;
};

export type SkillHandler = (event: AlexaRequestEnvelope) => Promise<AlexaResponseEnvelope>;

const REPROMPT = "You can say: play the story Grandpa sent, or ask what is new.";
const LAUNCH = "Spoken Letter. Which family story would you like?";
const HELP = "You can say: play the story Grandpa sent, or ask what is new. Which would you like?";
const RETRY = "I'm still looking for that one. Ask again in a moment.";
const NOTHING_TO_RESUME = "There is nothing to resume. Ask for a family story first.";
const NOTHING_TO_PLAY = "Which family story would you like? You can say: play the story Grandpa sent.";

const SAY_LOG_LIMIT = 120;

function escapeSsml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function ssml(text: string): OutputSpeech {
  return { type: "SSML", ssml: `<speak>${escapeSsml(text)}</speak>` };
}

function speak(text: string, options: { reprompt?: string; endSession: boolean; directives?: AudioDirective[] }): AlexaResponseEnvelope {
  return {
    version: "1.0",
    response: {
      outputSpeech: ssml(text),
      ...(options.reprompt !== undefined && { reprompt: { outputSpeech: ssml(options.reprompt) } }),
      ...(options.directives && { directives: options.directives }),
      shouldEndSession: options.endSession,
    },
  };
}

const EMPTY: AlexaResponseEnvelope = { version: "1.0", response: {} };

/** A question: the session stays open with the standard reprompt. */
const ask = (text: string) => speak(text, { reprompt: REPROMPT, endSession: false });
/** A closing line, optionally with playback: the session ends. */
const tell = (text: string, directives?: AudioDirective[]) => speak(text, { endSession: true, ...(directives && { directives }) });
/** Playback control without speech. */
const control = (directives: AudioDirective[]): AlexaResponseEnvelope => ({ version: "1.0", response: { directives, shouldEndSession: true } });

function slotValue(event: AlexaRequestEnvelope, name: string): string | undefined {
  const value = event.request.intent?.slots?.[name]?.value?.trim();
  return value === undefined || value === "" ? undefined : value;
}

/** `slots` as `skill_turn` logs it: names to values, `{}` when the intent carries none, absent for non-intent requests. */
function loggedSlots(event: AlexaRequestEnvelope): Record<string, string | null> | undefined {
  const slots = event.request.intent?.slots;
  if (slots === undefined) return undefined;
  return Object.fromEntries(Object.entries(slots).map(([name, slot]) => [name, slot.value ?? null]));
}

type IntentText = {
  text: string;
  /** Whether a successful turn for this intent is expected to play a story (phase-1.md `DeadEndPlay`); the one place that fact is decided. */
  playOriented: boolean;
};

/** The one line of text the agent receives for an intent (phase-9.md section 2). */
function textForIntent(event: AlexaRequestEnvelope): IntentText | null {
  const name = event.request.intent?.name;
  switch (name) {
    case "PlayStoryIntent": {
      const title = slotValue(event, "title");
      const storyteller = slotValue(event, "storyteller");
      if (title && storyteller) return { text: `play the story ${title} by ${storyteller}`, playOriented: true };
      if (title) return { text: `play the story ${title}`, playOriented: true };
      if (storyteller) return { text: `play the story ${storyteller} sent`, playOriented: true };
      return { text: "play a family story", playOriented: true };
    }
    case "WhatIsNewIntent":
      return { text: "what family stories are new?", playOriented: false };
    case "NextStoryIntent":
      return { text: "play the next family story", playOriented: true };
    case "CatchAllIntent": {
      const text = slotValue(event, "text");
      return text === undefined ? null : { text, playOriented: false };
    }
    default:
      return null;
  }
}

/** `outcome`/`errorClass` for an agent-turn failure (phase-1.md section 1). */
function classifyError(error: unknown): { outcome: "agent_error" | "timeout" | "rejected"; errorClass: string } {
  if (error instanceof AgentHttpError) return { outcome: "rejected", errorClass: `${error.constructor.name}:${error.code}` };
  if (error instanceof DOMException && error.name === "AbortError") return { outcome: "timeout", errorClass: error.constructor.name };
  if (error instanceof Error) return { outcome: "agent_error", errorClass: error.constructor.name };
  return { outcome: "agent_error", errorClass: "UnknownError" };
}

type Telemetry = {
  intent?: string;
  slots?: Record<string, string | null>;
  played: boolean;
  playOriented: boolean;
  storyId?: string | null;
  tools: string[];
  say?: string;
  outcome: "ok" | "agent_error" | "timeout" | "rejected";
  errorClass?: string;
};

/**
 * Alexa request envelope in, SSML plus AudioPlayer directives out. The Lambda never talks
 * to `/mcp`: the agent does, over the same JWT-gated endpoint Alexa+ uses. Only the parent
 * speaks to the device; the reply never carries a name beyond the storyteller's.
 */
export function createHandler(options: HandlerOptions): SkillHandler {
  return async (event) => {
    const applicationId = event.context.System.application.applicationId;
    if (!applicationId || applicationId !== options.skillId) {
      throw new Error(`Rejected request for application id ${JSON.stringify(applicationId)}`);
    }
    const { type } = event.request;
    const locale = event.request.locale ?? "en-US";
    const started = performance.now();
    const telemetry: Telemetry = { played: false, playOriented: false, tools: [], outcome: "ok" };

    async function respond(): Promise<AlexaResponseEnvelope> {
      if (type === "LaunchRequest") return ask(LAUNCH);
      if (type === "SessionEndedRequest" || type.startsWith("AudioPlayer.") || type.startsWith("PlaybackController.")) return EMPTY;
      if (type !== "IntentRequest") return ask(HELP);

      const intent = event.request.intent?.name ?? "";
      telemetry.intent = intent;
      const slots = loggedSlots(event);
      if (slots !== undefined) telemetry.slots = slots;

      switch (intent) {
        case "AMAZON.PauseIntent":
        case "AMAZON.StopIntent":
        case "AMAZON.CancelIntent":
          return control([STOP_DIRECTIVE]);
        case "AMAZON.ResumeIntent": {
          const token = event.context.AudioPlayer?.token;
          const play = token ? decodeStreamToken(token) : null;
          if (!play) return ask(NOTHING_TO_RESUME);
          return control([playDirective(play, event.context.AudioPlayer?.offsetInMilliseconds ?? 0)]);
        }
        case "AMAZON.HelpIntent":
        case "AMAZON.FallbackIntent":
          return ask(HELP);
        default:
          break;
      }

      const intentText = textForIntent(event);
      if (intentText === null) return ask(NOTHING_TO_PLAY);
      const { text, playOriented } = intentText;
      telemetry.playOriented = playOriented;
      if (intent === "CatchAllIntent") options.recordUtterance?.({ locale, text });

      const deviceUserId = event.context.System.user.userId;
      try {
        const reply = await options.agent.turn({ deviceUserId, text });
        telemetry.say = reply.say;
        telemetry.tools = reply.toolCalls.map((call) => `${call.name}:${call.ms}ms`);
        telemetry.played = Boolean(reply.play);
        telemetry.storyId = reply.play?.id ?? null;
        return reply.play ? tell(reply.say, [playDirective(reply.play)]) : ask(reply.say);
      } catch (error) {
        const { outcome, errorClass } = classifyError(error);
        telemetry.outcome = outcome;
        telemetry.errorClass = errorClass;
        return ask(RETRY);
      }
    }

    try {
      return await respond();
    } finally {
      const ms = Math.round(performance.now() - started);
      const dimensionIntent = telemetry.intent ?? type;
      const envelope = emfEnvelope(process.env.EMF_NAMESPACE, { Intent: dimensionIntent }, [
        { name: "SkillTurnMs", value: ms, unit: "Milliseconds", dimensionSets: [["Intent"], []] },
        { name: "DeadEndPlay", value: telemetry.playOriented && !telemetry.played ? 1 : 0, unit: "Count", dimensionSets: [[]] },
      ]);
      log.info("skill_turn", {
        requestType: type,
        ...(telemetry.intent !== undefined && { intent: telemetry.intent }),
        ...(telemetry.slots !== undefined && { slots: telemetry.slots }),
        ...(type === "SessionEndedRequest" && { reason: event.request.reason, error: event.request.error }),
        ms,
        played: telemetry.played,
        ...(telemetry.storyId !== undefined && { storyId: telemetry.storyId }),
        tools: telemetry.tools,
        ...(options.logSay && telemetry.say !== undefined && { say: telemetry.say.slice(0, SAY_LOG_LIMIT) }),
        outcome: telemetry.outcome,
        ...(telemetry.errorClass !== undefined && { errorClass: telemetry.errorClass }),
        ...envelope,
      });
    }
  };
}
