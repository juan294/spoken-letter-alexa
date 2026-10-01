# Phase 2: safe session diagnostics

Entry: Phase 1 accepted and source/state contract revalidated. Repair F5 without weakening intentional suppression of raw slot values, utterances, or model replies. Current telemetry and reader are at `packages/skill/src/handler.ts:544` and `packages/skill/src/handler.test.ts:514`.

## Additive logging contract

- Preserve `event: skill_turn`, latency, playback, tool timing, and current execution `outcome` classifications. Keep the legacy `slots` map redacted; document that its nulls mean redacted, not absent.
- Add `slotPresence`, with `missing`/`present` per known slot from the generated intent definition. Missing or whitespace-only values count as missing. Never log unknown slot names or values. Non-intent requests omit this field.
- Add `flowBefore` and `flowAfter`, limited to `none`, `draft`, `reaction`, `wish`; a bounded `fallbackCount`; and `interactionResult`, limited to `completed`, `awaiting_input`, `fallback`, `retry`, `handoff`, `canceled`, `no_action`. An execution `ok` may coexist with interaction `fallback`, never with a successful-save claim for that fallback.
- Add a code-owned `responseKey` from a finite registry identifying the chosen response branch, for example `theme_prompt`, `theme_recovery`, `draft_saved`, `draft_limit`, `general_recovery`, `reaction_prompt`, `wish_confirm`, `agent_reply`, or `playback_control`. It does not contain dynamic speech or SSML. Set it alongside response creation; do not recover it by parsing speech or matching words in prose.
- Add SHA-256 `sessionHash` from a domain-separated Alexa session ID and `requestHash` from its request ID. Hash only transport IDs; never hash/store raw user/device identity for session correlation. Omit `sessionHash` when an AudioPlayer event has no session. Hashes are log fields, never CloudWatch dimensions or persisted session/store schema additions.
- Reuse `emfEnvelope` for `FallbackCount: 1` on fallback and `0` on other turns, with only an undimensioned series. Add one dashboard counter widget using that exact metric and existing namespace. Preserve latency and dead-end metrics. No new alarm, email subscription, workflow, or AWS service.
- Classify caught backend failures consistently, including draft, readback, wish, reaction, update, and launch-update paths that currently return recovery while leaving default `ok`. Reuse bounded known error codes/classes; never log exception messages, response bodies, or untrusted arbitrary code strings. A launch-update fallback may retain its existing welcome response but must disclose the failed dependency to operators.
- Correct misleading Lambda warnings and comments for `LOG_SAY` and `RECORD_UTTERANCES`: current raw recording is intentionally inert (`packages/skill/src/handler.test.ts:490`, `packages/skill/src/handler.test.ts:559`). Leave defaults off; safe diagnostics require neither flag. Document that `record-pull.mjs` cannot reconstruct this session or turn safe presence fields into training transcripts. Retain compatibility controls rather than silently removing deployment arguments.

```text
@ finalizeTurn(request, response, branchTelemetry) -> oneSkillTurnLog
ctx: generatedSlotDefinitions, codeOwnedResponseKeys, emfEnvelope
pre: raw speech and identifiers never enter the telemetry bag
do:
  1. validate slot presence and finite state/result fields
  2. compute domain-separated transport ID hashes
  3. compute fallback count and existing latency metrics
  4. emit one bounded log in the handler finalizer
br: no session -> omit session hash; fallback -> interaction result is fallback
fail: backend rejection -> bounded failure class and retry result
risk: telemetry must not change the Alexa response envelope or metric cardinality
```

## Behavioral oracles

| ID | Case | Required result |
| --- | --- | --- |
| T1 | Theme absent, blank, or supplied | Presence distinguishes missing/present; raw values remain absent; no inference from redacted null |
| T2 | Start → two fallbacks → saved draft | Same session hash, distinct request hashes, correct flow before/after and response keys; fallbacks never marked completed |
| T3 | Generic fallback and successful playback | Fallback metric exactly 1 versus 0; unchanged latency/dead-end metrics and dimensions |
| T4 | Draft/wish/reaction/update failures, malformed receipt, HTTP rejection, timeout | Correct failure classification and retry/disclosure result; no misleading successful action |
| T5 | Adversarial names in slots, unknown slot names, model output, error message, session attributes | No raw names, raw user/session/request IDs, tokens, URLs, arbitrary strings, speech, or error messages in new telemetry; logging flags do not bypass suppression |
| T6 | AudioPlayer callback without session; session ended; explicit cancellation | One log per invocation, no invented session hash, correct no-action/canceled result; no regression to directives |

Test the dashboard widget's namespace, metric name, statistic, and lack of transport-ID dimensions with CDK assertions. Use existing metrics helper unchanged (`packages/shared/src/metrics.ts:18`). A mutation that marks fallback completed must fail T2; emitting raw slot values must fail T5; using session hashes as dimensions must fail the metric test.

## Work units and verification

Unit A owns skill handler/telemetry tests, Lambda warning tests, and raw-recording documentation/comments. Unit B owns the fallback dashboard widget and its infrastructure tests after the metric contract above is fixed. B is `[batch-eligible]` because it has no file overlap with A and needs no implementation output. One integration owner; no working-branch publication. Keep staffing proportionate to this small change.

Write red tests, implement, independently review, repair, simplify, then run the full sequential local gate. Automated acceptance: T1–T6, existing suppression tests, CDK assertions, and all five gate checks pass on exact candidate inputs. Manual acceptance: Phase 3 observes the new fields from the deployed exact candidate; until then they are local-only. Stop for Owner Phase 2 acceptance unless explicit continuation exists.
