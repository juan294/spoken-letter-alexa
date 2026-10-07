# Spanish (es-ES) version of the Alexa skill

Planned 2026-10-07 on `develop` at `7b19135407fad93dfde70db608c210ae0e1ceb91` in `/Users/juan/code/spoken-letter-alexa`. The Owner requested a full Spanish version after the October 7 probe. This document specifies local implementation, then deployment and device acceptance as separate Owner gates. It does not authorize implementation, push, ASK publication, CDK deployment, notification sends or private-app changes.

## Goal

An adult with an Echo set to Spanish (Spain) on an Alexa+ account can use every current skill journey in Spanish: open the skill, hear what is new, play stories and the playlist, control playback, start a draft and pick a theme, read the draft back, save a wish or a reaction, hear updates, and get help or an app handoff. Every reply is in Spanish. The en-US skill keeps its current behavior and wording exactly. The English demo path (Alexa+ in English, case 65226985) is unaffected and continues separately.

## Evidence and limits

- The October 7 probe proved routing. A minimal es-ES locale on branch `probe/es-es-locale` (`b13c7bc`) reached `sla-alexa-skill` under Alexa+ with the Echo in Spanish: `LaunchRequest` at 07:25:31 and 07:26:30 UTC, and `WhatIsNewIntent` at 07:26:45 and 07:27:19 UTC. See `docs/research/2026-10-02-alexa-invocation-failure.md` (October 7 sections).
- English Alexa+ fails on this Spain-based account for every request, including built-ins. A Spanish version is the only Alexa+ device path available today. It does not replace the English path.
- The handler holds about 50 English reply constants and inline replies (`packages/skill/src/handler.ts:67-87`, `:132-148`, `:353-567`). It also has English-only text matching: `safeDemoTopic` (`:94-104`), catch-all routing (`:525-586`), `catchAllTitle` (`:195-202`), reaction choice (`:510-512`) and storyteller aliases built from the en-US model (`:88-91`).
- The generator is English-only. It has one `MODEL_PATH` (`packages/skill/src/model/generate.ts:18`), an `a-z` utterance alphabet (`:171-185`), English child words (`:168`), English sample tables (`:47-339`) and English slot values (`:349-361`). The shared denylist fragments are English (`packages/shared/src/contract/agent-tools.ts:19-30`).
- Backend speech has no language control. Request schemas carry no locale (`packages/agent/src/routes.ts:42-64`). The agent persona is English (`packages/agent/src/persona.ts:2-16`), and the turn route never sets `systemPrompt` (`routes.ts:365-366`, `turn.ts:18`, `turn.ts:118`). Playlist replies are English (`packages/agent/src/playlist.ts:153-256`). Update details are English constants re-rendered by `publicEvent` (`demo-updates.ts:11-12`, `:130-142`). The draft outline is an English template (`demo-drafts.ts:125-127`), and `canonicalTheme` is English-only (`demo-drafts.ts:96-108`).
- Other en-US pins: proactive events (`packages/skill/src/proactive-events.ts:19`), the AudioPlayer subtitle "read by" (`packages/skill/src/audio.ts:107`), and progressive filler (`handler.ts:147-149`).
- Fixture stories and audio are English (`fixtures/stories.json`, `fixtures/README.md:3-5`). Titles stay as they are.
- Backend tracing used a read-only search assignment whose report is summarized above. The citations used here were spot-checked against source on `7b19135`. The `graphify_local` server failed to connect in this session, so structure came from direct reads and `grep`.

## Decisions

