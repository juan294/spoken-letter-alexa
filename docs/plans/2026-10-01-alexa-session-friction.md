# Alexa session friction repair

Planned 2026-10-01 on `develop` at `be03dd1a7ca82368a8e45a5b7b472649a5ae49fd` in `/Users/juan/code/spoken-letter-alexa`. The Owner requested a plan after the September 30 log review. This document specifies local implementation and subsequent device acceptance; it does not authorize implementation, push, ASK metadata publication, CDK deployment, notifications, or private-app changes.

## Goal

An adult can start a story draft, answer the theme question naturally, recover from a recognition failure without restarting, and read the saved draft back. The next session's logs distinguish recognition failures, missing input, successful actions, and backend failures without recording speech or names. Existing delivered-story playback continues to work.

## Evidence and limits

The read-only review retrieved CloudWatch events from `/aws/lambda/sla-alexa-skill` and `/aws/lambda/sla-alexa-api` for September 29 22:00 UTC through October 1 07:00 UTC. The observed September 30 activity was 18:10–18:14 UTC, or 20:10–20:14 Europe/Madrid. Local evidence is `/tmp/alexa-session-2026-09-30/skill-structured.json` and the corresponding raw log files. Temporary files are supplementary; the sanitized observations below preserve the planning input if they disappear.

The fetched skill artifact was `$LATEST`, code SHA-256 `jfXm41y7FFVuuLabJMgzCeRLyykouZTx7FbqybeloXE=`, last modified September 29 19:05:41 UTC, for skill `amzn1.ask.skill.0598e354-ee92-413f-940a-61e4a6a0a2a7`. Its source map confirmed the prompt, fallback, theme-routing, and logging behavior cited below. This ties observations to an AWS artifact, not to an inferred Git release SHA.

| ID | Observation or source finding | Disposition |
| --- | --- | --- |
| F1 | Four of nine intent requests were `AMAZON.FallbackIntent`, at 20:12:22, 20:12:59, 20:13:27, and 20:13:38 Madrid time. The handler treats help and fallback identically (`packages/skill/src/handler.ts:377`). | Contextual recovery in Phase 1; visible fallback diagnostics in Phase 2. The historical phrases cannot be reconstructed. |
| F2 | `StartStoryIntent` occurred at 20:12:34 and 20:12:52. Both took 0 ms after rounding; no corresponding draft backend call appeared. No `ThemeIntent` followed. | Treat a stalled theme question as the strongest inference, not proof of a missing slot. Phase 1 repairs a separately confirmed prompt/model mismatch. |
| F3 | The prompt offers bare “mermaids” or “space” (`packages/skill/src/handler.ts:74`), but `ThemeIntent` declares a phrase slot with carrier samples (`packages/skill/src/model/generate.ts:288`). | Add a bounded bare-topic route and retain existing carrier phrases. |
| F4 | Every question receives the playback reprompt, including the theme question (`packages/skill/src/handler.ts:127`, `packages/skill/src/handler.ts:132`). | Give draft, reaction, and wish questions matching reprompts. |
| F5 | `loggedSlots` writes `null` for every slot value (`packages/skill/src/handler.ts:158`). Every observed request was marked `outcome: ok`, including fallback. Optional speech logging is intentionally disabled by the current test contract (`packages/skill/src/handler.test.ts:559`). | Add input-presence and interaction-result fields while retaining raw-value suppression and existing execution outcomes. |
| F6 | “What's new” completed in 2.85 s. Play-all selected `st_mauricio_the_bull` in 446 ms; Alexa reported playback started and later stopped. First launch took 3.098 s. No logged timeout or backend error occurred. | Preserve playback and time budgets. Record latency during acceptance; this sample does not justify a latency architecture change or a percentile claim. |

There was no request/session correlation in the historical structured lines. Temporal grouping suggests one device test but cannot prove the identity of every request. Exact utterances, spoken replies, and themes are unavailable. Additional Owner-recalled phrases may extend the test matrix; their absence does not block the known fixes. No synthetic phrase below is labeled as something the Owner said.

