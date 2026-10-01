# Alexa session friction handoff

## Planning state, 2026-10-01

The Owner authorized planning after a read-only September 30 session review. The plan and three phase files were written on `develop` in `/Users/juan/code/spoken-letter-alexa`, source baseline `be03dd1a7ca82368a8e45a5b7b472649a5ae49fd`. No implementation branch/worktree, code edit, commit, push, model publication, deployment, notification send, or private-repository change was performed for this planning task.

F1–F4 cover contextual recognition/recovery and prompt consistency. F5 covers safe presence/result diagnostics. F6 records successful playback and sparse latency observations with no speculative optimization. The selected design adds a custom bare-topic intent while retaining phrase-slot carriers; it preserves only validated session state and keeps raw values out of logs. The public MCP and agent route contracts remain unchanged.

The primary live evidence came from CloudWatch logs and the fetched deployed skill source map, with the AWS artifact identity recorded in the main plan. Logs show four fallbacks among nine intent requests, two immediate creation starts with no draft backend request, one listing, and one confirmed playback start. Missing-theme behavior is an inference; redacted null slot values cannot establish it. Exact failed speech and spoken replies are unavailable. Owner-recalled wording is optional additional regression input, not a prerequisite for the known fixes.

Graphify was queried through the repository's own graph using its read-only CLI because the MCP query tool was not exposed. Direct reads confirmed relevant behavior and the consumer list. Amazon primary documentation was checked for phrase-slot restrictions, custom slot validation, session attributes, and reprompts. Prior implementation notes establish that raw speech suppression is deliberate; new diagnostics must preserve it.

Planning artifacts require link/path and diff validation only. Product gates were not run and no product outcome is claimed. The next action is Owner review of [the main plan](2026-10-01-alexa-session-friction.md), followed by explicit implementation authorization. Phase 1 starts only after revalidating actual refs/files. Per-phase stops apply unless the Owner explicitly grants continuation; external actions retain separate authorization boundaries.

## Authorization and implementation entry

The Owner invoked `/rpi-implement` on this plan, then authorized all phases without intermediate stops, local merge into `develop`, and task worktree pruning. External publication and device operations keep the separate boundaries in Phase 3. Entry verified `develop` at `be03dd1a7ca82368a8e45a5b7b472649a5ae49fd`; only the untracked planning artifacts belonged to this task. Their originals remain preserved in the integration checkout until byte comparison at merge. Worktree: `/Users/juan/code/spoken-letter-alexa-session-friction`, branch `fix/alexa-session-friction`. No private checkout is modified.

Graphify's read-only CLI queried the repository's own `graphify-out` link before source tracing; the MCP tool is unavailable. The structural result located the handler, model, client, routes, and observability consumers. Current source reads confirmed the baseline.

## Phase 1 implementation

F1–F4 are repaired locally. `ThemeChoiceIntent` uses the distinct custom `drafttheme` slot; supported explicit-start paraphrases retain SearchQuery carriers. Draft entry is gated; fallback never writes; validated state survives contextual recovery. Returned state contains only allowed fields, canonical wish data, and the bounded fallback counter. Fixed error copy distinguishes unsupported themes, backend unavailability, and the draft limit. Explicit task switches and cancellation clear obsolete state.

Red tests: the initial focused run had 20 failures and 85 passes; repaired handler/model tests reached 111 passes before the final wish-carrier repair. Further review regressions failed before their fixes. Four executed mutations were killed: removing draft gating, dropping recovery attributes, restoring the playback reprompt, and writing on fallback. Exact operational logs are retained locally outside tracked deliverables.

Independent reviewer `review_phase1` found wish-entry reprompt gaps, a bare-reaction prompt/model mismatch, invalid-wish restart guidance, and missing explicit-start/reopen/handoff/counter-reset coverage. All were repaired. Re-review identified the missing-topic wish's bare-theme command as unusable without wish state; it now gives the full supported wish-start carrier. These changes preserve the shared wish vocabulary and public contracts.

The required `codex-simplify` pass inspected reuse (shared question/recovery helpers), quality (state reconstruction and fixed copy), and efficiency (bounded state and catalog lookups). No additional refactor was justified. The first full gate passed all five checks, but subsequent review repairs invalidate that candidate's receipt; the final Phase 1 gate must pass before Phase 2 entry. Amazon routing and Echo behavior remain UNVERIFIED.

## Deviations

- Plan said reaction guidance uses like/love/no. Found the interaction model declares reaction carrier phrases, with no bare like/love sample. Chose supported “I like it”/“I love it”/“no” reprompts, preserving recognition scope and avoiding a second prompt/model mismatch.
- Plan said matching wish reprompts. Found a missing-topic wish has no validated confirmation state, so a bare-topic reply cannot continue it. Chose a complete supported wish-start command until canonical wish state exists.

