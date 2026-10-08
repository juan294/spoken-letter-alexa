# Phase 1: device spike — screens, recording window and take playback

**Entry.** The Owner accepts the plan and authorizes Phase 1. Revalidate `develop`, `packages/skill/src/handler.ts`, `audio.ts` and `model/generate.ts` against the plan's citations. Work in a worktree off `develop`.

**What this phase builds.** The recording mechanics as production code that Phase 5 reuses. The creation flow doesn't exist yet, so this phase reaches recording through a standalone path: "record story" with no creation record uses a spike script from the takes manifest.

## Implementation

1. **Envelope and directives.**
   - Extend `AlexaRequestEnvelope` (`handler.ts:16-41`) with `context.System.device?.supportedInterfaces` and the `Alexa.Presentation.APL.UserEvent` request (`arguments`, `source`).
   - Widen the response `directives` union with `Alexa.Presentation.APL.RenderDocument` and `Alexa.Presentation.APL.ExecuteCommands`.
   - Add `supportsApl(event)`.
2. **APL documents** in `packages/skill/src/apl/`:
   - `teleprompter.json`: a title, a large-type `ScrollView` of the script, a countdown overlay, a recording indicator, and a "Done" `TouchWrapper` that sends `SendEvent ["done"]`.
   - `recording.ts`: builds the datasource. It also builds the command sequence: the countdown 3, 2, 1 (`SetValue` with `delay` steps), then repeated `Scroll` steps of a fraction of a page with delays, sized from the script length so the scroll ends at about the D8 read time.
   - Viewport target: hub landscape small (960x480) and up.
3. **Takes fixture.** Add `fixtures/takes/manifest.json` and its parser `parseTakesManifest` in `packages/shared`:
   - Each entry has `script` (text), `files` (`plain`, `effects`, `music`, `both`; MP3 file names) and an optional `spike: true`.
   - Add `scripts/add-demo-take.mjs`: it converts any MP3 to the SSML audio format (48 kbps, 24 kHz, mono) with `ffmpeg`, writes it to `fixtures/takes/`, and registers it under the given script text.
   - For the spike, register a 20-second slice of `fixtures/audio/st_ignacio_the_snail.mp3` with the script text of that passage, written out by the Owner or typed from the audio, as the `spike` entry for all four variants.
   - Add the `/fixtures/takes/*` route to `packages/app/src/local.ts:19`.
4. **Intents** (en-US only, D13):
   - `RecordStoryIntent`: "record story", "record my story", "start recording", "i'm ready to record".
   - `TheEndIntent`: "the end", "that's the end", "stop recording", "i'm done reading".
   - Add both to an en-US-only intent list. Add an explicit `RECORDING_SAMPLES` exemption for the `record` fragment in `generate.test.ts:153-172`, alongside the handoff and credit-help sets (D2).
5. **Handler** (new module `packages/skill/src/recording.ts`, called from `respond()`):
   - **`RecordStoryIntent`:** render the teleprompter and run the countdown and scroll. Speak a short cue: "Get ready. Three, two, one." The countdown is visual and the cue is timed to it. Return with `shouldEndSession` undefined, so the session stays open with the mic closed.
   - **`TheEndIntent` or `UserEvent` "done":** confirm "Got it. Here's your recording." Play the take through SSML `<audio src>`, then ask "Record again, or continue?" with a reprompt.
   - **"Record again":** rerun `RecordStoryIntent`. **"Continue"** in the spike: "Great." The session ends.
6. **Manifest:** add `{"type": "ALEXA_PRESENTATION_APL"}` to `skill.json:63-67`, keeping `AUDIO_PLAYER`.

```text
@ startRecording(event, script) -> AlexaResponse
ctx: APL documents, takes manifest
pre: script text known (spike entry in this phase)
do:
  1. compute scroll steps from script word count and D8 read time
  2. emit RenderDocument(teleprompter) + ExecuteCommands(countdown, scroll)
  3. emit cue speech; leave shouldEndSession undefined
br: no APL support -> speak the script, then "say 'Alexa, the end' when you finish" (SS1)
risk: Alexa+ may ignore shouldEndSession undefined; the device check measures it
```

## Behavioral oracles

Write failing tests first.

| ID | Case | Required result |
| --- | --- | --- |
| R1 | `RecordStoryIntent` with APL support | One `RenderDocument` with the teleprompter token; `ExecuteCommands` whose countdown precedes the scroll; `shouldEndSession` absent; the speech contains no banned words (`handler.test.ts:36-40`) |
| R2 | The same without `supportedInterfaces` | No APL directive; the speech contains the script and the "Alexa, the end" cue (SS1) |
| R3 | `TheEndIntent`, then a `UserEvent` with `arguments ["done"]` | Both give an SSML `<audio>` whose `src` is the CloudFront URL of the matched take, plus the "Record again, or continue?" reprompt |
| R4 | `playDirective` for each existing fixture story | Output byte-identical to `develop` (snapshot taken before changes) |
| R5 | Generator | The en-US model contains `RecordStoryIntent` and `TheEndIntent`; the es-ES model is byte-identical to `develop`; the denylist test passes with only the named exemption |
| R6 | `parseTakesManifest` | Rejects unknown keys, non-`.mp3` names and a missing variant; normalizes script text (case, whitespace, punctuation) for matching |
| R7 | `add-demo-take.mjs` | The produced file probes as MP3, 48 kbps, 24000 Hz (an `ffprobe` assertion in a script test, skipped with a printed reason when `ffmpeg` is missing) |

## Owner-gated deploys and device check

Each step needs separate authorization:
- `pnpm build`
- the CDK deploy of `SpokenLetterAlexaSkill` (Lambda) and `SpokenLetterAlexaSimulator` (uploads `fixtures/takes/`)
- `pnpm -F @spoken-letter-alexa/skill deploy` (manifest and model)

Then on the Echo Show 5 under Alexa+, record the result of each item in the notes:

- [ ] D1. "Alexa, open Spoken Letter", then "record story". Does the teleprompter render, the countdown show, and the script scroll smoothly?
- [ ] D2. Read for 20 seconds, then say "Alexa, the end". Does it reach the skill (Lambda log `TheEndIntent`)? Repeat at about 30 and about 40 seconds and record when it stops reaching the skill.
- [ ] D3. Does the take play through SSML audio at acceptable quality, and does the "record again" reprompt keep the mic open?
- [ ] D4. Does tapping "Done" work instead of D2, and until how long?
- [ ] D5. How long does the teleprompter stay on screen after the session ends?

**Decision at exit**, recorded in the notes:
- If D2 holds to about 30 seconds, keep D8's 70-word default.
- If not, shorten the default to fit what was measured, and make the "Done" button primary if D4 works where D2 doesn't.
- If APL doesn't render under Alexa+, Phase 5 stages the screen in the edit and keeps the voice-only path.

## Batch eligibility

- Unit A `[batch-eligible]`: step 3 (`packages/shared` parser, `scripts/add-demo-take.mjs`, `fixtures/takes/`, `local.ts`).
- Unit B: steps 1, 2, 4, 5 and 6 (skill and generator), with one owner. It uses Unit A's parser export once that export is merged.

## Exit

Independent review, repair, simplify and the full local gate. Then the gated deploys and the device checklist, followed by the exit decision. Record evidence and deviations in the notes.
