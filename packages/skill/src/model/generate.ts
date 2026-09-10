import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { parseFixtureCatalog, TOOL_METADATA } from "@spoken-letter-alexa/mcp-server";
import { CLASS_C_DENYLIST } from "@spoken-letter-alexa/shared";

export type ModelSlot = { name: string; type: string };
export type ModelIntent = { name: string; slots?: ModelSlot[]; samples: string[] };
export type ModelSlotTypeValue = { name: { value: string; synonyms?: string[] } };
export type ModelSlotType = { name: string; values: ModelSlotTypeValue[] };
export type InteractionModel = {
  interactionModel: {
    languageModel: { invocationName: string; intents: ModelIntent[]; types: ModelSlotType[] };
  };
};

/** `skill-package/interactionModels/custom/en-US.json`, committed and drift-checked. */
export const MODEL_PATH = path.resolve(import.meta.dirname, "../../skill-package/interactionModels/custom/en-US.json");
export const TRAINING_PATH = path.resolve(import.meta.dirname, "../../skill-package/training/en-US.jsonl");
/** `fixtures/stories.json` at the repo root — the same catalog the MCP server serves. */
export const FIXTURES_PATH = path.resolve(import.meta.dirname, "../../../../fixtures/stories.json");

export const INVOCATION_NAME = "spoken letter";

/** Recorded phrasings, one `{ text }` JSON object per line (written by `record:pull`). */
export function readTraining(file = TRAINING_PATH): string[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => (JSON.parse(line) as { text: string }).text);
}

export type CatalogStoryteller = { storyteller: string };

/** The delivered-story catalog, for the storyteller slot type (phase-3.md section 2). */
export function loadStories(file = FIXTURES_PATH): CatalogStoryteller[] {
  return parseFixtureCatalog(JSON.parse(readFileSync(file, "utf8")));
}

/**
 * One intent per MCP tool. The mapping is by tool name so a new or renamed tool fails
 * the generator until the skill gets an intent for it. Sample utterances are code the
 * Owner reviews in the diff (phase-9.md section 3); they name no child and use no
 * denylisted fragment (asserted in generate.test.ts).
 */
const TOOL_INTENTS: Record<string, Omit<ModelIntent, "name"> & { name: string }> = {
  get_family_story: {
    name: "PlayStoryIntent",
    slots: [
      { name: "title", type: "AMAZON.SearchQuery" },
      { name: "storyteller", type: "StorytellerName" },
    ],
    samples: [
      "play a family story",
      "play a story",
      "play the latest story",
      "play the newest story",
      "play a short story",
      "play something short",
      "play a bedtime story",
      "play something for bedtime",
      "play that again",
      "play it again",
      "play the story {storyteller} sent",
      "play the story from {storyteller}",
      "play the story by {storyteller}",
      "play the story {storyteller} made",
      "play the one {storyteller} sent",
      "play the one from {storyteller}",
      "play the story of {storyteller}",
      "what {storyteller} sent",
      "put on the story {storyteller} sent",
      "let's hear the story {storyteller} sent",
      "play {title}",
      "play the story {title}",
      "play the story called {title}",
      "play the one about {title}",
      "play the one called {title}",
      "put on {title}",
      "let's hear {title}",
      "i want to hear {title}",
    ],
  },
  list_family_stories: {
    name: "WhatIsNewIntent",
    samples: [
      "what is new",
      "what's new",
      "what family stories are new",
      "what stories are new",
      "what stories do i have",
      "what stories are there",
      "which stories are new",
      "which family stories do i have",
      "list my family stories",
      "list the stories",
      "is there a new story",
      "are there new stories",
      "any new stories",
      "what {storyteller} sent me",
      "who sent a story",
      "what do you have",
    ],
  },
  suggest_next_story: {
    name: "NextStoryIntent",
    samples: [
      "play the next family story",
      "play the next story",
      "play the next one",
      "play another story",
      "play another one",
      "next story",
      "next one",
      "another story",
      "another one",
      "what should i hear next",
      "which story is next",
    ],
  },
};

/**
 * The catch-all: one `AMAZON.SearchQuery` slot behind carrier phrases (Alexa rejects a
 * sample that is only the slot), so unmatched speech reaches the agent as plain text.
 * Alexa returns only the slot value, so every carrier is intent-neutral: the verb stays
 * inside `{text}` ("to play the lighthouse one" arrives as "play the lighthouse one").
 * `i want to {text}` / `i would like to {text}` / `i'd like to {text}` are deliberately
 * absent: `PlayStoryIntent` samples such as `i want to hear {title}` share that prefix, and
 * Alexa's NLU can route the whole phrase to whichever intent's sample matches first
 * (phase-3.md section 3, `assertNoCarrierCollision` below).
 */
const CATCH_ALL_SAMPLES = [
  "to {text}",
  "please {text}",
  "can you {text}",
  "could you {text}",
  "would you {text}",
  "ask spoken letter to {text}",
  "ask spoken letter {text}",
  "tell spoken letter to {text}",
  "tell spoken letter {text}",
];

const BUILT_IN_INTENTS = [
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
];

