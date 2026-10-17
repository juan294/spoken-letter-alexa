import {
  type CreateStage,
  foldName,
  type CreationRecord,
  type DemoPack,
  findListener,
  findPack,
  findTake,
  isCreateStage,
  parseDemoCreate,
  parseTakesManifest,
  TAKE_VARIANTS,
  type TakeVariant,
} from "@spoken-letter-alexa/shared";

import { scriptPreviewDirectives, statusDirectives, teleprompterDirectives } from "./apl/recording.ts";
import { STOP_DIRECTIVE } from "./audio.ts";
import { CREATE_MESSAGES as c } from "./create-messages.ts";
import type { AlexaRequestEnvelope, AlexaResponseEnvelope } from "./handler.ts";
import { editDistance, soundsLike, withoutInvocation } from "./names.ts";
import { closing, type Directive, type OutputSpeech, question, ssml } from "./responses.ts";
import { resolvedValue, slotValue } from "./slots.ts";
import demoCreate from "../../../fixtures/demo-create.json" with { type: "json" };
import takesManifest from "../../../fixtures/takes/manifest.json" with { type: "json" };

/**
 * The staged create flow (staged demo plan, revised for Jordan's script): en-US only, every
 * line fixed. The purchase is staged too: no store, payment or entitlement is touched, and the
 * next run starts with no credits again. A skill never receives raw audio, so nothing is captured: the teleprompter shows
 * the script, the adult reads it, and playback is a take an adult recorded beforehand of the
 * same script in the real app. The session carries the flow; the agent keeps a copy of the
 * record so a dropped session resumes at take review (SS2).
 */
const DEMO = parseDemoCreate(demoCreate);
const SCRIPT = DEMO.story.script;
/** Undefined until the script has a take: playback then says so (SS5). */
const TAKE = findTake(parseTakesManifest(takesManifest), SCRIPT);
/** A resume is offered only soon after the session dropped, so a rehearsal never changes the next run's lines. */
export const RESUME_SECONDS = 15 * 60;

/**
 * The flow's state is its record; `reading` means the teleprompter runs and the microphone stays
 * closed. `heard` (session only, never saved) means the take was played back in review.
 */
export type CreateState = CreationRecord & { heard?: true };

export type CreateKey =
  | "create_start" | "create_packs" | "create_confirm" | "create_listener" | "create_wish" | "create_question" | "create_script" | "record_start" | "record_help"
  | "take_saved" | "take_resume" | "take_review" | "take_missing" | "create_title" | "create_sound" | "create_finish" | "create_sent"
  | "create_canceled";

export type CreateTurn = {
  key: CreateKey;
  result: "awaiting_input" | "completed" | "canceled";
  response: AlexaResponseEnvelope;
  /** The record to save, when the turn moved the flow. */
  record?: CreationRecord;
  /** Alexa+ sent an intent the stage does not expect, and the turn followed Jordan's script instead. */
  scriptDefault?: true;
};

type Context = { event: AlexaRequestEnvelope; publicBaseUrl: string | undefined };

const listenerById = (id: string | undefined) => DEMO.listeners.find((listener) => listener.id === id);
const packById = (id: string | undefined) => DEMO.purchase?.packs.find((pack) => pack.id === id);
const CURRENCY = DEMO.purchase?.currency ?? "";
const PACKS = DEMO.purchase?.packs ?? [];
const SCRIPT_PACK = packById(DEMO.purchase?.scriptPack) ?? PACKS.at(-1);
const isVariant = (value: unknown): value is TakeVariant => (TAKE_VARIANTS as readonly unknown[]).includes(value);
const recordOf = ({ heard: _heard, ...record }: CreateState): CreationRecord => record;
/** The turn Jordan's script expects next, taken because Alexa+ routed her line elsewhere. */
const scripted = (turn: CreateTurn): CreateTurn => ({ ...turn, scriptDefault: true });
const withListener = (stage: CreateStage, state: CreateState): CreateState => ({ stage, ...(state.listenerId && { listenerId: state.listenerId }) });

