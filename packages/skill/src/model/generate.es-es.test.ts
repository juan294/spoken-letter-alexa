import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import {
  assertNoCarrierCollision,
  assertSlotsDeclared,
  generateExamplePhrases,
  generateInteractionModel,
  loadStories,
  MODEL_PATHS,
  storytellerSlotType,
  utteranceAllowed,
  withExamplePhrases,
} from "./generate.ts";

const stories = loadStories();
const english = generateInteractionModel({ training: [], stories });
const spanish = generateInteractionModel({ locale: "es-ES", training: [], stories });
const esIntents = spanish.interactionModel.languageModel.intents;
const esByName = Object.fromEntries(esIntents.map((intent) => [intent.name, intent]));
const typeValues = (model: typeof english, name: string) => model.interactionModel.languageModel.types.find((type) => type.name === name)?.values ?? [];

const MANIFEST_PATH = new URL("../../skill-package/skill.json", import.meta.url);
type Manifest = { manifest: { publishingInformation: { distributionCountries: string[]; locales: Record<string, { examplePhrases: string[]; smallIconUri: string; largeIconUri: string; summary: string; description: string }> } } };

describe("es-ES interaction model", () => {
  test("M2 the committed es-ES model is exactly what the generator produces", () => {
    const committed = readFileSync(MODEL_PATHS["es-ES"], "utf8");
    expect(committed, "es-ES.json drifted: run pnpm -F @spoken-letter-alexa/skill generate").toBe(`${JSON.stringify(spanish, null, 2)}\n`);
  });

  test("M3 declares exactly the en-US intents with the same slot names and types", () => {
    expect(spanish.interactionModel.languageModel.invocationName).toBe("spoken letter");
    const shape = (model: typeof english) => model.interactionModel.languageModel.intents.map((intent) => [intent.name, intent.slots ?? null]);
    expect(shape(spanish)).toEqual(shape(english));
    for (const intent of esIntents) {
      if (intent.name.startsWith("AMAZON.")) expect(intent.samples).toEqual([]);
      else expect(intent.samples.length, intent.name).toBeGreaterThan(0);
    }
  });

  test("M3 every custom intent has Spanish samples, not English ones", () => {
    const englishSamples = new Set(english.interactionModel.languageModel.intents.flatMap((intent) => intent.samples));
    for (const sample of esIntents.flatMap((intent) => intent.samples)) {
      if (sample === "{drafttheme}") continue;
      expect(englishSamples.has(sample), sample).toBe(false);
    }
    expect(esByName.WhatIsNewIntent?.samples).toContain("qué hay de nuevo");
    expect(esByName.PlayAllIntent?.samples).toContain("pon mis historias");
    expect(esByName.StartStoryIntent?.samples).toContain("vamos a crear una historia");
    expect(esByName.ReadDemoDraftIntent?.samples).toContain("lee mi borrador");
    expect(esByName.WishStoryIntent?.samples).toContain("quiero una historia sobre {wishtopic}");
    expect(esByName.UpdatesIntent?.samples).toContain("mis novedades");
    expect(esByName.StartPlaylistOverIntent?.samples).toContain("empieza la lista desde el principio");
    expect(esByName.CatchAllIntent?.samples).toEqual(expect.arrayContaining(["por favor {text}", "puedes {text}", "pide a spoken letter que {text}"]));
  });

  test("M4 every es-ES sample passes the Spanish safety filter, except the fixed handoff and credit explanations", () => {
    const exempt = new Set([...(esByName.AppHandoffIntent?.samples ?? []), ...(esByName.CreditHelpIntent?.samples ?? [])]);
    for (const sample of esIntents.flatMap((intent) => intent.samples)) {
      expect(sample).toMatch(/^[a-zñáéíóúü0-9 {}']+$/u);
      if (!exempt.has(sample)) expect(utteranceAllowed(sample, "es-ES"), sample).toBe(true);
    }
  });

  test.each([
    "niño", "niña", "niños", "niñas", "hijo", "hija", "hijos", "hijas", "nieto", "nieta", "nietos", "nietas", "crío", "cría", "peque",
  ])("M4 rejects the child word %s", (word) => {
    expect(utteranceAllowed(`pon la historia de mi ${word}`, "es-ES")).toBe(false);
  });

  test.each(["enviar", "descargar", "comprar", "crédito", "pagar", "destinatario", "borrar", "eliminar", "quitar", "admin"])(
    "M4 rejects the denylist fragment %s",
    (fragment) => {
      expect(utteranceAllowed(`quiero ${fragment} una historia`, "es-ES")).toBe(false);
    },
  );

  test("M4 Spanish words that merely contain a child word or fragment are not rejected", () => {
    expect(utteranceAllowed("pon una historia pequeña", "es-ES")).toBe(true);
    expect(utteranceAllowed("lee mi borrador", "es-ES")).toBe(true);
    expect(utteranceAllowed("pon una historia", "es-ES")).toBe(true);
    expect(utteranceAllowed("pon una historia ç", "es-ES")).toBe(false);
  });

  test("M5 carrier-collision and slot-declaration validators hold for es-ES", () => {
    expect(() => { assertNoCarrierCollision(esByName.PlayStoryIntent!.samples, esByName.CatchAllIntent!.samples); }).not.toThrow();
    for (const intent of esIntents) expect(() => { assertSlotsDeclared(intent); }).not.toThrow();
  });

  test("M6 slot types keep English canonical values with Spanish synonyms", () => {
    for (const name of ["DemoTopic", "ReactionChoice", "StorytellerName"]) {
      expect(typeValues(spanish, name).map((value) => value.name.value), name).toEqual(typeValues(english, name).map((value) => value.name.value));
    }
    const synonyms = (name: string, value: string) => typeValues(spanish, name).find((entry) => entry.name.value === value)?.name.synonyms ?? [];
    expect(synonyms("DemoTopic", "mermaids")).toContain("sirenas");
    expect(synonyms("DemoTopic", "bedtime")).toContain("dormir");
    expect(synonyms("ReactionChoice", "love")).toContain("encanta");
    expect(synonyms("ReactionChoice", "like")).toContain("ha gustado");
    expect(synonyms("StorytellerName", "Aunt Whitney")).toEqual(expect.arrayContaining(["Whitney", "tía Whitney", "tita Whitney"]));
  });

  test("M6 Spanish kinship forms follow the English kinship word", () => {
    const type = storytellerSlotType([{ storyteller: "Grandma Rosa" }, { storyteller: "Dad Leo" }, { storyteller: "Juan" }], "es-ES");
    expect(type.values).toEqual([
      { name: { value: "Dad Leo", synonyms: ["Leo", "papá Leo"] } },
      { name: { value: "Grandma Rosa", synonyms: ["Rosa", "abuela Rosa"] } },
      { name: { value: "Juan" } },
    ]);
  });

  test("M7 the manifest carries the es-ES locale, its generated example phrases and both countries", () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as Manifest;
    const info = manifest.manifest.publishingInformation;
    expect(info.distributionCountries).toEqual(["US", "ES"]);
    const es = info.locales["es-ES"];
    expect(es?.examplePhrases).toEqual(generateExamplePhrases(stories, "es-ES"));
    expect(es?.examplePhrases).toEqual([
      "Alexa, abre spoken letter",
      "Alexa, pide a spoken letter que ponga la historia que mandó Aunt Whitney",
      "Alexa, pide a spoken letter qué hay de nuevo",
    ]);
    expect(es?.smallIconUri).toBe(info.locales["en-US"]?.smallIconUri);
    expect(es?.largeIconUri).toBe(info.locales["en-US"]?.largeIconUri);
    expect(`${es?.summary} ${es?.description}`).not.toMatch(/\b(?:the|your|stories)\b/i);
  });

  test("M7 every example phrase's request matches a generated sample", () => {
    const samples = new Set(esIntents.flatMap((intent) => intent.samples));
    expect(samples).toContain("ponga la historia que mandó {storyteller}");
    expect(samples).toContain("qué hay de nuevo");
  });
});

describe("withExamplePhrases", () => {
  const committed = readFileSync(MANIFEST_PATH, "utf8");

  test("rewriting the committed phrases leaves skill.json byte-identical in both locales", () => {
    let text = withExamplePhrases(committed, "en-US", generateExamplePhrases(stories));
    text = withExamplePhrases(text, "es-ES", generateExamplePhrases(stories, "es-ES"));
    expect(text).toBe(committed);
  });

  test("changes only the named locale's phrases", () => {
    const text = withExamplePhrases(committed, "es-ES", ["Alexa, abre spoken letter", "dos", "tres"]);
    const before = JSON.parse(committed) as Manifest;
    const after = JSON.parse(text) as Manifest;
    expect(after.manifest.publishingInformation.locales["es-ES"]?.examplePhrases).toEqual(["Alexa, abre spoken letter", "dos", "tres"]);
    expect(after.manifest.publishingInformation.locales["en-US"]).toEqual(before.manifest.publishingInformation.locales["en-US"]);
    expect(text.split("\n").length).toBe(committed.split("\n").length);
  });

  test("a missing locale fails loudly", () => {
    expect(() => withExamplePhrases('{"manifest":{}}', "es-ES", ["a"])).toThrow(/es-ES/);
  });
});
