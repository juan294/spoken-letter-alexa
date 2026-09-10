import { describe, expect, test } from "vitest";

import { TEST_BASE_URL, TEST_STORIES } from "../test-support.ts";
import { FixtureProvider, parseFixtureCatalog } from "./fixtures.ts";

describe("FixtureProvider", () => {
  const provider = new FixtureProvider({ stories: TEST_STORIES, publicBaseUrl: TEST_BASE_URL });

  test("lists delivered stories newest first and honours the limit", async () => {
    const all = await provider.listDeliveredStories("demo", 10);
    expect(all.map((story) => story.id)).toEqual(["st_lighthouse", "st_owl", "st_bread"]);
    const two = await provider.listDeliveredStories("demo", 2);
    expect(two.map((story) => story.id)).toEqual(["st_lighthouse", "st_owl"]);
  });

  test("summaries carry only the ADR 0013 boundary fields", async () => {
    const [story] = await provider.listDeliveredStories("demo", 1);
    expect(Object.keys(story!).sort()).toEqual(["deliveredAt", "durationSeconds", "id", "storyteller", "title"]);
  });

  test("a story with artwork carries its public url and nothing more", async () => {
    const stories = await provider.listDeliveredStories("demo", 10);
    const owl = stories.find((story) => story.id === "st_owl");
    expect(Object.keys(owl!).sort()).toEqual(["artUrl", "deliveredAt", "durationSeconds", "id", "storyteller", "title"]);
    expect(owl!.artUrl).toBe(`${TEST_BASE_URL}/fixtures/art/st_owl.png`);
  });

  test("getStory carries the artwork url alongside the audio", async () => {
    const story = await provider.getStory("demo", "st_owl");
    expect(story!.artUrl).toBe(`${TEST_BASE_URL}/fixtures/art/st_owl.png`);
    const without = await provider.getStory("demo", "st_bread");
    expect(without).not.toBeNull();
    expect("artUrl" in without!).toBe(false);
  });

  test("getStory returns the public MP3 url with a one-hour expiry", async () => {
    const before = Date.now();
    const story = await provider.getStory("demo", "st_owl");
    expect(story).not.toBeNull();
    expect(story!.audio).toEqual({
      url: `${TEST_BASE_URL}/fixtures/audio/st_owl.mp3`,
      expiresAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) as string,
      contentType: "audio/mpeg",
    });
    const expiresIn = Date.parse(story!.audio.expiresAt) - before;
    expect(expiresIn).toBeGreaterThan(59 * 60 * 1000);
    expect(expiresIn).toBeLessThanOrEqual(60 * 60 * 1000 + 1000);
  });

  test("getStory returns null for an unknown id", async () => {
    await expect(provider.getStory("demo", "nope")).resolves.toBeNull();
  });
});

describe("parseFixtureCatalog", () => {
  test("accepts the documented shape and drops unknown keys", () => {
    const parsed = parseFixtureCatalog({
      stories: [
        {
          id: "st_x",
          title: "T",
          storyteller: "S",
          durationSeconds: 10,
          deliveredAt: "2026-09-01T00:00:00.000Z",
          file: "st_x.mp3",
          recipientName: "must not survive",
        },
      ],
    });
    expect(parsed).toEqual([
      {
        id: "st_x",
        title: "T",
        storyteller: "S",
        durationSeconds: 10,
        deliveredAt: "2026-09-01T00:00:00.000Z",
        file: "st_x.mp3",
      },
    ]);
  });

  test("rejects a malformed catalog with the offending path", () => {
    expect(() => parseFixtureCatalog({ stories: [{ id: "x" }] })).toThrow(/stories\.0\.title/);
  });

  test("requires the audio file to be named after the id", () => {
    expect(() =>
      parseFixtureCatalog({
        stories: [{ id: "st_x", title: "T", storyteller: "S", deliveredAt: "2026-09-01T00:00:00.000Z", file: "other.mp3" }],
      }),
    ).toThrow(/stories\.0\.file/);
  });

  test("requires the artwork file to be named after the id", () => {
    const story = { id: "st_x", title: "T", storyteller: "S", deliveredAt: "2026-09-01T00:00:00.000Z", file: "st_x.mp3" };
    expect(() => parseFixtureCatalog({ stories: [{ ...story, art: "other.png" }] })).toThrow(/stories\.0\.art/);
    expect(parseFixtureCatalog({ stories: [{ ...story, art: "st_x.png" }] })[0]!.art).toBe("st_x.png");
  });
});