| Decision | Selected | Alternative and trade-off |
| --- | --- | --- |
| D1: depth (Owner, 2026-10-07) | End to end. The skill sends the request locale to the API, backend replies have Spanish versions, and the agent is told to answer in Spanish. | Skill-only is cheaper but mixes languages in most replies. |
| D2: names (Owner, 2026-10-07) | Storyteller names are spoken as the catalog has them. The es-ES `StorytellerName` type adds Spanish kinship synonyms ("tía Whitney") and the bare name. | Translating kinship words when speaking is more natural for the fixtures but risks mangling real names. |
| D3: locale resolution | One shared `SkillLocale = "en-US" \| "es-ES"`. `resolveLocale(locale)` returns `es-ES` for any `es-*`, otherwise `en-US`. | Per-call string checks would scatter the rule. |
| D4: canonical slot values | es-ES custom slot types keep the English canonical values (`mermaids`, `like`, `Aunt Whitney`) with Spanish synonyms. The handler reads Alexa entity resolution (`ER_SUCCESS_MATCH`) for custom types and falls back to the raw value. | Spanish canonical values would widen backend enums and contracts. |
| D5: message catalogs | `packages/skill/src/messages.ts` and `packages/agent/src/messages.ts`, typed `Record<SkillLocale, Messages>`, so a missing Spanish key fails `tsc`. English values move verbatim. | Inline ternaries would hide missing translations. |
| D6: transport | Optional `locale` (`z.enum(["en-US","es-ES"])`, default `en-US`) on the session-open, playlist, demo next/inbox/draft and wish bodies. The session record stores the locale. Turns use it for the persona language line and the fallback reply. | A header-based locale is less visible in schemas and tests. |
| D7: draft outline | Rendered at save time in the request locale and stored as today. Readback returns the stored text. | Storing choices and rendering on read changes the receipt format for a 2-hour record. |
| D8: generator | `generateInteractionModel({ locale, training, stories })` with per-locale sample tables, alphabet (Spanish adds `ñáéíóúü`), child words and denylist fragments. Both models are committed and drift-checked. en-US output stays byte-identical. Invocation name `spoken letter` in both. | A hand-written es-ES model, like the probe, would drift. |
| D9: copy | Spain Spanish, `tú` register, brief, same meaning as the English line, no implementation terms. The Owner reviews every Spanish string in the Phase 1 and Phase 3 diffs. | — |
| D10: notifications | Proactive `localizedAttributes` carry both `en-US` and `es-ES`. | — |

## Scope and invariants

- Out of scope: the simulator (stays en-US, including Transcribe and Polly), story titles and audio, MCP tool summaries (LLM-facing only), the private repository and the English Alexa+ path.
- en-US is unchanged. The existing en-US model drift test and every existing handler and backend English assertion pass unmodified, except mechanical signature updates recorded in the notes.
- Child safety: no child account, voice or data. Only `downloaded` stories are exposed. Spanish samples pass a Spanish child-word filter (`niño`, `niña`, `niños`, `niñas`, `hijo`, `hija`, `hijos`, `hijas`, `nieto`, `nieta`, `nietos`, `nietas`, `crío`, `cría`, `peque`) and Spanish denylist fragments (`enviar`, `descargar`, `comprar`, `crédito`, `pagar`, `destinatario`, `borrar`, `eliminar`, `quitar`, `admin`). Logs keep slot presence only. Raw speech and names are never logged.
- Keep the three MCP tools, agent route response schemas, receipt validation, idempotency, the 7-second client budget, the 8-second Lambda timeout and the single CI workflow. No new AWS service.
- The probe branch `probe/es-es-locale` is superseded. Phase 2 replaces its hand-written model. The branch is deleted locally after Phase 2 acceptance. The probe test file is not carried over.

## Phase sequence

