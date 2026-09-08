import { readFileSync } from "node:fs";

import { CLASS_C_DENYLIST } from "@spoken-letter-alexa/shared";
import { describe, expect, test } from "vitest";

import { generateInteractionModel, MODEL_PATH, readTraining, utteranceAllowed } from "./generate.ts";

const model = generateInteractionModel({ training: [] });
const intents = model.interactionModel.languageModel.intents;
const byName = Object.fromEntries(intents.map((intent) => [intent.name, intent]));

describe("generateInteractionModel", () => {
  test("invocation name and one intent per tool plus the catch-all and the built-ins", () => {
    expect(model.interactionModel.languageModel.invocationName).toBe("spoken letter");
    expect(Object.keys(byName).sort()).toEqual(
      [
        "AMAZON.CancelIntent",
        "AMAZON.FallbackIntent",
        "AMAZON.HelpIntent",
        "AMAZON.PauseIntent",
        "AMAZON.ResumeIntent",
        "AMAZON.StopIntent",
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
  });

  test("PlayStoryIntent has optional title and storyteller slots and enough samples", () => {
    const play = byName.PlayStoryIntent!;
    expect(play.slots?.map((slot) => slot.name).sort()).toEqual(["storyteller", "title"]);
    expect(play.samples.length).toBeGreaterThanOrEqual(8);
    expect(play.samples).toContain("play the story {storyteller} sent");
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
    const withTraining = generateInteractionModel({ training: ["Let's hear Grandpa", "let's hear grandpa", "  Play the lighthouse one  "] });
    const catchAll = withTraining.interactionModel.languageModel.intents.find((intent) => intent.name === "CatchAllIntent")!;
    expect(catchAll.samples.filter((sample) => sample === "let's hear grandpa")).toHaveLength(1);
    expect(catchAll.samples).toContain("play the lighthouse one");
  });

  test("the committed en-US model is exactly what the generator produces (drift check)", () => {
    const committed = readFileSync(MODEL_PATH, "utf8");
    expect(committed).toBe(`${JSON.stringify(generateInteractionModel({ training: readTraining() }), null, 2)}\n`);
  });
});
