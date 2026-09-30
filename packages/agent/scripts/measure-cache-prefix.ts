// Measures the prompt-cache prefix of the real Bedrock turn request (prompt-caching fleet
// plan, Phase 6). The request is assembled by `runTurn` itself against the in-process MCP
// server in fixtures mode, so the tool specs are the ones the deployed server defines. No
// deployed server is called and no inference runs: tokens are counted with Bedrock
// CountTokens through Strands (`useNativeTokenCount`), and every count also reports Strands'
// character heuristic. A count that fell back to the heuristic is labelled INFERRED.
//
// Usage: AWS_PROFILE=archy pnpm -F @spoken-letter-alexa/agent measure:cache-prefix
// The result is recorded in docs/research/2026-09-30-bedrock-cache-prefix.md.
import {
  type BaseModelConfig,
  BedrockModel,
  configureLogging,
  Message,
  Model,
  type ModelStreamEvent,
  type StreamOptions,
  type SystemPrompt,
  TextBlock,
  type ToolSpec,
} from "@strands-agents/sdk";

import { ALEXA_PERSONA, personaWithCatalog } from "../src/persona.ts";
import { trimHistory } from "../src/routes.ts";
import { ScriptedModel } from "../src/scripted-model.ts";
import { MCP_URL, mcpHarness } from "../src/test-support.ts";
import { runTurn } from "../src/turn.ts";
import { nativeCountEvidence } from "./count-evidence.ts";

const MODEL_ID = process.env.BEDROCK_MODEL_ID ?? "us.anthropic.claude-haiku-4-5-20251001-v1:0";
const REGION = process.env.AWS_REGION ?? "us-east-1";
/** Bedrock prompt-caching docs, "Supported models", Claude Haiku 4.5 (retrieved 2026-09-30). */
const MINIMUM_TOKENS = 4096;
const UTTERANCE = "Alexa, play the story Grandpa sent";

type Captured = { messages: Message[]; systemPrompt: SystemPrompt | undefined; toolSpecs: ToolSpec[] };

/** Records what the agent hands the model on each call, then lets the scripted model answer. */
class RecordingModel extends Model {
  readonly calls: Captured[] = [];
  private readonly inner = new ScriptedModel();

  updateConfig(modelConfig: BaseModelConfig): void {
    this.inner.updateConfig(modelConfig);
  }

  getConfig(): BaseModelConfig {
    return this.inner.getConfig();
  }

  async *stream(messages: Message[], options?: StreamOptions): AsyncIterable<ModelStreamEvent> {
    this.calls.push({ messages: [...messages], systemPrompt: options?.systemPrompt, toolSpecs: options?.toolSpecs ?? [] });
    yield* this.inner.stream(messages, options);
  }
}

// Strands reports CountTokens success and failure only through its logger.
const strandsLog: string[] = [];
const keep = (...args: unknown[]): void => {
  strandsLog.push(args.map(String).join(" "));
};
configureLogging({ debug: keep, info: keep, warn: keep, error: keep });

/** The base model ID behind a cross-region inference profile (`us.anthropic...` -> `anthropic...`). */
function baseModelId(modelId: string): string {
  return modelId.replace(/^(us|eu|apac|global)\./, "");
}

type Count = { tokens: number; label: "VERIFIED (CountTokens API)" | "INFERRED (Strands heuristic)"; modelId: string; error?: string };

async function count(messages: Message[], options: { systemPrompt?: SystemPrompt; toolSpecs?: ToolSpec[] }): Promise<{ api: Count; heuristic: number }> {
  const heuristic = await new BedrockModel({ region: REGION, modelId: MODEL_ID }).countTokens(messages, options);
  // The inference profile first, then the base model ID it routes to.
  const errors: string[] = [];
  for (const modelId of [MODEL_ID, baseModelId(MODEL_ID)]) {
    // Strands remembers a model that failed once and then skips the API without logging.
    BedrockModel.clearCountTokensCache();
    const before = strandsLog.length;
    const tokens = await new BedrockModel({ region: REGION, modelId, useNativeTokenCount: true }).countTokens(messages, options);
    const evidence = nativeCountEvidence(tokens, strandsLog.slice(before));
    if (evidence.verified) return { api: { tokens, label: "VERIFIED (CountTokens API)", modelId, ...(errors.length > 0 && { error: errors.join(" | ") }) }, heuristic };
    errors.push(`${modelId}: ${evidence.reason}`);
  }
  return { api: { tokens: heuristic, label: "INFERRED (Strands heuristic)", modelId: MODEL_ID, error: errors.join(" | ") }, heuristic };
}