The graph query used the repository's own `graphify-out/graph.json`: `graphify query 'createHandler loggedSlots askForTheme ThemeIntent fallback generate logging handler tests' --graph /Users/juan/code/spoken-letter-alexa/graphify-out/graph.json --budget 2200`. The `graphify_local` MCP tool was not exposed in this session, so the read-only CLI was used. Its truncated structural result located the handler, generator, tests, and infrastructure; direct source reads supply the contract.

## Decisions and alternatives

| Decision | Selected design | Alternative and trade-off |
| --- | --- | --- |
| D1: bare themes | Add `ThemeChoiceIntent` with a distinct `drafttheme` slot of existing custom type `DemoTopic`, and sample `{drafttheme}`. Keep `StartStoryIntent` and `ThemeIntent` using `theme: AMAZON.SearchQuery`. Accept the new route only in an active draft flow. | Native dialog elicitation can support richer input but requires a dialog model and broader response changes. Adding bare `{theme}` to the current phrase-slot intent violates Amazon's carrier requirement. |
| D2: recognition scope | Add explicit creation paraphrases and theme synonyms grounded in current supported themes. Preserve playback, wish, and catch-all intent boundaries. | Broad catch-all carriers can compete with established playback intents; arbitrary expansion cannot repair unknown historical phrases reliably. |
| D3: recovery | Preserve only validated session state, use context-specific help/fallback, and provide a more explicit example after a second consecutive fallback. Keep cancel and an explicit switch to another task available. | Returning generic help is simpler but repeats the observed dead end. Automatic interpretation of a fallback as a theme would invent missing input. |
| D4: diagnostics | Add bounded fields for slot presence, flow, response category, interaction result, and ephemeral-session correlation. Count fallbacks separately from execution errors. | Raw speech or model replies would aid transcript review but conflict with the current no-name logging contract. Do not enable them. |
| D5: acceptance | Exercise real skill handler/client/routes locally, then require ASK development routing and an Echo rehearsal after separate deployment authorization. | Simulator success alone does not prove Amazon's recognition or device behavior. |

Amazon's [slot reference](https://developer.amazon.com/en-US/docs/alexa/custom-skills/slot-type-reference.html), checked October 1, requires carriers for `AMAZON.SearchQuery` intent samples. [Custom slot types](https://developer.amazon.com/en-US/docs/alexa/custom-skills/create-and-edit-custom-slot-types.html) can reuse a type across slots, but values still require server validation. [Session guidance](https://developer.amazon.com/en-US/docs/alexa/custom-skills/manage-skill-session-and-session-attributes.html) describes returning session attributes and using specific reprompts. These support D1–D3; real recognition of the new model remains an acceptance check.

## Scope and invariants

- Keep the three public MCP tools and all agent route request/response schemas unchanged. No agent-facing tool change is proposed, so a new `rpi-tool-design` contract is unnecessary. Existing boundaries remain at `packages/shared/src/contract/agent-tools.ts:18`.
- Drafts remain fixture/demo state. Keep the seven canonical themes, ten-receipt limit, two-hour TTL, backend validation, and request idempotency (`packages/agent/src/demo-drafts.ts:6`, `packages/agent/src/demo-drafts.ts:97`, `packages/agent/src/demo-drafts.ts:151`). Names, recipients, delivery, credits, outbound messaging, and the private repository remain outside this plan.
- Bare topic recognition never creates a draft outside an active draft flow. Requests to play, request a wish, ask help, or hand off a named listener must not become draft writes merely because their text contains a theme.
- Keep current successful user-facing copy and the existing suppression of implementation terminology in speech (`packages/skill/src/handler.test.ts:34`). Logging response keys refer to code paths, not stored speech.
- Preserve the 7 s client budget and 8 s skill Lambda timeout. No new AWS service, CI workflow, deploy command, paid-model rehearsal, or notification send.

## Phase sequence and acceptance

