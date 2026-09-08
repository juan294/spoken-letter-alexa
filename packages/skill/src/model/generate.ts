import path from "node:path";

import { TOOL_METADATA } from "@spoken-letter-alexa/mcp-server";
import { CLASS_C_DENYLIST } from "@spoken-letter-alexa/shared";

export type ModelSlot = { name: string; type: string };
export type ModelIntent = { name: string; slots?: ModelSlot[]; samples: string[] };
export type InteractionModel = {
  interactionModel: {
    languageModel: { invocationName: string; intents: ModelIntent[]; types: never[] };
  };
};

/** `skill-package/interactionModels/custom/en-US.json`, committed and drift-checked. */
export const MODEL_PATH = path.resolve(import.meta.dirname, "../../skill-package/interactionModels/custom/en-US.json");
export const TRAINING_PATH = path.resolve(import.meta.dirname, "../../skill-package/training/en-US.jsonl");

export const INVOCATION_NAME = "spoken letter";

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
      { name: "storyteller", type: "AMAZON.FirstName" },
    ],
    samples: [
      "play a family story",
      "play a story",
      "play the latest story",
      "play the newest story",
      "play the story {storyteller} sent",
      "play the story from {storyteller}",
      "play the story by {storyteller}",
      "play the one {storyteller} sent",
      "play the one from {storyteller}",
      "play the story of {storyteller}",
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
 */
const CATCH_ALL_SAMPLES = [
  "to {text}",
  "please {text}",
  "can you {text}",
  "could you {text}",
  "would you {text}",
  "i want to {text}",
  "i would like to {text}",
  "i'd like to {text}",
  "ask spoken letter to {text}",
  "ask spoken letter {text}",
  "tell spoken letter to {text}",
  "tell spoken letter {text}",
];

const BUILT_IN_INTENTS = ["AMAZON.CancelIntent", "AMAZON.FallbackIntent", "AMAZON.HelpIntent", "AMAZON.PauseIntent", "AMAZON.ResumeIntent", "AMAZON.StopIntent"];

const CHILD_WORDS = /\b(kid|kids|child|children|son|daughter|grandson|granddaughter)\b/;

/** Alexa's utterance alphabet: lowercase letters, digits, spaces, apostrophes, slot braces. */
export function normaliseUtterance(text: string): string {
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

export function generateInteractionModel(input: { training: string[] }): InteractionModel {
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

  for (const name of BUILT_IN_INTENTS) intents.push({ name, samples: [] });

  return { interactionModel: { languageModel: { invocationName: INVOCATION_NAME, intents, types: [] } } };
}
