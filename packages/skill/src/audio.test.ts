import { describe, expect, test } from "vitest";

import { artSource, decodeStreamToken, encodeStreamToken, playDirective, type Play } from "./audio.ts";

const ART_URL = "https://alexa.spokenletter.com/fixtures/art/st_owl.png";
const PLAY: Play = {
  url: "https://alexa.spokenletter.com/fixtures/audio/st_owl.mp3",
  title: "The owl who forgot how to hoot",
  storyteller: "Grandpa Juan",
  durationSeconds: 184,
  artUrl: ART_URL,
};

describe("artSource", () => {
  test("accepts an https url and describes it at the size Alexa asks for", () => {
    expect(artSource(ART_URL)).toEqual({ url: ART_URL, size: "X_SMALL", widthPixels: 480, heightPixels: 480 });
  });

  test.each([
    ["absent", undefined],
    ["null", null],
    ["empty", ""],
    ["plain http", "http://alexa.spokenletter.com/fixtures/art/st_owl.png"],
    ["a data uri", "data:image/png;base64,iVBORw0KGgo="],
    ["a bare path the model invented", "/fixtures/art/st_owl.png"],
    ["prose the model wrote instead", "the artwork for the owl story"],
  ])("drops %s rather than failing the story", (_label, value) => {
    expect(artSource(value)).toBeNull();
  });
});

describe("playDirective", () => {
  test("carries the artwork card when the story has one", () => {
    const directive = playDirective(PLAY);
    expect(directive.audioItem.metadata.art).toEqual({
      sources: [{ url: ART_URL, size: "X_SMALL", widthPixels: 480, heightPixels: 480 }],
    });
  });

  test("omits the art key entirely when the artUrl is unusable", () => {
    const directive = playDirective({ ...PLAY, artUrl: "not a url" });
    expect("art" in directive.audioItem.metadata).toBe(false);
    // The story itself still plays: bad artwork never costs the recording.
    expect(directive.audioItem.stream.url).toBe(PLAY.url);
  });
});

describe("stream token", () => {
  test("round trips the artwork so resume rebuilds the same card", () => {
    const play = decodeStreamToken(encodeStreamToken(PLAY));
    expect(play).toEqual(PLAY);
    expect(playDirective(play!, 42_000).audioItem.metadata.art).toEqual({
      sources: [{ url: ART_URL, size: "X_SMALL", widthPixels: 480, heightPixels: 480 }],
    });
  });

  test("never carries an artUrl it would refuse to show", () => {
    const token = encodeStreamToken({ ...PLAY, artUrl: "http://insecure.example/art.png" });
    expect(decodeStreamToken(token)!.artUrl).toBeNull();
  });

  test("still decodes a token minted before artwork existed", () => {
    const legacy = Buffer.from(
      JSON.stringify({ url: PLAY.url, title: PLAY.title, storyteller: PLAY.storyteller, durationSeconds: 184 }),
      "utf8",
    ).toString("base64url");
    expect(decodeStreamToken(legacy)).toEqual({ ...PLAY, artUrl: null });
  });
});
