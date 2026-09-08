/** The agent's `play` reply: the story MP3 and what to show on a screen device. */
export type Play = { url: string; title: string; storyteller: string; durationSeconds: number | null };

export type PlayDirective = {
  type: "AudioPlayer.Play";
  playBehavior: "REPLACE_ALL";
  audioItem: {
    stream: { url: string; token: string; offsetInMilliseconds: number };
    metadata: { title: string; subtitle: string };
  };
};

export type StopDirective = { type: "AudioPlayer.Stop" };

export type AudioDirective = PlayDirective | StopDirective;

/**
 * The stream token Alexa echoes back in every AudioPlayer request. It carries the whole
 * `play` so pause and resume need no store: the Lambda rebuilds the directive from the
 * token and the offset Alexa reports. Base64url JSON with a fixed key order.
 */
export function encodeStreamToken(play: Play): string {
  const canonical = { url: play.url, title: play.title, storyteller: play.storyteller, durationSeconds: play.durationSeconds };
  return Buffer.from(JSON.stringify(canonical), "utf8").toString("base64url");
}

export function decodeStreamToken(token: string): Play | null {
  try {
    const parsed = JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as Partial<Play>;
    if (typeof parsed.url !== "string" || typeof parsed.title !== "string" || typeof parsed.storyteller !== "string") return null;
    return { url: parsed.url, title: parsed.title, storyteller: parsed.storyteller, durationSeconds: typeof parsed.durationSeconds === "number" ? parsed.durationSeconds : null };
  } catch {
    return null;
  }
}

export function playDirective(play: Play, offsetInMilliseconds = 0): PlayDirective {
  return {
    type: "AudioPlayer.Play",
    playBehavior: "REPLACE_ALL",
    audioItem: {
      stream: { url: play.url, token: encodeStreamToken(play), offsetInMilliseconds },
      metadata: { title: play.title, subtitle: `read by ${play.storyteller}` },
    },
  };
}

export const STOP_DIRECTIVE: StopDirective = { type: "AudioPlayer.Stop" };