Phase 1 final-gate attempt on `241f7c807c1f4e0e07899317c605471210dcf0ea` retained failures: lint rejected an untyped mock-call read, and an existing wish-copy regression required the theme question. Both were repaired by explicit call assertions and retaining the question followed by the usable wish-start command. Typecheck, synth, and all eight E2E cases passed in that attempt; the aggregate result remains failed and its receipt is retained.

## Phase 1 accepted locally

Independent review approved the repaired recognition/state implementation. Full default verification on `84cff45` passed typecheck, lint, 541 unit tests, CDK synth (including Lambda bundles), and eight simulator E2E cases, with unchanged candidate/environment identity. Review subsequently requested restoring an exact two-call-count assertion alongside the S2 nth-call assertions; it is included in Phase 2's regression candidate. All earlier failed receipts remain retained and superseded explicitly. F1–F4 are local resolved findings; Amazon recognition remains unverified.

## Phase 2 implementation

F5 is repaired locally with generated-definition slot presence, redacted known-slot legacy maps, finite response/result/flow fields, bounded fallback count, and domain-separated SHA-256 hashes of Alexa session and request IDs. Hashes are log fields, never metric dimensions or store fields. Response keys are chosen with response constructors, never extracted from speech. Backend rejection, timeout, malformed-client receipt, and unexpected errors receive bounded classes and retry diagnostics. Launch dependency failures retain welcome copy and disclose the failure in the same turn log.

`FallbackCount` publishes only an undimensioned count in the existing `sla/mcp` namespace; the dashboard uses its sum. Existing alarms, subscriptions, latency/dead-end metrics, and 7 s/8 s budgets are preserved. Recording controls remain compatible and off by default, with truthful inert-control warnings. README, infrastructure comments, and the historical importer explain that safe fields cannot reconstruct transcripts or produce training speech.

Red evidence: the first Phase 2 focused run had 19 failures and 105 passes. The final focused handler/Lambda/CDK selection passed 124 tests. Initial test repairs corrected module-reset spy identity and asserted CDK's effective metric-level `Sum` statistic; namespace, metric name, and absence of dimensions remain exact assertions. Lint exposed an unused value-only registry and shorthand void callback; the finite registry is now a TypeScript union and the callback has an explicit body. Executed mutations that falsely completed fallback, leaked slot values, or added hash dimensions were each killed.

Independent reviewer `review_phase2` approved T1–T6 and all changed consumers with no actionable finding, and independently ran 114 handler/Lambda/client tests. Required simplify passes found reusable failure classification and redundant state/presence calculation; those are centralized/computed once. Quality review retained code-owned branch keys and compatibility switches. Efficiency review found no other justified change. The complete Phase 2 default gate is the next entry condition for Phase 3; its receipt will bind this committed candidate. External telemetry, Amazon routing, and Echo acceptance remain UNVERIFIED.

## Deviations, Phase 2

- Generator also rewrote manifest whitespace while producing the interaction model. Restored the unchanged manifest bytes because no metadata change is required.
- CDK encodes the effective `Sum` statistic on the metric tuple rather than on the widget defaults. The test asserts that tuple exactly, including no dimension pairs, and keeps the existing alarm/subscription counts.

## Phase 2 accepted locally

Full default verification on `a70f4725ff7319153f47b2aea8e04ac96b31dfa3` passed typecheck, lint, 560 tests, CDK synth, and eight E2E cases. Receipt attempt `8b18996e4688482e8876be4c532bdf80` binds candidate digest `8364afacc38e59349a55cb8384bb2cb77620ebfca730a6f9f5d08ccc869eea5c`; candidate and environment remained unchanged. F5 is resolved locally. Deployed fields and metric publication remain unverified.

## Phase 3 implementation and review

Added `packages/skill/src/session-recovery.integration.test.ts:1`, exercising real `createHandler`, `createAgentClient`, Hono agent routes, `MemoryDemoDraftStore`, `MemorySessionStore`, and the existing real fixture MCP/OAuth harness. Network IO is adapted to Hono requests; deterministic outline generation replaces paid model IO. The harness forwards response attributes, changes transport request IDs per turn, and repeats the exact successful request only for duplicate delivery. Every command-secret header is asserted before the real route validates it.

I1–I4 passed in the initial and repaired local runs. No new production behavior is introduced in this phase, so there is no implementation red/green cycle; these integrated tests verify the already repaired behavior against the real owned modules. Removing preserved state breaks I1, removing idempotency breaks I2's same-receipt/count/generator-call assertions, allowing stale entry breaks I3, and routing named/playback text into drafts breaks I4. The earlier executed mutations already demonstrated draft-gating and state-retention sensitivity.

