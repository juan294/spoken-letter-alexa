import { describe, expect, test, vi } from "vitest";

import { DemoUpdateController, MemoryDemoUpdateStore, parseFixtureEvents, type DemoStory } from "./demo-updates.ts";

const stories: DemoStory[] = [
  { id: "st_mermaid", title: "A mermaid story", storyteller: "Aunt Whitney", deliveredAt: "2026-08-03T00:00:00Z", audioUrl: "https://example.test/fixtures/audio/st_mermaid.mp3" },
  { id: "st_owl", title: "The owl", storyteller: "Grandpa Juan", deliveredAt: "2026-08-04T00:00:00Z", audioUrl: "https://example.test/fixtures/audio/st_owl.mp3" },
];
const seed = [
  { eventId: "new_owl", type: "new_story" as const, occurredAt: "2026-08-04T00:00:00Z", storyId: "st_owl", detail: "A new story is ready." },
  { eventId: "birthday", type: "occasion" as const, occurredAt: "2026-09-28T00:00:00Z", detail: "A family birthday is coming up. You can create a story for the occasion." },
];

function harness() {
  const store = new MemoryDemoUpdateStore({ now: () => 1_000 });
  const controller = new DemoUpdateController({ store, stories, seed, now: () => 1_000 });
  return { store, controller };
}

describe("fixture event seed", () => {
  test("validates delivered story references and rejects child fields", () => {
    expect(parseFixtureEvents({ events: seed }, stories)).toHaveLength(2);
    expect(() => parseFixtureEvents({ events: [{ ...seed[0], storyId: "missing" }] }, stories)).toThrow(/story/i);
    expect(() => parseFixtureEvents({ events: [{ ...seed[1], childName: "Mateo" }] }, stories)).toThrow();
    expect(() => parseFixtureEvents({ events: [{ ...seed[1], detail: "Lily's birthday is tomorrow." }] }, stories)).toThrow();
  });
});