| Phase | Outcome | Boundary |
| --- | --- | --- |
| [1: skill locale and Spanish replies](2026-10-07-alexa-skill-spanish-locale-phases/phase-1.md) | The handler replies in Spanish for es-ES requests, matches Spanish phrases and reads canonical slot values; en-US is unchanged | Review, simplify, full local gate, Owner copy review and acceptance |
| [2: es-ES interaction model](2026-10-07-alexa-skill-spanish-locale-phases/phase-2.md) | Generated, drift-checked es-ES model and manifest locale with Spanish safety filters | Review, simplify, full local gate, Owner acceptance |
| [3: backend localization](2026-10-07-alexa-skill-spanish-locale-phases/phase-3.md) | Locale reaches the API; playlist, updates, drafts and agent replies are Spanish for es-ES | Review, simplify, full local gate, Owner copy review and acceptance |
| [4: rehearsal and release](2026-10-07-alexa-skill-spanish-locale-phases/phase-4.md) | Local Spanish journeys through the real handler, client and routes; then the gated deploys and an Echo test in Spanish | Local acceptance first; each deploy and device step needs separate Owner authorization |

Implementation starts in a local worktree off the revalidated `develop`. Each phase follows red tests, implementation, independent review, repair, simplify and verification. One integration owner merges accepted work into `develop` locally. Phases run sequentially, and this request grants no continuation across phases. Each phase runs `python3 .rpi/scripts/rpi-verify.py` sequentially (typecheck, lint, unit tests, CDK synth, offline simulator E2E). Changed inputs invalidate earlier evidence. No tests have run for these planning-only artifacts.

## Consumer sweep

Commands run on `7b19135` (with `--exclude-dir=node_modules`, and generated `infra/cdk.out` and `infra/dist` bundles excluded):

- `grep -rln -e '/agent/session' -e '/agent/turn' -e '/agent/playlist' -e '/agent/demo' packages infra`
- `grep -rn canonicalTheme packages`
- `grep -rn -e 'publicEvent(' -e 'outlineFor(' packages`
- `grep -rn 'en-US.json' packages infra`
- `grep -rn -e utteranceAllowed -e normaliseUtterance -e CLASS_C_DENYLIST packages`
- `grep -rln AgentClient packages`

| Consumer | Disposition |
| --- | --- |
| `packages/skill/src/agent-client.ts`, `agent-client.test.ts` | Phase 3: send `locale` on the bodies in D6 |
| `packages/skill/src/handler.ts`, `handler.test.ts`, `lambda.ts`, `lambda.test.ts`, `index.ts` | Phase 1 (catalog, resolution, locale), Phase 3 (passes locale to the client) |
| `packages/skill/src/session-recovery.integration.test.ts` | Phase 3 adds the locale field to its in-process requests; Phase 4 adds es-ES journeys. Its English regexes stay unchanged. |
| `packages/agent/src/routes.ts`, `routes.test.ts`, `demo-draft-route.test.ts`, `demo-update-route.test.ts`, `playlist-route.test.ts` | Phase 3: optional locale, defaults proven by existing tests |
| `packages/agent/src/demo-updates.ts` (`publicEvent` :130, callers :223, :288; `canonicalTheme` :263) | Phase 3: locale-aware detail and Spanish theme matching |
| `packages/agent/src/demo-drafts.ts` (`canonicalTheme` :96, :164; `outlineFor` :125, :168), `packages/agent/src/index.ts` | Phase 3: Spanish patterns and locale-rendered outline; export unchanged |
| `packages/agent/scripts/measure-cache-prefix.ts` | Excluded: a measurement script that uses the default locale |
| `packages/app/src/bootstrap.test.ts` | Phase 3: must pass unchanged (default locale) |
| `packages/simulator/src/agent/http.ts`, `transport.test.ts`, `App.test.tsx` | Excluded: the simulator stays en-US and the field is optional; Phase 3 proves an omitted locale is accepted |
| `packages/skill/src/model/generate.ts`, `generate-cli.ts`, `generate.test.ts` | Phase 2 |
| `packages/skill/scripts/deploy.mjs` | Phase 2: check both model files and both locales' icons |
| `packages/skill/scripts/record-pull.mjs` (`training/en-US.jsonl`) | Excluded: training stays en-US; es-ES has no training file in this plan |
| `packages/shared/src/contract/agent-tools.ts` (`CLASS_C_DENYLIST`) | Unchanged. Spanish fragments live in the generator's per-locale table (Phase 2) because the shared list governs tool metadata. |
| `packages/skill/src/proactive-events.ts`, `proactive-events.test.ts` | Phase 1 (D10) |

