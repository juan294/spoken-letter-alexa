// `pnpm -F skill generate`: rebuild skill-package/interactionModels/custom/en-US.json from
// the tool metadata, the fixture catalog and the recorded phrasings in
// skill-package/training/en-US.jsonl. Also refreshes skill.json's examplePhrases, so the
// store listing never drifts from what the model actually supports. Deterministic; the test
// suite fails when either committed file drifts from this output.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { generateExamplePhrases, generateInteractionModel, loadStories, MODEL_PATH, readTraining } from "./generate.ts";

const SKILL_MANIFEST_PATH = path.resolve(import.meta.dirname, "../../skill-package/skill.json");

type SkillManifest = { manifest: { publishingInformation: { locales: Record<string, { examplePhrases: string[] }> } } };

const training = readTraining();
const stories = loadStories();
const model = generateInteractionModel({ training, stories });
mkdirSync(path.dirname(MODEL_PATH), { recursive: true });
writeFileSync(MODEL_PATH, `${JSON.stringify(model, null, 2)}\n`);

const manifest = JSON.parse(readFileSync(SKILL_MANIFEST_PATH, "utf8")) as SkillManifest;
const locale = manifest.manifest.publishingInformation.locales["en-US"];
if (!locale) throw new Error(`${SKILL_MANIFEST_PATH} has no en-US locale`);
locale.examplePhrases = generateExamplePhrases(stories);
writeFileSync(SKILL_MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);

const intents = model.interactionModel.languageModel.intents;
console.error(
  JSON.stringify({
    event: "interaction_model_written",
    path: MODEL_PATH,
    intents: intents.length,
    training: training.length,
    samples: intents.reduce((n, intent) => n + intent.samples.length, 0),
    storytellers: model.interactionModel.languageModel.types[0]?.values.length ?? 0,
  }),
);
