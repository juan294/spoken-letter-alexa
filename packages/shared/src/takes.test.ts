import { describe, expect, test } from "vitest";

import { findTake, normalizeScript, parseTakesManifest, TAKE_VARIANTS } from "./takes.ts";

const files = { plain: "owl_plain.mp3", effects: "owl_effects.mp3", music: "owl_music.mp3", both: "owl_both.mp3" };
const entry = { script: "Once upon a time, an owl forgot how to hoot.", files };

describe("parseTakesManifest", () => {
  test("accepts takes with all four variants", () => {
    const manifest = parseTakesManifest({ takes: [entry, { script: "A second story.", files }] });
    expect(manifest.takes).toHaveLength(2);
    expect(TAKE_VARIANTS).toEqual(["plain", "effects", "music", "both"]);
  });

  test.each([
    ["an unknown entry key", { takes: [{ ...entry, speaker: "Aunt Whitney" }] }],
    ["an unknown files key", { takes: [{ ...entry, files: { ...files, extra: "owl_extra.mp3" } }] }],
    ["an unknown top-level key", { takes: [entry], notes: "x" }],
    ["a missing variant", { takes: [{ ...entry, files: { plain: files.plain, effects: files.effects, music: files.music } }] }],
    ["a non-mp3 file name", { takes: [{ ...entry, files: { ...files, both: "owl_both.wav" } }] }],
    ["a file name that leaves the takes folder", { takes: [{ ...entry, files: { ...files, plain: "../audio/owl.mp3" } }] }],
    ["an empty script", { takes: [{ ...entry, script: "  " }] }],
    ["two takes for the same normalized script", { takes: [entry, { ...entry, script: "once upon a time an owl forgot how to hoot" }] }],
    ["the removed spike flag", { takes: [{ ...entry, spike: true }] }],
  ])("rejects %s", (_label, input) => {
    expect(() => parseTakesManifest(input)).toThrow(/fixtures\/takes\/manifest\.json/);
  });
});

describe("normalizeScript", () => {
  test("ignores case, whitespace and punctuation", () => {
    expect(normalizeScript("  Once upon a time,\n an OWL — forgot how to hoot!  ")).toBe("once upon a time an owl forgot how to hoot");
    expect(normalizeScript("Ignacio wasn't just any snail.")).toBe(normalizeScript("ignacio wasnt just any snail"));
  });
});

describe("findTake", () => {
  const manifest = parseTakesManifest({ takes: [entry, { script: "A second passage.", files: { ...files, plain: "second.mp3" } }] });

  test("matches a script by its normalized text", () => {
    expect(findTake(manifest, "ONCE upon a time an owl forgot how to hoot")?.files.plain).toBe("owl_plain.mp3");
  });

  test("returns undefined for a script with no take", () => {
    expect(findTake(manifest, "A story nobody read aloud.")).toBeUndefined();
  });
});