Independent reviewer `review_phase3` independently passed all four journeys and identified two oracle gaps: hash uniqueness permitted all hashes to be absent, and session-store privacy lacked a direct assertion. Both were hardened, rerun, and approved in re-review. No actionable finding remains. The required three simplify lenses confirmed reuse of existing real test support, clear transport/state ownership, and bounded offline work; no further edit was justified. Typecheck and lint passed in preliminary runs, and relative documentation links and diff whitespace were checked. The complete final phase gate remains the next required check.

The device script has nine focused NOT RUN case groups and a concrete exact-candidate release/model/Lambda/log checklist, with supported reaction carriers. The friction log preserves historical observations and records only measured local behavior. Generated model SHA-256 is `bf3f7afa21acaa22d0f4d49eb1b7e0155aa958402b3d0b19e074972c11db7624`. F6 remains monitoring-only, with no speculative latency changes or new percentile claim. D1–D5 are implemented within the Owner's authorized local scope. `amazon_routing=UNVERIFIED`, `echo_acceptance=UNVERIFIED`; all Amazon/Echo matrix cases remain NOT RUN.

## Deviations, Phase 3

- The planned route-test setup was extended with the existing real fixture MCP/OAuth harness so I4's unrelated playback actually runs the agent and playlist path without sockets or mocked owned modules.
- No AWS, ASK, private-app, paid-model, or outbound operation is executed. Those are explicit separate prerequisites for device completion, not failed or skipped local software gates.

## Phase 3 acceptance and local integration

Phase 3 candidate `491694de866c991598c987311db21ac54e55c28d` passed the complete default gate: typecheck, lint, 564 tests across 69 files, Lambda bundle/CDK synth, and eight simulator E2E cases. Receipt attempt `495f8334bb3d4bb19d7633a1daebf6b0` binds candidate digest `cd29d163cdfbe565ef5d6cc9af2d18c0efb578a1e9de8a871aab589dc471f98a`; candidate/environment identity was unchanged. Independent review and simplify are complete. Coverage percentages were not collected; none is claimed.

Fetched `origin` before integration and confirmed `origin/develop` still matched the baseline. The authorized local merge is `c864591cad022a938e28ad69f978a9d9fe8a02fa` on `develop`, merging the tested task branch without conflicts. Original untracked planning inputs were byte-checked and preserved under `.rpi/local/alexa-session-friction/original-planning-inputs/` before the tracked versions were integrated. This documentation completion records the merge and marks local acceptance; it does not change product source.

Final integrated verification command: `python3 .rpi/scripts/rpi-verify.py --evidence .rpi/local/alexa-session-friction/final-verification.json`. That receipt records the final integrated checkout identity, all five exit codes, runtime identity, and candidate stability. Earlier receipts, red/green and mutation logs, and review dispositions are preserved under `.rpi/local/alexa-session-friction/`. Task worktree build/dependency outputs are reproducible; verification and simulator-result evidence are preserved before pruning. No foreign worktree or branch is removed.

Local scope completed: F1–F5 resolved; F6 retained as monitoring-only; D1–D5 implemented. `local_verified=true` for the tested repair. `amazon_routing=UNVERIFIED`; `echo_acceptance=UNVERIFIED`. Nine external case groups are NOT RUN. The next action is separately authorized release/CDK deployment and ASK development metadata publication, followed by ASK dialog and adult Echo observation on the exact candidate. No push, deploy, publication, paid rehearsal, notification, or private-repository mutation occurred in this implementation session.

## October 1 deployment continuation

The Owner subsequently authorized deployment for device testing. Local `main` was fast-forwarded to integration candidate `c7009edf12418855b8a4986f4871a1c06418aabb`. Before deployment, the final five-check receipt was revalidated against the exact source inventory and runtime environment; both matched. `pnpm build` passed. CDK diff showed API and skill code updates, a gateway synchronization marker, and the existing dashboard's fallback widget. Previous deployed API and skill ZIP files were preserved locally for rollback reference. The AWS account was verified as `106403001709`, profile `archy`, region `us-east-1`.

The root deploy wrapper stopped locally because pnpm 11 selected its built-in deploy command and rejected `--require-approval`; that invocation made no AWS update. The infrastructure script was then invoked explicitly with `pnpm -F infra run deploy --require-approval never`. Its skill update completed. The downloaded skill ZIP matches all three files in `infra/dist/skill`; code SHA-256 is `jk38LPf49BJ49FXWGE4Zkf8raIy6IJKdqfGwd8y610g=`, last modified `2026-10-01T12:20:40.000+0000`, state Active, update Successful. Both recording flags remain `0`. As of `2026-10-01T12:58:36Z`, the same CDK invocation was still publishing the API asset; the full deployment had not completed. TCP retransmissions and a slow multipart upload were observed. No second CDK deployment was started.

