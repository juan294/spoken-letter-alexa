import { createHash } from "node:crypto";

import { emfEnvelope, foldName, isDemoTopic, log, resolveLocale, type SkillLocale } from "@spoken-letter-alexa/shared";

import { AgentHttpError, type AgentClient, type PlaylistCommand, type PlaylistReply } from "./agent-client.ts";
import { type AudioDirective, decodeStreamToken, playDirective, STOP_DIRECTIVE } from "./audio.ts";
import { type DemoTopic, MATCHERS, type Matchers, MESSAGES, type Messages } from "./messages.ts";
import { scheduleProgressiveResponse } from "./progressive.ts";
import { type CreateKey, type CreateTurn, continueCreate, createAttributes, createStateFrom, isDoneEvent, resumeCreate, startCreate } from "./create-flow.ts";
import { closing, type Directive, type OutputSpeech, question } from "./responses.ts";
import { resolvedValue, slotValue } from "./slots.ts";
import interactionModel from "../skill-package/interactionModels/custom/en-US.json" with { type: "json" };
import spanishModel from "../skill-package/interactionModels/custom/es-ES.json" with { type: "json" };

/** Entity resolution for custom slot types: `ER_SUCCESS_MATCH` carries the canonical value (plan D4). */
type SlotResolutions = { resolutionsPerAuthority?: { status?: { code?: string }; values?: { value?: { name?: string } }[] }[] };
type Slot = { name: string; value?: string; resolutions?: SlotResolutions };

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
      /** `supportedInterfaces` names `Alexa.Presentation.APL` on a screen device (`supportsApl`). */
      device?: { supportedInterfaces?: Record<string, unknown> };
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
    /** `Alexa.Presentation.APL.UserEvent` only: the `SendEvent` arguments. */
    arguments?: unknown[];
    /** `Alexa.Presentation.APL.RuntimeError` only. `message` can quote the document, so it is never logged. */
    errors?: { type?: string; reason?: string; message?: string }[];
  };
};