function userText(text: string): Message[] {
  return [new Message({ role: "user", content: [new TextBlock(text)] })];
}

async function main(): Promise<void> {
  const harness = await mcpHarness();
  const turn = { mcpUrl: MCP_URL, accessToken: await harness.serviceToken(), fetch: harness.fetch };
  const model = new RecordingModel();
  const opening = await runTurn({ ...turn, model }, UTTERANCE);
  const first = model.calls[0];
  const last = model.calls.at(-1);
  // A follow-up turn replays the stored history, trimmed the way `/agent/turn` stores it.
  const followUp = new RecordingModel();
  await runTurn({ ...turn, model: followUp, history: trimHistory(opening.history) }, "Alexa, play another one");
  const longest = followUp.calls.at(-1);
  if (!first || !last || !longest) throw new Error("a turn made no model call");

  // 20 stories, the most `fetchCatalog` asks for (routes.ts), in its line format: once typical,
  // once at the HTTP provider's field maxima (id 64, title 200, storyteller 80 characters).
  const catalog = Array.from({ length: 20 }, (_, i) => `st_story_${i}: A bedtime story number ${i} by Grandpa Juan, 3m4s`).join("\n");
  const words = (i: number, length: number): string => `the lighthouse keeper and the owl who forgot how to hoot, part ${i} `.repeat(8).slice(0, length);
  const longestCatalog = Array.from({ length: 20 }, (_, i) => `${`st_${i}_`.padEnd(64, "0123456789abcdef")}: ${words(i, 200)} by ${words(i, 80)}, 59m59s`).join("\n");
  // One character of user text: Bedrock CountTokens needs a message. Counted alone it is 24 tokens.
  const probe = userText(".");

  const rows: [string, Awaited<ReturnType<typeof count>>][] = [
    ["tools checkpoint (tools only)", await count(probe, { toolSpecs: first.toolSpecs })],
    ["system checkpoint (tools + ALEXA_PERSONA)", await count(probe, { systemPrompt: ALEXA_PERSONA, toolSpecs: first.toolSpecs })],
    ["system checkpoint with a typical 20-story catalog", await count(probe, { systemPrompt: personaWithCatalog(catalog), toolSpecs: first.toolSpecs })],
    ["system checkpoint with a maximum-length 20-story catalog", await count(probe, { systemPrompt: personaWithCatalog(longestCatalog), toolSpecs: first.toolSpecs })],
    ["first request of a turn (no catalog)", await count(first.messages, { systemPrompt: first.systemPrompt ?? ALEXA_PERSONA, toolSpecs: first.toolSpecs })],
    [`last request of the turn (call ${model.calls.length})`, await count(last.messages, { systemPrompt: last.systemPrompt ?? ALEXA_PERSONA, toolSpecs: last.toolSpecs })],
    [`last request of a follow-up turn with stored history (call ${followUp.calls.length})`, await count(longest.messages, { systemPrompt: longest.systemPrompt ?? ALEXA_PERSONA, toolSpecs: longest.toolSpecs })],
    ["probe message alone", await count(probe, {})],
  ];

  const report = {
    modelId: MODEL_ID,
    region: REGION,
    minimumTokens: MINIMUM_TOKENS,
    tools: first.toolSpecs.map((spec) => spec.name),
    personaChars: ALEXA_PERSONA.length,
    longestCatalogLineChars: Math.max(...longestCatalog.split("\n").map((line) => line.length)),
    modelCallsInTurn: model.calls.length,
    rows: rows.map(([shape, { api, heuristic }]) => ({ shape, tokens: api.tokens, label: api.label, countModelId: api.modelId, heuristic, skippedError: api.error })),
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

await main();
