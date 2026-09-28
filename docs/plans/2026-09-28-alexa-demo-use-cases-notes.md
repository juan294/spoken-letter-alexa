# Alexa demo use cases implementation notes

## Scope and authority

The Owner authorized `/rpi-implement` for all four local phases in one conversation on 2026-09-28, with a one-case exception to the per-phase acceptance stop. This does not authorize a push, CDK deployment, ASK metadata publication, Proactive Events send, private-repository edit, or final submission. The implementation branch is `feat/alexa-demo-use-cases` in `/Users/juan/code/spoken-letter-alexa-demo-use-cases`, created from `develop` at `191b254747a9336974871a277c837bc8a004bde0`. The plan and research were preserved in that base commit.

## Phase 1: playback journeys

Local implementation is committed as `cac8309a2fd81e180ba6637f6b4572a2417df804`. The skill uses an authenticated internal playlist command route. The controller reads delivered stories through the existing MCP tools, fetches fresh audio before playback, persists only hashed device keys, story IDs, positions, token digests and event digests with a two-hour TTL, and uses conditional writes for stale callback races. Skill audio supports `ENQUEUE` with `expectedPreviousToken`; new stream tokens are short and opaque. Generated `en-US` intents route all, newest, creator, title, replay and playlist reset requests. Model replies without audio cannot claim playback. Raw slot values, catch-all speech and model `say` are excluded from skill telemetry.

Independent review found six issues. Persisted URL-bearing tokens were replaced with digests; replay got its own intent; the first-20 catalog limit now has truthful recovery copy; help copy no longer names an unavailable storyteller; no-audio replies use explicit `needsAnswer` or deterministic catalog recovery; and raw slot values no longer enter logs. The reviewer rechecked these repairs and reported no remaining local plan-compliance blocker. The simplify pass removed long URL-bearing playlist tokens in favor of short opaque tokens and retained the bounded MCP read surface.

Verification: `python3 .rpi/scripts/rpi-verify.py` passed all five checks on staged identity SHA-256 `2e415743c8143cd827daa02397771b1c8efa0156e2c58df60045df9250c885b2`, before commit `cac8309`. Results were typecheck 0, lint 0, unit tests 422 passed, CDK synth 0, and simulator E2E 2 passed. A prior attempt failed only because three CDK setup hooks exceeded Vitest's default ten-second hook limit under concurrent machine load; `infra/vitest.config.ts` now sets a 60-second setup limit, and the full gate passed afterward without changing assertions.

The five outstanding Echo checks from the earlier interaction UX Phase 3 remain unmeasured: `play the story aunt whitney sent`, `next`, `start over`, `shuffle on`, and `i want to hear martina`. ASK development model validation, Echo intent routing, stream-token progression, and device playback for this phase are also unmeasured. No deployment was authorized or attempted. The Owner's all-phases continuation allows local Phase 2 work to proceed while these manual acceptance results remain open.

## Deviations

- **First-20 catalog bound.** The direct-title oracle broadly says to play a unique delivered title. The MCP list tool returns at most 20, so a title outside that window cannot be resolved on this route. The main plan's stuck-state contract explicitly requires a bounded-list explanation for 21 or more stories. The controller now says it checked the first 20 and offers an available title; it does not claim the requested story is absent from the account. This remains a deliberate demo limit pending a separately designed paged catalog contract.
- **Raw utterance recording.** The earlier UX implementation could record catch-all text and optional model speech. The phase's no-child-name log invariant makes those raw values unsafe for this path. Skill telemetry keeps intent and slot names, but omits slot values, catch-all text and model speech. The older recording controls therefore produce no raw training utterances in this implementation.
