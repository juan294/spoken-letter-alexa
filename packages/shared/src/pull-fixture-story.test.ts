import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { listStories, mediaSource, pullStory, pullTake, STORY_FIELDS } from "../../../scripts/pull-fixture-story.mjs";

const DOCS = "https://firestore.googleapis.com/v1/projects/spoken-letter/databases/(default)/documents";

type Call = { url: string; init?: RequestInit };

/** A Firestore REST stand-in: records every call and answers from `documents`. */
function fakeFirestore(documents: Record<string, Record<string, unknown>>) {
  const calls: Call[] = [];
  const fetch = (url: string, init?: RequestInit) => {
    calls.push({ url, ...(init && { init }) });
    if (url === `${DOCS}:runQuery`) {
      const results = Object.entries(documents).map(([id, fields]) => ({ document: { name: `projects/spoken-letter/databases/(default)/documents/stories/${id}`, fields } }));
      return Promise.resolve(new Response(JSON.stringify(results)));
    }
    const id = /\/stories\/([^?]+)/.exec(url)?.[1] ?? "";
    const fields = documents[id];
    return Promise.resolve(fields ? new Response(JSON.stringify({ name: `x/stories/${id}`, fields })) : new Response("{}", { status: 404 }));
  };
  return { calls, fetch };
}

const delivered = {
  title: { stringValue: "The fox who found the moon" },
  status: { stringValue: "downloaded" },
  mixStatus: { stringValue: "ready" },
  finalMixRef: { stringValue: "spaces/space1/stories/doc1/final.mp3" },
  iconRef: { stringValue: "spaces/space1/stories/doc1/icon.png" },
  downloadedAt: { timestampValue: "2026-09-12T08:30:00Z" },
  spaceId: { stringValue: "space1" },
};

