import { describe, expect, test } from "vitest";

import { MemoryPlaylistStore, PlaylistController, type PlaylistCatalog, type PlaylistStory } from "./playlist.ts";

const stories: PlaylistStory[] = [
  { id: "a", title: "Owl", storyteller: "Grandpa", deliveredAt: "2026-09-01T00:00:00Z" },
  { id: "b", title: "Moon", storyteller: "Grandma", deliveredAt: "2026-09-03T00:00:00Z" },
  { id: "c", title: "Boat", storyteller: "Grandpa", deliveredAt: "2026-09-02T00:00:00Z" },
];

function harness(input = stories) {
  let now = 1_000;
  let audioExpiresAt = 2_000;
  const catalog: PlaylistCatalog = {
    list: () => Promise.resolve(input),
    get: (id) => Promise.resolve(input.find((story) => story.id === id) ? {
      id, url: `https://example.test/${id}.mp3`, title: input.find((story) => story.id === id)!.title,
      storyteller: input.find((story) => story.id === id)!.storyteller, durationSeconds: null,
      artUrl: null, expiresAt: audioExpiresAt,
    } : null),
  };
  const store = new MemoryPlaylistStore({ now: () => now });
  const controller = new PlaylistController({ store, catalog, now: () => now, random: () => 0.7 });
  return { controller, store, now: (value: number) => { now = value; }, expireAudio: () => { audioExpiresAt = 999; } };
}

