# Phase 6: Jordan's script, rehearsal and release

**Entry.**
- Phase 5 is accepted.
- Jordan's demo script has been received and saved as `docs/plans/2026-10-08-alexa-staged-demo-flow-script.md`, tracked, with fictional names only.
- Revalidate `develop`, the fixtures and the notes. Work in a worktree off `develop`.

**Outcome.** Every spoken line, name, number and carrier phrase in the skill matches her script. A full local rehearsal passes. The frozen script has real-app takes. After the gated deploys, the device run under Alexa+ is accepted for filming.

## Implementation

1. **Align data, not code:**
   - `fixtures/demo-family.json`: families, listeners, credits and script words, all from her script.
   - `create-messages.ts` copy.
   - Carrier phrases for each of her lines in the conversation, feedback and listener steps.
   - Any step her script drops is skipped through the fixture or catalog only, with no code removal.
   - Each step her script adds beyond the plan's eight is listed in the notes and needs the Owner's decision before work.
2. **Rehearsal test:** `packages/skill/src/demo-rehearsal.integration.test.ts` runs her lines verbatim through the real handler, client and routes, with `ScriptedModel` and memory stores. It asserts each Alexa reply against her expected wording, using the oracle style of `spanish-rehearsal.integration.test.ts`.
3. **Freeze and produce audio:**
   1. Run one local rehearsal against real Bedrock with her lines, so the script is cached (D6).
   2. Print the frozen script with `pnpm -F @spoken-letter-alexa/agent demo:script`. This phase adds that new script, `packages/agent/scripts/demo-script.ts`: it reads the latest creation record for a device key with one read-only DynamoDB GetItem (profile `archy`) when deployed, or from memory locally, and prints the title and script without names.
   3. Jordan reads it in the real Spoken Letter app with effects and music.
   4. After each enhancement setting (as is, effects, music, both), pull the current final mix with `scripts/pull-fixture-story.mjs <storyDocId> --as-take <frozen-script-file> --variant <name>`. The story keeps one current mix, so there are four pulls in sequence. If the app can't return to "as is" after mixing, pull `plain` first.
   5. `--as-take` converts and registers each pull through `scripts/add-demo-take.mjs`; J3 confirms all four variants are present.
4. **Deploy order** (SS10): API, then simulator assets, then the skill Lambda, then the ASK model. Each deploy needs separate Owner authorization.

## Behavioral oracles

| ID | Case | Required result |
| --- | --- | --- |
| J1 | Her script, start to finish, offline | Every reply matches; no fallback; stage `sent` |
| J2 | Her lines with ASR-style variation (lower case, missing punctuation) | The same cache key and the same script (normalization) |
| J3 | Takes manifest | The frozen script's normalized text has all four variants |
| J4 | Full local gate | Passes |

## Device acceptance (Owner and Jordan, after the deploys)

- [ ] A1. A full run of her script on the Echo Show 5 under Alexa+. Record per step: reply wording, screen, timing, and whether Lambda logs show the expected intent.
- [ ] A2. Two consecutive runs give the same on-screen script (cache hit in logs).
- [ ] A3. The take and each sound variant play cleanly; "Alexa, the end" or "Done" lands within the measured window.
- [ ] A4. Playback of the stories from Phase 2 and the original stories still shows the card as before.
- [ ] A5. Reset between takes: a "start over" or a new creation leaves no stale stage.

## Exit

The local acceptance (J1–J4), then the gated deploys, then device acceptance. Record the deploy outputs and the device results in the notes. Filming starts after A1–A5 pass.
