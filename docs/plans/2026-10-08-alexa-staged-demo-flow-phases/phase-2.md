# Phase 2: more storytellers (independent track)

**Entry.**
- The plan is accepted.
- The Owner has chosen 3–5 delivered stories from 2–3 storytellers other than Aunt Whitney, using the script's `--list` output.
- For each story the Owner confirms: (a) the storyteller agrees to publication in this public MIT repository; (b) no real child's name is spoken in the audio or appears in the title; (c) the storyteller display name to use.
- `gcloud` is authenticated for project `spoken-letter`. This was used on 2026-09-29 to pull the artwork with `gcloud storage cp` from `gs://spoken-letter-media/spaces/<space>/stories/<doc>/`, and story metadata through the Firestore REST `runQuery`.
- Revalidate `develop`, `fixtures/README.md` and the private story schema (`../spoken-letter/src/lib/schema/stories.ts`, read-only), where `status` is `:334`, `finalMixRef` and `mixStatus` are `:410-416`, `iconRef` is `:432` and `downloadedAt` is `:439`.
- Work in a worktree off `develop`.

This phase can run before, between or after Phases 1 and 3–5. It touches fixtures, the simulator mock and the generated models. Generated files are reconciled by regenerating, never by hand-merging.

## Implementation

1. **New `scripts/pull-fixture-story.mjs`.** It pulls a delivered story straight from production with read-only calls under the Owner's `gcloud` credentials. This replaces the manual export in `fixtures/README.md:40-63`.
   - **`--list`:** a Firestore REST `runQuery` on `stories` where `status == "downloaded"`. It selects only `title`, `downloadedAt` and `finalMixDurationSeconds`, and prints the document id, title, date and duration, so the Owner can choose.
   - **`<storyDocId> --storyteller "<display name>" [--id st_<slug>]`:**
     1. GET the story document with a field mask of `title`, `status`, `finalMixRef`, `mixStatus`, `iconRef`, `downloadedAt` and `spaceId`. The mask never includes recipient, sender or content fields (the ADR 0013 boundary).
     2. Refuse unless `status == "downloaded"`, `mixStatus == "ready"` and `finalMixRef` is set. That is the product's delivered, current rendition (`stories.ts:404-416`).
     3. `gcloud storage cp` the final mix to `fixtures/audio/<id>.mp3`, and the `iconRef` object to a temp file. Render the art with the README's `magick` recipe to `fixtures/art/<id>.png`.
     4. Register the story through `add-fixture-story.mjs`'s logic, exported as a function. The duration comes from `ffprobe`, and `deliveredAt` from `downloadedAt`.
     5. Print only the title and id, so the Owner can do the no-child-name check.
   - **`--as-take <script-file> --variant <plain|effects|music|both>`:** pulls the same final mix into `fixtures/takes/` through Phase 1's `add-demo-take.mjs` conversion (used in Phase 6).
   - Document it in `fixtures/README.md`, replacing the manual export steps.
2. Pull each chosen story with the script.
3. Regenerate both models with `pnpm -F @spoken-letter-alexa/skill generate`. `StorytellerName` gains the new names with kinship synonyms (`packages/skill/src/model/generate.ts:263-276`), and the manifest's example phrases regenerate.
4. Simulator: add the new MP3 and PNG imports next to the three in `packages/simulator/src/agent/mock.ts:5-10` and `:20-24`.
5. Update the tests that pin the old catalog's order to the real newest and first stories:
   - `packages/simulator/src/agent/mock-journeys.test.ts:40`
   - `packages/simulator/e2e/journeys.spec.ts:51-52`
   - and, if the first story changes, `mock-journeys.test.ts:20-26`, `e2e/smoke.spec.ts:19-21` and `transport.test.ts:55-58`
6. Update `docs/friction-log.md:489` (the catalog no longer holds only Aunt Whitney) and the device test script's fixture list (`docs/alexa-device-manual-test-script.md`, step 2).

## Behavioral oracles

| ID | Case | Required result |
| --- | --- | --- |
| S1 | Catalog parse | Every entry passes `packages/mcp-server/src/provider/fixtures.ts:7-26`; `file` = `<id>.mp3`; art, if any, = `<id>.png` |
| S2 | Generator | `StorytellerName` lists every distinct storyteller in both locales; drift tests pass after regeneration |
| S3 | Playback | A handler test plays one new story by title and one by "play my stories from <storyteller>", and the card subtitle names that storyteller |
| S4 | Simulator | Offline E2E smoke and journeys pass with the updated expectations |
| S5 | `pull-fixture-story.mjs` with a fake runner (fetch and command stubs) | The field mask contains exactly the listed fields; a story not `downloaded`, or with `mixStatus` not `ready`, is refused with a reason; the `gs://` source is built from `finalMixRef`; `--list` output has no recipient or sender data |

## Owner-gated deploys

These run separately, or together with another phase's deploys:
- the CDK deploy of `SpokenLetterAlexaSimulator` (uploads the audio and art) and of the API stack (the bundled catalog, `infra/scripts/bundle-lambda.mjs:61-64`)
- the ASK deploy for the `StorytellerName` values

Device check: "play my stories from <new storyteller>" plays with the right card.

## Batch eligibility

One unit with one owner, because every step shares the catalog. It is `[batch-eligible]` against Phases 1 and 3–5, apart from the generated model files, which are regenerated at integration.

## Exit

Review, simplify and the full local gate. Record the consent and child-name confirmations (yes or no per story, no names) in the notes.
