// `pnpm -F skill generate`: rebuild skill-package/interactionModels/custom/{en-US,es-ES}.json
// from the tool metadata, the fixture catalog and the recorded phrasings in
// skill-package/training/en-US.jsonl (es-ES has no training file). Also refreshes each
// locale's examplePhrases in skill.json in place, so the store listing never drifts from what
// the model actually supports and the hand-formatted manifest is otherwise untouched.
// Deterministic; the test suite fails when any committed file drifts from this output.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { SKILL_LOCALES } from "@spoken-letter-alexa/shared";

import { generateExamplePhrases, generateInteractionModel, loadStories, MODEL_PATHS, readTraining, withExamplePhrases } from "./generate.ts";

const SKILL_MANIFEST_PATH = path.resolve(import.meta.dirname, "../../skill-package/skill.json");

const training = readTraining();
const stories = loadStories();
let manifest = readFileSync(SKILL_MANIFEST_PATH, "utf8");
for (const locale of SKILL_LOCALES) {
  const localeTraining = locale === "en-US" ? training : [];
  const model = generateInteractionModel({ locale, training: localeTraining, stories });
  const modelPath = MODEL_PATHS[locale];
  mkdirSync(path.dirname(modelPath), { recursive: true });
  writeFileSync(modelPath, `${JSON.stringify(model, null, 2)}\n`);
  manifest = withExamplePhrases(manifest, locale, generateExamplePhrases(stories, locale));

  const intents = model.interactionModel.languageModel.intents;
  console.error(
    JSON.stringify({
      event: "interaction_model_written",
      locale,
      path: modelPath,
      intents: intents.length,
      training: localeTraining.length,
      samples: intents.reduce((n, intent) => n + intent.samples.length, 0),
      storytellers: model.interactionModel.languageModel.types[0]?.values.length ?? 0,
    }),
  );
}
writeFileSync(SKILL_MANIFEST_PATH, manifest);
