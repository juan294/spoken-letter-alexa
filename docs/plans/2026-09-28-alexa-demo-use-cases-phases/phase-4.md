# Phase 4: demo rehearsal and evidence

Entry: Phases 1–3 accepted on `develop`, with exact local commit, ASK development skill version, CDK deployment identity, fixture catalogue, and device opt-in state recorded. This phase closes the complete use-case matrix before recording final footage. It does not change the private repository or convert a demo receipt into a real delivery.

## Demo matrix

| Source-list category | Required parent-operated scene | Proof |
| --- | --- | --- |
| Entire playlist and controls | Play all, skip, previous, restart current, repeat, and let one track enqueue the next. | Two distinct story IDs, correct order/offset/token, and the device actually plays both streams. |
| Creator, title, new stories | Select a fixture adult storyteller, a title, then newest-first. | Spoken response and actual played IDs match `fixtures/stories.json:1-31`. |
| Creation | Ask for a bedtime draft, supply a theme, then ask to send to a fictional listener alias that is not a stored Recipient. | Read back one saved **demo draft**; device states that recipient selection and delivery happen in the private app. No alias appears in repository logs or store. |
| New-story, wish, reaction updates | Hear an in-skill fixture update; finish a story, reopen the skill, choose like/love; submit a topic wish and optional adult creator. | Demo event, reaction, and wish receipts exist once; spoken copy says demo state, not creator delivery. |
| Device notification | Owner opts in, receives one generic development-stage Alexa notification, then opens the skill for fixture detail. | Amazon API receipt, device observation, and matching in-skill event ID. |
| Family occasion | Hear a synthetic birthday prompt and begin a draft. | Event is fixture-marked; no person or birth date leaves the repo. |
| Help and credits | Ask how to create, how to add credits, and directly request credits. | Accurate app handoff; no purchase or entitlement write. |

## Execution and evidence

- Generate the model from `packages/skill/src/model/generate.ts:270-295`, confirm byte-for-byte drift tests, and inspect the skill manifest's exact development-stage diff before any separately authorized `ask deploy`. Run ASK validation against the published development skill after that separate authorization. The model's invocation name and generated intent set remain in one source (`packages/skill/src/model/generate.ts:23`, `packages/skill/src/model/generate.ts:270-295`).
- Run `python3 .rpi/scripts/rpi-verify.py` sequentially at the final candidate (`.rpi/policy.json:7-42`). Add simulator E2E cases for the whole script using the in-app mock; do not substitute a mocked Alexa callback for the Owner-device playback and notification observations. Run relevant ASK model tests and CDK synth inside the same gate.
- Inspect `scripts/add-fixture-story.mjs`, fixture catalogue, test-support fixtures, generator, manifest examples, simulator mock, and E2E script for story ID and title drift (`packages/skill/src/model/generate.ts:17-21`, `packages/skill/src/model/generate.ts:260-295`; `packages/skill/src/model/generate.test.ts:173-176`). Recompute any sample utterance and art URLs from the committed fixture set.
- Record date, commit, skill ID/version, AWS stack outputs, device model/locale, exact utterance, Alexa intent/slots, response, playback token transition, notification receipt, and observed result for each scene in `docs/friction-log.md` and the phase handoff. Redact tokens, secrets, raw Alexa user IDs, and child names. Mark unsupported or unmeasured paths directly.
- Review the final local diff independently for plan compliance, repair findings, run the simplify pass, then rerun all invalidated checks. Complete all four phase gates before proposing a push or deployment. The existing one-workflow and one-deploy-command topology stays intact (`.github/workflows/verify.yml:1-31`; `package.json:12-23`).

## Acceptance and final handoff

Automated acceptance: every required check passes on the exact final commit, generated model and manifest examples match their source, fixture state is deterministic, and the simulator E2E script covers each category with assertions that fail if a real delivery or payment is falsely claimed. Manual acceptance: the parent-operated Echo rehearsal proves actual audio progression and a development notification; all fixture writes are read back and clearly identified as such. A green local gate alone does not establish device behavior.

Record any deviation and its disposition, the exact tested identity, local versus deployed evidence, unresolved vendor limitation, and the separate approval needed for push, ASK publication, CDK deploy, Proactive Events send, or final video submission. A real-account version is a distinct plan in the private repository after the freeze; this plan grants no cross-repo implementation authority.