| Phase | Outcome | Boundary |
| --- | --- | --- |
| [1: recognition and recovery](2026-10-01-alexa-session-friction-phases/phase-1.md) | Bare themes, matching reprompts, and contextual recovery without unintended writes | Independent review, simplify, full local gate, Owner phase acceptance |
| [2: safe diagnostics](2026-10-01-alexa-session-friction-phases/phase-2.md) | Missing input, fallbacks, retries, and completed actions can be distinguished and correlated | Independent review, simplify, full local gate, Owner phase acceptance |
| [3: integrated rehearsal](2026-10-01-alexa-session-friction-phases/phase-3.md) | Real handler/client/backend regression journeys and a concrete release/device checklist | Local acceptance first; deployment and device evidence remain separate |

Implementation starts in a local worktree off the revalidated `develop` base. Each phase follows red tests → implementation → independent review → repair → simplify → verification. One integration owner merges accepted work locally into `develop`. Phase execution is sequential; this planning request supplies no all-phases continuation authority. Record review and verification gaps instead of treating a missing result as a pass.

Every implementation phase runs `python3 .rpi/scripts/rpi-verify.py` sequentially: typecheck, lint, unit tests, CDK synth, and offline simulator E2E (`.rpi/policy.json:7`). Changed inputs invalidate prior check evidence. No tests have run for these planning-only artifacts.

## Stuck states and recovery

| State and observer | Visible behavior and exit | Required oracle |
| --- | --- | --- |
| Parent starts without a theme | Ask for a theme; theme reprompt; preserve draft state. Bare or carrier answer can complete; cancel saves nothing. | S1, S2, S5 in Phase 1 |
| Parent's answer reaches fallback during a draft | Ask for the theme again, retain draft state, give an explicit carrier after repeated failure. Valid answer completes without reopening. | S3; no save on either fallback |
| Parent gives a bare topic outside a draft | Explain how to start creation; no draft write or accidental wish confirmation. | S4 |
| Parent gives unsupported input | Offer supported examples; no saved claim; next valid theme succeeds. Do not repeat untrusted backend text. | S6 |
| Parent is confirming a wish or reacting | Context-specific recovery retains only validated confirmation state. Yes/no or like/love can complete afterward. | S7 |
| Malformed session attributes | Discard unknown fields and invalid state; return an actionable start/theme prompt without a write. | S8 |
| Draft backend is unavailable or receipt is malformed | Say no draft was saved, retain a theme-entry recovery path; a later valid submission succeeds. Duplicate delivery of the same request remains idempotent. | S6 and I2 in Phase 3 |
| Draft limit is reached | Explain that no draft was saved and that the parent can read the latest draft or try later. Do not promise an immediate retry will work. | S9 plus existing controller expiry tests |
| Session expires or parent reopens | Do not resurrect a pending theme or create a draft from a bare topic. Offer the explicit creation command; saved-draft readback remains available under existing TTL. | S4 and I3 |
| Operator sees an `ok` execution result for fallback | Separate interaction result and fallback count identify the recognition failure; the query groups by ephemeral session hash. | T1–T6 in Phase 2 |
| New model has only local verification | Mark Amazon routing and Echo behavior UNVERIFIED. After authorization, agent publishes the exact candidate and gathers ASK and device evidence. | Phase 3 external checklist |

## Consumer sweep

Search: `rg -n 'createHandler|HandlerOptions|AlexaResponseEnvelope|skill_turn|DeadEndPlay|SkillTurnMs|LOG_SAY|recordUtterance|loggedSlots|demoFlow' packages infra scripts --glob '!**/node_modules/**' --glob '!**/dist/**'`, followed by theme/draft route searches and direct reads.