describe("pull-fixture-story.mjs (S5)", () => {
  let root: string;
  let commands: string[][];
  /** `gcloud storage cp <src> <dst>` and `magick … PNG24:<dst>` leave a file at the last argument. */
  const run = (command: string, args: string[]) => {
    commands.push([command, ...args]);
    const target = (args.at(-1) ?? "").replace(/^PNG24:/, "");
    if (command === "gcloud" || command === "magick") {
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, "fake");
    }
  };
  const probe = () => 187.4;
  const deps = (fetch: ReturnType<typeof fakeFirestore>["fetch"]) => ({ fetch, token: "t", run, probe, root });

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "sla-pull-story-"));
    commands = [];
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("the story field mask is exactly the listed fields and names no recipient, sender or content", async () => {
    expect([...STORY_FIELDS].sort()).toEqual(["downloadedAt", "finalMixRef", "iconRef", "mixStatus", "narrationRef", "spaceId", "status", "title"]);
    const { calls, fetch } = fakeFirestore({ doc1: delivered });
    await pullStory(deps(fetch), "doc1", { storyteller: "Uncle Theo" });
    const get = new URL(calls[0]!.url);
    expect(decodeURIComponent(get.pathname)).toBe("/v1/projects/spoken-letter/databases/(default)/documents/stories/doc1");
    expect(get.searchParams.getAll("mask.fieldPaths").sort()).toEqual([...STORY_FIELDS].sort());
    expect(calls[0]!.init?.headers).toEqual({ Authorization: "Bearer t" });
  });

  test("pulls the final mix and icon from the media bucket and registers the story", async () => {
    const { fetch } = fakeFirestore({ doc1: delivered });
    const result = await pullStory(deps(fetch), "doc1", { storyteller: "Uncle Theo" });
    expect(result).toEqual({ id: "st_the_fox_who_found_the_moon", title: "The fox who found the moon" });
    expect(commands[0]).toEqual(["gcloud", "storage", "cp", "gs://spoken-letter-media/spaces/space1/stories/doc1/final.mp3", path.join(root, "fixtures/audio/st_the_fox_who_found_the_moon.mp3")]);
    expect(commands[1]?.slice(0, 4)).toEqual(["gcloud", "storage", "cp", "gs://spoken-letter-media/spaces/space1/stories/doc1/icon.png"]);
    expect(commands[2]?.[0]).toBe("magick");
    expect(commands[2]?.at(-1)).toBe(`PNG24:${path.join(root, "fixtures/art/st_the_fox_who_found_the_moon.png")}`);
    const catalog = JSON.parse(readFileSync(path.join(root, "fixtures/stories.json"), "utf8")) as { stories: unknown[] };
    expect(catalog.stories).toEqual([{
      id: "st_the_fox_who_found_the_moon",
      title: "The fox who found the moon",
      storyteller: "Uncle Theo",
      durationSeconds: 187,
      deliveredAt: "2026-09-12T08:30:00.000Z",
      file: "st_the_fox_who_found_the_moon.mp3",
      art: "st_the_fox_who_found_the_moon.png",
    }]);
  });

  test("an explicit id names the files", async () => {
    const { fetch } = fakeFirestore({ doc1: delivered });
    const result = await pullStory(deps(fetch), "doc1", { storyteller: "Uncle Theo", id: "st_fox" });
    expect(result.id).toBe("st_fox");
    expect(commands[0]?.at(-1)).toBe(path.join(root, "fixtures/audio/st_fox.mp3"));
  });

  test("a story without an icon is registered without art", async () => {
    const { fetch } = fakeFirestore({ doc1: { ...delivered, iconRef: undefined } });
    await pullStory(deps(fetch), "doc1", { storyteller: "Uncle Theo" });
    expect(commands).toHaveLength(1);
    const catalog = JSON.parse(readFileSync(path.join(root, "fixtures/stories.json"), "utf8")) as { stories: Record<string, unknown>[] };
    expect("art" in catalog.stories[0]!).toBe(false);
  });

  test.each([
    ["not downloaded", { status: { stringValue: "sent" } }, /status is sent, not downloaded/],
    ["a mix that is not ready", { mixStatus: { stringValue: "requested" } }, /mixStatus is requested, not ready/],
    ["no final mix", { finalMixRef: undefined }, /no finalMixRef/],
  ])("refuses a story with %s, before copying anything", async (_label, patch, reason) => {
    const { fetch } = fakeFirestore({ doc1: { ...delivered, ...patch } });
    await expect(pullStory(deps(fetch), "doc1", { storyteller: "Uncle Theo" })).rejects.toThrow(reason);
    expect(commands).toEqual([]);
  });

  test("a missing story is refused", async () => {
    const { fetch } = fakeFirestore({});
    await expect(pullStory(deps(fetch), "nope", { storyteller: "Uncle Theo" })).rejects.toThrow(/story nope: HTTP 404/);
  });

  test("mediaSource builds the gs:// path and refuses a ref outside a story folder", () => {
    expect(mediaSource("spaces/s/stories/d/final.mp3")).toBe("gs://spoken-letter-media/spaces/s/stories/d/final.mp3");
    // The audio-profile rendition the product writes (profileFinalMixPath).
    expect(mediaSource("spaces/s/stories/d/final/brand-chime-v1.mp3")).toBe("gs://spoken-letter-media/spaces/s/stories/d/final/brand-chime-v1.mp3");
    expect(() => mediaSource("spaces/s/stories/d/final/../../e/final.mp3")).toThrow(/unexpected storage ref/);
    expect(() => mediaSource("spaces/s/stories/d/../../x.mp3")).toThrow(/unexpected storage ref/);
    expect(() => mediaSource("gs://other/x.mp3")).toThrow(/unexpected storage ref/);
  });

  test("--list queries downloaded stories, selects only title, date and duration, and returns no recipient or sender data", async () => {
    const { calls, fetch } = fakeFirestore({
      doc1: { title: { stringValue: "The fox who found the moon" }, downloadedAt: { timestampValue: "2026-09-12T08:30:00Z" }, finalMixDurationSeconds: { doubleValue: 187.4 } },
      doc2: { title: { stringValue: "A boat for two" }, downloadedAt: { timestampValue: "2026-08-01T10:00:00Z" }, finalMixDurationSeconds: { integerValue: "95" } },
    });
    const stories = await listStories({ fetch, token: "t" });
    const body = JSON.parse(calls[0]!.init?.body as string) as { structuredQuery: { from: unknown; where: unknown; select: { fields: { fieldPath: string }[] } } };
    expect(calls[0]!.url).toBe(`${DOCS}:runQuery`);
    expect(body.structuredQuery.from).toEqual([{ collectionId: "stories" }]);
    expect(body.structuredQuery.where).toEqual({ fieldFilter: { field: { fieldPath: "status" }, op: "EQUAL", value: { stringValue: "downloaded" } } });
    expect(body.structuredQuery.select.fields.map((field) => field.fieldPath).sort()).toEqual(["downloadedAt", "finalMixDurationSeconds", "title"]);
    expect(stories).toEqual([
      { id: "doc1", title: "The fox who found the moon", downloadedAt: "2026-09-12T08:30:00Z", durationSeconds: 187 },
      { id: "doc2", title: "A boat for two", downloadedAt: "2026-08-01T10:00:00Z", durationSeconds: 95 },
    ]);
  });

  test("--as-take pulls the final mix and hands it to add-demo-take for one variant", async () => {
    const { fetch } = fakeFirestore({ doc1: delivered });
    const scriptFile = path.join(root, "script.txt");
    writeFileSync(scriptFile, "Once upon a time, a fox.\n");
    await pullTake(deps(fetch), "doc1", { name: "fox", scriptFile, variant: "music" });
    expect(commands[0]?.slice(0, 4)).toEqual(["gcloud", "storage", "cp", "gs://spoken-letter-media/spaces/space1/stories/doc1/final.mp3"]);
    const take = commands[1]!;
    expect(take[0]).toBe(process.execPath);
    expect(take[1]).toMatch(/scripts\/add-demo-take\.mjs$/);
    expect(take.slice(2, 6)).toEqual(["--name", "fox", "--script", "Once upon a time, a fox."]);
    expect(take[6]).toBe("--music");
    expect(take[7]).toBe(commands[0]?.at(-1));
  });

  test("--as-take --narration pulls the voice-only narration for its variants and the mix for the rest", async () => {
    const scriptFile = path.join(root, "script.txt");
    writeFileSync(scriptFile, "Once upon a time, a fox.\n");
    const { fetch } = fakeFirestore({ doc1: { ...delivered, narrationRef: { stringValue: "spaces/space1/stories/doc1/narration-n1.webm" } } });
    await pullTake(deps(fetch), "doc1", { name: "fox", scriptFile, variant: "effects,music,both", narration: "plain" });
    const copies = commands.filter((command) => command[0] === "gcloud").map((command) => command[3]);
    expect(copies).toEqual(["gs://spoken-letter-media/spaces/space1/stories/doc1/final.mp3", "gs://spoken-letter-media/spaces/space1/stories/doc1/narration-n1.webm"]);
    const take = commands.at(-1)!;
    expect(take.slice(6)).toEqual(["--effects", commands[0]?.at(-1), "--music", commands[0]?.at(-1), "--both", commands[0]?.at(-1), "--plain", commands[1]?.at(-1)]);
    expect(commands[1]?.at(-1)).toMatch(/narration\.webm$/);
  });

  test("--as-take --narration refuses a story without a narration", async () => {
    const { fetch } = fakeFirestore({ doc1: delivered });
    await expect(pullTake(deps(fetch), "doc1", { name: "fox", scriptFile: "x", variant: "", narration: "plain" })).rejects.toThrow(/no narrationRef/);
    expect(commands).toEqual([]);
  });

  test("--as-take refuses an unknown variant before any call", async () => {
    const { calls, fetch } = fakeFirestore({ doc1: delivered });
    await expect(pullTake(deps(fetch), "doc1", { name: "fox", scriptFile: "x", variant: "loud" })).rejects.toThrow(/--variant must be one of/);
    expect(calls).toEqual([]);
    expect(commands).toEqual([]);
  });
});
