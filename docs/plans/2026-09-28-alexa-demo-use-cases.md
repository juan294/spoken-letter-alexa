# Alexa device demo use cases

Planned 2026-09-28 for `/Users/juan/code/spoken-letter-alexa`, `develop` at `9d58fbb6616bbdad252a35eba3e30bf71e90c273`. Inputs: the Owner's `/Users/juan/Downloads/Use Cases Spoken Letter for Alexa.md` (modified 2026-09-28), `docs/research/2026-09-28-alexa-demo-use-cases-current-state.md`, and `docs/plans/2026-09-28-tools-alexa-demo-use-cases.md`. This plan covers local code and development-stage demo behavior. It authorizes no push, deploy, skill metadata submission, private-repository edit, payment, or outbound message.

## Goal and accepted interpretation

Record parent-operated demos of every category in the Owner's list: playlist and selected-story playback, guided creation, new-story and family-event updates, feedback, wishes, help, and credits. Every spoken response must distinguish an action that happened from a fixture simulation or a handoff. The recordings remain stories already delivered by the Owner; no child account, voice, stored recipient name, or undelivered story enters this path (`AGENTS.md:18-34`; `packages/mcp-server/src/provider/types.ts:1-28`).

The phrase “implement in the skill before demos” is interpreted as **fixture-backed, parent-only demo journeys**. This is the local route that fits the present device service subject, which resolves to fixtures (`packages/agent/src/routes.ts:145-148`; `packages/mcp-server/src/provider/registry.ts:10-25`). Real delivery, a named listener selection, creator email, and paid credits require a separate private-app contract after the freeze; a local demo must not claim any of those effects. The Owner can change that scope before implementation. The source examples are intent examples, not permission to send a child's data to Alexa.

## Existing work and overlap

The 2026-09-10 interaction UX plan's Phase 4 is still a plan, with no implementation handoff recorded after Phase 3; its Phase 3 handoff says five device checks remain (`docs/plans/2026-09-10-alexa-skill-interaction-ux-notes.md:165-172`; `docs/plans/2026-09-10-alexa-skill-interaction-ux-phases/phase-4.md:1-10`). Phase 1 here absorbs its continuous-play, dead-end, copy, and suggestion-state goals. Before Phase 1 starts, run and record those five outstanding device checks, then reconcile any observed routing differences in the phase file. Do not implement two competing playlist designs. The old Phase 4's suggestion to speak a follow-up from `PlaybackFinished` must be interpreted against Amazon's [AudioPlayer reference](https://developer.amazon.com/en-US/docs/alexa/custom-skills/audioplayer-interface-reference.html), retrieved 2026-09-28: `PlaybackFinished` cannot return speech or another `Play` directive. Queue progression uses `PlaybackNearlyFinished`; feedback is asked on a later invocation.

## Decisions and options

