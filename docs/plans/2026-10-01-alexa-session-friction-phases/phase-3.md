# Phase 3: integrated rehearsal and device acceptance

Entry: Phases 1 and 2 accepted locally. This phase establishes that the local skill can complete and recover through the existing backend. It prepares concrete external steps; executing deployment or publication still needs separate Owner authorization.

## Local integrated journeys

Add a skill-focused integration test such as `packages/skill/src/session-recovery.integration.test.ts`. Use the real `createHandler`, real `createAgentClient`, and real Hono agent routes with `MemoryDemoDraftStore`, `MemorySessionStore`, and existing deterministic outline generation. Adapt only network IO to `app.request`, using the agent client's fetch injection. Do not replace these owned modules with fake responses. Reuse the route-test setup pattern (`packages/agent/src/demo-draft-route.test.ts:12`) without adding a test-only production API.

The harness transfers each response's session attributes into the next request, uses fresh IDs for distinct turns, reuses an ID only to simulate duplicate delivery, and sends a real command-secret header. It cannot simulate Amazon NLU; phrase-to-intent expectations are a separate matrix.

| ID | Journey | Oracle |
| --- | --- | --- |
| I1 | Start → fallback → fallback → bare mermaids → read draft | Exactly one stored receipt; actual readback matches it; no write on fallback; safe telemetry reconstructs all turns |
| I2 | Start → explicit theme → generator unavailable → valid theme; duplicate successful request | Failure makes no saved claim; retry succeeds; duplicate ID adds no second receipt |
| I3 | Start → cancel → bare theme; reopen → explicit create/theme | No save after cancellation or from stale state; fresh explicit flow completes |
| I4 | Named-listener request, unsupported theme, and unrelated playback text during draft entry | No name in storage/logs/replies; no unintended draft from playback; supported theme can subsequently complete |

Keep existing wish/reaction and playback tests plus the required simulator E2E suite. Do not add a simulator mock that claims to prove Alexa recognition. One implementation unit owns the new integration test and documentation updates; no batch is needed. Review → repair → simplify → full sequential local gate on final candidate.

## Phrase and recovery matrix

Update `docs/alexa-device-manual-test-script.md` with a focused section. Use this matrix as planned input, not a historical transcript. Every positive case must work on its first attempt; deliberately invalid input must disclose recovery and permit the next valid answer without reopening.

1. Open → “let's create a story” → “mermaids” → reopen/read draft.
2. Open → “let's make a story” → “space”.
3. Open → “I would like to create a story” → “about forest”.
4. Open → “I'd like to make a story about animals”.
5. Start creation → deliberately unknown response → another unknown response → “about mermaids”. Record actual intent; if invalid input routes elsewhere, label that scenario's routing rather than assume fallback occurred.
6. Start creation → wait for reprompt → “space”. Reprompt must remain about the theme.
7. Start creation → cancel → reopen → “mermaids”. No automatic draft creation; explicit start can complete afterward.
8. Control: “what is new”, “play all my stories”, “play the story Ignacio the snail”, and “Alexa, pause”. Existing intents and real playback must still work.
9. Shared-flow controls, when fixture state permits: a wish confirmation and a reaction prompt with help/fallback recovery followed by a valid answer. Mark unavailable fixture state NOT RUN.

The agent records observed intent, slot-presence flags, response key, interaction result, candidate identity, elapsed time, and saved receipt/readback. The adult supplies the hardware speech/observation. Do not request operations the agent can perform itself. Record exact planned phrases locally as test cases; do not persist unsolicited raw speech or names in runtime logs.

## Concrete external checklist, after authorization

- Revalidate integration commit, clean tree, all local gates, stack outputs, skill ID, endpoint, en-US locale, and generated-model digest. Resolve installed ASK CLI through the package (`pnpm -F @spoken-letter-alexa/skill exec ask --version`), not the observed global 1.x CLI. Existing deploy preflight already requires 2.x; do not weaken it.
- Use the documented `develop` → `main` release procedure and `pnpm deploy` from the Owner's machine only after the applicable release authorization. Skill metadata publication uses `pnpm -F @spoken-letter-alexa/skill deploy` with separate ASK publication authority. These are existing paths, not new commands/gates.
- Verify build status and fetch the development model from Amazon. Record skill ID, stage, locale, model digest, Lambda code SHA-256/last-modified identity, and endpoint readback for the same candidate. Do not claim a Git SHA matches an AWS bundle without build evidence.
- Run ASK development dialog cases and the adult Echo matrix. Confirm actual `PlaybackStarted` and receipt-backed draft readback. Backend success or a Play directive alone is insufficient device evidence.
- Fetch logs read-only with the same AWS profile and region. Check safe correlation, slot-presence, response keys, interaction result, fallback counter, and absence of logged raw values. A deliberately invalid turn may count as fallback; positive cases may not.
- If any remote action fails, report it, reproduce locally, and finish new gates before requesting any new remote attempt. No automatic republish or deploy loop. No Proactive Events send.

## Acceptance and handoff

Local completion requires I1–I4, phase regression tests, independent review and simplify dispositions, and all five local gates on the exact final inputs. Update `docs/friction-log.md` with measured local results and external status, without overwriting the original September 30 evidence. Integrate accepted local changes into `develop` and preserve the tested identity.

Device completion additionally requires positive phrase cases to recognize correctly without fallback, matching theme reprompt, recovery without reopening, receipt/readback agreement, and unchanged real playback. Report case counts and cold/warm turn durations. The historical 3.098 s launch and 2.85 s listing were single observations; do not advertise a new p95 or latency improvement from this small rehearsal. A device failure remains a finding with a local fix or explicit disposition.

Until deployment is authorized and the matrix is observed, report `local_verified=true`, `amazon_routing=UNVERIFIED`, and `echo_acceptance=UNVERIFIED` only when the respective local work has actually passed. No placeholder success values. Record actual candidate/merge identities, authorization, observations, deviations, unresolved cases, and next action in the notes.