/** Rebuilds the flow from session attributes; anything outside the closed values is dropped. */
export function createStateFrom(attributes: Record<string, string> | undefined): CreateState | null {
  if (attributes?.demoFlow !== "create" || !isCreateStage(attributes.createStage) || attributes.createStage === "sent" || attributes.createStage === "stopped") return null;
  const state: CreateState = { stage: attributes.createStage };
  const listener = listenerById(attributes.createListener);
  if (listener) state.listenerId = listener.id;
  if (attributes.createAnswers === "1" || attributes.createAnswers === "2") state.answers = Number(attributes.createAnswers);
  const title = attributes.createTitle?.trim();
  if (title && title.length <= 60) state.title = title;
  if (isVariant(attributes.createSound)) state.sound = attributes.createSound;
  if (attributes.createReading === "1" && state.stage === "recording") state.reading = true;
  const pack = packById(attributes.createPack);
  if (pack && state.stage === "purchase") state.packId = pack.id;
  if (attributes.createHeard === "1" && state.stage === "review") state.heard = true;
  return state;
}

export function createAttributes(state: CreateState): Record<string, string> {
  return {
    demoFlow: "create",
    createStage: state.stage,
    ...(state.listenerId && { createListener: state.listenerId }),
    ...(state.answers && { createAnswers: String(state.answers) }),
    ...(state.title && { createTitle: state.title }),
    ...(state.sound && { createSound: state.sound }),
    ...(state.reading && { createReading: "1" }),
    ...(state.packId && { createPack: state.packId }),
    ...(state.heard && { createHeard: "1" }),
  };
}


export function supportsApl(event: AlexaRequestEnvelope): boolean {
  return Object.hasOwn(event.context.System.device?.supportedInterfaces ?? {}, "Alexa.Presentation.APL");
}

/** A question: the microphone opens and the flow moves to `state`, saved unless the turn only repeats a prompt. */
function ask(key: CreateKey, state: CreateState, speech: string | OutputSpeech, reprompt: string, directives?: Directive[], save = true): CreateTurn {
  const response = question(speech, reprompt);
  if (directives) response.response.directives = directives;
  return { key, result: "awaiting_input", response: { ...response, sessionAttributes: createAttributes(state) }, ...(save && { record: recordOf(state) }) };
}

/**
 * Speech with the session left open and the microphone closed (`shouldEndSession` absent): on a
 * screen device the adult then has about 30 seconds to say "Alexa, the end".
 */
function open(key: CreateKey, state: CreateState, speech: OutputSpeech, directives?: Directive[], save = true): CreateTurn {
  return { key, result: "awaiting_input", response: { version: "1.0", sessionAttributes: createAttributes(state),
    response: { outputSpeech: speech, ...(directives && { directives }) } }, ...(save && { record: recordOf(state) }) };
}

function startReading(ctx: Context, state: CreateState): CreateTurn {
  const next: CreateState = { ...withListener("recording", state), reading: true };
  return supportsApl(ctx.event)
    ? open("record_start", next, ssml(c.recordCue), teleprompterDirectives(SCRIPT))
    : open("record_start", next, ssml(`${c.scriptIntro} ${SCRIPT} ${c.readAloudCue}`)); // SS1: no screen.
}

function screen(ctx: Context, state: CreateState, detail: string): Directive[] | undefined {
  if (!supportsApl(ctx.event)) return undefined;
  const listener = listenerById(state.listenerId);
  return statusDirectives({ eyebrow: listener ? c.forListener(listener.name) : "", heading: state.title ?? c.yourStory, detail });
}

const takeUrl = (ctx: Context, variant: TakeVariant): string | undefined =>
  TAKE && ctx.publicBaseUrl ? `${ctx.publicBaseUrl.replace(/\/$/, "")}/fixtures/takes/${TAKE.files[variant]}` : undefined;

const LISTENER_NAMES = (() => {
  const all = DEMO.listeners.map((listener) => listener.name);
  return all.length === 1 ? all[0] ?? "" : `${all.slice(0, -1).join(", ")} or ${all.at(-1) ?? ""}`;
})();