## Stuck states and recovery

| State | Who sees what | How it ends | Proving test |
| --- | --- | --- | --- |
| SS1: missing or unsupported request locale (`fr-FR`, absent) | The adult hears English replies | Automatic: `resolveLocale` returns `en-US` | Phase 1: `resolveLocale` table test, plus a handler request without a locale replying in English |
| SS2: Spanish phrase not matched (`AMAZON.FallbackIntent`) | Spanish recovery guidance; the second fallback gives an exact Spanish example and says cancel works | The adult follows the example or cancels; the counter resets on progress | Phase 1: es-ES versions of the existing fallback journeys |
| SS3: Spanish slot not resolved (`ER_SUCCESS_NO_MATCH`) | The raw value goes to the backend; an unknown theme gets the Spanish "try mermaids or space" prompt | The next valid theme saves the draft | Phase 1 (handler) and Phase 3 (`canonicalTheme` Spanish table, `unsupported_theme` path) |
| SS4: the skill sends `locale` to an API that predates Phase 3 | Backend lines stay English inside Spanish sessions | Phase 4 deploy order: API before skill. The older API's `z.object` strips the unknown key, so nothing fails. | Phase 3: a route test proves an extra or omitted `locale` is accepted; the Phase 4 checklist states the order |
| SS5: the LLM answers in English despite the instruction | A mixed-language reply for that turn | The language line is part of every es-ES turn's system prompt, so the next turn is instructed again | Phase 3: the turn route passes a Spanish-instructed prompt on every es-ES turn, including after a locale switch. Phase 4 device acceptance records language per reply. |
| SS6: the device changes language inside the 2-hour session TTL | Replies follow the stored locale until the next session open | Each session open stores the request locale | Phase 3: reopen with a new locale replaces the stored one |
| SS7: a draft saved in English is read in a Spanish session | The adult hears the stored English outline | The 2-hour receipt TTL, or a new draft | Phase 3: readback returns the stored outline without error |
| SS8: the committed es-ES model drifts from the generator | CI fails with a message naming `pnpm -F @spoken-letter-alexa/skill generate` | Regenerate and commit | Phase 2: drift test for both locales |
| SS9: Amazon's model build rejects the es-ES model | `ask deploy` prints Amazon's error and the deploy script exits non-zero | Fix the model and redeploy (shown in the output) | Phase 2: local validators (slots declared, alphabet, carrier collision) run on both locales before deploy |
| SS10: a proactive event is missing the es-ES attributes | Amazon rejects the event | — | Phase 1: payload test asserts both locales |

## Acceptance

Automated, every phase: the full local gate passes. Phase-specific tests are listed in each phase file. en-US output is proven unchanged by the existing suite running unmodified, plus a byte-identical en-US model drift check.

Manual: the Owner reviews and accepts the Spanish copy (Phases 1 and 3). Phase 4 device acceptance in Spanish under Alexa+ is listed in its phase file. Deploys are Owner gates.

## Risks

- Amazon's Spanish NLU may route differently from English for similar samples. Phase 4 covers this on a device; the local checks cannot.
- English Alexa+ may be restored, or a US account may be set up, at any time. Nothing in this plan depends on either.
- The fixture titles are English inside Spanish sentences. This is accepted because titles are content.

## Handoff

- Objective and scope: as above. Owner decisions D1, D2 and the 4-phase split were given 2026-10-07. No implementation is authorized yet.
- Base: `develop` `7b19135`. Probe evidence is on `probe/es-es-locale` `b13c7bc` in `/Users/juan/code/spoken-letter-alexa-es-probe` (development stage currently has the probe es-ES model).
- Next: Owner accepts this plan and authorizes Phase 1. On entry, revalidate `develop`, the citations above and the probe worktree state.