const CHILD_WORDS = /\b(kid|kids|child|children|son|daughter|grandson|granddaughter)\b/;

/** Alexa's utterance alphabet: lowercase letters, digits, spaces, apostrophes, slot braces. */
function normaliseUtterance(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 {}']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Recorded phrasings are filtered exactly as the fixed lists are asserted. */
export function utteranceAllowed(sample: string): boolean {
  if (!/^[a-z0-9 {}']+$/.test(sample)) return false;
  if (CHILD_WORDS.test(sample)) return false;
  if (/record|audio/.test(sample)) return false;
  return CLASS_C_DENYLIST.every((denied) => !sample.includes(denied.fragment));
}

/** The literal text before a sample's first `{slot}`, or the whole sample when it has none. */
function carrierPrefix(sample: string): string {
  const index = sample.indexOf("{");
  return index === -1 ? sample : sample.slice(0, index);
}

/**
 * Every `CatchAllIntent` carrier must be intent-neutral: if one is a literal prefix of a
 * `PlayStoryIntent` sample, Alexa's NLU can route a play request to the catch-all instead
 * of `PlayStoryIntent` (phase-3.md section 3). Throws with both colliding samples named, so
 * this is a generate-time failure rather than a live mis-route.
 */
export function assertNoCarrierCollision(playSamples: string[], catchAllSamples: string[]): void {
  for (const catchAllSample of catchAllSamples) {
    const prefix = carrierPrefix(catchAllSample);
    if (prefix === catchAllSample) continue; // no slot placeholder: not a carrier phrase
    for (const playSample of playSamples) {
      if (playSample.startsWith(prefix)) {
        throw new Error(`CatchAllIntent carrier "${catchAllSample}" is a prefix of PlayStoryIntent sample "${playSample}" — remove or rephrase the carrier`);
      }
    }
  }
}

/** A kinship word's other common spoken forms, so any of them still matches the same person. */
const KINSHIP_SYNONYM_FORMS: Record<string, string[]> = {
  aunt: ["auntie"],
  grandma: ["grandmother", "granny"],
  grandpa: ["grandfather", "gramps"],
  mom: ["mommy", "mother"],
  dad: ["daddy", "father"],
};

/**
 * `StorytellerName` (phase-3.md section 2): `AMAZON.FirstName` only matches a bare first
 * name, but every fixture storyteller is kinship-qualified ("Aunt Whitney"). The full string
 * is the canonical value; synonyms add the bare first name and, when the leading word is a
 * recognized kinship term, its other common forms ("Auntie Whitney").
 */
export function storytellerSlotType(stories: CatalogStoryteller[]): ModelSlotType {
  const distinct = [...new Set(stories.map((story) => story.storyteller))].sort();
  const values = distinct.map((storyteller) => {
    const [kinshipWord, ...rest] = storyteller.split(" ");
    const bareName = rest.join(" ");
    const kinshipVariants = bareName ? (KINSHIP_SYNONYM_FORMS[kinshipWord?.toLowerCase() ?? ""] ?? []) : [];
    const synonyms = bareName
      ? [bareName, ...kinshipVariants.map((variant) => `${variant.charAt(0).toUpperCase()}${variant.slice(1)} ${bareName}`)].sort()
      : [];
    return { name: { value: storyteller, ...(synonyms.length > 0 && { synonyms }) } };
  });
  return { name: "StorytellerName", values };
}

/** The store listing's fixed three-entry `examplePhrases`, generated so it never drifts from what actually works. */
export function generateExamplePhrases(stories: CatalogStoryteller[]): [string, string, string] {
  const [storyteller] = [...new Set(stories.map((story) => story.storyteller))].sort();
  return [
    "Alexa, open spoken letter",
    `Alexa, ask spoken letter to play the story ${storyteller ?? "your family"} sent`,
    "Alexa, ask spoken letter what is new",
  ];
}

export function generateInteractionModel(input: { training: string[]; stories: CatalogStoryteller[] }): InteractionModel {
  const intents: ModelIntent[] = TOOL_METADATA.map((tool) => {
    const intent = TOOL_INTENTS[tool.name];
    if (!intent) throw new Error(`tool ${tool.name} has no skill intent: add it to TOOL_INTENTS in packages/skill/src/model/generate.ts`);
    return { name: intent.name, ...(intent.slots && { slots: intent.slots }), samples: [...intent.samples] };
  });

  const catchAll = new Set(CATCH_ALL_SAMPLES);
  for (const line of input.training) {
    const sample = normaliseUtterance(line);
    if (sample && utteranceAllowed(sample)) catchAll.add(sample);
  }
  intents.push({ name: "CatchAllIntent", slots: [{ name: "text", type: "AMAZON.SearchQuery" }], samples: [...catchAll] });

  const playSamples = intents.find((intent) => intent.name === "PlayStoryIntent")?.samples ?? [];
  assertNoCarrierCollision(playSamples, [...catchAll]);

  for (const name of BUILT_IN_INTENTS) intents.push({ name, samples: [] });

  return {
    interactionModel: {
      languageModel: { invocationName: INVOCATION_NAME, intents, types: [storytellerSlotType(input.stories)] },
    },
  };
}
