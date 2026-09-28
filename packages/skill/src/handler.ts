import { emfEnvelope, log } from "@spoken-letter-alexa/shared";

import { AgentHttpError, type AgentClient, type PlaylistCommand, type PlaylistReply } from "./agent-client.ts";
import { type AudioDirective, decodeStreamToken, playDirective, STOP_DIRECTIVE } from "./audio.ts";
import { scheduleProgressiveResponse } from "./progressive.ts";

type Slot = { name: string; value?: string };

export type AlexaRequestEnvelope = {
  version: string;
  session?: { new: boolean; sessionId: string; application: { applicationId: string }; user: { userId: string } };
  context: {
    System: {
      application: { applicationId: string };
      user: { userId: string };
      /** Directive Service base URL, for a progressive response while the agent call is in flight (phase-2.md section 2). */
      apiEndpoint?: string;
      apiAccessToken?: string;
    };
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
  /** Test injection point for the Directive Service call (phase-2.md section 2); defaults to global `fetch`. */
  progressiveFetch?: typeof fetch | undefined;
};

export type SkillHandler = (event: AlexaRequestEnvelope) => Promise<AlexaResponseEnvelope>;

const REPROMPT = "You can say: play my stories, or ask what is new.";
const LAUNCH = "Spoken Letter. Which family story would you like?";
const HELP = "You can say: play my stories, or ask what is new. Which would you like?";
const RETRY = "I'm still looking for that one. Ask again in a moment.";
const NOTHING_TO_RESUME = "There is nothing to resume. Ask for a family story first.";
const NOTHING_TO_PLAY = "Which family story would you like? You can say: play my stories.";
const NOTHING_TO_GO_BACK_TO = "That was the first one. Ask for another story instead.";
const ONE_AT_A_TIME = "I play family stories one at a time.";
const NO_PLAY = "Which delivered story would you like? You can name a title, or say play my stories.";

/** Catalog-aware filler for the progressive response, never a generic "one moment" (phase-2.md section 2). */
function progressiveText(playOriented: boolean): string {
  return playOriented ? "Looking for that one." : "Checking what's new.";
}

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

/** Resume, start over and repeat all decode the current AudioPlayer token and re-issue a play directive, differing only in the offset. */
function resumablePlay(event: AlexaRequestEnvelope, offsetInMilliseconds: number): AlexaResponseEnvelope {
  const token = event.context.AudioPlayer?.token;
  const play = token ? decodeStreamToken(token) : null;
  if (!play) return ask(NOTHING_TO_RESUME);
  return control([playDirective(play, offsetInMilliseconds)]);
}

function slotValue(event: AlexaRequestEnvelope, name: string): string | undefined {
  const value = event.request.intent?.slots?.[name]?.value?.trim();
  return value === undefined || value === "" ? undefined : value;
}

/** Best-effort title from a play request that Alexa routed through CatchAllIntent. */
function catchAllTitle(text: string): string | undefined {
  const stripped = text
    .replace(/^(?:please\s+)?(?:play|put on|listen to|hear)\s+/i, "")
    .replace(/^(?:(?:the|a)\s+)?(?:story\s+)?(?:called\s+)?/i, "")
    .replace(/\s+one$/i, "")
    .trim();
  return stripped && stripped !== text && stripped.length <= 200 ? stripped : undefined;
}

/** `slots` as `skill_turn` logs it: names to values, `{}` when the intent carries none, absent for non-intent requests. */
function loggedSlots(event: AlexaRequestEnvelope): Record<string, string | null> | undefined {
  const slots = event.request.intent?.slots;
  if (slots === undefined) return undefined;
  return Object.fromEntries(Object.keys(slots).map((name) => [name, null]));
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
    case "AMAZON.NextIntent":
      // Both route identically (phase-3.md section 1 "Routing note"): NextStoryIntent's
      // samples stay, since the generator binds that intent name to suggest_next_story.
      return { text: "play the next family story", playOriented: true };
    case "CatchAllIntent": {
      const text = slotValue(event, "text");
      return text === undefined ? null : {
        text,
        playOriented: /\b(play|hear|listen|put on)\b/i.test(text) && !/\b(what|which|list|new|available)\b/i.test(text),
      };
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
    const started = performance.now();
    const telemetry: Telemetry = { played: false, playOriented: false, tools: [], outcome: "ok" };

    async function respond(): Promise<AlexaResponseEnvelope> {
      if (type === "LaunchRequest") return ask(LAUNCH);
      const deviceUserId = event.context.System.user.userId;
      const playlist = options.agent.playlist;
      const playlistResult = (reply: PlaylistReply): AlexaResponseEnvelope => {
        if (reply.action === "play" && reply.play && reply.token) {
          telemetry.played = true;
          telemetry.storyId = reply.play.id;
          const directive = playDirective(reply.play, reply.offsetInMilliseconds ?? 0, {
            token: reply.token,
            ...(reply.playBehavior === "ENQUEUE" && reply.expectedPreviousToken && { expectedPreviousToken: reply.expectedPreviousToken }),
          });
          return reply.say ? tell(reply.say, [directive]) : control([directive]);
        }
        return reply.say ? ask(reply.say) : EMPTY;
      };
      const command = async (input: Omit<PlaylistCommand, "deviceUserId">): Promise<AlexaResponseEnvelope> => {
        if (!playlist) return ask(NO_PLAY);
        try {
          return playlistResult(await playlist({ deviceUserId, ...input }));
        } catch (error) {
          const { outcome, errorClass } = classifyError(error);
          telemetry.outcome = outcome;
          telemetry.errorClass = errorClass;
          return type.startsWith("AudioPlayer.") ? EMPTY : ask(RETRY);
        }
      };
      if (type === "SessionEndedRequest") return EMPTY;
      if (type === "AudioPlayer.PlaybackNearlyFinished" || type === "AudioPlayer.PlaybackFinished") {
        if (!playlist || !event.request.token) return EMPTY;
        try {
          return await command({
            command: type === "AudioPlayer.PlaybackNearlyFinished" ? "nearlyFinished" : "finished",
            observedToken: event.request.token,
            eventId: event.request.requestId,
          });
        } catch (error) {
          log.warn("playlist_event_failed", { event: type, errorClass: error instanceof Error ? error.constructor.name : "UnknownError" });
          return EMPTY;
        }
      }
      if (type.startsWith("AudioPlayer.") || type.startsWith("PlaybackController.")) return EMPTY;
      if (type !== "IntentRequest") return ask(HELP);

      const intent = event.request.intent?.name ?? "";
      const observed = event.context.AudioPlayer?.token;
      const tokenInput = observed ? { observedToken: observed } : {};
      telemetry.intent = intent;
      const slots = loggedSlots(event);
      if (slots !== undefined) telemetry.slots = slots;

      switch (intent) {
        case "AMAZON.PauseIntent":
        case "AMAZON.StopIntent":
        case "AMAZON.CancelIntent":
          return control([STOP_DIRECTIVE]);
        case "AMAZON.ResumeIntent":
          if (playlist) {
            if (!observed) return ask(NOTHING_TO_RESUME);
            return command({ command: "resume", observedToken: observed, offsetInMilliseconds: event.context.AudioPlayer?.offsetInMilliseconds ?? 0 });
          }
          return resumablePlay(event, event.context.AudioPlayer?.offsetInMilliseconds ?? 0);
        case "AMAZON.StartOverIntent":
        case "AMAZON.RepeatIntent":
        case "PlayAgainIntent":
          if (playlist) return command({ command: "restart", ...tokenInput });
          return resumablePlay(event, 0);
        case "AMAZON.PreviousIntent":
          if (playlist) return command({ command: "previous", ...tokenInput });
          return ask(NOTHING_TO_GO_BACK_TO);
        case "AMAZON.LoopOnIntent":
        case "AMAZON.LoopOffIntent":
        case "AMAZON.ShuffleOnIntent":
        case "AMAZON.ShuffleOffIntent":
          // Acknowledged, not silently ignored — a skill that answers nothing reads as broken.
          return ask(ONE_AT_A_TIME);
        case "AMAZON.HelpIntent":
        case "AMAZON.FallbackIntent":
          return ask(HELP);
        default:
          break;
      }

      if (playlist) {
        if (intent === "PlayAllIntent") return command({ command: "start", order: "shuffle" });
        if (intent === "PlayNewStoriesIntent") return command({ command: "start", order: "newest" });
        if (intent === "PlayCreatorStoriesIntent") {
          const storyteller = slotValue(event, "storyteller");
          return storyteller ? command({ command: "start", order: "shuffle", storyteller }) : ask("Which adult storyteller do you mean?");
        }
        if (intent === "StartPlaylistOverIntent") return command({ command: "reset", ...tokenInput });
        if (intent === "PlayStoryIntent") {
          const title = slotValue(event, "title");
          const storyteller = slotValue(event, "storyteller");
          if (title) return command({ command: "title", title, ...(storyteller && { storyteller }) });
          return command({ command: "start", order: "shuffle", ...(storyteller && { storyteller }) });
        }
        if (intent === "NextStoryIntent" || intent === "AMAZON.NextIntent") {
          try {
            const reply = await playlist({ deviceUserId, command: "next", ...tokenInput });
            if (!reply.fallbackToSuggestion) return playlistResult(reply);
          } catch (error) {
            const { outcome, errorClass } = classifyError(error);
            telemetry.outcome = outcome;
            telemetry.errorClass = errorClass;
            return ask(RETRY);
          }
          // Without an active playlist, preserve the existing suggestion behavior.
        }
      }

      const intentText = textForIntent(event);
      if (intentText === null) return ask(NOTHING_TO_PLAY);
      const { text, playOriented } = intentText;
      telemetry.playOriented = playOriented;
      // Catch-all text can include a child's name. Keep it out of recording telemetry.

      const { apiEndpoint, apiAccessToken } = event.context.System;
      const progressive =
        apiEndpoint && apiAccessToken
          ? scheduleProgressiveResponse({
              apiEndpoint,
              apiAccessToken,
              requestId: event.request.requestId,
              text: progressiveText(playOriented),
              fetch: options.progressiveFetch,
            })
          : undefined;

      try {
        const reply = await options.agent.turn({ deviceUserId, text });
        telemetry.tools = reply.toolCalls.map((call) => `${call.name}:${call.ms}ms`);
        telemetry.played = Boolean(reply.play);
        telemetry.storyId = reply.play?.id ?? null;
        if (reply.play) return tell(reply.say, [playDirective(reply.play)]);
        if (playOriented && reply.needsAnswer !== true && playlist && intent === "CatchAllIntent") {
          const title = catchAllTitle(text);
          return await command(title ? { command: "title", title } : { command: "start", order: "newest" });
        }
        if (playOriented && reply.needsAnswer !== true && playlist && (intent === "NextStoryIntent" || intent === "AMAZON.NextIntent")) {
          try {
            return playlistResult(await playlist({ deviceUserId, command: "start", order: "newest" }));
          } catch (error) {
            const { outcome, errorClass } = classifyError(error);
            telemetry.outcome = outcome;
            telemetry.errorClass = errorClass;
            return ask(RETRY);
          }
        }
        return ask(playOriented && reply.needsAnswer !== true ? NO_PLAY : reply.say);
      } catch (error) {
        const { outcome, errorClass } = classifyError(error);
        telemetry.outcome = outcome;
        telemetry.errorClass = errorClass;
        return ask(RETRY);
      } finally {
        // The agent settled — a progressive response would only be spoken over a still-open turn.
        progressive?.cancel();
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
        ...(type === "SessionEndedRequest" && { reason: event.request.reason, error: event.request.error?.type }),
        ms,
        played: telemetry.played,
        ...(telemetry.storyId !== undefined && { storyId: telemetry.storyId }),
        tools: telemetry.tools,
        outcome: telemetry.outcome,
        ...(telemetry.errorClass !== undefined && { errorClass: telemetry.errorClass }),
        ...envelope,
      });
    }
  };
}
