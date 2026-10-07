import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { parseFixtureCatalog, TOOL_METADATA } from "@spoken-letter-alexa/mcp-server";
import { CLASS_C_DENYLIST, SKILL_LOCALES, type SkillLocale, spanishPattern } from "@spoken-letter-alexa/shared";

export type ModelSlot = { name: string; type: string };
export type ModelIntent = { name: string; slots?: ModelSlot[]; samples: string[] };
export type ModelSlotTypeValue = { name: { value: string; synonyms?: string[] } };
export type ModelSlotType = { name: string; values: ModelSlotTypeValue[] };
export type InteractionModel = {
  interactionModel: {
    languageModel: { invocationName: string; intents: ModelIntent[]; types: ModelSlotType[] };
  };
};

/** `skill-package/interactionModels/custom/<locale>.json`, committed and drift-checked. */
export const MODEL_PATHS = Object.fromEntries(SKILL_LOCALES.map((locale) =>
  [locale, path.resolve(import.meta.dirname, `../../skill-package/interactionModels/custom/${locale}.json`)])) as Record<SkillLocale, string>;
export const MODEL_PATH = MODEL_PATHS["en-US"];
/** Recorded phrasings per locale; a locale with no file (es-ES today) has none. */
export const TRAINING_PATHS = Object.fromEntries(SKILL_LOCALES.map((locale) =>
  [locale, path.resolve(import.meta.dirname, `../../skill-package/training/${locale}.jsonl`)])) as Record<SkillLocale, string>;
export const TRAINING_PATH = TRAINING_PATHS["en-US"];
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
      "play the {title} story",
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
    // "what {storyteller} sent me" needs the slot declared, or Amazon's own model build
    // rejects the sample ("the intent doesn't declare the slot") — a plan gap the generator's
    // own checks didn't catch, only `ask deploy`'s server-side validation did.
    slots: [{ name: "storyteller", type: "StorytellerName" }],
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

