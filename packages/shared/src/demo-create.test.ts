import { describe, expect, test } from "vitest";

import { CREATE_STAGES, creationRecordSchema, findListener, isCreateStage, parseDemoCreate } from "./demo-create.ts";
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
    ["zero credits", { ...valid, credits: 0 }],
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

describe("creation record", () => {
  test("stages are a closed, ordered set", () => {
    expect(CREATE_STAGES).toEqual(["listener", "wish", "conversation", "recording", "review", "title", "sound", "finish", "sent", "stopped"]);
    expect(isCreateStage("review")).toBe(true);
    expect(isCreateStage("script")).toBe(false);
    expect(isCreateStage(undefined)).toBe(false);
  });

  test("stores codes, counts and the title only", () => {
    expect(creationRecordSchema.parse({ stage: "sound", listenerId: "samuel", title: "Sam on the Moon" })).toEqual({ stage: "sound", listenerId: "samuel", title: "Sam on the Moon" });
    expect(creationRecordSchema.safeParse({ stage: "conversation", answers: 3 }).success).toBe(false);
    expect(creationRecordSchema.safeParse({ stage: "conversation", answer: "a dragon" }).success).toBe(false);
    expect(creationRecordSchema.safeParse({ stage: "finish", sound: "loud" }).success).toBe(false);
  });
});
