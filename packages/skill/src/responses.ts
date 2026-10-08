import type { AplDirective } from "./apl/recording.ts";
import type { AudioDirective } from "./audio.ts";
import type { AlexaResponseEnvelope } from "./handler.ts";

export type OutputSpeech = { type: "SSML"; ssml: string };
export type Directive = AudioDirective | AplDirective;

export function escapeSsml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Text is escaped; an `{ audio }` part becomes an `<audio>` element between the spoken parts. */
export function ssml(...parts: (string | { audio: string })[]): OutputSpeech {
  const body = parts.map((part) => (typeof part === "string" ? escapeSsml(part) : `<audio src="${escapeSsml(part.audio)}"/>`)).join(" ");
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
export const closing = (text: string, directives?: Directive[]) => speak(text, { endSession: true, ...(directives && { directives }) });
