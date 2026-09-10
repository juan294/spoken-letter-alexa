import { readFileSync } from "node:fs";

import { CLASS_C_DENYLIST } from "@spoken-letter-alexa/shared";
import { describe, expect, test } from "vitest";

import { assertNoCarrierCollision, assertSlotsDeclared, generateExamplePhrases, generateInteractionModel, loadStories, MODEL_PATH, readTraining, storytellerSlotType, utteranceAllowed } from "./generate.ts";

const stories = loadStories();
const model = generateInteractionModel({ training: [], stories });
const intents = model.interactionModel.languageModel.intents;
const byName = Object.fromEntries(intents.map((intent) => [intent.name, intent]));

describe("generateInteractionModel", () => {
  test("invocation name and one intent per tool plus the catch-all and the built-ins, including the ten added ones", () => {
    expect(model.interactionModel.languageModel.invocationName).toBe("spoken letter");
    expect(Object.keys(byName).sort()).toEqual(
      [
        "AMAZON.CancelIntent",
        "AMAZON.FallbackIntent",
        "AMAZON.HelpIntent",
        "AMAZON.PauseIntent",
        "AMAZON.ResumeIntent",
        "AMAZON.StopIntent",
        "AMAZON.NextIntent",
        "AMAZON.PreviousIntent",
        "AMAZON.StartOverIntent",
        "AMAZON.RepeatIntent",
        "AMAZON.LoopOnIntent",
        "AMAZON.LoopOffIntent",
        "AMAZON.ShuffleOnIntent",
        "AMAZON.ShuffleOffIntent",
        "AMAZON.YesIntent",
        "AMAZON.NoIntent",
        "CatchAllIntent",
        "NextStoryIntent",
        "PlayStoryIntent",
        "WhatIsNewIntent",
      ].sort(),
    );
  });

  test("the catch-all carries a single AMAZON.SearchQuery slot and utterances that route free text", () => {
    const catchAll = byName.CatchAllIntent!;
    expect(catchAll.slots).toEqual([{ name: "text", type: "AMAZON.SearchQuery" }]);
    // A bare "{text}" is refused by Alexa (AMAZON.SearchQuery needs a carrier phrase).
    expect(catchAll.samples).not.toContain("{text}");
    expect(catchAll.samples).toContain("to {text}");
    expect(catchAll.samples).toContain("ask spoken letter {text}");
    // Removed: these shared a prefix with PlayStoryIntent's "i want to hear {title}" (phase-3.md section 3).
    expect(catchAll.samples).not.toContain("i want to {text}");
    expect(catchAll.samples).not.toContain("i would like to {text}");
    expect(catchAll.samples).not.toContain("i'd like to {text}");
  });

  test("PlayStoryIntent has optional title and storyteller slots and enough samples", () => {
    const play = byName.PlayStoryIntent!;
    expect(play.slots?.map((slot) => slot.name).sort()).toEqual(["storyteller", "title"]);
    expect(play.slots?.find((slot) => slot.name === "storyteller")?.type).toBe("StorytellerName");
    expect(play.samples.length).toBeGreaterThanOrEqual(8);
    expect(play.samples).toContain("play the story {storyteller} sent");
    // The utterances-people-actually-use additions (phase-3.md section 4).
    expect(play.samples).toContain("play a short story");
    expect(play.samples).toContain("play that again");
    // "recorded" fails utteranceAllowed (contains "record"); "made" is the substitute.
    expect(play.samples).toContain("play the story {storyteller} made");
    expect(play.samples).not.toContain("play the story {storyteller} recorded");
  });

  test("WhatIsNewIntent gained the new samples, and declares the storyteller slot they reference", () => {
    const whatIsNew = byName.WhatIsNewIntent!;
    expect(whatIsNew.samples).toContain("what {storyteller} sent me");
    expect(whatIsNew.samples).toContain("who sent a story");
    expect(whatIsNew.samples).toContain("what do you have");
    // Amazon's model build rejects a sample slot with no matching declaration; asserted at
    // generate time too, below (assertSlotsDeclared).
    expect(whatIsNew.slots).toEqual([{ name: "storyteller", type: "StorytellerName" }]);
  });

  test("no utterance names a child, a denylisted fragment or a non-ASCII character", () => {
    const samples = intents.flatMap((intent) => intent.samples);
    for (const sample of samples) {
      // The generator's own filter for recorded phrasings must accept every fixed sample too.
      expect(utteranceAllowed(sample)).toBe(true);
      expect(sample).toMatch(/^[a-z0-9 {}']+$/);
      for (const denied of CLASS_C_DENYLIST) {
        if (denied.fragment === "record" || denied.fragment === "audio") continue; // never appear either; asserted below
        expect(sample.includes(denied.fragment)).toBe(false);
      }
      expect(sample).not.toMatch(/\b(kid|kids|child|children|son|daughter)\b/);
    }
    expect(samples.some((sample) => /record|audio/.test(sample))).toBe(false);
  });

  test("training phrasings are appended to the catch-all, deduplicated and normalised", () => {
    const withTraining = generateInteractionModel({ training: ["Let's hear Grandpa", "let's hear grandpa", "  Play the lighthouse one  "], stories });
    const catchAll = withTraining.interactionModel.languageModel.intents.find((intent) => intent.name === "CatchAllIntent")!;
    expect(catchAll.samples.filter((sample) => sample === "let's hear grandpa")).toHaveLength(1);
    expect(catchAll.samples).toContain("play the lighthouse one");
  });

  test("no CatchAllIntent carrier prefix is a prefix of any PlayStoryIntent sample", () => {
    const play = byName.PlayStoryIntent!.samples;
    const catchAll = byName.CatchAllIntent!.samples;
    expect(() => { assertNoCarrierCollision(play, catchAll); }).not.toThrow();
  });

  test("the committed en-US model is exactly what the generator produces (drift check)", () => {
    const committed = readFileSync(MODEL_PATH, "utf8");
    expect(committed).toBe(`${JSON.stringify(generateInteractionModel({ training: readTraining(), stories: loadStories() }), null, 2)}\n`);
  });
});

describe("assertNoCarrierCollision", () => {
  test("catches a carrier that is a prefix of a play sample", () => {
    expect(() => { assertNoCarrierCollision(["i want to hear {title}"], ["i want to {text}"]); }).toThrow(/prefix/);
  });

  test("passes when no carrier is a prefix of any play sample", () => {
    expect(() => { assertNoCarrierCollision(["play {title}"], ["to {text}", "please {text}"]); }).not.toThrow();
  });

  test("ignores a catch-all sample with no slot placeholder", () => {
    expect(() => { assertNoCarrierCollision(["play a story"], ["play a story"]); }).not.toThrow();
  });
});

describe("assertSlotsDeclared", () => {
  test("catches a sample referencing a slot the intent never declared", () => {
    const intent = { name: "WhatIsNewIntent", samples: ["what {storyteller} sent me"] };
    expect(() => { assertSlotsDeclared(intent); }).toThrow(/storyteller.*not declared/);
  });

  test("passes when every referenced slot is declared", () => {
    const intent = { name: "WhatIsNewIntent", slots: [{ name: "storyteller", type: "StorytellerName" }], samples: ["what {storyteller} sent me", "what do you have"] };
    expect(() => { assertSlotsDeclared(intent); }).not.toThrow();
  });

  test("every generated intent declares every slot its samples reference", () => {
    for (const generated of intents) expect(() => { assertSlotsDeclared(generated); }).not.toThrow();
  });
});

describe("storytellerSlotType", () => {
  test("every catalog storyteller is a value, with its bare first name as a synonym", () => {
    const type = storytellerSlotType(stories);
    expect(type.name).toBe("StorytellerName");
    const names = type.values.map((value) => value.name.value);
    for (const { storyteller } of stories) expect(names).toContain(storyteller);
    const whitney = type.values.find((value) => value.name.value === "Aunt Whitney");
    expect(whitney?.name.synonyms).toContain("Whitney");
  });

  test("a recognized kinship word gains its other common forms as synonyms too", () => {
    const type = storytellerSlotType([{ storyteller: "Aunt Whitney" }]);
    expect(type.values[0]?.name.synonyms).toContain("Auntie Whitney");
  });

  test("a storyteller with no recognized kinship prefix still gets a value, with no synonyms required", () => {
    const type = storytellerSlotType([{ storyteller: "Juan" }]);
    expect(type.values).toEqual([{ name: { value: "Juan" } }]);
  });
});

describe("generateExamplePhrases", () => {
  test("three phrases, the second naming a real storyteller from the catalog", () => {
    const phrases = generateExamplePhrases(stories);
    expect(phrases).toHaveLength(3);
    expect(phrases[0]).toBe("Alexa, open spoken letter");
    expect(phrases[1]).toContain("Aunt Whitney");
    expect(phrases[2]).toBe("Alexa, ask spoken letter what is new");
  });

  test("the committed skill.json examplePhrases match the generator (drift check)", () => {
    const skillJsonPath = new URL("../../skill-package/skill.json", import.meta.url);
    const manifest = JSON.parse(readFileSync(skillJsonPath, "utf8")) as { manifest: { publishingInformation: { locales: Record<string, { examplePhrases: string[] }> } } };
    expect(manifest.manifest.publishingInformation.locales["en-US"]?.examplePhrases).toEqual(generateExamplePhrases(loadStories()));
  });
});
