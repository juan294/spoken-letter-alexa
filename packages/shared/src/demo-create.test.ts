import { describe, expect, test } from "vitest";

import { CREATE_STAGES, creationRecordSchema, findListener, findPack, isCreateStage, parseDemoCreate } from "./demo-create.ts";
import { findTake, parseTakesManifest } from "./takes.ts";
import demoCreate from "../../../fixtures/demo-create.json" with { type: "json" };
import takesManifest from "../../../fixtures/takes/manifest.json" with { type: "json" };

const valid = {
  credits: 3,
  listeners: [{ id: "lucy", name: "Lucy", synonyms: ["Lu"], wish: { phrase: "a forest picnic", topic: "the forest" } }, { id: "theo", name: "Theo" }],
  story: { replies: ["A fox and an owl. What do they do?", "A picnic. How does it end?"], title: "The Picnic", script: "Once upon a time." },
};

describe("parseDemoCreate", () => {
  test("accepts the committed fixture, and its script has a take with every mix", () => {
    const demo = parseDemoCreate(demoCreate);
    const take = findTake(parseTakesManifest(takesManifest), demo.story.script);
    expect(Object.keys(take?.files ?? {})).toEqual(["plain", "effects", "music", "both"]);
  });

  test("defaults synonyms and leaves the wish optional", () => {
    const demo = parseDemoCreate(valid);
    expect(demo.listeners[1]).toEqual({ id: "theo", name: "Theo", synonyms: [] });
  });

  test.each([
    ["an unknown key", { ...valid, families: [] }],
    ["an unknown listener key", { ...valid, listeners: [{ id: "lucy", name: "Lucy", age: 5 }] }],
    ["zero credits and nothing to buy", { ...valid, credits: 0 }],
    ["negative credits", { ...valid, credits: -1 }],
    ["a pack with no credits", { ...valid, credits: 0, purchase: { currency: "euros", packs: [{ id: "small", name: "Small pack", credits: 0, price: "2.99" }] } }],
    ["a price that is not money", { ...valid, credits: 0, purchase: { currency: "euros", packs: [{ id: "small", name: "Small pack", credits: 2, price: "two" }] } }],
    ["no listeners", { ...valid, listeners: [] }],
    ["an unsafe listener id", { ...valid, listeners: [{ id: "Lucy Smith", name: "Lucy" }] }],
    ["one reply", { ...valid, story: { ...valid.story, replies: ["Only one."] } }],
    ["an empty script", { ...valid, story: { ...valid.story, script: " " } }],
  ])("rejects %s", (_label, input) => {
    expect(() => parseDemoCreate(input)).toThrow(/fixtures\/demo-create\.json is invalid/);
  });

  test("rejects a repeated id and a name heard for two listeners", () => {
    expect(() => parseDemoCreate({ ...valid, listeners: [{ id: "lucy", name: "Lucy" }, { id: "lucy", name: "Theo" }] })).toThrow(/repeats the listener id/);
    expect(() => parseDemoCreate({ ...valid, listeners: [{ id: "lucy", name: "Lucy" }, { id: "theo", name: "Theo", synonyms: ["lucy"] }] })).toThrow(/names two listeners/);
  });
});

describe("findListener", () => {
  const demo = parseDemoCreate(valid);

  test("matches the name or a synonym, ignoring case and spaces", () => {
    expect(findListener(demo, " lucy ")?.id).toBe("lucy");
    expect(findListener(demo, "LU")?.id).toBe("lucy");
    expect(findListener(demo, "Mia")).toBeUndefined();
  });
});

describe("the purchase scene (Jordan's script lines 9-15)", () => {
  const packs = [
    { id: "small", name: "Small story pack", credits: 2, price: "2.99", synonyms: ["small pack"] },
    { id: "family", name: "Family story pack", credits: 10, price: "11.99" },
    { id: "founding", name: "Founding family pack", credits: 20, price: "19.99", synonyms: ["founding family"] },
  ];
  const buying = parseDemoCreate({ ...valid, credits: 0, purchase: { currency: "euros", packs } });

  test("the committed fixture starts with no credits and offers Jordan's three packs", () => {
    const demo = parseDemoCreate(demoCreate);
    expect(demo.credits).toBe(0);
    expect(demo.purchase?.currency).toBe("euros");
    expect(demo.purchase?.packs.map((pack) => [pack.name, pack.credits, pack.price])).toEqual([
      ["Small story pack", 2, "2.99"], ["Family story pack", 10, "11.99"], ["Founding family pack", 20, "19.99"],
    ]);
  });

  test("a spoken pack matches its name or synonym anywhere in the words, the longest form first", () => {
    expect(findPack(buying, "The Founding family pack.")?.id).toBe("founding");
    expect(findPack(buying, "the founding family please")?.id).toBe("founding");
    expect(findPack(buying, "i'd like the family story pack")?.id).toBe("family");
    expect(findPack(buying, "small pack")?.id).toBe("small");
    expect(findPack(buying, "the biggest one")).toBeUndefined();
    expect(findPack(parseDemoCreate(valid), "small pack")).toBeUndefined();
    const apostrophe = parseDemoCreate({ ...valid, credits: 0, purchase: { currency: "euros", packs: [{ id: "founders", name: "Founder's pack", credits: 5, price: "4.99" }] } });
    expect(findPack(apostrophe, "the founder's pack")?.id).toBe("founders");
  });

  test("rejects a repeated pack id or a pack name heard twice", () => {
    expect(() => parseDemoCreate({ ...valid, credits: 0, purchase: { currency: "euros", packs: [packs[0], { ...packs[1], id: "small" }] } })).toThrow(/repeats the pack id/);
    expect(() => parseDemoCreate({ ...valid, credits: 0, purchase: { currency: "euros", packs: [packs[0], { ...packs[1], synonyms: ["Small Pack"] }] } })).toThrow(/names two packs/);
  });
});

describe("creation record", () => {
  test("stages are a closed, ordered set", () => {
    expect(CREATE_STAGES).toEqual(["credits", "pack", "purchase", "listener", "wish", "conversation", "recording", "review", "title", "sound", "finish", "sent", "stopped"]);
    expect(isCreateStage("review")).toBe(true);
    expect(isCreateStage("script")).toBe(false);
    expect(isCreateStage(undefined)).toBe(false);
  });

  test("stores codes, counts and the title only", () => {
    expect(creationRecordSchema.parse({ stage: "sound", listenerId: "samuel", title: "Sam on the Moon" })).toEqual({ stage: "sound", listenerId: "samuel", title: "Sam on the Moon" });
    expect(creationRecordSchema.safeParse({ stage: "conversation", answers: 3 }).success).toBe(false);
    expect(creationRecordSchema.safeParse({ stage: "conversation", answer: "a dragon" }).success).toBe(false);
    expect(creationRecordSchema.safeParse({ stage: "finish", sound: "loud" }).success).toBe(false);
    expect(creationRecordSchema.parse({ stage: "purchase", packId: "founding" })).toEqual({ stage: "purchase", packId: "founding" });
    expect(creationRecordSchema.safeParse({ stage: "purchase", packId: "Founding family pack" }).success).toBe(false);
  });
});
