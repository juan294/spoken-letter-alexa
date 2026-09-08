import { log } from "@spoken-letter-alexa/shared";

import { type AgentClient } from "./agent-client.ts";
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
};

export type SkillHandler = (event: AlexaRequestEnvelope) => Promise<AlexaResponseEnvelope>;

const REPROMPT = "You can say: play the story Grandpa sent, or ask what is new.";
const LAUNCH = "Spoken Letter. Which family story would you like?";
const HELP = "You can say: play the story Grandpa sent, or ask what is new. Which would you like?";
const RETRY = "I'm still looking for that one. Ask again in a moment.";
const NOTHING_TO_RESUME = "There is nothing to resume. Ask for a family story first.";
const NOTHING_TO_PLAY = "Which family story would you like? You can say: play the story Grandpa sent.";

export function escapeSsml(text: string): string {
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

function slotValue(event: AlexaRequestEnvelope, name: string): string | undefined {
  const value = event.request.intent?.slots?.[name]?.value?.trim();
  return value === undefined || value === "" ? undefined : value;
}

/** The one line of text the agent receives for an intent (phase-9.md section 2). */
export function textForIntent(event: AlexaRequestEnvelope): string | null {
  const name = event.request.intent?.name;
  switch (name) {
    case "PlayStoryIntent": {
      const title = slotValue(event, "title");
      const storyteller = slotValue(event, "storyteller");
      if (title && storyteller) return `play the story ${title} by ${storyteller}`;
      if (title) return `play the story ${title}`;
      if (storyteller) return `play the story ${storyteller} sent`;
      return "play a family story";
    }
    case "WhatIsNewIntent":
      return "what family stories are new?";
    case "NextStoryIntent":
      return "play the next family story";
    case "CatchAllIntent":
      return slotValue(event, "text") ?? null;
    default:
      return null;
  }
}

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

    if (type === "LaunchRequest") return speak(LAUNCH, { reprompt: REPROMPT, endSession: false });
    if (type === "SessionEndedRequest" || type.startsWith("AudioPlayer.") || type.startsWith("PlaybackController.")) return EMPTY;
    if (type !== "IntentRequest") return speak(HELP, { reprompt: REPROMPT, endSession: false });

    const intent = event.request.intent?.name ?? "";
    switch (intent) {
      case "AMAZON.PauseIntent":
      case "AMAZON.StopIntent":
      case "AMAZON.CancelIntent":
        return { version: "1.0", response: { directives: [STOP_DIRECTIVE], shouldEndSession: true } };
      case "AMAZON.ResumeIntent": {
        const token = event.context.AudioPlayer?.token;
        const play = token ? decodeStreamToken(token) : null;
        if (!play) return speak(NOTHING_TO_RESUME, { reprompt: REPROMPT, endSession: false });
        return { version: "1.0", response: { directives: [playDirective(play, event.context.AudioPlayer?.offsetInMilliseconds ?? 0)], shouldEndSession: true } };
      }
      case "AMAZON.HelpIntent":
      case "AMAZON.FallbackIntent":
        return speak(HELP, { reprompt: REPROMPT, endSession: false });
      default:
        break;
    }

    const text = textForIntent(event);
    if (text === null) return speak(NOTHING_TO_PLAY, { reprompt: REPROMPT, endSession: false });
    if (intent === "CatchAllIntent") options.recordUtterance?.({ locale, text });

    const deviceUserId = event.context.System.user.userId;
    try {
      const reply = await options.agent.turn({ deviceUserId, text });
      log.info("skill_turn", { intent, tools: reply.toolCalls.map((call) => `${call.name}:${call.ms}ms`), played: Boolean(reply.play) });
      if (reply.play) return speak(reply.say, { endSession: true, directives: [playDirective(reply.play)] });
      return speak(reply.say, { reprompt: REPROMPT, endSession: false });
    } catch (error) {
      log.warn("skill_turn_failed", { intent, message: error instanceof Error ? error.message : String(error) });
      return speak(RETRY, { reprompt: REPROMPT, endSession: false });
    }
  };
}