| Decision | Chosen contract | Other path and trade-off |
| --- | --- | --- |
| D1: account effects | Device demo uses fixture catalog plus a separate demo-state store for drafts, wishes, reactions, and update events. It says “saved for this demo” when it writes demo state. | Real private-app writes would fulfill delivery and creator messaging but require the post-freeze private bridge, account-linked identity, and a revised safety contract. They are outside this plan. |
| D2: playback | A deterministic playlist controller owns order, position, and event idempotency. Named title and creator resolution use the delivered catalog. | Letting the model select “next” each time is simpler but cannot guarantee skip, previous, shuffle, or newest-first order; the current suggestion ring is oldest-first and process-local (`packages/mcp-server/src/tools/suggest.ts:17-32`, `packages/mcp-server/src/tools/suggest.ts:51-70`). |
| D3: notifications | A fixture event inbox is readable when the parent opens the skill. One generic `AMAZON.MessageAlert.Activated` Proactive Event is tested on the Owner's opted-in development device; its template cannot recite the Owner's example text verbatim. | Spoken updates alone require no Alexa notification permission. Proactive Events require manifest publication, a predefined schema, subscription, and the Owner's device opt-in under Amazon's [Proactive Events guide](https://developer.amazon.com/en-US/docs/alexa/smapi/proactive-events-api.html), retrieved 2026-09-28. |
| D4: creation and credits | Alexa can guide an adult through a short story outline and save a demo draft without a listener. It explains how to finish delivery or add credits in the private app. It cannot send or purchase. | Direct Alexa delivery or credit changes conflict with the current recipient and paid-entitlement boundary (`packages/shared/src/contract/agent-tools.ts:18-40`) and need a separate product decision. |
| D5: feedback | A reaction prompt appears on the next skill invocation after first completed playback; a parent can save “like” or “love” in demo state. | The requested immediate spoken prompt cannot be emitted by `PlaybackFinished` under Amazon's [AudioPlayer response contract](https://developer.amazon.com/en-US/docs/alexa/custom-skills/audioplayer-interface-reference.html), retrieved 2026-09-28. |

Amazon's [Dialog interface](https://developer.amazon.com/en-US/docs/alexa/custom-skills/dialog-interface-reference.html), retrieved 2026-09-28, supports slot elicitation and intent confirmation when a dialog model is declared. This plan uses explicit skill state and confirmation for fixture writes; Phase 2 may use `Dialog.ElicitSlot` only after the generated interaction model and ASK validation prove the required dialog model is present.

## Invariants

1. The device never plays an undelivered or invented story. Catalog IDs and fresh audio URLs come from the provider, and a failed lookup produces a spoken recovery (`packages/mcp-server/src/tools/get.ts:24-42`; `packages/mcp-server/src/tools/index.ts:36-40`).
2. The parent is the only demo speaker. Alexa-facing payloads, logs, fixture events, and notifications contain no stored recipient name, child voice, date of birth, email, or account credit balance. Story titles and adult storyteller names remain allowed (`AGENTS.md:31-34`; `packages/mcp-server/src/provider/types.ts:1-18`).
3. No agent-facing write tool is added to the three-tool MCP surface. A fixture action goes through an explicit, validated skill or agent route with a demo-only data store; it is never disguised as a real account action (`packages/mcp-server/src/tools/index.ts:10-12`; `packages/shared/src/contract/agent-tools.ts:18-40`).
4. All demo state is keyed by the opaque hashed device identity, time-limited, and isolated from the private bridge. The existing device session hash and two-hour TTL are the starting pattern (`packages/agent/src/sessions.ts:5-25`, `packages/agent/src/sessions.ts:41-47`). No raw Alexa user ID is logged.
5. Out-of-session events use only Amazon's fixed schema text. `AMAZON.MessageAlert.Activated` speaks a count and creator name under Amazon's [schema reference](https://developer.amazon.com/en-US/docs/alexa/smapi/schemas-for-proactive-events.html), retrieved 2026-09-28; the exact story title and fixture event detail are read inside the skill.

## Phase sequence

| Phase | Outcome | Acceptance stop |
| --- | --- | --- |
| [1](2026-09-28-alexa-demo-use-cases-phases/phase-1.md) | All requested playback modes and controls, with stable ordering and no stale enqueue | Automated gate; parent device playback script |
| [2](2026-09-28-alexa-demo-use-cases-phases/phase-2.md) | Guided demo draft, creation and credits help, safe handoff for named listener or paid action | Automated gate; parent dialog script |
| [3](2026-09-28-alexa-demo-use-cases-phases/phase-3.md) | Fixture wish, first-play reaction, in-skill event inbox, and generic opt-in device notification | Automated gate; ASK development validation and device subscription/readback |
| [4](2026-09-28-alexa-demo-use-cases-phases/phase-4.md) | Complete demo matrix, copy audit, rehearsal evidence, and packaging | Automated gate; recorded parent-operated end-to-end rehearsal |

Each phase is a separate implementation conversation and stops for acceptance. The user has authorized research and planning, not implementation. Local changes should start in a worktree off `develop`; the integration owner merges completed work locally to `develop` after review and gates. Push and deployment are separate Owner gates (`AGENTS.md:109-125`, `AGENTS.md:160-173`).

## Consumer sweep

The planning search was `rg -n 'createHandler|createAgentClient|PlayStoryIntent|PlaybackNearlyFinished|playDirective|SessionStore|registerTools|TOOL_METADATA|StorySummary|FixtureProvider|HttpProvider|ALEXA_PERSONA|turnOutputSchema' packages infra scripts amazon --glob '!**/node_modules/**'`. Changes to skill requests and output affect `packages/skill/src/handler.ts`, `agent-client.ts`, `audio.ts`, `lambda.ts`, the generated model and drift tests, handler/audio/client tests, and `packages/skill/skill-package/skill.json` (`packages/skill/src/lambda.ts:5-29`; `packages/skill/src/model/generate.ts:270-295`; `packages/skill/src/model/generate.test.ts:173-176`). Changes to session or agent output affect `packages/agent/src/routes.ts`, `turn.ts`, `schema.ts`, `sessions.ts`, their tests, app bootstrap, and simulator mock/transport consumers (`packages/agent/src/routes.ts:162-179`; `packages/app/src/bootstrap.ts:145-174`; `packages/simulator/src/agent/types.ts:1-30`). Catalog and tool changes affect provider implementations, registry, tool tests, and agent catalog formatting (`packages/mcp-server/src/provider/types.ts:25-28`; `packages/mcp-server/src/provider/registry.ts:14-25`; `packages/agent/src/routes.ts:71-105`). The fixture writer `scripts/add-fixture-story.mjs`, fixture catalogue, test-support fixtures, simulator E2E helpers, and skill model generator are included in Phase 4's consistency check (`packages/skill/src/model/generate.ts:17-21`; `packages/skill/src/model/generate.ts:270-295`). Existing OAuth and private bridge routes are excluded because this plan does not change account identity or real delivery.

## Stuck states and recovery

| State | Who sees what | End and evidence |
| --- | --- | --- |
| Empty, ambiguous, or over-limit catalog | Parent hears “no delivered stories,” a title/creator clarification, or a bounded-list explanation. | Select an available unique story or refresh the fixture catalog. Tests exercise empty, duplicate titles, and 21+ stories without claiming completeness beyond the list cap (`packages/mcp-server/src/tools/schemas.ts:22-31`). |
| Stale playback event or expired URL | Parent's current track continues or gets a spoken retry on the next invocation; logs record stale/expired class without a raw URL. | State version and `expectedPreviousToken` reject obsolete enqueues; a fresh `get_family_story` URL is fetched before replay/queue. Tests interleave skip with `PlaybackNearlyFinished` and advance a clock past URL expiry. |
| Missing theme, adult creator, or unclear pronoun | Parent hears a specific question; no demo draft, wish, or reaction is saved. | Reply to the question or cancel. Tests assert missing values never become defaults and that the next turn can complete the flow. |
| Demo write unavailable or duplicate event | Parent hears that the item was not saved; no creator-delivery claim. | Retry with the same idempotency key after recovery; tests prove one saved item and one visible confirmation. |
| Notification not subscribed or Alexa rejects a schema | Parent can still hear updates inside the skill; a spoken help line explains how to enable notifications. | Opt in on the Owner device and retry a development event after schema validation; test subscription state transitions and record the real device result. |
| Named listener or paid credit request | Parent hears that the private app must choose the listener or handle credits; Alexa claims no delivery or charge. | Complete the action in the app outside this demo plan. Tests assert no write call and no child name in the response or structured logs. |

## Verification and release boundary

Every implementation phase uses TDD and the sequential local command in `.rpi/policy.json:7-42`: `python3 .rpi/scripts/rpi-verify.py`, which runs typecheck, lint, unit tests, CDK synth, and simulator E2E. Phase files name additional targeted oracles. Local model generation and drift checks precede any authorized `ask deploy`; ASK validation against the development skill follows that publication and is recorded as remote evidence. Amazon's development endpoint and device checks are manual acceptance evidence, not inferred from a green unit suite. No CI workflow or deploy command is added (`.github/workflows/verify.yml:1-31`; `package.json:12-23`).

Before a push, inspect CI and deploy triggers and run the complete local gate. A push, ASK metadata publication, CDK deployment, Amazon Proactive Events API call, or outbound email needs separate authorization. A real-account version needs a new private-repository session after the freeze and a revised boundary decision; this fixture plan is not its implementation authorization.

## Handoff

Research and tool design are local documentation on a clean `develop` base at the commit above. The current worktree has these seven new documentation files and an existing `origin` remote; no push was made. Recheck `git status`, the source list, existing Phase 3 device-check evidence, and current code before implementing. Decisions D1–D5 are the local demo scope; no external effects are accepted as done. The next action is Owner review of this plan and Phase 1 entry, including the five outstanding device checks from the prior UX plan. No product checks have run for these documentation-only files.
