# Bedrock prompt-cache prefix: measurement and decision

## Question and baseline

Does the turn agent's cacheable prefix on Bedrock reach the model's minimum tokens per cache
checkpoint? If it does, Strands `cacheConfig` is worth enabling. If it does not, a cache point
is a silent no-op and the config stays off. This is Phase 6 of the Archy prompt-caching fleet
plan (`archy/docs/plans/2026-09-30-prompt-caching-fleet-phases/phase-6.md`).

Repository: `spoken-letter-alexa`. Measurement date: 2026-09-30. Base: `develop` @
`f31b9915bf0b6c7876616780bb569e782a9a90e9`, branch `feat/prompt-caching`. Strands
`@strands-agents/sdk` 1.16.0. Account `106403001709`, region `us-east-1`, CLI profile `archy`.

Decision: not applicable at 1586 < 4096 tokens for us.anthropic.claude-haiku-4-5-20251001-v1:0

The number is the stable prefix the plan would cache: the tool specs plus `ALEXA_PERSONA`
with no catalog. Two tests parse the line above:

- `packages/app/src/bootstrap.test.ts` fails if `cacheConfig` is added to `createBedrockModel`
  (`packages/app/src/bootstrap.ts:86`) while this line says "not applicable", if the line
  contradicts itself, or if the app default model (`packages/app/src/env.ts:10`) differs from
  the measured one.
- `infra/test/stacks.test.ts:88` fails if the `BEDROCK_MODEL_ID` the API stack deploys
  (`infra/lib/api-stack.ts:26`, `:47`, `:68`) differs from the measured one.

## Model minimum

Source: https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html, retrieved
2026-09-30.

- Claude Haiku 4.5 (`anthropic.claude-haiku-4-5-20251001-v1:0`): **4,096** minimum tokens per
  cache checkpoint, 4 checkpoints per request, 5-minute and 1-hour TTL, checkpoints accepted in
  `system`, `messages` and `tools`.
- "The minimum applies cumulatively to the entire prompt prefix before each checkpoint,
  including, where applicable, content in the `tools`, `system`, and `messages` fields."
- "If you add a cache checkpoint before the total prompt prefix meets the minimum number of
  tokens, your inference still succeeds, but your prefix isn't cached."
- Checkpoints are processed `tools` -> `system` -> `messages`.
- With caching, `inputTokens` excludes cached tokens: total input is
  `inputTokens + cacheReadInputTokens + cacheWriteInputTokens`.
- The same page says Anthropic models on Bedrock also support Implicit Prompt Caching, which
  needs no checkpoints and is best effort.

## Method

`packages/agent/scripts/measure-cache-prefix.ts` (run with
`AWS_PROFILE=archy pnpm -F @spoken-letter-alexa/agent measure:cache-prefix`):

1. It runs the real `runTurn` (`packages/agent/src/turn.ts`) against the in-process MCP server
   in fixtures mode (`packages/agent/src/test-support.ts`). No deployed server is called. A
   recording model wraps `ScriptedModel`, captures the `systemPrompt`, `toolSpecs` and
   `messages` Strands hands the model on every call, and answers with the scripted
   list -> get -> structured-output sequence. No inference runs.
2. The captured tool specs are the three MCP tools (`list_family_stories`, `get_family_story`,
   `suggest_next_story`, registered at `packages/mcp-server/src/tools/index.ts:63-105`) plus
   Strands' own `strands_structured_output` tool, added because `runTurn` sets
   `structuredOutputSchema`.
3. Each shape is counted with Strands `BedrockModel.countTokens` and `useNativeTokenCount: true`,
   which sends Bedrock `CountTokens` (read-only, no inference). The Strands character heuristic
   (text chars/4, JSON chars/2) is reported next to it.
4. A count is labelled VERIFIED only on positive evidence: Strands' own success line,
   `total_tokens=<N> | native token count`, with the same N, logged during that call
   (`packages/agent/scripts/count-evidence.ts`, tested in `count-evidence.test.ts`). A missing
   line means the heuristic, because Strands does not always log a fallback (next section).
5. A checkpoint's prefix needs a message for `CountTokens` to accept the request, so the
   checkpoint rows carry a one-character user message. Counted alone, that message is 24
   tokens, so these rows overstate the prefix by up to 24 tokens.

### CountTokens behaviour found on the way

- Strands only calls the API when `useNativeTokenCount` is `true`; the default is the
  heuristic (`bedrock.js:306-308`).
- `CountTokens` rejects the cross-region inference profile. VERIFIED with
  `aws bedrock-runtime count-tokens --profile archy --region us-east-1 --model-id us.anthropic.claude-haiku-4-5-20251001-v1:0`:
  `An error occurred (ValidationException) when calling the CountTokens operation: The provided model doesn't support counting tokens.`
  The base model ID `anthropic.claude-haiku-4-5-20251001-v1:0` succeeds (`{"inputTokens": 24}`
  for the one-character message). The script tries the profile, then the base ID.
- Strands logs that failure once at debug level, adds the model ID to a process-wide skip set,
  and silently returns the heuristic on every later call (`bedrock.js:48-51`, `:311`, `:337-341`).
  An AccessDenied failure is only warned about once per process (`bedrock.js:333-335`).
  The first run of this script took the absence of a fallback line as success, and so labelled
  heuristic numbers as API counts (for example 2,708 for the system checkpoint). The script now
  calls `BedrockModel.clearCountTokensCache()` before every attempt and requires the success
  line (method step 4). Every number below comes from a run with both fixes; the first run's
  numbers are void.