function anySlotText(event: AlexaRequestEnvelope): string | undefined {
  return Object.keys(event.request.intent?.slots ?? {}).map((name) => slotValue(event, name)).find(Boolean);
}

/** A listener named in speech: the resolved slot, or the raw words after a carrier ("it's for Sam"). */
function spokenListener(event: AlexaRequestEnvelope): string | undefined {
  const spoken = resolvedValue(event, "listener") ?? anySlotText(event);
  return spoken?.replace(/^(?:it's |it is |the story is )?for\s+/i, "").trim();
}

/** The one listener a heard word names or nearly names ("samual"); several or none gives undefined. */
function listenerIn(spoken: string) {
  const exact = findListener(DEMO, spoken);
  if (exact) return exact;
  const words = foldName(spoken).split(/[^\p{L}]+/u).filter(Boolean);
  const close = DEMO.listeners.filter((listener) => [listener.name, ...listener.synonyms]
    .some((form) => words.some((word) => soundsLike(word, foldName(form)))));
  return close.length === 1 ? close[0] : undefined;
}

function chooseListener(spoken: string | undefined, prefix?: string): CreateTurn {
  const listener = spoken ? listenerIn(spoken) : undefined;
  const lead = prefix ? `${prefix} ` : "";
  if (!listener) {
    // SS7: the name is never repeated back; a bare "who is it for?" only repeats the prompt.
    const line = spoken ? `${c.unknownListener(LISTENER_NAMES)} ${c.whoFor}` : c.whoFor;
    return ask(spoken ? "create_listener" : "create_start", { stage: "listener" }, `${lead}${line}`, c.whoFor, undefined, prefix !== undefined);
  }
  if (listener.wish) {
    const offer = c.wishOffer(listener.name, listener.wish.phrase, listener.wish.topic);
    return ask("create_wish", { stage: "wish", listenerId: listener.id }, `${lead}${offer}`, offer);
  }
  return ask("create_question", { stage: "conversation", listenerId: listener.id }, `${lead}${c.firstQuestion}`, c.firstQuestion);
}

/**
 * "create a story" (optionally naming the listener). With no credits, the purchase scene first
 * (lines 9-15), keeping a named listener for after it; with credits, the credit line and then who
 * it's for (Jordan's fallback). `credits` is the fixture's balance unless a test switches the path.
 */
export function startCreate(spoken: string | undefined, credits = DEMO.credits): CreateTurn {
  const listener = spoken ? findListener(DEMO, spoken) : undefined;
  const turn = credits > 0 ? chooseListener(spoken, c.start(credits))
    : ask("create_start", { stage: "credits", ...(listener && { listenerId: listener.id }) }, c.noCredits, c.buyReprompt);
  // Line 8 can be said over a playing story, which would otherwise play on under the flow (issue 21).
  turn.response.response.directives = [STOP_DIRECTIVE, ...(turn.response.response.directives ?? [])];
  return turn;
}

/** Line 13 for a pack; the listener named at entry, if any, is kept for after the purchase. */
function confirmPack(state: CreateState, pack: DemoPack): CreateTurn {
  const confirm = c.confirmPurchase(pack, CURRENCY);
  return ask("create_confirm", { ...withListener("purchase", state), packId: pack.id }, confirm, confirm);
}

/** A pack named in speech: the resolved slot, or any slot's words, since a pack name can reach other intents. */
function spokenPack(event: AlexaRequestEnvelope) {
  const words = resolvedValue(event, "pack") ?? anySlotText(event);
  return words ? findPack(DEMO, words) : undefined;
}

/** The take was read: review, from the end cue, the Done button or a resume. */
function saved(ctx: Context, state: CreateState, resumed = false): CreateTurn {
  const next = withListener("review", state);
  return ask(resumed ? "take_resume" : "take_saved", next, resumed ? c.resumeReview : c.saved, c.reviewReprompt, screen(ctx, next, c.status.saved));
}

/**
 * A launch, or a Done tap after the session closed, resumes a recent recording at review (SS2).
 * Anything older, or any other stage, starts the next run clean.
 */
export function resumeCreate(ctx: Context, stored: { record: CreationRecord; updatedAt: number }, nowSeconds: number, fromDone: boolean): CreateTurn | null {
  const { stage, reading } = stored.record;
  if (nowSeconds - stored.updatedAt > RESUME_SECONDS) return null;
  // Only a reading that started: the script on screen before "record" has nothing saved yet.
  if (!(stage === "recording" && reading) && (fromDone || stage !== "review")) return null;
  const listener = listenerById(stored.record.listenerId);
  return saved(ctx, { stage, ...(listener && { listenerId: listener.id }) }, !fromDone);
}

const PLAYBACK_INTENTS = new Set(["PlaybackIntent", "PlayAgainIntent", "AMAZON.RepeatIntent"]);
const NEXT_INTENTS = new Set(["AMAZON.NextIntent", "NextStoryIntent", "AMAZON.ResumeIntent"]);

function isPlayback(event: AlexaRequestEnvelope, intent: string | undefined): boolean {
  if (intent && PLAYBACK_INTENTS.has(intent)) return true;
  // "play back" can reach PlayStoryIntent as "play {title}" with the title "back".
  return intent === "PlayStoryIntent" && /^(?:it |that |the story |my story )?back$/i.test(slotValue(event, "title") ?? "");
}

const MINOR_WORDS = /^(?:a|an|and|at|by|for|in|of|on|or|the|to)$/;

/** A title as the adult said it: the resolved catalog value, or the words without a carrier, in title case. */
function spokenTitle(event: AlexaRequestEnvelope): string | undefined {
  const heard = resolvedValue(event, "storytitle") ?? anySlotText(event);
  const raw = (heard && withoutInvocation(heard))
    ?.replace(/^(?:(?:let's |we'll )?call it|it's called|it is called|the title is)\s+/i, "").trim();
  if (!raw) return undefined;
  const words = raw.split(/\s+/).slice(0, 12);
  const titled = raw === raw.toLowerCase()
    ? words.map((word, index) => (index > 0 && MINOR_WORDS.test(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    : words;
  return titled.join(" ").slice(0, 60).trim();
}

/** A heard title within a few letters of the script's ("sam on the mon") is the script's title. */
function titleFor(heard: string | undefined): string | undefined {
  if (!heard) return undefined;
  const scriptTitle = DEMO.story.title;
  const distance = editDistance(foldName(heard), foldName(scriptTitle));
  return distance <= Math.max(2, Math.floor(scriptTitle.length / 5)) ? scriptTitle : heard;
}

function soundChoice(event: AlexaRequestEnvelope, intent: string | undefined): TakeVariant | undefined {
  if (intent === "AMAZON.NoIntent") return "plain";
  const resolved = resolvedValue(event, "sound");
  if (isVariant(resolved)) return resolved;
  const text = anySlotText(event)?.toLowerCase() ?? "";
  if (/\bboth\b|music and|and music/.test(text)) return "both";
  if (/\bmusic\b/.test(text)) return "music";
  if (/\beffects?\b/.test(text)) return "effects";
  if (/\b(?:none|neither|nothing|as it is)\b/.test(text)) return "plain";
  return undefined;
}

/** The current stage's question again: help, a fallback, or a reply the stage does not take. Nothing is saved. */
function prompt(state: CreateState): CreateTurn {
  const listener = listenerById(state.listenerId);
  const again = (key: CreateKey, speech: string, reprompt = speech) => ask(key, state, speech, reprompt, undefined, false);
  switch (state.stage) {
    case "credits": return again("create_start", c.buyReprompt);
    case "pack": return again("create_packs", c.packList(PACKS, CURRENCY), c.packReprompt);
    case "purchase": {
      const pack = packById(state.packId);
      return pack ? again("create_confirm", c.confirmPurchase(pack, CURRENCY), c.confirmPurchase(pack, CURRENCY)) : again("create_packs", c.packList(PACKS, CURRENCY), c.packReprompt);
    }
    case "listener": return again("create_listener", c.whoFor);
    case "wish": return again("create_wish", listener?.wish ? c.wishOffer(listener.name, listener.wish.phrase, listener.wish.topic) : c.firstQuestion);
    case "conversation": return again("create_question", (state.answers ? DEMO.story.replies[state.answers - 1] : undefined) ?? c.firstQuestion);
    case "recording":
      if (state.reading) return open("record_help", state, ssml(c.recordingHelp), undefined, false);
      return again("create_script", c.recordReprompt);
    case "review": return again("take_review", c.reviewReprompt);
    case "title": return again("create_title", c.titleReprompt);
    case "sound": return again("create_sound", c.soundQuestion(state.title ?? c.yourStory), c.soundWhich);
    default: return again("create_finish", c.finishPrompt);
  }
}

/** The teleprompter's Done button (`apl/teleprompter.json`), as an APL UserEvent. */
export const isDoneEvent = (event: AlexaRequestEnvelope): boolean =>
  event.request.type === "Alexa.Presentation.APL.UserEvent" && event.request.arguments?.[0] === "done";

const STOP_INTENTS = new Set(["AMAZON.StopIntent", "AMAZON.CancelIntent", "AMAZON.PauseIntent"]);

/**
 * The next turn of a flow already in progress. Every stage answers its expected reply, an explicit
 * no, stop or help, and a different choice it can name. Anything else follows Jordan's script:
 * Alexa+ routes her short replies to whatever intent it likes ("record" as FallbackIntent, "yes" as
 * WhatIsNewIntent; device run 2026-10-17), so the script's answer is the only safe reading of them.
 */
export function continueCreate(ctx: Context, state: CreateState): CreateTurn {
  const { event } = ctx;
  const intent = event.request.type === "IntentRequest" ? event.request.intent?.name : undefined;
  const done = isDoneEvent(event);
  const listener = listenerById(state.listenerId);
  const reading = state.stage === "recording" && state.reading === true;

  if (intent && STOP_INTENTS.has(intent)) {
    // While reading, "Alexa, the end" can be heard as a stop: the reading ends and is kept.
    if (reading) return scripted(saved(ctx, state));
    // Stored as stopped, so the next launch opens plainly instead of resuming this run.
    return { key: "create_canceled", result: "canceled", response: closing(c.canceled), record: { stage: "stopped" } };
  }
  // A Done tap only ends a reading; one racing "the end" must not move a later stage.
  if (intent === "AMAZON.HelpIntent" || (!intent && !done) || (done && state.stage !== "recording")) return prompt(state);
  const fallback = intent === "AMAZON.FallbackIntent";
  const yes = intent === "AMAZON.YesIntent";
  const no = intent === "AMAZON.NoIntent";
  const follow = (turn: CreateTurn, expected: boolean) => (expected ? turn : scripted(turn));
  const packs = () => ask("create_packs", withListener("pack", state), c.packList(PACKS, CURRENCY), c.packReprompt);

  switch (state.stage) {
    case "credits": {
      // "Yes, the Founding family pack" answers lines 10 and 12 at once.
      const named = fallback ? undefined : spokenPack(event);
      if (named) return confirmPack(state, named);
      // Stored as stopped, like a stop: without a credit there is no story to make.
      if (no) return { key: "create_canceled", result: "canceled", response: closing(c.noPurchase), record: { stage: "stopped" } };
      return follow(packs(), yes);
    }
    case "pack": {
      const named = fallback ? undefined : spokenPack(event);
      if (named) return confirmPack(state, named);
      return SCRIPT_PACK && !no ? scripted(confirmPack(state, SCRIPT_PACK)) : prompt(state);
    }
    case "purchase": {
      const pack = packById(state.packId);
      if (!pack) return packs();
      const other = fallback || yes ? undefined : spokenPack(event);
      if (other && other.id !== pack.id) return confirmPack(state, other);
      if (no) return ask("create_packs", withListener("pack", state), `${c.notPurchased} ${c.packList(PACKS, CURRENCY)}`, c.packReprompt);
      return follow(chooseListener(listener?.name, c.purchased(pack.credits)), yes || other !== undefined);
    }
    case "listener": {
      const spoken = fallback ? undefined : spokenListener(event);
      const only = DEMO.listeners.length === 1 ? DEMO.listeners[0] : undefined;
      const named = spoken ? listenerIn(spoken) : undefined;
      // With one listener every answer is line 17, so a misheard name never loops; SS7 needs several.
      if (named || !only) return chooseListener(spoken);
      return scripted(chooseListener(only.name));
    }
    case "wish": {
      const topic = listener?.wish?.topic;
      const next = withListener("conversation", state);
      if (no || !topic) return ask("create_question", next, `${c.wishNo} ${c.firstQuestion}`, c.firstQuestion);
      return follow(ask("create_question", next, `${c.wishYes(topic)} ${c.firstQuestion}`, c.firstQuestion), yes);
    }
    case "conversation": {
      const answers = state.answers ?? 0;
      const reply = DEMO.story.replies[answers];
      if (reply) return ask("create_question", { ...state, answers: answers + 1 }, reply, reply);
      const next = withListener("recording", state);
      return supportsApl(event)
        ? ask("create_script", next, c.handOver, c.recordReprompt, scriptPreviewDirectives(SCRIPT))
        : ask("create_script", next, c.handOverNoScreen, c.recordReprompt);
    }
    case "recording":
      if (intent === "TheEndIntent" || done) return saved(ctx, state);
      if (reading && intent !== "RecordStoryIntent") return scripted(saved(ctx, state));
      return follow(startReading(ctx, state), intent === "RecordStoryIntent");
    case "review": {
      if (intent === "RecordStoryIntent") return startReading(ctx, state);
      const playback = isPlayback(event, intent);
      const next = intent !== undefined && NEXT_INTENTS.has(intent);
      // Line 32 then line 34: the take plays back first, then the flow moves on.
      if (playback || (!next && !state.heard)) {
        const audio = takeUrl(ctx, "plain");
        const heard: CreateState = { ...state, heard: true };
        return follow(audio
          ? ask("take_review", heard, ssml({ audio }, c.afterPlayback), c.reviewReprompt, undefined, false)
          : ask("take_missing", heard, c.takeMissing, c.reviewReprompt, undefined, false), playback);
      }
      const titleStage = withListener("title", state);
      return follow(ask("create_title", titleStage, c.titleQuestion, c.titleReprompt, screen(ctx, titleStage, c.status.finishing)), next);
    }
    case "title": {
      const heard = fallback ? undefined : spokenTitle(event);
      const title = titleFor(heard) ?? DEMO.story.title;
      const next: CreateState = { ...withListener("sound", state), title };
      return follow(ask("create_sound", next, c.soundQuestion(title), c.soundWhich, screen(ctx, next, c.status.sound)), heard !== undefined);
    }
    case "sound": {
      const chosen = yes ? undefined : soundChoice(event, intent);
      const sound = chosen ?? DEMO.story.sound;
      const next: CreateState = { ...state, stage: "finish", sound };
      return follow(ask("create_finish", next, `${c.soundAdded[sound]} ${c.finishPrompt}`, c.finishPrompt, screen(ctx, next, c.soundAdded[sound])), chosen !== undefined);
    }
    default: {
      const audio = takeUrl(ctx, state.sound ?? "plain");
      if (isPlayback(event, intent)) {
        return audio
          ? ask("create_finish", state, ssml({ audio }, c.finishPrompt), c.finishPrompt, undefined, false)
          : ask("take_missing", state, c.finishMissing, c.finishPrompt, undefined, false);
      }
      if (no) return prompt(state);
      const title = state.title ?? c.yourStory;
      const name = listener?.name ?? "";
      const sent: CreateState = { ...state, stage: "sent" };
      // A story still playing from before the flow stops, so only the finished story is heard.
      const directives: Directive[] = [STOP_DIRECTIVE, ...(screen(ctx, sent, c.status.sent(name)) ?? [])];
      const response = audio ? closing(ssml(c.sent(title, name), { audio }), directives) : closing(c.sentNoAudio(title, name), directives);
      return follow({ key: "create_sent", result: "completed", response, record: recordOf(sent) }, intent === "SendStoryIntent" || yes);
    }
  }
}