describe("demo updates", () => {
  test("renders existing stored updates in customer language without rewriting their state", async () => {
    const { controller, store } = harness();
    const legacy = {
      completions: [], reactions: [], dismissals: [],
      wishes: [{ wishId: "old", topic: "mermaids" as const, storyteller: null, requestDigest: "digest", createdAt: 900 }],
      events: [
        { eventId: "new_owl", type: "new_story" as const, occurredAt: "2026-09-29T00:00:00Z", storyId: "st_owl", detail: "A new demo story is ready.", readAt: null, dismissed: false },
        { eventId: "birthday", type: "occasion" as const, occurredAt: "2026-09-28T00:00:00Z", detail: "A family birthday is coming up. You can prepare a demo story draft.", readAt: null, dismissed: false },
        { eventId: "reaction_old", type: "reaction_update" as const, occurredAt: "2026-09-27T00:00:00Z", detail: "Your demo reaction was saved.", readAt: null, dismissed: false },
        { eventId: "wish_old", type: "wish_update" as const, occurredAt: "2026-09-26T00:00:00Z", detail: "Your demo wish about mermaids is in the fixture inbox.", readAt: null, dismissed: false },
      ], version: 1, expiresAt: 2_000,
    };
    await store.compareAndSet("dev_hash", null, legacy);
    const inbox = await controller.inbox("dev_hash");
    expect(inbox.events.map((item) => item.detail)).toEqual([
      'A new story is ready. "The owl" by Grandpa Juan.',
      "A family birthday is coming up. You can create a story for the occasion.",
      "Your reaction was saved.",
      "Your wish for a story about mermaids was saved.",
    ]);
    expect((await controller.next("dev_hash")).event).toEqual(inbox.events[0]);
    expect(await store.get("dev_hash")).toEqual(legacy);
  });

  test("records the first finished play, prompts on only the next invocation, and saves one demo reaction", async () => {
    const { store, controller } = harness();
    expect(await controller.recordFinished("dev_hash", "st_mermaid", "event-1")).toEqual({ status: "recorded" });
    expect(await controller.recordFinished("dev_hash", "st_mermaid", "event-1")).toEqual({ status: "duplicate" });
    const pending = await controller.next("dev_hash");
    expect(pending.pendingReaction).toEqual({ storyId: "st_mermaid", title: "A mermaid story", storyteller: "Aunt Whitney" });
    expect((await controller.next("dev_hash")).pendingReaction).toBeUndefined();
    const receipt = await controller.react("dev_hash", "reaction-1", "love");
    expect(receipt).toMatchObject({ status: "saved", choice: "love", storyId: "st_mermaid" });
    expect(await controller.react("dev_hash", "reaction-1", "love")).toEqual(receipt);
    expect((await store.get("dev_hash"))?.reactions).toHaveLength(1);
    expect((await store.get("dev_hash"))?.reactions[0]).toMatchObject({ storyId: "st_mermaid", storyteller: "Aunt Whitney" });
    expect(JSON.stringify(await store.get("dev_hash"))).not.toMatch(/event-1|reaction-1/i);
  });

  test("keeps later completions queued until the first prompted story is handled", async () => {
    const { controller } = harness();
    await controller.recordFinished("dev_hash", "st_mermaid", "event-1");
    await controller.recordFinished("dev_hash", "st_owl", "event-2");
    expect((await controller.next("dev_hash")).pendingReaction?.storyId).toBe("st_mermaid");
    expect((await controller.next("dev_hash")).pendingReaction).toBeUndefined();
    expect((await controller.react("dev_hash", "reaction-1", "like") as { storyId: string }).storyId).toBe("st_mermaid");
    expect((await controller.next("dev_hash")).pendingReaction?.storyId).toBe("st_owl");
  });

  test("dismisses a prompt without a reaction; failed save leaves it retryable", async () => {
    const { controller, store } = harness();
    await controller.recordFinished("dev_hash", "st_owl", "event-1");
    await controller.next("dev_hash");
    const original = store.compareAndSet.bind(store);
    vi.spyOn(store, "compareAndSet").mockRejectedValueOnce(new Error("storage down"));
    await expect(controller.react("dev_hash", "reaction-1", "like")).rejects.toMatchObject({ code: "update_unavailable" });
    expect((await store.get("dev_hash"))?.reactions).toHaveLength(0);
    vi.spyOn(store, "compareAndSet").mockImplementation(original);
    expect(await controller.react("dev_hash", "reaction-1", "dismiss")).toEqual({ status: "dismissed" });
    expect((await store.get("dev_hash"))?.reactions).toHaveLength(0);
  });

  test("requires confirmed canonical wish and resolves only a delivered adult storyteller", async () => {
    const { controller, store } = harness();
    await expect(controller.wish("dev_hash", "wish-1", "mermaids for Mateo", undefined, false)).rejects.toMatchObject({ code: "confirmation_required" });
    await expect(controller.wish("dev_hash", "wish-1", "mermaids", "Unknown creator", true)).rejects.toMatchObject({ code: "unknown_storyteller" });
    const receipt = await controller.wish("dev_hash", "wish-1", "mermaids for Mateo", "Aunt Whitney", true);
    expect(receipt).toMatchObject({ status: "saved", topic: "mermaids", storyteller: "Aunt Whitney" });
    expect(await controller.wish("dev_hash", "wish-1", "space", undefined, true)).toEqual(receipt);
    expect(JSON.stringify(await store.get("dev_hash"))).not.toMatch(/Mateo|wish-1|Unknown creator/i);
  });

  test("lists unread fixture events newest first and marks only the spoken or dismissed item", async () => {
    const { controller } = harness();
    const inbox = await controller.inbox("dev_hash");
    expect(inbox.events.map((item) => item.eventId)).toEqual(["birthday", "new_owl"]);
    expect(inbox.events[1]).toMatchObject({ storyId: "st_owl" });
    expect(inbox.events[1]?.detail).toContain("The owl");
    expect((await controller.next("dev_hash")).event?.detail).toContain("A family birthday");
    expect((await controller.next("dev_hash")).event?.eventId).toBe("birthday");
    expect(await controller.markEvent("dev_hash", "birthday", "read")).toEqual({ status: "read" });
    expect((await controller.next("dev_hash")).event?.eventId).toBe("new_owl");
    expect(await controller.markEvent("dev_hash", "new_owl", "dismiss")).toEqual({ status: "dismissed" });
    expect((await controller.inbox("dev_hash")).events).toEqual([]);
  });
});