function normaliseUtterance(text: string, locale: SkillLocale): string {
  const tables = LOCALE_TABLES[locale];
  return tables.lowercase(text)
    .replace(tables.alphabet.other, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Recorded phrasings are filtered exactly as the fixed lists are asserted. */
export function utteranceAllowed(sample: string, locale: SkillLocale = "en-US"): boolean {
  const tables = LOCALE_TABLES[locale];
  if (!tables.alphabet.allowed.test(sample)) return false;
  if (tables.childWords.test(sample)) return false;
  if (tables.deniedFragments.some((fragment) => sample.includes(fragment))) return false;
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

const SLOT_PLACEHOLDER = /\{([a-zA-Z0-9_]+)\}/g;

/**
 * Every `{slot}` referenced in an intent's samples must be declared on that intent, or
 * Amazon's server-side model build rejects it ("the intent doesn't declare the slot") —
 * caught only at `ask deploy` before this check existed. Generate-time failure instead.
 */
export function assertSlotsDeclared(intent: ModelIntent): void {
  const declared = new Set((intent.slots ?? []).map((slot) => slot.name));
  for (const sample of intent.samples) {
    for (const match of sample.matchAll(SLOT_PLACEHOLDER)) {
      const slotName = match[1];
      if (slotName !== undefined && !declared.has(slotName)) {
        throw new Error(`Intent "${intent.name}" sample "${sample}" references slot "{${slotName}}", which is not declared on ${intent.name}`);
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
 * The Spanish kinship forms for the same English kinship words (plan D2: the catalog name is
 * spoken as is). Spain Spanish puts an article before tía and abuelo ("pídele a la tía Whitney"),
 * and Alexa fills the slot with it, so those forms are synonyms too.
 */
const SPANISH_KINSHIP_FORMS: Record<string, string[]> = {
  aunt: ["tía", "tita", "la tía", "la tita"],
  grandma: ["abuela", "la abuela"],
  grandpa: ["abuelo", "el abuelo"],
  mom: ["mamá"],
  dad: ["papá"],
};

/**
 * `StorytellerName` (phase-3.md section 2): `AMAZON.FirstName` only matches a bare first
 * name, but every fixture storyteller is kinship-qualified ("Aunt Whitney"). The full string
 * is the canonical value; synonyms add the bare first name and, when the leading word is a
 * recognized kinship term, its other common forms ("Auntie Whitney").
 */
export function storytellerSlotType(stories: CatalogStoryteller[], locale: SkillLocale = "en-US"): ModelSlotType {
  const { kinshipForms, kinshipSpoken } = LOCALE_TABLES[locale];
  const distinct = [...new Set(stories.map((story) => story.storyteller))].sort();
  const values = distinct.map((storyteller) => {
    const [kinshipWord, ...rest] = storyteller.split(" ");
    const bareName = rest.join(" ");
    const kinshipVariants = bareName ? (kinshipForms[kinshipWord?.toLowerCase() ?? ""] ?? []) : [];
    const synonyms = bareName
      ? [bareName, ...kinshipVariants.map((variant) => `${kinshipSpoken(variant)} ${bareName}`)].sort()
      : [];
    return { name: { value: storyteller, ...(synonyms.length > 0 && { synonyms }) } };
  });
  return { name: "StorytellerName", values };
}

/** The store listing's fixed three-entry `examplePhrases`, generated so it never drifts from what actually works. */
export function generateExamplePhrases(stories: CatalogStoryteller[], locale: SkillLocale = "en-US"): [string, string, string] {
  const [storyteller] = [...new Set(stories.map((story) => story.storyteller))].sort();
  return LOCALE_TABLES[locale].examplePhrases(storyteller);
}

/**
 * Rewrites one locale's `examplePhrases` array inside the manifest text, leaving every other
 * byte as committed (the manifest is hand-formatted; `JSON.stringify` would reflow it).
 */
export function withExamplePhrases(manifestText: string, locale: SkillLocale, phrases: readonly string[]): string {
  const localeStart = manifestText.indexOf(`"${locale}": {`);
  const key = localeStart === -1 ? -1 : manifestText.indexOf(`"examplePhrases": [`, localeStart);
  // The array must sit before the next locale key, never inside another locale's block.
  const nextLocale = localeStart === -1 ? -1 : manifestText.slice(localeStart + 1).search(/"[a-z]{2}-[A-Z]{2}": \{/);
  if (key === -1 || (nextLocale !== -1 && key > localeStart + 1 + nextLocale)) throw new Error(`skill.json has no ${locale} locale with examplePhrases`);
  const lineStart = manifestText.lastIndexOf("\n", key) + 1;
  const indent = manifestText.slice(lineStart, key);
  const open = key + `"examplePhrases": [`.length;
  const close = manifestText.indexOf("]", open);
  const body = phrases.map((phrase) => `${indent}  ${JSON.stringify(phrase)}`).join(",\n");
  return `${manifestText.slice(0, open)}\n${body}\n${indent}${manifestText.slice(close)}`;
}

export function generateInteractionModel(input: { locale?: SkillLocale; training: string[]; stories: CatalogStoryteller[] }): InteractionModel {
  const locale = input.locale ?? "en-US";
  const intents: ModelIntent[] = TOOL_METADATA.map((tool) => {
    const intent = TOOL_INTENTS[tool.name];
    if (!intent) throw new Error(`tool ${tool.name} has no skill intent: add it to TOOL_INTENTS in packages/skill/src/model/generate.ts`);
    return { name: intent.name, ...(intent.slots && { slots: intent.slots }), samples: [...intent.samples] };
  });

  const tables = LOCALE_TABLES[locale];
  const catchAll = new Set(tables.catchAll);
  for (const line of input.training) {
    const sample = normaliseUtterance(line, locale);
    if (sample && utteranceAllowed(sample, locale)) catchAll.add(sample);
  }
  intents.push({ name: "CatchAllIntent", slots: [{ name: "text", type: "AMAZON.SearchQuery" }], samples: [...catchAll] });
  intents.push(
    {
      name: "StartStoryIntent",
      slots: [{ name: "theme", type: "AMAZON.SearchQuery" }],
      samples: ["let's create a story", "create a story", "make a story", "let's create a bedtime story", "create a story about {theme}", "make a story about {theme}", "let's make a story", "i would like to create a story", "i'd like to make a story", "let's make a story about {theme}", "i would like to create a story about {theme}", "i'd like to make a story about {theme}"],
    },
    {
      name: "ThemeChoiceIntent",
      slots: [{ name: "drafttheme", type: "DemoTopic" }],
      samples: ["{drafttheme}"],
    },
    {
      name: "ThemeIntent",
      slots: [{ name: "theme", type: "AMAZON.SearchQuery" }],
      samples: ["about {theme}", "the theme is {theme}", "make it about {theme}"],
    },
    {
      name: "HelpTopicIntent",
      slots: [{ name: "topic", type: "AMAZON.SearchQuery" }],
      samples: ["help with {topic}", "how do i {topic}", "tell me about {topic}"],
    },
    { name: "ReadDemoDraftIntent", samples: ["read my draft", "what is in my draft", "what is my draft"] },
    {
      name: "WishStoryIntent",
      // Alexa requires a slot name to keep one type across intents; HelpTopicIntent uses `topic` for SearchQuery.
      slots: [{ name: "wishtopic", type: "DemoTopic" }],
      samples: ["i want a story about {wishtopic}", "i wish for a story about {wishtopic}"],
    },
    {
      name: "WishFromStorytellerIntent",
      slots: [{ name: "wishtopic", type: "DemoTopic" }, { name: "storyteller", type: "StorytellerName" }],
      samples: ["ask {storyteller} for another {wishtopic} story", "i wish for another {wishtopic} story from {storyteller}"],
    },
    {
      name: "AppHandoffIntent",
      slots: [{ name: "listeneralias", type: "AMAZON.FirstName" }],
      samples: ["send {listeneralias} a spoken letter", "create a story for {listeneralias}", "can you send {listeneralias} a spoken letter", "can you create a story for {listeneralias}"],
    },
    {
      name: "CreditHelpIntent",
      samples: ["add story credits", "can you add story credits", "how do i add story credits"],
    },
    {
      name: "ReactToStoryIntent",
      slots: [{ name: "choice", type: "ReactionChoice" }],
      samples: ["i {choice} that story", "i {choice} it", "that story was {choice}"],
    },
    { name: "UpdatesIntent", samples: ["show my updates", "tell me my updates", "any updates", "what are my updates"] },
    { name: "PlayAllIntent", samples: ["play my stories", "play my spoken letter stories", "play all my stories", "play the whole playlist", "shuffle my stories"] },
    { name: "PlayAgainIntent", samples: ["play it again", "play that again", "play the current story again", "start all over"] },
    { name: "PlayNewStoriesIntent", samples: ["play my new stories", "play the new stories", "play my newest stories"] },
    {
      name: "PlayCreatorStoriesIntent",
      slots: [{ name: "storyteller", type: "StorytellerName" }],
      samples: ["play my stories from {storyteller}", "play stories from {storyteller}", "play all stories by {storyteller}"],
    },
    { name: "StartPlaylistOverIntent", samples: ["start the playlist over", "restart the playlist", "play the playlist from the beginning"] },
  );

  if (tables.samples) {
    // Same intents, slots and order as en-US (plan D8); only the samples change.
    const unused = new Set(Object.keys(tables.samples));
    for (const intent of intents) {
      if (intent.name === "CatchAllIntent") continue;
      const samples = tables.samples[intent.name];
      if (!samples) throw new Error(`intent ${intent.name} has no ${locale} samples: add them to the ${locale} table in packages/skill/src/model/generate.ts`);
      intent.samples = [...samples];
      unused.delete(intent.name);
    }
    if (unused.size > 0) throw new Error(`${locale} samples name unknown intents: ${[...unused].join(", ")}`);
  }

  const playSamples = intents.find((intent) => intent.name === "PlayStoryIntent")?.samples ?? [];
  assertNoCarrierCollision(playSamples, [...catchAll]);
  for (const intent of intents) assertSlotsDeclared(intent);

  for (const name of BUILT_IN_INTENTS) intents.push({ name, samples: [] });

  return {
    interactionModel: {
      languageModel: { invocationName: INVOCATION_NAME, intents, types: [
        storytellerSlotType(input.stories, locale),
        ...tables.types,
      ] },
    },
  };
}

/** es-ES catch-all carriers: intent-neutral, like the en-US ones, and never a prefix of a `PlayStoryIntent` sample. */
const SPANISH_CATCH_ALL_SAMPLES = [
  "por favor {text}",
  "puedes {text}",
  "podrías {text}",
  "pide a spoken letter que {text}",
  "dile a spoken letter que {text}",
];

/**
 * es-ES samples per intent (plan D8, phase-2.md step 2): the same intents and slots as en-US,
 * Spain Spanish, no child words, no denylisted fragment outside the fixed handoff and credit
 * explanations. The catch-all carriers are intent-neutral and are not a prefix of any
 * `PlayStoryIntent` sample. "ponga …" serves "pide a spoken letter que ponga …".
 */
const SPANISH_SAMPLES: Record<string, string[]> = {
  PlayStoryIntent: [
    "pon una historia familiar",
    "pon una historia",
    "pon la última historia",
    "pon la historia más nueva",
    "pon una historia corta",
    "pon algo corto",
    "pon una historia para dormir",
    "pon algo para dormir",
    "pon un cuento",
    "pon un cuento para dormir",
    "pon la historia que mandó {storyteller}",
    "pon la historia que ha mandado {storyteller}",
    "pon la historia que me ha mandado {storyteller}",
    "ponga la historia que mandó {storyteller}",
    "pon la historia de {storyteller}",
    "pon la historia que hizo {storyteller}",
    "pon la que mandó {storyteller}",
    "pon la de {storyteller}",
    "lo que mandó {storyteller}",
    "quiero escuchar la historia que mandó {storyteller}",
    "pon {title}",
    "ponga {title}",
    "pon la historia {title}",
    "pon la historia que se llama {title}",
    "pon la que se llama {title}",
    "ponme {title}",
    "reproduce {title}",
    "quiero escuchar {title}",
    "léeme {title}",
  ],
  WhatIsNewIntent: [
    "qué hay de nuevo",
    "qué historias nuevas hay",
    "qué historias tengo",
    "qué historias hay",
    "qué historias familiares tengo",
    "cuáles son las historias nuevas",
    "dime mis historias",
    "dime las historias",
    "hay alguna historia nueva",
    "hay historias nuevas",
    "alguna historia nueva",
    "qué me ha mandado {storyteller}",
    "quién ha mandado una historia",
    "qué tienes",
  ],
  NextStoryIntent: [
    "pon la siguiente historia familiar",
    "pon la siguiente historia",
    "pon la siguiente",
    "pon otra historia",
    "pon otra",
    "siguiente historia",
    "la siguiente",
    "otra historia",
    "otra más",
    "qué escucho ahora",
    "cuál es la siguiente historia",
  ],
  StartStoryIntent: [
    "vamos a crear una historia",
    "crea una historia",
    "crea un cuento",
    "haz una historia",
    "inventa una historia",
    "inventa un cuento sobre {theme}",
    "vamos a crear una historia para dormir",
    "crea una historia para dormir",
    "crea una historia sobre {theme}",
    "haz una historia sobre {theme}",
    "vamos a hacer una historia",
    "quiero crear una historia",
    "me gustaría hacer una historia",
    "vamos a hacer una historia sobre {theme}",
    "quiero crear una historia sobre {theme}",
    "me gustaría crear una historia sobre {theme}",
  ],
  ThemeChoiceIntent: ["{drafttheme}"],
  ThemeIntent: ["sobre {theme}", "el tema es {theme}", "que sea sobre {theme}"],
  HelpTopicIntent: ["ayuda con {topic}", "cómo puedo {topic}", "háblame de {topic}"],
  ReadDemoDraftIntent: ["lee mi borrador", "qué dice mi borrador", "qué hay en mi borrador", "cuál es mi borrador"],
  WishStoryIntent: ["quiero una historia sobre {wishtopic}", "quiero un cuento sobre {wishtopic}", "me gustaría una historia sobre {wishtopic}"],
  WishFromStorytellerIntent: [
    "pide a {storyteller} otra historia sobre {wishtopic}",
    "pídele a {storyteller} otra historia sobre {wishtopic}",
    "pídele a {storyteller} otro cuento sobre {wishtopic}",
    "quiero otra historia sobre {wishtopic} de {storyteller}",
  ],
  AppHandoffIntent: [
    "envía una historia a {listeneralias}",
    "manda una historia a {listeneralias}",
    "crea una historia para {listeneralias}",
    "puedes enviar una historia a {listeneralias}",
    "puedes crear una historia para {listeneralias}",
  ],
  CreditHelpIntent: ["añade créditos", "añade créditos de historias", "puedes añadir créditos", "cómo añado créditos"],
  ReactToStoryIntent: ["me {choice} esa historia", "me {choice}", "esa historia me {choice}"],
  UpdatesIntent: ["mis novedades", "dime mis novedades", "qué novedades tengo", "cuáles son mis novedades"],
  PlayAllIntent: ["pon mis historias", "pon mis historias de spoken letter", "pon todas mis historias", "pon toda la lista", "mezcla mis historias"],
  PlayAgainIntent: ["ponla otra vez", "ponla de nuevo", "pon esta historia otra vez", "vuelve a ponerla"],
  PlayNewStoriesIntent: ["pon mis historias nuevas", "pon las historias nuevas", "pon mis historias más nuevas"],
  PlayCreatorStoriesIntent: ["pon mis historias de {storyteller}", "pon las historias de {storyteller}", "pon todas las historias de {storyteller}"],
  StartPlaylistOverIntent: ["empieza la lista desde el principio", "reinicia la lista", "pon la lista desde el principio"],
};

/** es-ES `DemoTopic` and `ReactionChoice`: the English canonical values with Spanish synonyms (plan D4). */
const SPANISH_TYPES: ModelSlotType[] = [
  { name: "DemoTopic", values: [
    { name: { value: "mermaids", synonyms: ["sirena", "sirenas"] } },
    { name: { value: "space", synonyms: ["espacio", "el espacio", "estrella", "estrellas", "planeta", "planetas"] } },
    { name: { value: "ocean", synonyms: ["océano", "mar", "el mar", "playa"] } },
    { name: { value: "forest", synonyms: ["bosque", "el bosque"] } },
    { name: { value: "animals", synonyms: ["animal", "animales", "gato", "gatos", "perro", "perros"] } },
    { name: { value: "friendship", synonyms: ["amistad", "la amistad", "amigo", "amigos", "amiga", "amigas"] } },
    { name: { value: "bedtime", synonyms: ["dormir", "hora de dormir", "la hora de dormir"] } },
  ] },
  { name: "ReactionChoice", values: [
    { name: { value: "like", synonyms: ["gusta", "gustó", "ha gustado"] } },
    { name: { value: "love", synonyms: ["encanta", "encantó", "ha encantado"] } },
  ] },
];

const ENGLISH_TYPES: ModelSlotType[] = [
  { name: "DemoTopic", values: [
    { name: { value: "mermaids", synonyms: ["mermaid"] } },
    { name: { value: "space", synonyms: ["star", "stars", "planet", "planets"] } },
    { name: { value: "ocean", synonyms: ["sea", "beach"] } },
    { name: { value: "forest", synonyms: ["wood", "woods"] } },
    { name: { value: "animals", synonyms: ["animal", "cat", "cats", "dog", "dogs"] } },
    { name: { value: "friendship", synonyms: ["friend", "friends"] } },
    { name: { value: "bedtime", synonyms: ["sleep"] } },
  ] },
  { name: "ReactionChoice", values: [{ name: { value: "like", synonyms: ["liked"] } }, { name: { value: "love", synonyms: ["loved"] } }] },
];

type LocaleTables = {
  lowercase: (text: string) => string;
  /** Alexa's utterance alphabet for the locale: lowercase letters, digits, spaces, apostrophes, slot braces. */
  alphabet: { allowed: RegExp; other: RegExp };
  /** Each locale's own child words: the English "son" is the Spanish "they are". */
  childWords: RegExp;
  /** Substrings refused on top of the shared `CLASS_C_DENYLIST`. */
  deniedFragments: readonly string[];
  kinshipForms: Record<string, string[]>;
  kinshipSpoken: (variant: string) => string;
  /** Samples per intent; null keeps the en-US literals above. */
  samples: Record<string, string[]> | null;
  catchAll: readonly string[];
  types: ModelSlotType[];
  examplePhrases: (storyteller: string | undefined) => [string, string, string];
};

/**
 * Everything that differs by locale (plan D8). es-ES safety lists follow the plan's Scope and
 * invariants; Spanish samples are checked against these and the shared `CLASS_C_DENYLIST`.
 */
const LOCALE_TABLES: Record<SkillLocale, LocaleTables> = {
  "en-US": {
    lowercase: (text) => text.toLowerCase(),
    alphabet: { allowed: /^[a-z0-9 {}']+$/, other: /[^a-z0-9 {}']/g },
    childWords: CHILD_WORDS,
    deniedFragments: ["record", "audio"],
    kinshipForms: KINSHIP_SYNONYM_FORMS,
    // English capitalizes the kinship word as a title ("Auntie Whitney").
    kinshipSpoken: (variant) => `${variant.charAt(0).toUpperCase()}${variant.slice(1)}`,
    samples: null,
    catchAll: CATCH_ALL_SAMPLES,
    types: ENGLISH_TYPES,
    examplePhrases: (storyteller) => [
      "Alexa, open spoken letter",
      `Alexa, ask spoken letter to play the story ${storyteller ?? "your family"} sent`,
      "Alexa, ask spoken letter what is new",
    ],
  },
  "es-ES": {
    lowercase: (text) => text.normalize("NFC").toLocaleLowerCase("es-ES"),
    alphabet: { allowed: /^[a-zñáéíóúü0-9 {}']+$/u, other: /[^a-zñáéíóúü0-9 {}']/gu },
    childWords: spanishPattern(String.raw`\b(?:niño|niña|niños|niñas|hijo|hija|hijos|hijas|nieto|nieta|nietos|nietas|crío|cría|peque)\b`),
    deniedFragments: ["record", "audio", "grab", "enviar", "descargar", "comprar", "crédito", "pagar", "destinatario", "borrar", "eliminar", "quitar", "admin"],
    kinshipForms: SPANISH_KINSHIP_FORMS,
    // Spanish writes the kinship word in lower case ("tía Whitney").
    kinshipSpoken: (variant) => variant,
    samples: SPANISH_SAMPLES,
    catchAll: SPANISH_CATCH_ALL_SAMPLES,
    types: SPANISH_TYPES,
    examplePhrases: (storyteller) => [
      "Alexa, abre spoken letter",
      `Alexa, pide a spoken letter que ponga la historia que mandó ${storyteller ?? "tu familia"}`,
      "Alexa, pide a spoken letter qué hay de nuevo",
    ],
  },
};
