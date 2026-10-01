import { createHash } from "node:crypto";

import { emfEnvelope, log } from "@spoken-letter-alexa/shared";

import { AgentHttpError, type AgentClient, type PlaylistCommand, type PlaylistReply } from "./agent-client.ts";
import { type AudioDirective, decodeStreamToken, playDirective, STOP_DIRECTIVE } from "./audio.ts";
import { scheduleProgressiveResponse } from "./progressive.ts";
import interactionModel from "../skill-package/interactionModels/custom/en-US.json" with { type: "json" };

type Slot = { name: string; value?: string };

export type AlexaRequestEnvelope = {
  version: string;
  session?: { new: boolean; sessionId: string; application: { applicationId: string }; user: { userId: string }; attributes?: Record<string, string> };
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
  sessionAttributes?: Record<string, string>;
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
  /** Deprecated compatibility control. Raw speech recording is intentionally disabled. */
  recordUtterance?: ((utterance: { locale: string; text: string }) => void) | undefined;
  /** Deprecated compatibility control. Model speech logging is intentionally disabled. */
  logSay?: boolean | undefined;
  /** Test injection point for the Directive Service call (phase-2.md section 2); defaults to global `fetch`. */
  progressiveFetch?: typeof fetch | undefined;
};

export type SkillHandler = (event: AlexaRequestEnvelope) => Promise<AlexaResponseEnvelope>;

const REPROMPT = "You can say: play my stories, or ask what is new.";
const LAUNCH = "Spoken Letter. Which family story would you like?";
const HELP = "You can say play my stories, ask what is new, or say let's create a story. For delivery and credits, use Spoken Letter. Which would you like?";
const RETRY = "I'm still looking for that one. Ask again in a moment.";
const NOTHING_TO_RESUME = "There is nothing to resume. Ask for a family story first.";
const NOTHING_TO_PLAY = "Which family story would you like? You can say: play my stories.";
const NOTHING_TO_GO_BACK_TO = "That was the first one. Ask for another story instead.";
const ONE_AT_A_TIME = "I play family stories one at a time.";
const NO_PLAY = "Which delivered story would you like? You can name a title, or say play my stories.";
const THEME_PROMPT = "What would you like your story to be about? You can say mermaids or space.";
const DRAFT_UNAVAILABLE = "No draft was saved. You can try another theme in a moment.";
const DRAFT_UNSUPPORTED = "No draft was saved. Try a theme such as mermaids or space.";
const DRAFT_LIMIT = "No draft was saved. You can say read my draft, or try creating another later.";
const REACTION_REPROMPT = "You can say I like it, I love it, or no.";
const WISH_REPROMPT = "You can say yes or no.";
const WISH_START = "To start a wish, say I want a story about space.";
const NAMED_HANDOFF = "I can help you start a story. Open Spoken Letter to choose the listener and send it.";
const CREDITS_HELP = "You can add story credits in Spoken Letter.";
const CREATION_HELP = "To get started here, say let's create a story. You can finish your draft, record a story, and choose who to send it to in Spoken Letter.";
const REACTION_UNAVAILABLE = "No reaction was saved. You can say like or love again.";
const WISH_UNAVAILABLE = "No wish was saved. You can try again.";
const storytellerValues = interactionModel.interactionModel.languageModel.types.find((type) => type.name === "StorytellerName")?.values ?? [];
const SAFE_STORYTELLERS = new Set(storytellerValues.map((entry) => entry.name.value));
const STORYTELLER_ALIASES = new Map(storytellerValues.flatMap((entry) =>
  [entry.name.value, ...entry.name.synonyms].map((alias) => [alias.toLocaleLowerCase("en-US"), entry.name.value] as const)));

/** Only fixture-safe topics cross the skill session boundary. */
function safeDemoTopic(speech: string | undefined): string | null {
  if (!speech) return null;
  const text = speech.toLocaleLowerCase("en-US");
  const topics: [string, RegExp][] = [
    ["mermaids", /\bmermaids?\b/], ["space", /\b(?:space|stars?|planets?)\b/],
    ["ocean", /\b(?:ocean|sea|beach)\b/], ["forest", /\b(?:forest|woods?)\b/],
    ["animals", /\b(?:animals?|cats?|dogs?)\b/], ["friendship", /\b(?:friends?|friendship)\b/],
    ["bedtime", /\b(?:bedtime|sleep)\b/],
  ];
  return topics.find(([, pattern]) => pattern.test(text))?.[0] ?? null;
}