| Caller, writer, or reader | Coverage |
| --- | --- |
| `packages/skill/src/handler.ts:226`; `packages/skill/src/handler.test.ts:12` request builders and `packages/skill/src/handler.test.ts:514` telemetry reader | Phase 1 routing/state; Phase 2 additive telemetry; Phase 3 session transport harness |
| `packages/skill/src/model/generate.ts:268`; generated `skill-package/interactionModels/custom/en-US.json`; `packages/skill/src/model/generate.test.ts:63` and `packages/skill/src/model/generate.test.ts:100` | Phase 1 new intent and drift/slot-type checks; no hand-edit of generated JSON |
| `packages/skill/src/lambda.ts:31`; `packages/skill/src/lambda.test.ts:28`; exported skill handler in `packages/skill/src/index.ts:1` | Phase 2 entry compatibility and accurate warnings for inert raw-recording controls |
| `packages/skill/src/agent-client.ts:151`, `agent-client.test.ts`; `packages/agent/src/routes.ts:303`; `packages/agent/src/demo-draft-route.test.ts:12` | Schemas unchanged; Phase 3 exercises actual client and routes together |
| `packages/agent/src/demo-drafts.ts:151`; `demo-drafts.test.ts` | Store format/writer unchanged; existing idempotency, TTL, limit, and no-name behavior retained; Phase 3 verifies receipts |
| `infra/lib/observability-stack.ts:94`; `infra/test/stacks.test.ts` | Phase 2 fallback counter widget and metric contract; no new alarm or subscription |
| `infra/lib/skill-stack.ts:27`; `infra/bin/app.ts`; `infra/test/skill-stack.test.ts` | Phase 2 documents deprecated/inert raw-recording controls accurately; do not enable them or change deployment defaults |
| `packages/skill/scripts/record-pull.mjs:1` | Existing historical raw-utterance importer is not a consumer of new safe diagnostics. Clarify its current limitation in Phase 2; no training-file write or synthetic transcript import |
| `packages/shared/src/metrics.ts:18`; `metrics.test.ts` | Reuse unchanged EMF helper; Phase 2 tests metric dimensions and values at the caller |
| `docs/alexa-device-manual-test-script.md:1`; `docs/friction-log.md` | Phase 3 focused recognition/recovery matrix and acceptance reporting |
| Simulator mock, transport, and Playwright suite | No Alexa intent/session consumer; retain required existing E2E gate. New recognition proof belongs to the skill harness and Amazon, not the simulator mock |
| MCP-server functions also named `createHandler`, audio/token code, notification workers | Different surface or unchanged behavior; excluded from edits. Existing regression gate still covers them |

## Durable handoff

Current scope is planning only. Base and current source commit are `be03dd1a7ca82368a8e45a5b7b472649a5ae49fd` on `develop`; no implementation worktree exists for this plan. Findings F1–F5 are assigned above; F6 is monitored with no speculative latency work. D1–D5 are proposed design decisions ready for Owner review. Exact failed phrases and actual device acceptance remain unavailable; no claim of repair is made.

On implementation entry, reread actual refs/status, this plan and the phase file, compare cited source with current files, verify the logs if still available, and preserve unrelated changes. Record tested candidate identities, red/green evidence, review/simplify results, deviations, local merge identity, and external evidence separately in [notes](2026-10-01-alexa-session-friction-notes.md). The next action is plan acceptance and explicit implementation authorization.

## Implementation status, 2026-10-01

The Owner authorized `/rpi-implement`, all-phase continuation, local merge into `develop`, and task worktree pruning. This status supersedes the planning-only handoff above; the original evidence and decisions remain preserved.

- [x] Phase 1: S1–S9, independent review, repairs, simplify, four killed recovery mutations, and full local gate.
- [x] Phase 2: T1–T6, independent review, simplify, three killed diagnostics mutations, and full local gate.
- [x] Phase 3 local: I1–I4 using real owned modules, independent review with repaired oracles, simplify, concrete device checklist, and full local gate (564 tests and eight E2E cases).
- [x] Local integration: merge `c864591cad022a938e28ad69f978a9d9fe8a02fa`; exact tested source and final integration receipt are recorded in [notes](2026-10-01-alexa-session-friction-notes.md).
- [ ] ASK publication/deployment and device acceptance: NOT RUN; separate authorization and adult hardware observations remain prerequisites.

`local_verified=true`; `amazon_routing=UNVERIFIED`; `echo_acceptance=UNVERIFIED`. F1–F5 are resolved locally, F6 remains monitoring-only. No latency improvement is claimed.
