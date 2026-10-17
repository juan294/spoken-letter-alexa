import type { AplDirective } from "./apl/recording.ts";
import type { AudioDirective } from "./audio.ts";
import type { AlexaResponseEnvelope } from "./handler.ts";

export type OutputSpeech = { type: "SSML"; ssml: string };
export type Directive = AudioDirective | AplDirective;

export function escapeSsml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Alexa+ reads the command "record" as the noun (issue 21). Only the skill's own command forms are
 * marked (a quoted "record" or "re-record", "record a story"); titles and replies keep Alexa's reading.
 */
const PRONUNCIATIONS: readonly [RegExp, string][] = [
  [/(?<=&quot;)re-record(?=&quot;)/gi, "<phoneme alphabet=\"ipa\" ph=\"ˌɹiɹɪˈkɔɹd\">$&</phoneme>"],
  // Alexa+ ignored `<w role="amazon:VB">` (issue 21, 2026-10-17), so the verb is spelled out in IPA.
  [/(?<=&quot;)record(?=&quot;)|\brecord(?= (?:a |your )?story\b)/gi, "<phoneme alphabet=\"ipa\" ph=\"ɹɪˈkɔɹd\">$&</phoneme>"],
];

/** Escaped text with the skill's pronunciation fixes applied. */
export function speechText(text: string): string {
  return PRONUNCIATIONS.reduce((speech, [pattern, replacement]) => speech.replace(pattern, replacement), escapeSsml(text));
}

/** Text is escaped; an `{ audio }` part becomes an `<audio>` element between the spoken parts. */
export function ssml(...parts: (string | { audio: string })[]): OutputSpeech {
  const body = parts.map((part) => (typeof part === "string" ? speechText(part) : `<audio src="${escapeSsml(part.audio)}"/>`)).join(" ");
  return { type: "SSML", ssml: `<speak>${body}</speak>` };
}

export function speak(speech: string | OutputSpeech, options: { reprompt?: string; endSession: boolean; directives?: Directive[] }): AlexaResponseEnvelope {
  return {
    version: "1.0",
    response: {
      outputSpeech: typeof speech === "string" ? ssml(speech) : speech,
      ...(options.reprompt !== undefined && { reprompt: { outputSpeech: ssml(options.reprompt) } }),
      ...(options.directives && { directives: options.directives }),
      shouldEndSession: options.endSession,
    },
  };
}

/** A question stays open with the caller's flow-specific reprompt. */
export const question = (speech: string | OutputSpeech, reprompt: string) => speak(speech, { reprompt, endSession: false });
/** A closing line, optionally with playback: the session ends. */
export const closing = (speech: string | OutputSpeech, directives?: Directive[]) => speak(speech, { endSession: true, ...(directives && { directives }) });
