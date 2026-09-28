import { describe, expect, test, vi } from "vitest";

import { DemoDraftController, MemoryDemoDraftStore, type DraftGenerator } from "./demo-drafts.ts";

const choices = { place: "quiet shore", challenge: "small mystery", ending: "kindness" } as const;

function harness() {
  const generator = vi.fn<DraftGenerator>(() => Promise.resolve(choices));
  const store = new MemoryDemoDraftStore({ now: () => 1_000 });
  const controller = new DemoDraftController({ store, generator, now: () => 1_000 });
  return { controller, store, generator };
}

describe("demo drafts", () => {
  test("canonicalizes a name-bearing spoken theme before generation and persistence", async () => {
    const { controller, store, generator } = harness();
    const receipt = await controller.save("dev_hash", "request-1", "a bedtime story for Mateo at the beach");
    expect(receipt).toMatchObject({ status: "saved", theme: "bedtime" });
    expect(generator).toHaveBeenCalledWith("bedtime");
    expect(JSON.stringify(await store.get("dev_hash"))).not.toMatch(/Mateo|beach|request-1/i);
    expect(JSON.stringify(receipt)).not.toMatch(/Mateo|beach/i);
    expect(receipt.outline.length).toBeLessThanOrEqual(280);
  });

  test("accepts the mermaid rehearsal theme without copying spoken wording", async () => {
    const { controller, generator, store } = harness();
    const receipt = await controller.save("dev_hash", "request-1", "a magical mermaid story for Mateo under the sea");
    expect(receipt.theme).toBe("mermaids");
    expect(generator).toHaveBeenCalledWith("mermaids");
    expect(JSON.stringify(await store.get("dev_hash"))).not.toContain("Mateo");
  });

  test("duplicate request returns the receipt once even if retry speech changes", async () => {
    const { controller, generator, store } = harness();
    const first = await controller.save("dev_hash", "request-1", "space");
    const repeated = await controller.save("dev_hash", "request-1", "ocean");
    expect(repeated).toEqual(first);
    expect(generator).toHaveBeenCalledTimes(1);
    expect((await store.get("dev_hash"))?.receipts).toHaveLength(1);
    expect(await controller.latest("dev_hash")).toEqual(first);
    expect(await controller.latest("other_hash")).toBeNull();
  });

  test("rejects unsupported theme without invoking the model or storing speech", async () => {
    const { controller, store, generator } = harness();
    await expect(controller.save("dev_hash", "request-1", "for Mateo and his teacher")).rejects.toMatchObject({ code: "unsupported_theme" });
    expect(generator).not.toHaveBeenCalled();
    expect(await store.get("dev_hash")).toBeNull();
  });

  test("model failure and invalid generated choices leave no saved receipt", async () => {
    const store = new MemoryDemoDraftStore();
    const failed = new DemoDraftController({ store, generator: () => Promise.reject(new Error("model down")) });
    await expect(failed.save("dev_hash", "request-1", "forest")).rejects.toMatchObject({ code: "draft_unavailable" });
    const invalid = new DemoDraftController({ store, generator: () => Promise.resolve({ place: "Mateo's house", challenge: "small mystery", ending: "kindness" } as never) });
    await expect(invalid.save("dev_hash", "request-1", "forest")).rejects.toMatchObject({ code: "draft_unavailable" });
    expect(await store.get("dev_hash")).toBeNull();
  });

  test("store failure leaves no saved claim and retry with the same request can succeed", async () => {
    const { controller, store } = harness();
    const original = store.compareAndSet.bind(store);
    const broken = vi.spyOn(store, "compareAndSet").mockRejectedValueOnce(new Error("storage down"));
    await expect(controller.save("dev_hash", "request-1", "forest")).rejects.toMatchObject({ code: "draft_unavailable" });
    expect(await store.get("dev_hash")).toBeNull();
    broken.mockImplementation(original);
    expect((await controller.save("dev_hash", "request-1", "forest")).status).toBe("saved");
  });

  test("keeps a bounded two-hour window and preserves idempotency at the cap", async () => {
    let now = 1_000;
    const store = new MemoryDemoDraftStore({ now: () => now });
    const controller = new DemoDraftController({ store, generator: () => Promise.resolve(choices), now: () => now });
    let first: Awaited<ReturnType<typeof controller.save>> | null = null;
    for (let index = 0; index < 10; index += 1) {
      const receipt = await controller.save("dev_hash", `request-${index}`, "ocean");
      if (index === 0) first = receipt;
    }
    expect((await store.get("dev_hash"))?.receipts).toHaveLength(10);
    expect(await controller.save("dev_hash", "request-0", "space")).toEqual(first);
    await expect(controller.save("dev_hash", "request-10", "space")).rejects.toMatchObject({ code: "draft_limit_reached" });
    now += 2 * 60 * 60 + 1;
    expect(await controller.latest("dev_hash")).toBeNull();
  });
});