const SAFE_TOPICS = new Set(["mermaids", "space", "ocean", "forest", "animals", "friendship", "bedtime"]);

/** Rebuild only code-owned state; neither arbitrary attributes nor wish prose can survive. */
function validatedSession(attributes: Record<string, string> | undefined): Record<string, string> {
  const state: Record<string, string> = {};
  const flow = attributes?.demoFlow;
  if (flow === "draft" || flow === "reaction") state.demoFlow = flow;
  if (flow === "wish" && attributes?.demoTopic && SAFE_TOPICS.has(attributes.demoTopic)
      && (!attributes.demoStoryteller || SAFE_STORYTELLERS.has(attributes.demoStoryteller))) {
    state.demoFlow = "wish";
    state.demoTopic = attributes.demoTopic;
    if (attributes.demoStoryteller) state.demoStoryteller = attributes.demoStoryteller;
  }
  if (attributes?.fallbackCount === "1" || attributes?.fallbackCount === "2") state.fallbackCount = attributes.fallbackCount;
  return state;
}

function recoverFlow(state: Record<string, string>, fallback: boolean): AlexaResponseEnvelope {
  const count = fallback ? (state.fallbackCount ? "2" : "1") : undefined;
  const repeated = count === "2";
  const next = { ...state };
  delete next.fallbackCount;
  if (count) next.fallbackCount = count;
  let text = HELP;
  let reprompt = REPROMPT;
  if (state.demoFlow === "draft") {
    text = repeated ? "Say about mermaids to choose a theme, or say cancel." : THEME_PROMPT;
    reprompt = THEME_PROMPT;
  } else if (state.demoFlow === "reaction") {
    text = repeated ? "Say I love that story, or say cancel." : "Did you like or love that story?";
    reprompt = REACTION_REPROMPT;
  } else if (state.demoFlow === "wish") {
    text = repeated ? "Say yes to save your wish, or say cancel." : "Would you like to save your wish? Say yes or no.";
    reprompt = WISH_REPROMPT;
  } else if (repeated) {
    text = "Say let's create a story, play my stories, or cancel.";
  }
  return { ...question(text, reprompt), sessionAttributes: next };
}

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

/** A question stays open with the caller's flow-specific reprompt. */
const question = (text: string, reprompt = REPROMPT) => speak(text, { reprompt, endSession: false });
/** A closing line, optionally with playback: the session ends. */
const closing = (text: string, directives?: AudioDirective[]) => speak(text, { endSession: true, ...(directives && { directives }) });
/** Playback control without speech. */
const audioControl = (directives: AudioDirective[]): AlexaResponseEnvelope => ({ version: "1.0", response: { directives, shouldEndSession: true } });
const themeQuestion = (text = THEME_PROMPT): AlexaResponseEnvelope => ({ ...question(text, THEME_PROMPT), sessionAttributes: { demoFlow: "draft" } });