export type AlexaResponseEnvelope = {
  version: "1.0";
  sessionAttributes?: Record<string, string>;
  response: {
    outputSpeech?: OutputSpeech;
    reprompt?: { outputSpeech: OutputSpeech };
    directives?: Directive[];
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
  /** The host serving `/fixtures/*` (CloudFront), for in-session take playback. Without it no take plays (SS5). */
  publicBaseUrl?: string | undefined;
  /** Test injection point for the Directive Service call (phase-2.md section 2); defaults to global `fetch`. */
  progressiveFetch?: typeof fetch | undefined;
  /** Seconds since the epoch, for the create flow's resume window; defaults to the clock. */
  now?: (() => number) | undefined;
};

export type SkillHandler = (event: AlexaRequestEnvelope) => Promise<AlexaResponseEnvelope>;

/** Both locales share canonical storyteller values; each adds its own spoken synonyms ("Auntie Whitney", "tía Whitney"). */
type SlotTypeValue = { name: { value: string; synonyms?: string[] } };
const storytellerValues: SlotTypeValue[] = [interactionModel, spanishModel].flatMap((model) =>
  model.interactionModel.languageModel.types.find((type) => type.name === "StorytellerName")?.values ?? []);
const SAFE_STORYTELLERS = new Set(storytellerValues.map((entry) => entry.name.value));
const STORYTELLER_ALIASES = new Map(storytellerValues.flatMap((entry) =>
  [entry.name.value, ...(entry.name.synonyms ?? [])].map((alias) => [foldName(alias), entry.name.value] as const)));

/**
 * "play El Trasgu by Tío Manuel" fills only `{title}` ("play {title}"): a tail naming a known
 * storyteller becomes the storyteller, so the title match is on the title alone.
 */
function titleByStoryteller(spoken: string): { title: string; storyteller: string } | null {
  const split = /^(.+?)\s+(?:by|from)\s+(.+)$/i.exec(spoken);
  const storyteller = split?.[2] ? STORYTELLER_ALIASES.get(foldName(split[2])) : undefined;
  return split?.[1] && storyteller ? { title: split[1], storyteller } : null;
}


/** Only fixture-safe topics cross the skill session boundary. A resolved slot is already canonical. */
function safeDemoTopic(speech: string | undefined, locale: SkillLocale): DemoTopic | null {
  if (!speech) return null;
  const text = speech.toLocaleLowerCase(locale);
  if (isDemoTopic(text)) return text;
  return MATCHERS[locale].topics.find(([, pattern]) => pattern.test(text))?.[0] ?? null;
}

/** A resolved `ReactionChoice` is canonical; an unresolved one is matched as spoken. */
function reactionChoice(spoken: string | undefined, locale: SkillLocale): "like" | "love" | undefined {
  const match = MATCHERS[locale];
  const choice = spoken?.toLocaleLowerCase(locale);
  if (choice === undefined) return undefined;
  if (choice === "like" || match.like.test(choice)) return "like";
  if (choice === "love" || match.love.test(choice)) return "love";
  return undefined;
}

/** Rebuild only code-owned state; neither arbitrary attributes nor wish prose can survive. */
function validatedSession(attributes: Record<string, string> | undefined): Record<string, string> {
  const state: Record<string, string> = {};
  const flow = attributes?.demoFlow;
  if (flow === "draft" || flow === "reaction") state.demoFlow = flow;
  if (flow === "wish" && attributes?.demoTopic && isDemoTopic(attributes.demoTopic)
      && (!attributes.demoStoryteller || SAFE_STORYTELLERS.has(attributes.demoStoryteller))) {
    state.demoFlow = "wish";
    state.demoTopic = attributes.demoTopic;
    if (attributes.demoStoryteller) state.demoStoryteller = attributes.demoStoryteller;
  }
  const create = createStateFrom(attributes);
  if (create) Object.assign(state, createAttributes(create));
  if (attributes?.fallbackCount === "1" || attributes?.fallbackCount === "2") state.fallbackCount = attributes.fallbackCount;
  return state;
}

function recoverFlow(m: Messages, state: Record<string, string>, fallback: boolean): AlexaResponseEnvelope {
  const count = fallback ? (state.fallbackCount ? "2" : "1") : undefined;
  const repeated = count === "2";
  const next = { ...state };
  delete next.fallbackCount;
  if (count) next.fallbackCount = count;
  let text = m.help;
  let reprompt = m.reprompt;
  if (state.demoFlow === "draft") {
    text = repeated ? m.draftRecoveryRepeated : m.themePrompt;
    reprompt = m.themePrompt;
  } else if (state.demoFlow === "reaction") {
    text = repeated ? m.reactionRecoveryRepeated : m.reactionPrompt;
    reprompt = m.reactionReprompt;
  } else if (state.demoFlow === "wish") {
    text = repeated ? m.wishRecoveryRepeated : m.wishRecovery;
    reprompt = m.wishReprompt;
  } else if (repeated) {
    text = m.generalRecoveryRepeated;
  }
  return { ...question(text, reprompt), sessionAttributes: next };
}

const EMPTY: AlexaResponseEnvelope = { version: "1.0", response: {} };

/** Playback control without speech. */
const audioControl = (directives: AudioDirective[]): AlexaResponseEnvelope => ({ version: "1.0", response: { directives, shouldEndSession: true } });
const themeQuestion = (m: Messages, text = m.themePrompt): AlexaResponseEnvelope => ({ ...question(text, m.themePrompt), sessionAttributes: { demoFlow: "draft" } });

/** Resume, start over and repeat all decode the current AudioPlayer token and re-issue a play directive, differing only in the offset. */
function resumablePlay(event: AlexaRequestEnvelope, offsetInMilliseconds: number, locale: SkillLocale): AlexaResponseEnvelope {
  const m = MESSAGES[locale];
  const token = event.context.AudioPlayer?.token;
  const play = token ? decodeStreamToken(token) : null;
  if (!play) return question(m.nothingToResume, m.reprompt);
  return audioControl([playDirective(play, offsetInMilliseconds, { locale })]);
}

/** Best-effort title from a play request that Alexa routed through CatchAllIntent. */
function catchAllTitle(text: string, match: Matchers): string | undefined {
  const stripped = match.titleCarriers.reduce((rest, carrier) => rest.replace(carrier, ""), text).trim();
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
function textForIntent(event: AlexaRequestEnvelope, match: Matchers): IntentText | null {
  const name = event.request.intent?.name;
  switch (name) {
    case "PlayStoryIntent": {
      const title = slotValue(event, "title");
      const storyteller = resolvedValue(event, "storyteller");
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
        playOriented: match.play.test(text) && !match.notPlay.test(text),
      };
    }
    default:
      return null;
  }
}

const CREATE_ONLY_INTENTS = new Set(["ChooseListenerIntent", "StoryDetailIntent", "PlaybackIntent", "StoryTitleIntent", "SoundChoiceIntent", "SendStoryIntent", "TheEndIntent"]);

/**
 * An en-US request that starts the staged create flow, with the listener it names, if any:
 * "create a story", "record story", "create a story for Sam" and "send Sam a spoken letter".
 */
function createEntry(event: AlexaRequestEnvelope, match: Matchers): { listener?: string } | null {
  if (event.request.type !== "IntentRequest") return null;
  const intent = event.request.intent?.name;
  if (intent === "StartStoryIntent" || intent === "RecordStoryIntent") return {};
  if (intent === "AppHandoffIntent") {
    const listener = slotValue(event, "listeneralias");
    return listener ? { listener } : {};
  }
  const text = intent === "CatchAllIntent" ? slotValue(event, "text") : undefined;
  if (!text || match.howToCreate.test(text) || !(match.createStory.test(text) || match.createFor.test(text) || match.send.test(text))) return null;
  const named = /\bfor\s+(\S+)\s*$/i.exec(text)?.[1] ?? /\bsend\s+(?!a\b|the\b|it\b|story\b)(\S+)/i.exec(text)?.[1];
  return named ? { listener: named } : {};
}

/** `outcome`/`errorClass` for an agent-turn failure (phase-1.md section 1). */
const KNOWN_ERROR_CODES = new Set([
  "session_not_found", "malformed", "http_error", "skill_secret_missing", "unsupported_theme",
  "draft_unavailable", "draft_limit_reached", "update_unavailable", "no_pending_reaction",
  "confirmation_required", "server_error", "unauthorized", "unavailable", "invalid_request", "create_unavailable",
]);

function classifyError(error: unknown): { outcome: "agent_error" | "timeout" | "rejected"; errorClass: string } {
  if (error instanceof AgentHttpError) return { outcome: "rejected", errorClass: `AgentHttpError:${KNOWN_ERROR_CODES.has(error.code) ? error.code : "unknown"}` };
  if (error instanceof DOMException && error.name === "AbortError") return { outcome: "timeout", errorClass: "DOMException" };
  if (error instanceof Error) return { outcome: "agent_error", errorClass: "Error" };
  return { outcome: "agent_error", errorClass: "UnknownError" };
}

type ResponseKey =
  "no_response" | "general_prompt" | "welcome" | "theme_prompt" | "theme_recovery" | "draft_saved" | "draft_limit" | "draft_read" | "draft_missing" | "draft_read_retry" | "reaction_prompt" | "reaction_saved" | "reaction_dismissed" | "reaction_retry" | "reaction_missing" | "wish_start" | "wish_confirm" | "wish_saved" | "wish_retry" | "general_recovery" | "reaction_recovery" | "wish_recovery" | "agent_reply" | "playback_control" | "playback_retry" | "updates" | "updates_retry" | "handoff" | "credits_help" | "creation_help" | "canceled" | CreateKey;
type InteractionResult = "completed" | "awaiting_input" | "fallback" | "retry" | "handoff" | "canceled" | "no_action";
type Flow = "none" | "draft" | "reaction" | "wish" | "create";
function flowOf(state: Record<string, string>): Flow {
  return state.demoFlow === "draft" || state.demoFlow === "reaction" || state.demoFlow === "wish" || state.demoFlow === "create" ? state.demoFlow : "none";
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
    const locale = resolveLocale(event.request.locale);
    const m = MESSAGES[locale];
    const match = MATCHERS[locale];
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
    const ask = (text: string, reprompt = m.reprompt, key: ResponseKey = "general_prompt", result: InteractionResult = "awaiting_input") =>
      mark(key, result, question(text, reprompt));
    const tell = (text: string, directives?: AudioDirective[], key: ResponseKey = "general_prompt", result: InteractionResult = "completed") =>
      mark(key, result, closing(text, directives));
    const control = (directives: AudioDirective[]) => mark("playback_control", "completed", audioControl(directives));
    const resume = (offset: number) => {
      const response = resumablePlay(event, offset, locale);
      return mark("playback_control", response.response.directives ? "completed" : "awaiting_input", response);
    };
    const askForTheme = (text = m.themePrompt, key: ResponseKey = "theme_prompt") => mark(key, "awaiting_input", themeQuestion(m, text));
    const recovery = (state: Record<string, string>, fallback: boolean) => {
      const flow = flowOf(state);
      const key: ResponseKey = flow === "draft" ? "theme_recovery" : flow === "reaction" ? "reaction_recovery" : flow === "wish" ? "wish_recovery" : "general_recovery";
      return mark(key, fallback ? "fallback" : "awaiting_input", recoverFlow(m, state, fallback));
    };

    async function respond(): Promise<AlexaResponseEnvelope> {
      const deviceUserId = event.context.System.user.userId;
      // The agent defaults to en-US, so English requests stay exactly as they were (plan D6).
      const localeInput = locale === "en-US" ? {} : { locale };
      const nextDemoUpdate = async (): Promise<AlexaResponseEnvelope> => {
        if (!options.agent.demoNext) return ask(m.launch, m.reprompt, "welcome");
        try {
          const next = await options.agent.demoNext({ deviceUserId, ...localeInput });
          if (next.pendingReaction) {
            return { ...ask(m.reactionFor(next.pendingReaction.title), m.reactionReprompt, "reaction_prompt"), sessionAttributes: { demoFlow: "reaction" } };
          }
          if (next.event) {
            const response = ask(m.updateDetail(next.event.detail), m.reprompt, "updates");
            if (options.agent.demoEvent) await options.agent.demoEvent({ deviceUserId, eventId: next.event.eventId, action: "read" });
            return response;
          }
        } catch (error) {
          failed(error);
          return ask(m.launch, m.reprompt, "welcome");
        }
        return ask(m.launch, m.reprompt, "welcome");
      };
      // The staged create flow is English only (plan D1); its record's copy lives with the agent (D5).
      const english = locale === "en-US";
      const createContext = { event, publicBaseUrl: options.publicBaseUrl };
      const runCreate = async (turn: CreateTurn): Promise<AlexaResponseEnvelope> => {
        if (turn.record && options.agent.createSave) {
          try {
            await options.agent.createSave({ deviceUserId, record: turn.record });
          } catch (error) {
            // The session still carries the flow; only a later resume is lost.
            log.warn("create_save_failed", { errorClass: classifyError(error).errorClass });
          }
        }
        return mark(turn.key, turn.result, turn.response);
      };
      const resumeFromRecord = async (fromDone: boolean): Promise<AlexaResponseEnvelope | null> => {
        if (!english || !options.agent.createCurrent) return null;
        try {
          const current = await options.agent.createCurrent({ deviceUserId });
          const now = options.now?.() ?? Math.floor(Date.now() / 1000);
          const turn = current.status === "found" ? resumeCreate(createContext, current, now, fromDone) : null;
          return turn ? await runCreate(turn) : null;
        } catch (error) {
          log.warn("create_current_failed", { errorClass: classifyError(error).errorClass });
          return null;
        }
      };
      // The English launch is Jordan's script line 1, so pending reactions and updates are left to "what's new".
      if (type === "LaunchRequest") return await resumeFromRecord(false) ?? (english ? ask(m.launch, m.reprompt, "welcome") : nextDemoUpdate());
      const playlist = options.agent.playlist;
      const playlistResult = (reply: PlaylistReply): AlexaResponseEnvelope => {
        if (reply.action === "play" && reply.play && reply.token) {
          telemetry.played = true;
          telemetry.storyId = reply.play.id;
          const directive = playDirective(reply.play, reply.offsetInMilliseconds ?? 0, {
            token: reply.token,
            locale,
            ...(reply.playBehavior === "ENQUEUE" && reply.expectedPreviousToken && { expectedPreviousToken: reply.expectedPreviousToken }),
          });
          return reply.say ? tell(reply.say, [directive], "playback_control") : control([directive]);
        }
        return reply.say ? ask(reply.say, m.reprompt, "playback_control") : EMPTY;
      };
      const command = async (input: Omit<PlaylistCommand, "deviceUserId">): Promise<AlexaResponseEnvelope> => {
        if (!playlist) return ask(m.noPlay, m.reprompt, "playback_control");
        try {
          return playlistResult(await playlist({ deviceUserId, ...input, ...localeInput }));
        } catch (error) {
          failed(error);
          return type.startsWith("AudioPlayer.") ? EMPTY : ask(m.retry, m.reprompt, "playback_retry", "retry");
        }
      };
      const saveDemoDraft = async (theme: string): Promise<AlexaResponseEnvelope> => {
        if (!options.agent.saveDraft) { unavailable(); return askForTheme(m.draftUnavailable, "theme_recovery"); }
        try {
          await options.agent.saveDraft({ deviceUserId, requestId: event.request.requestId, theme, ...localeInput });
          return tell(m.draftSaved, undefined, "draft_saved");
        } catch (error) {
          failed(error);
          if (error instanceof AgentHttpError && error.code === "unsupported_theme") return askForTheme(m.draftUnsupported, "theme_recovery");
          if (error instanceof AgentHttpError && error.code === "draft_limit_reached") return ask(m.draftLimit, m.draftLimitReprompt, "draft_limit", "retry");
          return askForTheme(m.draftUnavailable, "theme_recovery");
        }
      };
      const saveReaction = async (choice: "like" | "love" | "dismiss"): Promise<AlexaResponseEnvelope> => {
        if (!options.agent.demoReact) { unavailable(); return { ...ask(m.reactionUnavailable, m.reactionReprompt, "reaction_retry", "retry"), sessionAttributes: { demoFlow: "reaction" } }; }
        try {
          const reply: unknown = await options.agent.demoReact({ deviceUserId, requestId: event.request.requestId, choice });
          if (!reply || typeof reply !== "object" || !("status" in reply) || reply.status !== (choice === "dismiss" ? "dismissed" : "saved")) throw new Error("incomplete demo reaction receipt");
          if (choice !== "dismiss" && (!("reactionId" in reply) || typeof reply.reactionId !== "string" || !reply.reactionId || !("storyId" in reply) || typeof reply.storyId !== "string" || !reply.storyId || !("choice" in reply) || reply.choice !== choice)) throw new Error("incomplete demo reaction receipt");
          return choice === "dismiss" ? tell(m.reactionDismissed, undefined, "reaction_dismissed", "canceled") : tell(m.reactionSaved(choice), undefined, "reaction_saved");
        } catch (error) {
          failed(error);
          if (error instanceof AgentHttpError && error.code === "no_pending_reaction") return tell(m.noPendingReaction, undefined, "reaction_missing", "no_action");
          return { ...ask(m.reactionUnavailable, m.reactionReprompt, "reaction_retry", "retry"), sessionAttributes: { demoFlow: "reaction" } };
        }
      };
      const saveWish = async (topic: string, storyteller?: string): Promise<AlexaResponseEnvelope> => {
        if (!options.agent.demoWish) { unavailable(); return { ...ask(m.wishUnavailable, m.wishReprompt, "wish_retry", "retry"), sessionAttributes: { demoFlow: "wish", demoTopic: topic, ...(storyteller && { demoStoryteller: storyteller }) } }; }
        try {
          const receipt: unknown = await options.agent.demoWish({ deviceUserId, requestId: event.request.requestId, topic, ...(storyteller && { storyteller }), confirmed: true, ...localeInput });
          if (!receipt || typeof receipt !== "object" || !("status" in receipt) || receipt.status !== "saved" || !("wishId" in receipt) || typeof receipt.wishId !== "string" || !receipt.wishId) throw new Error("incomplete demo wish receipt");
          return tell(m.wishSaved, undefined, "wish_saved");
        } catch (error) {
          failed(error);
          return { ...ask(m.wishUnavailable, m.wishReprompt, "wish_retry", "retry"), sessionAttributes: { demoFlow: "wish", demoTopic: topic, ...(storyteller && { demoStoryteller: storyteller }) } };
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
      if (type === "Alexa.Presentation.APL.RuntimeError") {
        // A failed SetValue or Scroll must not speak over the adult reading, or drop the stage.
        log.warn("apl_runtime_error", { errors: (event.request.errors ?? []).map((error) => `${error.type ?? "unknown"}:${error.reason ?? "unknown"}`) });
        return { ...EMPTY, sessionAttributes: state };
      }
      const intent = event.request.intent?.name ?? "";
      if (type === "IntentRequest") {
        telemetry.intent = intent;
        const slots = loggedSlots(event);
        if (slots !== undefined) telemetry.slots = slots;
      }
      if (english) {
        const create = createStateFrom(state);
        if (create) return runCreate(continueCreate(createContext, create));
        // A Done tap or "the end" after the session dropped while reading (SS2).
        if (isDoneEvent(event) || intent === "TheEndIntent") {
          const resumed = await resumeFromRecord(true);
          if (resumed) return resumed;
        }
        const entry = createEntry(event, match);
        if (entry) return runCreate(startCreate(entry.listener));
      }
      if (type !== "IntentRequest") return ask(m.help);

      const observed = event.context.AudioPlayer?.token;
      const tokenInput = observed ? { observedToken: observed } : {};
      const pendingDraft = state.demoFlow === "draft";
      const pendingReaction = state.demoFlow === "reaction";
      const pendingWish = state.demoFlow === "wish";

      switch (intent) {
        case "AMAZON.PauseIntent":
        case "AMAZON.StopIntent":
        case "AMAZON.CancelIntent":
          if (pendingDraft) return tell(m.draftCanceled, undefined, "canceled", "canceled");
          if (pendingReaction) return saveReaction("dismiss");
          if (pendingWish) return tell(m.wishCanceled, undefined, "canceled", "canceled");
          return mark("playback_control", "canceled", control([STOP_DIRECTIVE]));
        case "AMAZON.ResumeIntent":
          if (playlist) {
            if (!observed) return ask(m.nothingToResume);
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
          return ask(m.nothingToGoBackTo);
        case "AMAZON.LoopOnIntent":
        case "AMAZON.LoopOffIntent":
        case "AMAZON.ShuffleOnIntent":
        case "AMAZON.ShuffleOffIntent":
          // Acknowledged, not silently ignored — a skill that answers nothing reads as broken.
          return ask(m.oneAtATime);
        case "AMAZON.HelpIntent":
          if (event.session?.attributes?.demoFlow === "wish" && !pendingWish) return ask(m.wishStart, m.wishStart, "wish_start");
          return recovery(state, false);
        case "AMAZON.FallbackIntent":
          if (event.session?.attributes?.demoFlow === "wish" && !pendingWish) return ask(m.wishStart, m.wishStart, "wish_start");
          return recovery(state, true);
        default:
          break;
      }

      // English creation enters the staged create flow above (createEntry), so the theme-to-draft
      // branches below are reached in Spanish, or from an English session already in a draft.
      if (pendingDraft && intent === "AMAZON.NoIntent") return tell(m.draftCanceled, undefined, "canceled", "canceled");
      if (intent === "ThemeChoiceIntent") {
        if (!pendingDraft) return pendingWish || pendingReaction ? recovery(state, false) : ask(m.creationHelp, m.reprompt, "creation_help", "handoff");
        const theme = resolvedValue(event, "drafttheme");
        return theme ? saveDemoDraft(theme) : askForTheme();
      }
      if (pendingReaction && intent === "AMAZON.NoIntent") return saveReaction("dismiss");
      if (intent === "ReactToStoryIntent") {
        const choice = reactionChoice(resolvedValue(event, "choice"), locale);
        if (choice) return saveReaction(choice);
        return { ...ask(m.reactionPrompt, m.reactionReprompt, "reaction_prompt"), sessionAttributes: { demoFlow: "reaction" } };
      }
      if (pendingWish && intent === "AMAZON.NoIntent") return tell(m.wishCanceled, undefined, "canceled", "canceled");
      if (pendingWish && intent === "AMAZON.YesIntent") {
        const topic = state.demoTopic ?? null;
        const storyteller = state.demoStoryteller;
        if (!topic || (storyteller && !SAFE_STORYTELLERS.has(storyteller))) return ask(m.wishTopicQuestion);
        return saveWish(topic, storyteller);
      }

      if (intent === "AMAZON.YesIntent" && !pendingWish) return ask(m.wishStart, m.wishStart, "wish_start");

      const catchAll = intent === "CatchAllIntent" ? slotValue(event, "text") : undefined;
      const catchAllAsk = catchAll ? match.askStoryteller.exec(catchAll) : null;
      const catchAllWish = catchAll && match.wish.test(catchAll);
      if (intent === "WishFromStorytellerIntent" && !resolvedValue(event, "storyteller")) return ask(m.whoFrom, m.wishStart, "wish_start");
      if (intent === "WishStoryIntent" || intent === "WishFromStorytellerIntent" || catchAllWish || catchAllAsk) {
        const topic = safeDemoTopic(resolvedValue(event, "wishtopic") ?? catchAll, locale);
        if (!topic) return ask(m.wishTopicStart, m.wishStart, "wish_start");
        const rawStoryteller = resolvedValue(event, "storyteller") ?? catchAllAsk?.[1];
        const spokenStoryteller = rawStoryteller ? STORYTELLER_ALIASES.get(foldName(rawStoryteller)) : undefined;
        if (rawStoryteller && !spokenStoryteller) return ask(m.whoFrom, m.wishStart, "wish_start");
        return { ...ask(m.wishConfirm(topic, spokenStoryteller), m.wishReprompt, "wish_confirm"),
          sessionAttributes: { demoFlow: "wish", demoTopic: topic, ...(spokenStoryteller && { demoStoryteller: spokenStoryteller }) } };
      }
      if (intent === "UpdatesIntent") {
        if (!options.agent.demoInbox) { unavailable(); return ask(m.updatesUnavailable, m.reprompt, "updates_retry", "retry"); }
        try {
          const inbox = await options.agent.demoInbox({ deviceUserId, ...localeInput });
          const eventItem = inbox.events[0];
          if (!eventItem) return tell(m.noUpdates, undefined, "updates", "no_action");
          const response = tell(eventItem.detail, undefined, "updates");
          if (options.agent.demoEvent) await options.agent.demoEvent({ deviceUserId, eventId: eventItem.eventId, action: "read" });
          return response;
        } catch (error) {
          failed(error);
          return ask(m.updatesFailed, m.reprompt, "updates_retry", "retry");
        }
      }
      if (intent === "AppHandoffIntent") return ask(m.namedHandoff, m.reprompt, "handoff", "handoff");
      if (intent === "CreditHelpIntent") return ask(m.creditsHelp, m.reprompt, "credits_help", "handoff");
      if (catchAll && match.send.test(catchAll)) return ask(m.namedHandoff, m.reprompt, "handoff", "handoff");
      if (catchAll && match.createFor.test(catchAll)) return ask(m.namedHandoff, m.reprompt, "handoff", "handoff");
      const helpTopic = intent === "HelpTopicIntent" ? slotValue(event, "topic") : catchAll;
      if (helpTopic && match.credits.test(helpTopic)) return ask(m.creditsHelp, m.reprompt, "credits_help", "handoff");
      if (catchAll && match.howToCreate.test(catchAll)) return ask(m.creationHelp, m.reprompt, "creation_help", "handoff");
      if (intent === "HelpTopicIntent") return ask(m.creationHelp, m.reprompt, "creation_help", "handoff");
      if (intent === "ReadDemoDraftIntent") {
        if (!options.agent.latestDraft) { unavailable(); return ask(m.draftUnavailable, m.reprompt, "draft_read_retry", "retry"); }
        try {
          const latest = await options.agent.latestDraft({ deviceUserId });
          return latest.status === "saved" ? tell(m.draftRead(latest.outline), undefined, "draft_read") : ask(m.noDraft, m.reprompt, "draft_missing");
        } catch (error) {
          failed(error);
          return ask(m.draftReadFailed, m.reprompt, "draft_read_retry", "retry");
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
        const explicitTheme = match.explicitTheme.exec(catchAll)?.[1];
        const bareTheme = match.bareTheme.test(catchAll) ? catchAll : undefined;
        if (explicitTheme || bareTheme) return saveDemoDraft(explicitTheme ?? bareTheme ?? "");
      }
      if (catchAll && match.createStory.test(catchAll)) {
        const theme = match.themeAbout.exec(catchAll)?.[1];
        return theme ? saveDemoDraft(theme) : askForTheme();
      }

      if (playlist) {
        if (intent === "PlayAllIntent") return command({ command: "start", order: "shuffle" });
        if (intent === "PlayNewStoriesIntent") return command({ command: "start", order: "newest" });
        if (intent === "PlayCreatorStoriesIntent") {
          const storyteller = resolvedValue(event, "storyteller");
          return storyteller ? command({ command: "start", order: "shuffle", storyteller }) : ask(m.whoFrom);
        }
        if (intent === "StartPlaylistOverIntent") return command({ command: "reset", ...tokenInput });
        if (intent === "PlayStoryIntent") {
          const spokenTitle = slotValue(event, "title");
          const resolvedStoryteller = resolvedValue(event, "storyteller");
          const split = spokenTitle && !resolvedStoryteller ? titleByStoryteller(spokenTitle) : null;
          const title = split?.title ?? spokenTitle;
          const storyteller = split?.storyteller ?? resolvedStoryteller;
          if (title) {
            const shortTitle = match.shortTitle.exec(title)?.[1];
            return command({ command: "title", title: shortTitle ?? title, ...(storyteller && { storyteller }) });
          }
          return command({ command: "start", order: "shuffle", ...(storyteller && { storyteller }) });
        }
        if (intent === "NextStoryIntent" || intent === "AMAZON.NextIntent") {
          try {
            const reply = await playlist({ deviceUserId, command: "next", ...tokenInput, ...localeInput });
            if (!reply.fallbackToSuggestion) return playlistResult(reply);
          } catch (error) {
            failed(error);
            return ask(m.retry, m.reprompt, "playback_retry", "retry");
          }
          // Without an active playlist, preserve the existing suggestion behavior.
        }
      }

      // The create flow's own replies ("Samuel", "add both", "a dragon who…") mean nothing outside it.
      if (CREATE_ONLY_INTENTS.has(intent)) return recovery(state, true);
      const intentText = textForIntent(event, match);
      if (intentText === null) return ask(m.nothingToPlay);
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
              // Catalog-aware filler, never a generic "one moment" (phase-2.md section 2).
              text: playOriented ? m.progressivePlay : m.progressiveNews,
              fetch: options.progressiveFetch,
            })
          : undefined;

      try {
        const reply = await options.agent.turn({ deviceUserId, text, ...localeInput });
        telemetry.tools = reply.toolCalls.map((call) => `${call.name}:${call.ms}ms`);
        telemetry.played = Boolean(reply.play);
        telemetry.storyId = reply.play?.id ?? null;
        if (reply.play) return tell(reply.say, [playDirective(reply.play, 0, { locale })], "agent_reply");
        if (playOriented && reply.needsAnswer !== true && playlist && intent === "CatchAllIntent") {
          const title = catchAllTitle(text, match);
          return await command(title ? { command: "title", title } : { command: "start", order: "newest" });
        }
        if (playOriented && reply.needsAnswer !== true && playlist && (intent === "NextStoryIntent" || intent === "AMAZON.NextIntent")) {
          try {
            return playlistResult(await playlist({ deviceUserId, command: "start", order: "newest", ...localeInput }));
          } catch (error) {
            failed(error);
            return ask(m.retry, m.reprompt, "playback_retry", "retry");
          }
        }
        return ask(playOriented && reply.needsAnswer !== true ? m.noPlay : reply.say, m.reprompt, "agent_reply", reply.needsAnswer === true || playOriented ? "awaiting_input" : "completed");
      } catch (error) {
        failed(error);
        return ask(m.retry, m.reprompt, "playback_retry", "retry");
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
      return type === "IntentRequest" || type === "LaunchRequest" || type.startsWith("Alexa.Presentation.APL.")
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
