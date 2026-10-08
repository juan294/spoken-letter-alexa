export type OutputSpeech = { type: "SSML"; ssml: string };

export function escapeSsml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function ssml(text: string): OutputSpeech {
  return { type: "SSML", ssml: `<speak>${escapeSsml(text)}</speak>` };
}