`pnpm -F @spoken-letter-alexa/skill run deploy` completed using ASK CLI 2.30.7. Import `amzn1.ask-package.import.889c5e00-f4de-41d1-b4c7-0dc676b6fe3a` succeeded for existing skill `amzn1.ask.skill.0598e354-ee92-413f-940a-61e4a6a0a2a7`, development stage, en-US. Every model build step succeeded. The fetched model equals the candidate's generated JSON; local file SHA-256 remains `bf3f7afa21acaa22d0f4d49eb1b7e0155aa958402b3d0b19e074972c11db7624`, canonical JSON SHA-256 is `b97902d895b5a9c8a1f7a566604761c1e0bfc870673b516d22e58df2dc31a14d`. The fetched manifest names endpoint `arn:aws:lambda:us-east-1:106403001709:function:sla-alexa-skill`. Development enablement returned HTTP 204 before and after publication. ASK rewrote only local manifest whitespace; the original bytes were restored after checking semantic equality.

Seven NLU profiles for the R1–R4 planned phrases selected the expected intents and slots on their first requests. The R1 ASK dialog attempt failed: Amazon's simulation service returned “An unexpected error occurred” for all five planned turns. The CLI exited zero despite these errors, so its exit code is not accepted as a passing rehearsal. No skill/API log events were observed in the checked window. No receipt save, outline readback, contextual recovery, or device audio is proved by this attempt. It was not repeated. `amazon_routing=PARTIAL` means NLU profiles only; `echo_acceptance=UNVERIFIED`. Every Echo case remains NOT RUN.

Raw and sanitized operational evidence is local under `.rpi/local/alexa-session-friction/deployment-2026-10-01/`, including the candidate receipt reference, build/diff/deploy logs, rollback ZIP files, skill file hashes, Amazon import/model/manifest readback, NLU profiles, failed dialog log, and partial deployment status. No GitHub push, notification send, or private-app mutation was performed in this continuation.

## October 1 console-test continuation

The Owner explicitly authorized console tests, immediate fixes and republishing. Eleven NLU plus Manual JSON endpoint journeys passed across 50 turns on the deployed skill and development model from `c7009edf12418855b8a4986f4871a1c06418aabb`. The endpoint harness carries actual returned session attributes and uses separate synthetic adult identities per case. Consistent DynamoDB reads confirmed actual draft, wish and reaction receipts. A separate validator passed 500 assertions for required intent/slot selection, receipt IDs and TTL, exact R1 outline readback, hashed request correlation, recovery state, safe CloudWatch fields and absence of raw speech or identifiers. Individual durations are in ignored local evidence; cold/warm classification is unavailable. No latency improvement or percentile is claimed.

Independent review of the live harness found missing oracles for routing, second-fallback guidance, cancellation state, listing, reaction identity, diagnostics and failure exits. A separate validator resolved these gaps against retained responses, NLU results and logs. An initial empty-item AWS CLI response caused a harness parse failure; the corrected harness treats that response as absent state. Failed evidence remains in `journeys-attempt1` and its log. Subsequent runs use unique evidence directories and nonzero failure exits.

Global Alexa Simulator and ASK dialog continued to fail with a generic Amazon error after development enablement was refreshed (HTTP 204). A direct simulation result was `FAILED` without invocation details. Browser Manual JSON launch succeeded and displayed the expected fixture birthday reply. NLU plus Manual JSON endpoint success is software evidence, not a global simulator or Echo pass. R6 checks emitted reprompt, R8 checks directives, and R9 supplies a synthetic completion callback; device idle timing, audible playback, real `PlaybackStarted` and natural completion remain unverified.

The first root deployment command failed before AWS changes because pnpm 11 dispatches its built-in `deploy`. The repair changes the root script to `pnpm -F infra run deploy` and documents `pnpm run deploy` plus an explicit ASK `run deploy`. This is a command dispatch repair; it adds no deployment resources or permissions.

Extended console checks exposed short-title playback failure ("play the Ignacio story"), generic fallback for bare named handoff and credit-help phrases, and an unknown storyteller slot omitted by Amazon's NLU. Repairs add explicit safe handoff/credit intents, keep named wishes distinct so a missing creator asks who, and normalize the spoken short-title wrapper before delivered-catalog lookup. No backend write is made for handoff or credit help, and unknown creators cannot silently become generic wishes. Regression tests failed before implementation and passed after repair. Fixed handoff samples have narrow denylist exceptions verified by no-write handler tests; imported raw training still rejects send/credit phrases. The shared agent-tool denylist remains unchanged.

Simplify: reuse keeps existing handoff copy and receipt controllers; quality removes the now-unused storyteller declaration from the generic wish intent; efficiency adds no catalog round trip. The independent reviewer identified the fixed-sample denylist conflict and stale publication digest. Both were corrected before the full gate.
