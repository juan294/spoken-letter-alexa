# Phase 2: more storytellers (independent track)

**Entry.**
- The plan is accepted.
- The Owner has exported 3–5 delivered stories from 2–3 storytellers other than Aunt Whitney, as MP3s, and artwork where available.
- For each story the Owner confirms: (a) the storyteller agrees to publication in this public MIT repository; (b) no real child's name is spoken in the audio or appears in the title; (c) the storyteller display name to use.
- Revalidate `develop` and `fixtures/README.md`. Work in a worktree off `develop`.

This phase can run before, between or after Phases 1 and 3–5. It touches fixtures, the simulator mock and the generated models. Generated files are reconciled by regenerating, never by hand-merging.

## Implementation

1. Add each story with `scripts/add-fixture-story.mjs` (`fixtures/README.md:40-63`), using its real delivery time. Add artwork through the README's `magick` recipe when the story has an icon.
2. Regenerate both models with `pnpm -F @spoken-letter-alexa/skill generate`. `StorytellerName` gains the new names with kinship synonyms (`packages/skill/src/model/generate.ts:263-276`), and the manifest's example phrases regenerate.
3. Simulator: add the new MP3 and PNG imports next to the three in `packages/simulator/src/agent/mock.ts:5-10` and `:20-24`.
4. Update the tests that pin the old catalog's order to the real newest and first stories:
   - `packages/simulator/src/agent/mock-journeys.test.ts:40`
   - `packages/simulator/e2e/journeys.spec.ts:51-52`
   - and, if the first story changes, `mock-journeys.test.ts:20-26`, `e2e/smoke.spec.ts:19-21` and `transport.test.ts:55-58`
5. Update `docs/friction-log.md:489` (the catalog no longer holds only Aunt Whitney) and the device test script's fixture list (`docs/alexa-device-manual-test-script.md`, step 2).

## Behavioral oracles

| ID | Case | Required result |
| --- | --- | --- |
| S1 | Catalog parse | Every entry passes `packages/mcp-server/src/provider/fixtures.ts:7-26`; `file` = `<id>.mp3`; art, if any, = `<id>.png` |
| S2 | Generator | `StorytellerName` lists every distinct storyteller in both locales; drift tests pass after regeneration |
| S3 | Playback | A handler test plays one new story by title and one by "play my stories from <storyteller>", and the card subtitle names that storyteller |
| S4 | Simulator | Offline E2E smoke and journeys pass with the updated expectations |

## Owner-gated deploys

These run separately, or together with another phase's deploys:
- the CDK deploy of `SpokenLetterAlexaSimulator` (uploads the audio and art) and of the API stack (the bundled catalog, `infra/scripts/bundle-lambda.mjs:61-64`)
- the ASK deploy for the `StorytellerName` values

Device check: "play my stories from <new storyteller>" plays with the right card.

## Batch eligibility

One unit with one owner, because every step shares the catalog. It is `[batch-eligible]` against Phases 1 and 3–5, apart from the generated model files, which are regenerated at integration.

## Exit

Review, simplify and the full local gate. Record the consent and child-name confirmations (yes or no per story, no names) in the notes.