/** Resume, start over and repeat all decode the current AudioPlayer token and re-issue a play directive, differing only in the offset. */
function resumablePlay(event: AlexaRequestEnvelope, offsetInMilliseconds: number): AlexaResponseEnvelope {
  const token = event.context.AudioPlayer?.token;
  const play = token ? decodeStreamToken(token) : null;
  if (!play) return question(NOTHING_TO_RESUME);
  return audioControl([playDirective(play, offsetInMilliseconds)]);
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

const INTENT_SLOTS = new Map(interactionModel.interactionModel.languageModel.intents.map((intent) =>
  [intent.name, "slots" in intent ? intent.slots.map((slot) => slot.name) : []] as const));

/** Legacy nulls mean redacted, not missing; unknown slot keys must never become log fields. */
function loggedSlots(event: AlexaRequestEnvelope): Record<string, null> | undefined {
  const slots = event.request.intent?.slots;
  if (slots === undefined) return undefined;
  return Object.fromEntries((INTENT_SLOTS.get(event.request.intent?.name ?? "") ?? [])
    .filter((name) => Object.hasOwn(slots, name)).map((name) => [name, null]));
}

function slotPresence(event: AlexaRequestEnvelope): Record<string, "missing" | "present"> | undefined {
  if (event.request.type !== "IntentRequest") return undefined;
  return Object.fromEntries((INTENT_SLOTS.get(event.request.intent?.name ?? "") ?? [])
    .map((name) => [name, slotValue(event, name) ? "present" : "missing"]));
}

function transportHash(domain: "alexa-session" | "alexa-request", id: string): string {
  return createHash("sha256").update(`${domain}\0${id}`).digest("hex");
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
const KNOWN_ERROR_CODES = new Set([
  "session_not_found", "malformed", "http_error", "skill_secret_missing", "unsupported_theme",
  "draft_unavailable", "draft_limit_reached", "update_unavailable", "no_pending_reaction",
  "confirmation_required", "server_error", "unauthorized", "unavailable", "invalid_request",
]);

function classifyError(error: unknown): { outcome: "agent_error" | "timeout" | "rejected"; errorClass: string } {
  if (error instanceof AgentHttpError) return { outcome: "rejected", errorClass: `AgentHttpError:${KNOWN_ERROR_CODES.has(error.code) ? error.code : "unknown"}` };
  if (error instanceof DOMException && error.name === "AbortError") return { outcome: "timeout", errorClass: "DOMException" };
  if (error instanceof Error) return { outcome: "agent_error", errorClass: "Error" };
  return { outcome: "agent_error", errorClass: "UnknownError" };
}

type ResponseKey =
  "no_response" | "general_prompt" | "welcome" | "theme_prompt" | "theme_recovery" | "draft_saved" | "draft_limit" | "draft_read" | "draft_missing" | "draft_read_retry" | "reaction_prompt" | "reaction_saved" | "reaction_dismissed" | "reaction_retry" | "reaction_missing" | "wish_start" | "wish_confirm" | "wish_saved" | "wish_retry" | "general_recovery" | "reaction_recovery" | "wish_recovery" | "agent_reply" | "playback_control" | "playback_retry" | "updates" | "updates_retry" | "handoff" | "credits_help" | "creation_help" | "canceled";
type InteractionResult = "completed" | "awaiting_input" | "fallback" | "retry" | "handoff" | "canceled" | "no_action";
type Flow = "none" | "draft" | "reaction" | "wish";
function flowOf(state: Record<string, string>): Flow {
  return state.demoFlow === "draft" || state.demoFlow === "reaction" || state.demoFlow === "wish" ? state.demoFlow : "none";
}

type Telemetry = {
  responseKey: ResponseKey;
  interactionResult: InteractionResult;
  flowBefore: Flow;
  flowAfter: Flow;
  fallbackCount: number;
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
    const state = validatedSession(event.session?.attributes);
    const telemetry: Telemetry = {
      played: false, playOriented: false, tools: [], outcome: "ok", responseKey: "no_response",
      interactionResult: "no_action", flowBefore: flowOf(state),
      flowAfter: "none", fallbackCount: 0,
    };
    const failed = (error: unknown) => {
      Object.assign(telemetry, classifyError(error));
      telemetry.interactionResult = "retry";
    };
    const unavailable = () => { failed(new Error("dependency unavailable")); };
    const mark = (key: ResponseKey, result: InteractionResult, response: AlexaResponseEnvelope): AlexaResponseEnvelope => {
      telemetry.responseKey = key;
      telemetry.interactionResult = telemetry.outcome === "ok" ? result : "retry";
      return response;
    };
    const ask = (text: string, reprompt = REPROMPT, key: ResponseKey = "general_prompt", result: InteractionResult = "awaiting_input") =>
      mark(key, result, question(text, reprompt));
    const tell = (text: string, directives?: AudioDirective[], key: ResponseKey = "general_prompt", result: InteractionResult = "completed") =>
      mark(key, result, closing(text, directives));
    const control = (directives: AudioDirective[]) => mark("playback_control", "completed", audioControl(directives));
    const resume = (offset: number) => {
      const response = resumablePlay(event, offset);
      return mark("playback_control", response.response.directives ? "completed" : "awaiting_input", response);
    };
    const askForTheme = (text = THEME_PROMPT, key: ResponseKey = "theme_prompt") => mark(key, "awaiting_input", themeQuestion(text));
    const recovery = (state: Record<string, string>, fallback: boolean) => {
      const flow = flowOf(state);
      const key: ResponseKey = flow === "draft" ? "theme_recovery" : flow === "reaction" ? "reaction_recovery" : flow === "wish" ? "wish_recovery" : "general_recovery";
      return mark(key, fallback ? "fallback" : "awaiting_input", recoverFlow(state, fallback));
    };

    async function respond(): Promise<AlexaResponseEnvelope> {
      const deviceUserId = event.context.System.user.userId;
      const nextDemoUpdate = async (): Promise<AlexaResponseEnvelope> => {
        if (!options.agent.demoNext) return ask(LAUNCH, REPROMPT, "welcome");
        try {
          const next = await options.agent.demoNext({ deviceUserId });
          if (next.pendingReaction) {
            return { ...ask(`Did you like or love ${next.pendingReaction.title}?`, REACTION_REPROMPT, "reaction_prompt"), sessionAttributes: { demoFlow: "reaction" } };
          }
          if (next.event) {
            const response = ask(`${next.event.detail} You can say let's create a story.`, REPROMPT, "updates");
            if (options.agent.demoEvent) await options.agent.demoEvent({ deviceUserId, eventId: next.event.eventId, action: "read" });
            return response;
          }
        } catch (error) {
          failed(error);
          return ask(LAUNCH, REPROMPT, "welcome");
        }
        return ask(LAUNCH, REPROMPT, "welcome");
      };
      if (type === "LaunchRequest") return nextDemoUpdate();
      const playlist = options.agent.playlist;
      const playlistResult = (reply: PlaylistReply): AlexaResponseEnvelope => {
        if (reply.action === "play" && reply.play && reply.token) {
          telemetry.played = true;
          telemetry.storyId = reply.play.id;
          const directive = playDirective(reply.play, reply.offsetInMilliseconds ?? 0, {
            token: reply.token,
            ...(reply.playBehavior === "ENQUEUE" && reply.expectedPreviousToken && { expectedPreviousToken: reply.expectedPreviousToken }),
          });
          return reply.say ? tell(reply.say, [directive], "playback_control") : control([directive]);
        }
        return reply.say ? ask(reply.say, REPROMPT, "playback_control") : EMPTY;
      };
      const command = async (input: Omit<PlaylistCommand, "deviceUserId">): Promise<AlexaResponseEnvelope> => {
        if (!playlist) return ask(NO_PLAY, REPROMPT, "playback_control");
        try {
          return playlistResult(await playlist({ deviceUserId, ...input }));
        } catch (error) {
          failed(error);
          return type.startsWith("AudioPlayer.") ? EMPTY : ask(RETRY, REPROMPT, "playback_retry", "retry");
        }
      };
      const saveDemoDraft = async (theme: string): Promise<AlexaResponseEnvelope> => {
        if (!options.agent.saveDraft) { unavailable(); return askForTheme(DRAFT_UNAVAILABLE, "theme_recovery"); }
        try {
          await options.agent.saveDraft({ deviceUserId, requestId: event.request.requestId, theme });
          return tell("I saved your story draft. Open Spoken Letter to choose the listener and finish it.", undefined, "draft_saved");
        } catch (error) {
          failed(error);
          if (error instanceof AgentHttpError && error.code === "unsupported_theme") return askForTheme(DRAFT_UNSUPPORTED, "theme_recovery");
          if (error instanceof AgentHttpError && error.code === "draft_limit_reached") return ask(DRAFT_LIMIT, "You can say read my draft.", "draft_limit", "retry");
          return askForTheme(DRAFT_UNAVAILABLE, "theme_recovery");
        }
      };
      const saveReaction = async (choice: "like" | "love" | "dismiss"): Promise<AlexaResponseEnvelope> => {
        if (!options.agent.demoReact) { unavailable(); return { ...ask(REACTION_UNAVAILABLE, REACTION_REPROMPT, "reaction_retry", "retry"), sessionAttributes: { demoFlow: "reaction" } }; }
        try {
          const reply: unknown = await options.agent.demoReact({ deviceUserId, requestId: event.request.requestId, choice });
          if (!reply || typeof reply !== "object" || !("status" in reply) || reply.status !== (choice === "dismiss" ? "dismissed" : "saved")) throw new Error("incomplete demo reaction receipt");
          if (choice !== "dismiss" && (!("reactionId" in reply) || typeof reply.reactionId !== "string" || !reply.reactionId || !("storyId" in reply) || typeof reply.storyId !== "string" || !reply.storyId || !("choice" in reply) || reply.choice !== choice)) throw new Error("incomplete demo reaction receipt");
          return choice === "dismiss" ? tell("Okay. Maybe next time.", undefined, "reaction_dismissed", "canceled") : tell(`I saved that you ${choice === "love" ? "loved" : "liked"} the story.`, undefined, "reaction_saved");
        } catch (error) {
          failed(error);
          if (error instanceof AgentHttpError && error.code === "no_pending_reaction") return tell("There is no completed story waiting for a reaction.", undefined, "reaction_missing", "no_action");
          return { ...ask(REACTION_UNAVAILABLE, REACTION_REPROMPT, "reaction_retry", "retry"), sessionAttributes: { demoFlow: "reaction" } };
        }
      };
      const saveWish = async (topic: string, storyteller?: string): Promise<AlexaResponseEnvelope> => {
        if (!options.agent.demoWish) { unavailable(); return { ...ask(WISH_UNAVAILABLE, WISH_REPROMPT, "wish_retry", "retry"), sessionAttributes: { demoFlow: "wish", demoTopic: topic, ...(storyteller && { demoStoryteller: storyteller }) } }; }
        try {
          const receipt: unknown = await options.agent.demoWish({ deviceUserId, requestId: event.request.requestId, topic, ...(storyteller && { storyteller }), confirmed: true });
          if (!receipt || typeof receipt !== "object" || !("status" in receipt) || receipt.status !== "saved" || !("wishId" in receipt) || typeof receipt.wishId !== "string" || !receipt.wishId) throw new Error("incomplete demo wish receipt");
          return tell("I saved your wish.", undefined, "wish_saved");
        } catch (error) {
          failed(error);
          return { ...ask(WISH_UNAVAILABLE, WISH_REPROMPT, "wish_retry", "retry"), sessionAttributes: { demoFlow: "wish", demoTopic: topic, ...(storyteller && { demoStoryteller: storyteller }) } };
        }
      };
      if (type === "SessionEndedRequest") return EMPTY;
      if (type === "AudioPlayer.PlaybackNearlyFinished" || type === "AudioPlayer.PlaybackFinished") {
        const token = event.request.token;
        if (!token) return EMPTY;
        if (type === "AudioPlayer.PlaybackFinished" && !token.startsWith("pl_") && options.agent.demoPlaybackFinished && decodeStreamToken(token)?.id) {
          try {
            await options.agent.demoPlaybackFinished({ deviceUserId, observedToken: token, eventId: event.request.requestId });
          } catch (error) {
            failed(error);
            log.warn("demo_completion_failed", { errorClass: telemetry.errorClass });
          }
          return EMPTY;
        }
        if (!playlist) return EMPTY;
        try {
          return await command({
            command: type === "AudioPlayer.PlaybackNearlyFinished" ? "nearlyFinished" : "finished",
            observedToken: token,
            eventId: event.request.requestId,
          });
        } catch (error) {
          failed(error);
          log.warn("playlist_event_failed", { event: type, errorClass: telemetry.errorClass });
          return EMPTY;
        }
      }
      if (type.startsWith("AudioPlayer.") || type.startsWith("PlaybackController.")) return EMPTY;
      if (type !== "IntentRequest") return ask(HELP);

      const intent = event.request.intent?.name ?? "";
      const observed = event.context.AudioPlayer?.token;
      const tokenInput = observed ? { observedToken: observed } : {};
      const pendingDraft = state.demoFlow === "draft";
      const pendingReaction = state.demoFlow === "reaction";
      const pendingWish = state.demoFlow === "wish";
      telemetry.intent = intent;
      const slots = loggedSlots(event);
      if (slots !== undefined) telemetry.slots = slots;

      switch (intent) {
        case "AMAZON.PauseIntent":
        case "AMAZON.StopIntent":
        case "AMAZON.CancelIntent":
          if (pendingDraft) return tell("Okay. No draft was saved.", undefined, "canceled", "canceled");
          if (pendingReaction) return saveReaction("dismiss");
          if (pendingWish) return tell("Okay. No wish was saved.", undefined, "canceled", "canceled");
          return mark("playback_control", "canceled", control([STOP_DIRECTIVE]));
        case "AMAZON.ResumeIntent":
          if (playlist) {
            if (!observed) return ask(NOTHING_TO_RESUME);
            return command({ command: "resume", observedToken: observed, offsetInMilliseconds: event.context.AudioPlayer?.offsetInMilliseconds ?? 0 });
          }
          return resume(event.context.AudioPlayer?.offsetInMilliseconds ?? 0);
        case "AMAZON.StartOverIntent":
        case "AMAZON.RepeatIntent":
        case "PlayAgainIntent":
          if (playlist) return command({ command: "restart", ...tokenInput });
          return resume(0);
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
          if (event.session?.attributes?.demoFlow === "wish" && !pendingWish) return ask(WISH_START, WISH_START, "wish_start");
          return recovery(state, false);
        case "AMAZON.FallbackIntent":
          if (event.session?.attributes?.demoFlow === "wish" && !pendingWish) return ask(WISH_START, WISH_START, "wish_start");
          return recovery(state, true);
        default:
          break;
      }

      if (pendingDraft && intent === "AMAZON.NoIntent") return tell("Okay. No draft was saved.", undefined, "canceled", "canceled");
      if (intent === "ThemeChoiceIntent") {
        if (!pendingDraft) return pendingWish || pendingReaction ? recovery(state, false) : ask(CREATION_HELP, REPROMPT, "creation_help", "handoff");
        const theme = slotValue(event, "drafttheme");
        return theme ? saveDemoDraft(theme) : askForTheme();
      }
      if (pendingReaction && intent === "AMAZON.NoIntent") return saveReaction("dismiss");
      if (intent === "ReactToStoryIntent") {
        const spokenChoice = slotValue(event, "choice")?.toLocaleLowerCase("en-US");
        if (spokenChoice === "like" || spokenChoice === "liked") return saveReaction("like");
        if (spokenChoice === "love" || spokenChoice === "loved") return saveReaction("love");
        return { ...ask("Did you like or love that story?", REACTION_REPROMPT, "reaction_prompt"), sessionAttributes: { demoFlow: "reaction" } };
      }
      if (pendingWish && intent === "AMAZON.NoIntent") return tell("Okay. No wish was saved.", undefined, "canceled", "canceled");
      if (pendingWish && intent === "AMAZON.YesIntent") {
        const topic = state.demoTopic ?? null;
        const storyteller = state.demoStoryteller;
        if (!topic || (storyteller && !SAFE_STORYTELLERS.has(storyteller))) return ask("What would you like your story to be about?");
        return saveWish(topic, storyteller);
      }

      if (intent === "AMAZON.YesIntent" && !pendingWish) return ask(WISH_START, WISH_START, "wish_start");

      const catchAll = intent === "CatchAllIntent" ? slotValue(event, "text") : undefined;
      const catchAllAsk = catchAll ? /^ask\s+(.+?)\s+for\b.*\bstory\b/i.exec(catchAll) : null;
      const catchAllWish = catchAll && /^i\s+(?:want|wish)\b.*\bstory\b.*\babout\b/i.test(catchAll);
      if (intent === "WishFromStorytellerIntent" && !slotValue(event, "storyteller")) return ask("Who would you like a story from?", WISH_START, "wish_start");
      if (intent === "WishStoryIntent" || intent === "WishFromStorytellerIntent" || catchAllWish || catchAllAsk) {
        const topic = safeDemoTopic(slotValue(event, "wishtopic") ?? catchAll);
        if (!topic) return ask(`What would you like your story to be about? ${WISH_START}`, WISH_START, "wish_start");
        const rawStoryteller = slotValue(event, "storyteller") ?? catchAllAsk?.[1];
        const spokenStoryteller = rawStoryteller ? STORYTELLER_ALIASES.get(rawStoryteller.toLocaleLowerCase("en-US")) : undefined;
        if (rawStoryteller && !spokenStoryteller) return ask("Who would you like a story from?", WISH_START, "wish_start");
        return { ...ask(`Save a wish for a ${topic} story${spokenStoryteller ? ` from ${spokenStoryteller}` : ""}? Say yes or no.`, WISH_REPROMPT, "wish_confirm"),
          sessionAttributes: { demoFlow: "wish", demoTopic: topic, ...(spokenStoryteller && { demoStoryteller: spokenStoryteller }) } };
      }
      if (intent === "UpdatesIntent") {
        if (!options.agent.demoInbox) { unavailable(); return ask("Your updates are unavailable right now.", REPROMPT, "updates_retry", "retry"); }
        try {
          const inbox = await options.agent.demoInbox({ deviceUserId });
          const eventItem = inbox.events[0];
          if (!eventItem) return tell("There are no unread updates.", undefined, "updates", "no_action");
          const response = tell(eventItem.detail, undefined, "updates");
          if (options.agent.demoEvent) await options.agent.demoEvent({ deviceUserId, eventId: eventItem.eventId, action: "read" });
          return response;
        } catch (error) {
          failed(error);
          return ask("I couldn't read your updates right now. Try again in a moment.", REPROMPT, "updates_retry", "retry");
        }
      }
      if (intent === "AppHandoffIntent") return ask(NAMED_HANDOFF, REPROMPT, "handoff", "handoff");
      if (intent === "CreditHelpIntent") return ask(CREDITS_HELP, REPROMPT, "credits_help", "handoff");
      if (catchAll && /\b(?:send|deliver)\b/i.test(catchAll)) return ask(NAMED_HANDOFF, REPROMPT, "handoff", "handoff");
      if (catchAll && /\b(?:create|make)\b.*\bfor\b/i.test(catchAll)) return ask(NAMED_HANDOFF, REPROMPT, "handoff", "handoff");
      const helpTopic = intent === "HelpTopicIntent" ? slotValue(event, "topic") : catchAll;
      if (helpTopic && /\b(?:credit|credits|charge|purchase|buy)\b/i.test(helpTopic)) return ask(CREDITS_HELP, REPROMPT, "credits_help", "handoff");
      if (catchAll && /\b(?:how|help)\b.*\b(?:create|make|draft)\b/i.test(catchAll)) return ask(CREATION_HELP, REPROMPT, "creation_help", "handoff");
      if (intent === "HelpTopicIntent") return ask(CREATION_HELP, REPROMPT, "creation_help", "handoff");
      if (intent === "ReadDemoDraftIntent") {
        if (!options.agent.latestDraft) { unavailable(); return ask(DRAFT_UNAVAILABLE, REPROMPT, "draft_read_retry", "retry"); }
        try {
          const latest = await options.agent.latestDraft({ deviceUserId });
          return latest.status === "saved" ? tell(`Your story draft says: ${latest.outline}`, undefined, "draft_read") : ask("There is no story draft yet. Say, let's create a story.", REPROMPT, "draft_missing");
        } catch (error) {
          failed(error);
          return ask("I couldn't read your story draft right now. Try again in a moment.", REPROMPT, "draft_read_retry", "retry");
        }
      }
      if (intent === "StartStoryIntent") {
        const theme = slotValue(event, "theme");
        return theme ? saveDemoDraft(theme) : askForTheme();
      }
      if (pendingDraft && intent === "ThemeIntent") {
        const theme = slotValue(event, "theme");
        return theme ? saveDemoDraft(theme) : askForTheme();
      }
      if (pendingDraft && catchAll) {
        const explicitTheme = /^(?:about|the theme is|make it about)\s+(.+)$/i.exec(catchAll)?.[1];
        const bareTheme = /^(?:bedtime|space|ocean|forest|animals|friendship|mermaids)(?: story)?$/i.test(catchAll) ? catchAll : undefined;
        if (explicitTheme || bareTheme) return saveDemoDraft(explicitTheme ?? bareTheme ?? "");
      }
      if (catchAll && /\b(?:create|make)\b.*\bstory\b/i.test(catchAll)) {
        const theme = /\babout\s+(.+)$/i.exec(catchAll)?.[1];
        return theme ? saveDemoDraft(theme) : askForTheme();
      }

      if (playlist) {
        if (intent === "PlayAllIntent") return command({ command: "start", order: "shuffle" });
        if (intent === "PlayNewStoriesIntent") return command({ command: "start", order: "newest" });
        if (intent === "PlayCreatorStoriesIntent") {
          const storyteller = slotValue(event, "storyteller");
          return storyteller ? command({ command: "start", order: "shuffle", storyteller }) : ask("Who would you like a story from?");
        }
        if (intent === "StartPlaylistOverIntent") return command({ command: "reset", ...tokenInput });
        if (intent === "PlayStoryIntent") {
          const title = slotValue(event, "title");
          const storyteller = slotValue(event, "storyteller");
          if (title) {
            const shortTitle = /^(?:the\s+)?(.+?)\s+story$/i.exec(title)?.[1];
            return command({ command: "title", title: shortTitle ?? title, ...(storyteller && { storyteller }) });
          }
          return command({ command: "start", order: "shuffle", ...(storyteller && { storyteller }) });
        }
        if (intent === "NextStoryIntent" || intent === "AMAZON.NextIntent") {
          try {
            const reply = await playlist({ deviceUserId, command: "next", ...tokenInput });
            if (!reply.fallbackToSuggestion) return playlistResult(reply);
          } catch (error) {
            failed(error);
            return ask(RETRY, REPROMPT, "playback_retry", "retry");
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
        if (reply.play) return tell(reply.say, [playDirective(reply.play)], "agent_reply");
        if (playOriented && reply.needsAnswer !== true && playlist && intent === "CatchAllIntent") {
          const title = catchAllTitle(text);
          return await command(title ? { command: "title", title } : { command: "start", order: "newest" });
        }
        if (playOriented && reply.needsAnswer !== true && playlist && (intent === "NextStoryIntent" || intent === "AMAZON.NextIntent")) {
          try {
            return playlistResult(await playlist({ deviceUserId, command: "start", order: "newest" }));
          } catch (error) {
            failed(error);
            return ask(RETRY, REPROMPT, "playback_retry", "retry");
          }
        }
        return ask(playOriented && reply.needsAnswer !== true ? NO_PLAY : reply.say, REPROMPT, "agent_reply", reply.needsAnswer === true || playOriented ? "awaiting_input" : "completed");
      } catch (error) {
        failed(error);
        return ask(RETRY, REPROMPT, "playback_retry", "retry");
      } finally {
        // The agent settled — a progressive response would only be spoken over a still-open turn.
        progressive?.cancel();
      }
    }

    try {
      const response = await respond();
      const nextState = validatedSession(response.sessionAttributes);
      telemetry.flowAfter = flowOf(nextState);
      telemetry.fallbackCount = Number(nextState.fallbackCount ?? "0");
      if (type === "IntentRequest" && event.request.intent?.name === "AMAZON.FallbackIntent") {
        telemetry.interactionResult = "fallback";
        telemetry.fallbackCount = nextState.fallbackCount ? Number(nextState.fallbackCount) : 1;
      }
      return type === "IntentRequest" || type === "LaunchRequest"
        ? { ...response, sessionAttributes: nextState }
        : response;
    } finally {
      const ms = Math.round(performance.now() - started);
      const dimensionIntent = telemetry.intent ?? type;
      const envelope = emfEnvelope(process.env.EMF_NAMESPACE, { Intent: dimensionIntent }, [
        { name: "SkillTurnMs", value: ms, unit: "Milliseconds", dimensionSets: [["Intent"], []] },
        { name: "FallbackCount", value: event.request.intent?.name === "AMAZON.FallbackIntent" && type === "IntentRequest" ? 1 : 0, unit: "Count", dimensionSets: [[]] },
        { name: "DeadEndPlay", value: telemetry.playOriented && !telemetry.played ? 1 : 0, unit: "Count", dimensionSets: [[]] },
      ]);
      const presence = slotPresence(event);
      log.info("skill_turn", {
        requestType: type,
        responseKey: telemetry.responseKey,
        interactionResult: telemetry.interactionResult,
        flowBefore: telemetry.flowBefore,
        flowAfter: telemetry.flowAfter,
        fallbackCount: telemetry.fallbackCount,
        ...(presence !== undefined && { slotPresence: presence }),
        ...(event.session?.sessionId && { sessionHash: transportHash("alexa-session", event.session.sessionId) }),
        requestHash: transportHash("alexa-request", event.request.requestId),
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