## Results

All rows VERIFIED by the Bedrock CountTokens API against `anthropic.claude-haiku-4-5-20251001-v1:0`
(2026-09-30, final run of the script).

| Shape                                                           | CountTokens | Strands heuristic |
| --------------------------------------------------------------- | ----------: | ----------------: |
| Tools checkpoint: 4 tool specs                                  |       1,316 |             2,410 |
| System checkpoint: tools + `ALEXA_PERSONA` (1,190 chars)        |       1,586 |             2,708 |
| System checkpoint: tools + persona + a typical 20-story catalog |       2,185 |             3,092 |
| System checkpoint: tools + persona + a max-length English catalog |       3,865 |             4,587 |
| First request of a turn, no catalog                             |       1,596 |             2,716 |
| Last request of the turn (call 3, after two tool results)       |       2,147 |             3,053 |
| Last request of a follow-up turn replaying the stored history   |       3,003 |             3,693 |
| The one-character probe message alone                           |          24 |                 1 |

- Both catalogs use the line format of `fetchCatalog` and the 20 stories it asks for
  (`packages/agent/src/routes.ts:119-142`). The typical one has short fixture-like lines. The
  maximum-length one fills every field to the HTTP provider's limits (id 64, title 200,
  storyteller 80 characters; `packages/mcp-server/src/provider/http.ts:9-11`), which gives
  358-character lines of English text. This is a maximum-length English-text catalog: emoji
  or CJK titles can tokenize more densely per character, so the same limits could produce
  more tokens. The decision rests on the 1,586-token stable prefix, which has no catalog, so it
  is unaffected.
- The catalog has no hard upper bound in this repository. On a cache miss the HTTP provider
  returns every story the bridge sends, without applying `limit`
  (`packages/mcp-server/src/provider/http.ts:60-77`), and `fetchCatalog` does not cap the count.
  The 20-story figure holds only while the upstream bridge honours `limit=20`.
- The follow-up turn replays history trimmed to `MAX_HISTORY_MESSAGES = 8`
  (`packages/agent/src/routes.ts:145-165`), as `/agent/turn` stores it.
- The heuristic overstates every prefix by 700 to 1,100 tokens. It would not be a safe basis
  for this decision.

## Decision

The stable tools + system prefix, the persona without a catalog plus the tool specs, is 1,586
tokens. That is what would be cached if the catalog moved out of the system prompt, and it is
2,510 tokens short of Haiku 4.5's 4,096 minimum. Every whole request measured in a normal turn
is below the minimum too (at most 3,003), so a cache point at any of the three places Strands
would put one (tools, system, last user message) would be a silent no-op.

With the catalog still in the system prompt, a typical 20-story catalog gives 2,185 and a
maximum-length English-text one 3,865, both below the minimum. A catalog prefix is per session anyway, so it
is not the prefix the plan would cache. A bridge that returned more than about 22 maximum-length
stories would push that per-session prefix past 4,096 (INFERRED from the rows above).

- No `cacheConfig` on the Bedrock model (`packages/app/src/bootstrap.ts:86`).
- The per-session catalog stays in the system prompt. Moving it to the first user turn only
  pays off when the prefix qualifies.
- No `.claude/rules/prompt-caching.md`: the plan adds it only in a repo that enables caching.

Strands would not flag a mistaken enable. `cacheConfig: { strategy: "auto" }` resolves to the
Anthropic strategy for any model ID containing `anthropic` or `claude`, and it injects cache
points without checking the size (`bedrock.js:188-216`, `:468-469`, `:491-500`). The warning
`cache_config is enabled but this model does not support automatic caching` fires only for
other model IDs, so on Haiku 4.5 below the minimum there is no log line at all. The
bootstrap test, the infra stack test and the per-turn usage log are the guards.

## Usage logging

Every `/agent/turn` log line (`agent_turn`, `packages/agent/src/routes.ts:374`) now carries
the turn's `inputTokens`, `outputTokens`, `cacheReadInputTokens` and `cacheWriteInputTokens`,
summed over the turn's model calls from the fresh agent's accumulated usage
(`packages/agent/src/turn.ts:45-52`, `:143`, `:151`). Cache fields are 0 when Bedrock reports
none. Non-zero `cacheReadInputTokens` without `cacheConfig` would come from Bedrock's implicit
caching (INFERRED from the documentation above; not observed).

## Re-measure when

- the model changes, in either place: `packages/app/src/env.ts:10` (the app default) or
  `infra/lib/api-stack.ts:26` (the deployed value). The bootstrap test and the infra stack test
  respectively fail until this record names the new model. Bedrock's table lists 512 for
  Opus 5, Fable 5 and the 5.5 series (Opus 5.5, Sonnet 5.5, Fable 5.1); 1,024 for Sonnet 5,
  Opus 4.8 and Sonnet 4.5/4.6; and 4,096 for Opus 4.5 to 4.7 and Haiku 4.5. The 512 and 1,024
  minimums are below today's prefix;
- the persona, the tool set or its schemas grow by roughly 2,500 tokens;
- the catalog moves out of the system prompt, or the bridge's story count or field limits
  change;
- the `agent_turn` log shows whole-turn input near 4,096 per call, for example from a large
  real catalog in `list_family_stories` results.
