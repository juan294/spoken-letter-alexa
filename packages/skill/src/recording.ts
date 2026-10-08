import { findTake, parseTakesManifest, spikeTake } from "@spoken-letter-alexa/shared";

import { teleprompterDirectives } from "./apl/recording.ts";
import { CREATE_MESSAGES as c } from "./create-messages.ts";
import type { AlexaRequestEnvelope, AlexaResponseEnvelope } from "./handler.ts";
import { escapeSsml, type OutputSpeech, ssml } from "./ssml.ts";
import takesManifest from "../../../fixtures/takes/manifest.json" with { type: "json" };

/**
 * The staged recording step (staged demo plan, phase 1). A skill never receives raw audio, so
 * nothing is captured: the teleprompter shows the script, the adult reads it, and "Alexa, the
 * end" (or the Done button) plays a take an adult recorded beforehand of the same script.
 * Until the creation flow exists (phase 3), the script is the manifest's spike passage.
 */
const TAKES = parseTakesManifest(takesManifest);

export const CREATE_STAGES = ["recording", "review"] as const;
export type CreateStage = (typeof CREATE_STAGES)[number];
export const isCreateStage = (value: string | undefined): value is CreateStage => (CREATE_STAGES as readonly (string | undefined)[]).includes(value);

export type RecordingKey = "record_start" | "record_help" | "take_review" | "take_missing" | "take_question" | "record_finish";
export type RecordingTurn = { key: RecordingKey; result: "awaiting_input" | "completed"; response: AlexaResponseEnvelope };

export function supportsApl(event: AlexaRequestEnvelope): boolean {
  return Object.hasOwn(event.context.System.device?.supportedInterfaces ?? {}, "Alexa.Presentation.APL");
}

const at = (createStage: CreateStage) => ({ demoFlow: "create", createStage });

/**
 * Speech with the session left open and the microphone closed (`shouldEndSession` absent): on a
 * screen device the adult then has about 30 seconds to say "Alexa, the end".
 */
const openSession = (text: string, extra: Partial<AlexaResponseEnvelope["response"]> = {}): AlexaResponseEnvelope => ({
  version: "1.0",
  sessionAttributes: at("recording"),
  response: { outputSpeech: ssml(text), ...extra },
});

const review = (outputSpeech: OutputSpeech): AlexaResponseEnvelope => ({
  version: "1.0",
  sessionAttributes: at("review"),
  response: { outputSpeech, reprompt: { outputSpeech: ssml(c.takeQuestion) }, shouldEndSession: false },
});

function startRecording(event: AlexaRequestEnvelope, script: string): RecordingTurn {
  const response = supportsApl(event)
    ? openSession(c.recordCue, { directives: teleprompterDirectives(script) })
    : openSession(`${c.scriptIntro} ${script} ${c.readAloudCue}`); // SS1: no screen.
  return { key: "record_start", result: "awaiting_input", response };
}

function reviewTake(script: string, publicBaseUrl: string | undefined): RecordingTurn {
  const take = findTake(TAKES, script);
  if (!take || !publicBaseUrl) return { key: "take_missing", result: "awaiting_input", response: review(ssml(c.takeMissing)) };
  const src = `${publicBaseUrl.replace(/\/$/, "")}/fixtures/takes/${take.files.plain}`;
  return {
    key: "take_review",
    result: "awaiting_input",
    response: review({ type: "SSML", ssml: `<speak>${escapeSsml(c.takeIntro)} <audio src="${escapeSsml(src)}"/> ${escapeSsml(c.takeQuestion)}</speak>` }),
  };
}

/**
 * The recording turn for this request, or null when the request is not part of recording.
 * "Record again" is `RecordStoryIntent`; "continue" arrives as Amazon's resume or next intent.
 * A Done tap after the session closed still plays the take: the spike has only one script.
 */
export function recordingTurn(event: AlexaRequestEnvelope, state: Record<string, string>, publicBaseUrl: string | undefined): RecordingTurn | null {
  const script = spikeTake(TAKES)?.script;
  if (script === undefined) return null;
  const { request } = event;
  const intent = request.type === "IntentRequest" ? request.intent?.name : undefined;
  const done = request.type === "Alexa.Presentation.APL.UserEvent" && request.arguments?.[0] === "done";
  const stage = state.demoFlow === "create" ? state.createStage : undefined;

  if (intent === "RecordStoryIntent") return startRecording(event, script);
  if (intent === "TheEndIntent" || done) return reviewTake(script, publicBaseUrl);
  if (stage === "review" && (intent === "AMAZON.ResumeIntent" || intent === "AMAZON.NextIntent")) {
    return { key: "record_finish", result: "completed", response: { version: "1.0", response: { outputSpeech: ssml(c.takeContinue), shouldEndSession: true } } };
  }
  if (intent === "AMAZON.FallbackIntent" || intent === "AMAZON.HelpIntent") {
    if (stage === "review") return { key: "take_question", result: "awaiting_input", response: review(ssml(c.takeQuestion)) };
    if (stage === "recording") return { key: "record_help", result: "awaiting_input", response: openSession(c.recordingHelp) };
  }
  return null;
}