describe("playlist controller", () => {
  test("starts newest first, filters creator, and never repeats the prior first on a shuffle restart", async () => {
    const { controller } = harness();
    const newest = await controller.command("owner", { command: "start", order: "newest" });
    expect(newest.play?.id).toBe("b");
    const byCreator = await controller.command("owner", { command: "start", order: "newest", storyteller: "Grandpa" });
    expect(byCreator.play?.id).toBe("c");
    const first = await controller.command("owner", { command: "start", order: "shuffle" });
    const second = await controller.command("owner", { command: "start", order: "shuffle" });
    expect(second.play?.id).not.toBe(first.play?.id);
  });

  test("matches titles and storytellers regardless of accents, so unresolved speech finds a Spanish name", async () => {
    const { controller } = harness([...stories, { id: "d", title: "El Trasgu del Sótano", storyteller: "Tío Manuel", deliveredAt: "2026-07-27T00:00:00Z" }]);
    expect((await controller.command("owner", { command: "start", order: "shuffle", storyteller: "tio manuel" })).play?.id).toBe("d");
    expect((await controller.command("owner", { command: "title", title: "el trasgu del sotano", storyteller: "Tio Manuel" })).play?.id).toBe("d");
  });

  test("disambiguates titles and creators, and offers an available choice for a missing title", async () => {
    const duplicate = [{ ...stories[0]!, title: "Owl" }, { ...stories[1]!, title: "Owl" }];
    const { controller } = harness(duplicate);
    const ambiguous = await controller.command("owner", { command: "title", title: "Owl" });
    expect(ambiguous.action).toBe("none");
    expect(ambiguous.say).toMatch(/which.*Owl/i);
    expect(ambiguous.say).toContain("Grandpa");
    const missing = await controller.command("owner", { command: "title", title: "Nope" });
    expect(missing.action).toBe("none");
    expect(missing.say).toContain("Owl");
    const creator = await harness().controller.command("owner", { command: "start", storyteller: "Grand" });
    expect(creator.action).toBe("none");
    expect(creator.say).toMatch(/Grandpa.*Grandma|Grandma.*Grandpa/);
  });

  test("bounds catalog at 20 and tells the parent when nothing is delivered", async () => {
    const empty = await harness([]).controller.command("owner", { command: "start" });
    expect(empty.action).toBe("none");
    expect(empty.say).toMatch(/no.*deliver/i);
    const many = Array.from({ length: 25 }, (_, index) => ({ ...stories[0]!, id: `s${index}`,
      title: index === 20 ? "A twenty-first story" : "Owl" }));
    const { controller, store } = harness(many);
    await controller.command("owner", { command: "start" });
    expect((await store.get("owner"))?.ids).toHaveLength(20);
    const late = await controller.command("owner", { command: "title", title: "A twenty-first story" });
    expect(late.action).toBe("none");
    expect(late.say).toMatch(/first 20/i);
    expect(late.say).not.toMatch(/couldn't find that delivered story/i);
  });

  test("persisted playlist state never contains a token or audio URL", async () => {
    const { controller, store } = harness();
    const first = await controller.command("owner", { command: "start", order: "newest" });
    const state = await store.get("owner");
    expect(JSON.stringify(state)).not.toContain("https://example.test/");
    expect(JSON.stringify(state)).not.toContain(first.token);
    expect(state).toHaveProperty("currentTokenDigest");
    const queued = await controller.command("owner", { command: "nearlyFinished", observedToken: first.token!, eventId: "near" });
    const afterQueue = await store.get("owner");
    expect(JSON.stringify(afterQueue)).not.toContain(first.token);
    expect(JSON.stringify(afterQueue)).not.toContain(queued.token);
    expect(queued.expectedPreviousToken).toBe(first.token);
  });

  test("playlist stream tokens are opaque and do not repeat the audio URL", async () => {
    const { controller } = harness();
    const first = await controller.command("owner", { command: "start", order: "newest" });
    expect(first.token).toBeDefined();
    expect(first.token?.length).toBeLessThan(128);
    expect(Buffer.from(first.token!, "base64url").toString("utf8")).not.toContain("https://");
  });

  test("skip wins against stale and duplicate nearly-finished events; end marks complete", async () => {
    const { controller, store } = harness();
    const first = await controller.command("owner", { command: "start", order: "newest" });
    const skipped = await controller.command("owner", { command: "next" });
    expect(skipped.play?.id).toBe("c");
    const stale = await controller.command("owner", { command: "nearlyFinished", observedToken: first.token!, eventId: "e1" });
    expect(stale.action).toBe("none");
    const queued = await controller.command("owner", { command: "nearlyFinished", observedToken: skipped.token!, eventId: "e2" });
    expect(queued.action).toBe("play");
    expect(queued.playBehavior).toBe("ENQUEUE");
    expect(queued.expectedPreviousToken).toBe(skipped.token);
    expect((await controller.command("owner", { command: "nearlyFinished", observedToken: skipped.token!, eventId: "e2" })).action).toBe("none");
    expect((await controller.command("owner", { command: "next" })).action).toBe("none");
    expect((await store.get("owner"))?.completed).toBe(true);
  });

  test("previous at first falls back; restart keeps index; reset returns to first", async () => {
    const { controller, store } = harness();
    expect(await controller.command("new-owner", { command: "next" })).toEqual({ action: "none", say: null, fallbackToSuggestion: true });
    const first = await controller.command("owner", { command: "start", order: "newest" });
    const previous = await controller.command("owner", { command: "previous" });
    expect(previous.action).toBe("none");
    expect(previous.say).toMatch(/first/i);
    await controller.command("owner", { command: "next" });
    const restart = await controller.command("owner", { command: "restart" });
    expect(restart.play?.id).toBe("c");
    expect((await store.get("owner"))?.index).toBe(1);
    const reset = await controller.command("owner", { command: "reset" });
    expect(reset.play?.id).toBe(first.play?.id);
    expect((await store.get("owner"))?.index).toBe(0);
  });

  test("expired audio leaves the old index and gives spoken recovery", async () => {
    const { controller, store, expireAudio } = harness();
    await controller.command("owner", { command: "start", order: "newest" });
    expireAudio();
    const result = await controller.command("owner", { command: "next" });
    expect(result.action).toBe("none");
    expect(result.say).toMatch(/try again/i);
    expect((await store.get("owner"))?.index).toBe(0);
  });

  test("resume refreshes audio at the reported offset only for the current token", async () => {
    const { controller } = harness();
    const first = await controller.command("owner", { command: "start", order: "newest" });
    const resumed = await controller.command("owner", { command: "resume", observedToken: first.token!, offsetInMilliseconds: 42_000 });
    expect(resumed).toMatchObject({ action: "play", playBehavior: "REPLACE_ALL", offsetInMilliseconds: 42_000 });
    expect(resumed.token).not.toBe(first.token);
    expect((await controller.command("owner", { command: "resume", observedToken: first.token!, offsetInMilliseconds: 42_000 })).action).toBe("none");
  });

  test("records finish for the predecessor after enqueue without moving playback back", async () => {
    const { controller, store } = harness();
    const first = await controller.command("owner", { command: "start", order: "newest" });
    const queued = await controller.command("owner", { command: "nearlyFinished", observedToken: first.token!, eventId: "near-1" });
    expect(queued.play?.id).toBe("c");
    const finished = await controller.command("owner", { command: "finished", observedToken: first.token!, eventId: "finish-1" });
    expect(finished).toEqual({ action: "none", say: null });
    expect((await store.get("owner"))?.lastFinishedTokenDigest).toBeTruthy();
    expect((await store.get("owner"))?.currentTokenDigest).toBeTruthy();
    expect((await controller.command("owner", { command: "nearlyFinished", observedToken: first.token!, eventId: "near-2" })).action).toBe("none");
  });

  test("stale voice skip cannot advance, but skip of a nearly finished track starts its queued successor", async () => {
    const { controller, store } = harness();
    const first = await controller.command("owner", { command: "start", order: "newest" });
    const queued = await controller.command("owner", { command: "nearlyFinished", observedToken: first.token!, eventId: "near-1" });
    const skip = await controller.command("owner", { command: "next", observedToken: first.token! });
    expect(skip.play?.id).toBe(queued.play?.id);
    expect(skip.playBehavior).toBe("REPLACE_ALL");
    expect((await store.get("owner"))?.index).toBe(1);
    const stale = await controller.command("owner", { command: "next", observedToken: first.token! });
    expect(stale.action).toBe("none");
    expect(stale.fallbackToSuggestion).toBeUndefined();
  });

  test("store compare-and-set allows only one advance from a version", async () => {
    const { controller, store } = harness();
    await controller.command("owner", { command: "start", order: "newest" });
    const prior = await store.get("owner");
    expect(prior).not.toBeNull();
    if (!prior) return;
    const attempted = { ...prior, index: 1, version: prior.version + 1 };
    const outcomes = await Promise.all([
      store.compareAndSet("owner", prior.version, attempted),
      store.compareAndSet("owner", prior.version, { ...attempted, index: 2 }),
    ]);
    expect(outcomes).toEqual([true, false]);
    expect((await store.get("owner"))?.index).toBe(1);
  });
});
