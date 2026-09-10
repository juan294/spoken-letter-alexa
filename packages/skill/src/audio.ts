/**
 * The agent's `play` reply: the story MP3 and what to show on a screen device. Declared
 * here rather than imported from `@spoken-letter-alexa/agent` on purpose: the skill bundle
 * must not depend on the agent package (Strands, Bedrock, Polly, Transcribe).
 */
export type Play = {
  url: string;
  title: string;
  storyteller: string;
  durationSeconds: number | null;
  /** The story's own artwork on an Echo Show. Null when the story has none. */
  artUrl?: string | null | undefined;
};

/** The one size Alexa asks for on the AudioPlayer card; `fixtures/art/` renders at exactly this. */
export const ART_PIXELS = 480;

export type ArtSource = { url: string; size: "X_SMALL"; widthPixels: number; heightPixels: number };

export type PlayDirective = {
  type: "AudioPlayer.Play";
  playBehavior: "REPLACE_ALL";
  audioItem: {
    stream: { url: string; token: string; offsetInMilliseconds: number };
    metadata: { title: string; subtitle: string; art?: { sources: ArtSource[] } };
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
  const art = artSource(play.artUrl);
  const canonical = {
    url: play.url,
    title: play.title,
    storyteller: play.storyteller,
    durationSeconds: play.durationSeconds,
    // Only a usable URL is carried, so resume rebuilds the same card the first play showed.
    ...(art && { artUrl: art.url }),
  };
  return Buffer.from(JSON.stringify(canonical), "utf8").toString("base64url");
}

export function decodeStreamToken(token: string): Play | null {
  try {
    const parsed = JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as Partial<Play>;
    if (typeof parsed.url !== "string" || typeof parsed.title !== "string" || typeof parsed.storyteller !== "string") return null;
    return {
      url: parsed.url,
      title: parsed.title,
      storyteller: parsed.storyteller,
      durationSeconds: typeof parsed.durationSeconds === "number" ? parsed.durationSeconds : null,
      artUrl: typeof parsed.artUrl === "string" ? parsed.artUrl : null,
    };
  } catch {
    return null;
  }
}

/**
 * The artwork the card may show. The agent's `artUrl` reaches us through a language model,
 * so it is treated as untrusted text: anything that is not an absolute https URL is
 * dropped and the story plays with no card art rather than not at all. Alexa itself
 * refuses non-https image sources.
 */
export function artSource(artUrl: string | null | undefined): ArtSource | null {
  if (typeof artUrl !== "string" || artUrl === "") return null;
  let parsed: URL;
  try {
    parsed = new URL(artUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  return { url: parsed.href, size: "X_SMALL", widthPixels: ART_PIXELS, heightPixels: ART_PIXELS };
}

export function playDirective(play: Play, offsetInMilliseconds = 0): PlayDirective {
  const art = artSource(play.artUrl);
  return {
    type: "AudioPlayer.Play",
    playBehavior: "REPLACE_ALL",
    audioItem: {
      stream: { url: play.url, token: encodeStreamToken(play), offsetInMilliseconds },
      metadata: {
        title: play.title,
        subtitle: `read by ${play.storyteller}`,
        ...(art && { art: { sources: [art] } }),
      },
    },
  };
}

export const STOP_DIRECTIVE: StopDirective = { type: "AudioPlayer.Stop" };
