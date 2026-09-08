// `pnpm -F skill generate`: rebuild skill-package/interactionModels/custom/en-US.json from
// the tool metadata and the recorded phrasings in skill-package/training/en-US.jsonl.
// Deterministic; the test suite fails when the committed file drifts from this output.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { generateInteractionModel, MODEL_PATH, TRAINING_PATH } from "./generate.ts";

export function readTraining(file = TRAINING_PATH): string[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => (JSON.parse(line) as { text: string }).text);
}

const training = readTraining();
const model = generateInteractionModel({ training });
mkdirSync(path.dirname(MODEL_PATH), { recursive: true });
writeFileSync(MODEL_PATH, `${JSON.stringify(model, null, 2)}\n`);
const intents = model.interactionModel.languageModel.intents;
console.error(JSON.stringify({ event: "interaction_model_written", path: MODEL_PATH, intents: intents.length, training: training.length, samples: intents.reduce((n, intent) => n + intent.samples.length, 0) }));
