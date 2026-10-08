# Staged demo flow: implementation notes

## Planning handoff (2026-10-08)

**Objective:** the plan at `docs/plans/2026-10-08-alexa-staged-demo-flow.md`.

**Scope:**
- Owner decisions D1–D4 were given in session on 2026-10-08: English only, staged on the skill with disclosure, takes and mixes from the real app, spike first.
- No implementation, deploy or push is authorized.

**Base:** `develop` `c2c8316`, clean tree, worktree `/Users/juan/code/spoken-letter-alexa`.

**Inputs:**
- Jordan's device findings, the former private-repo issues #2256 and #2257, which were deleted there at the Owner's request after a verbatim copy. The copy is local and gitignored: `docs/agents/2026-10-08-jordan-device-issues.md`.
- Amazon docs check (summary in memory `project-demo-recording-strategy`).
- Two read-only search assignments:
  - **Creation flow map.** Objective: map the create path. Permitted: read-only `packages/skill`, `packages/agent`. Output: a file:line report. Result: received.
  - **APL, infra and fixture consumers.** Objective: the APL, infra and fixture consumer sweep. Permitted: read-only. Output: a file:line report. Result: received.
  - Citations were spot-checked by the parent against `c2c8316`.

**Evidence:**
- Throwaway worktree spike, a fourth story by a second storyteller: 717 of 718 tests passed. The only failure was `mock-journeys.test.ts` expecting Mauricio as newest. The worktree and branch were removed.
- No other tests ran for these planning-only files.

**Open items** (none blocks plan acceptance):
- Phase 2 needs the Owner's story picks (from `pull-fixture-story.mjs --list`), with consent and no-child-name confirmations. The MP3s are pulled by script, not exported by hand.
- Phase 6 needs Jordan's script.
- `graphify_local` failed to connect this session, so structure came from direct reads.

**Accepted:** the Owner accepted the plan and authorized Phase 1 on 2026-10-08 ("go ahead"), at `develop` `6ea2132`. Phase 1 covers local implementation only; its deploys and device check remain separate Owner gates. No continuation past Phase 1.

**Next:** Phase 1 through `/rpi-implement` (Owner-invoked).

## Phase 1: device spike (local implementation)

**Entry.** The Owner invoked `/rpi-implement` on `phase-1.md` on 2026-10-08. That authorizes Phase 1's local work only. It does not cover push, `pnpm build` for deploy, the CDK deploys, `ask deploy`, the device check, or continuing to Phase 2. Base: `develop` `90296c2`, clean. Worktree `/Users/juan/code/spoken-letter-alexa-demo-spike`, branch `feat/demo-spike`. `graphify_local` failed to connect this session, so structure came from direct reads. The plan's citations were revalidated against `90296c2`; the only shift is that `handler.ts` line numbers moved by the phase's own edits.

**Commits:**
- `dcf8a0d`: the R4 baseline. The snapshot of `playDirective` for the three fixture stories was written on unchanged code.
- `f57eec9`: Unit A.
- `693d801`: Unit B.
- `c958b70`: review repairs.
- The simplify and notes commits follow (listed under Simplify).

**Built:**
- **Takes manifest.** `fixtures/takes/manifest.json` with `parseTakesManifest`, `normalizeScript`, `findTake` and `spikeTake` (`packages/shared/src/takes.ts`). The schema is strict. File names must match `^[a-z0-9_-]+\.mp3$`. A repeated normalized script or a second spike throws.
- **`scripts/add-demo-take.mjs`.** It converts with ffmpeg (libmp3lame, 48 kbps, 24 kHz, mono, metadata stripped) and registers the result. A new script needs all four mixes; one file may stand in for several. A registered script can replace any of its mixes. A file still used by another mix or script is never overwritten. Unknown flags are refused. It imports the TypeScript parser directly, which works through Node 24's type stripping (local v24.21.0; CI runs Node 24).
- **Spike take.** `spike_plain.mp3` is 15.0 s to 36.8 s of `st_ignacio_the_snail.mp3`, registered for all four mixes. The script text was transcribed locally with Whisper (`base.en` and `small.en`; no external service), and the converted file was transcribed again to check it. The slice starts after the recording's opening greeting, so no personal name is in the script or the take.
- **Local dev.** `packages/app/src/local.ts` serves `/fixtures/takes/*`.
- **Skill copy.** `packages/skill/src/create-messages.ts` holds the en-US recording lines (D12).
- **Screens.** `packages/skill/src/apl/teleprompter.json` (APL 2024.3) and `apl/recording.ts`:
  - The datasource and the directives.
  - The countdown: 3, 2 and 1 a second apart; then the overlay is hidden, the recording indicator shows, and the scroll runs.
  - The scroll moves all but the last screen in one-second steps over the D8 read time. The layout estimates are 30 characters a line and 5 lines a screen at 56dp type.
- **Skill flow.** `packages/skill/src/recording.ts`, called from `handler.ts` for en-US only:
  - `RecordStoryIntent` renders the teleprompter and runs the commands, leaving `shouldEndSession` absent. Without APL, it speaks the script and the "Alexa, the end" cue (SS1).
  - `TheEndIntent` or a Done `UserEvent` plays the take through SSML `<audio>` from `${PUBLIC_BASE_URL}/fixtures/takes/`, then asks "Record again, or continue?". Without a host for takes, it gives the SS5 line. Script matching against the manifest arrives with the flow's own scripts in Phase 5.
  - "Continue" (built-in resume or next) in review says "Great." and ends the session.
  - Help and fallback get stage-specific lines.
  - An `Alexa.Presentation.APL.RuntimeError` is logged by `type:reason` only, gets no speech, and keeps the stage.
- **Session and handler.** The session gains `demoFlow=create` with `createStage` in `recording` or `review`. The envelope gains `device.supportedInterfaces` and the UserEvent and RuntimeError fields. The directive union gains the APL directives. The response builders (`ssml`, `speak`, `question`, `closing`) moved from `handler.ts` to `responses.ts`, so `recording.ts` reuses them. `ssml()` takes text parts and `{ audio }` parts. `lambda.ts` passes `publicBaseUrl`.
- **Model.** `generate.ts` adds `RecordStoryIntent` and `TheEndIntent`, plus `EN_US_ONLY_INTENTS`, which are removed from es-ES. `es-ES.json` is byte-identical to `develop`.
- **Manifest.** `skill.json` adds `ALEXA_PRESENTATION_APL` and keeps `AUDIO_PLAYER`.

**Red evidence.** Before implementation, the 7 new or changed test files failed: missing modules (`takes.ts`, `create-messages.ts`), the generator intent list, R5, M3 and the Lambda wiring. Before their fixes, the review repairs added 3 more failing tests (shared take files, unknown flag, APL runtime error).

**Oracles:**

| ID | Test |
| --- | --- |
| R1 | `recording.test.ts` "R1 …": the teleprompter document and token, the countdown before the scroll, no `shouldEndSession`, the copy rules |
| R2 | `recording.test.ts` "R2 …" |
| R3 | `recording.test.ts` "R3 …" for `TheEndIntent`, a Done tap, and a Done tap after the session closed |
| R4 | `audio.fixtures.test.ts`: file snapshot from `dcf8a0d`, unchanged since |
| R5 | `generate.test.ts` intent list, "R5 …" and the denylist test with the `RECORDING_SAMPLES` exemption ("record" only); es-ES M3 and absence. The es-ES byte identity is shown by an empty `git diff develop -- …/es-ES.json` together with the M2 drift test. It isn't pinned by a hash, because Phase 2 legitimately changes es-ES storyteller values. |
| R6 | `packages/shared/src/takes.test.ts` |
| R7 | `packages/shared/src/add-demo-take.test.ts`: `ffprobe` gives mp3, 24000 Hz, 48000 bps, 1 channel. It ran (not skipped) locally. It skips with a printed reason without ffmpeg. |

**Independent review** (fresh context; CHANGES REQUESTED on `693d801`, with no blockers):

| ID | Finding | Disposition |
| --- | --- | --- |
| F1 | SS2's "launch with a creation record in `recording` resumes at review" can't exist before the record does (Phase 3) | Deviation 1; moved to Phase 3 |
| F2 | Replacing one mix overwrote a file other mixes or scripts share | Fixed in `c958b70`; test added. A partial ffmpeg failure can leave unreferenced files; the manifest is untouched. Accepted. |
| F3 | An APL `RuntimeError` got the help prompt and lost the stage | Fixed in `c958b70`; test added |
| F4 | `Sequential` waits for each `Scroll` animation, so the scroll can end after the read time | Device check D1 (timed) |
| F5 | The spoken cue may play before the visual countdown starts | Device check D1 |
| F6 | Without a screen, an absent `shouldEndSession` ends the session, so "Alexa, the end" goes to Alexa | Accepted for Phase 1 (the filming device has a screen). The SS2 resume in Phase 3 covers it. Added to risks. |
| F7 | APL version, overlay position, `Frame` | `top`/`left` 0 added. Version 2024.3 kept (the plan names the device's version). |
| F8 | No `supportedViewports` on the APL interface | `ask deploy` validates it (SS12). Recorded with the deploy output. |
| F9 | The es-ES splice removed the last intent when a name was missing | Fixed in `c958b70` (throws) |
| F10 | R1 didn't check the document; unknown flags were ignored; `local.ts` untested; the slice is 21.8 s | The first two are fixed. `local.ts` is a server entry with no test harness; the change is one route string. The slice length is Deviation 4. |

**Re-review** of `c958b70`: APPROVE, with no new findings. A nit: nothing tests the es-ES splice guard's throw. The simplify pass replaced that guard (below).

**Simplify.** Four read-only reviewers looked at reuse, simplification, efficiency and altitude.

*Applied:*
- **One set of response builders.** `speak`, `question` and `closing` moved with `ssml` into `responses.ts`. `recording.ts` uses them instead of building its own envelopes, and `ssml()` builds the `<audio>` element. (Reuse 1–2; altitude 1–2.)
- **The spike take is resolved once,** at module load, and passed to both steps. This removes a per-request scan and a lookup that could never miss. (Efficiency 1–2; altitude 5.)
- **English-only intents in their own list.** `generate.ts` keeps them in `EN_US_ONLY` and appends them only to the en-US model, so they are never spliced out of es-ES. `EN_US_ONLY_INTENTS` is derived from that list. (Altitude 4; simplification 6.)
- **One return point.** The handler returns a recording turn from a single place, after the intent telemetry. (Altitude 3; simplification 8.)
- **Smaller cleanups:**
  - dropped the unused envelope fields `device.deviceId` and `request.source`;
  - the shared index re-exports only what the skill uses;
  - `isCreateStage` is a plain comparison;
  - the stage check relies on `validatedSession`;
  - the script reuses `findTake`'s match.

*Skipped:*
- Memoizing the APL command list: about 70 small objects per `RecordStoryIntent`, which is negligible.
- Build-time validation in place of the cold-start manifest parse: a few milliseconds, and it keeps the runtime guard.
- Dropping the `CreateMessages` type: plan D12 names it.
- Moving the create stages to `packages/shared`: there is no shared consumer yet, so Phase 3 decides.
- Sharing a slug regex with `add-fixture-story.mjs`: two scripts, one line each.
- A `fixtureUrl` helper: it would touch four packages outside this diff.

## Deviations

1. **SS2 relaunch test.**
   - *Plan said:* Phase 1 proves "launch with a creation record in `recording` resumes at review".
   - *Found:* the creation record arrives in Phase 3 (D5), and `LaunchRequest` returns before any recording logic.
   - *Chose:* Phase 1 covers SS2's other half ("done" equals `TheEndIntent`, R3). The relaunch test moves to Phase 3.
   - *Why:* it can't be written before the record exists.
2. **Session state.**
   - *Plan said:* Phase 3 adds `demoFlow=create` and `createStage`.
   - *Chose:* Phase 1 adds both, with `createStage` limited to `recording` and `review`. Phase 3 extends that closed set.
   - *Why:* "record again" and "continue" need to know the stage.
3. **"Record again" and "continue".**
   - *Plan said:* two intents with their samples.
   - *Chose:* `RecordStoryIntent` also takes "record again" and "record it again". "Continue" is Amazon's built-in `AMAZON.ResumeIntent` (and `AMAZON.NextIntent`) during review; no custom intent was added.
   - *Why:* "continue" is a built-in resume phrase. That it reaches `AMAZON.ResumeIntent` on Alexa+ is INFERRED, so it's checked in D3.
4. **Spike slice.**
   - *Plan said:* a 20-second slice.
   - *Chose:* 21.8 s.
   - *Why:* it ends at a sentence boundary.
5. **The es-ES generator test.**
   - *Plan said:* es-ES suites run unmodified.
   - *Chose:* `generate.es-es.test.ts` M3 now excludes `EN_US_ONLY_INTENTS` from the English shape and asserts they are absent from es-ES. The consumer sweep already lists this file as a Phase 1 consumer.
   - *Why:* the model gains en-US-only intents by D13.
6. **R4 scope.**
   - *Chose:* the snapshot names the three current stories.
   - *Why:* Phase 2's new stories then leave the baseline untouched.
7. **Fallback and help while recording or in review.**
   - *Chose:* stage-specific lines (one is the reading cue with the session left open) instead of the generic help.
   - *Why:* generic help would open the mic over the adult reading, or lose the stage.

## Device-check additions (phase-1.md D1–D5)

- **D1:** time the countdown against the spoken cue (F5), and time when the scroll ends against the read (F4). Calibrate `CHARS_PER_LINE` and `LINES_PER_PAGE` in `apl/recording.ts`.
- **D3:** confirm that "continue" reaches the skill as `AMAZON.ResumeIntent` (Deviation 3). Note whether the "Recording" indicator still showing during playback looks wrong on camera; Phase 5 owns the review screen.
- **Deploy:** record whether `ask deploy` accepts the APL interface without `supportedViewports` (F8).

## Phase 1 handoff (2026-10-08)

**Gate.** `python3 .rpi/scripts/rpi-verify.py` passed all 5 checks on `bc09151`:

| Check | Result |
| --- | --- |
| typecheck | passed |
| lint | passed |
| test | 81 files, 769 tests |
| cdk-synth | passed |
| e2e | 8 of 8 |

Identity sha256 `97cad23b…4d45`, 660 files, unchanged before and after the run. The tree then had the notes edits uncommitted. The commit that follows changes only this notes file, so the code-check evidence still applies. An earlier run on `693d801` (5 of 5, 766 tests) is superseded.

**Unchanged against `develop`** (shown by an empty `git diff develop`):
- `es-ES.json`
- `audio.ts`
- `messages.ts`
- `handler.test.ts`, `handler.es-es.test.ts`, `session-recovery.integration.test.ts` and `spanish-rehearsal.integration.test.ts`

**State.** Branch `feat/demo-spike` in the worktree `/Users/juan/code/spoken-letter-alexa-demo-spike`, not merged. The plan merges only accepted work into `develop`. Nothing was pushed or deployed.

**Pending Owner gates, each authorized separately:**
1. Accept Phase 1's local work. Then the integration owner merges `feat/demo-spike` into `develop` locally.
2. `pnpm build`.
3. The CDK deploy of `SpokenLetterAlexaSkill` and `SpokenLetterAlexaSimulator`. This uploads `fixtures/takes/` and the new Lambda.
4. `pnpm -F @spoken-letter-alexa/skill deploy` (the manifest with APL, and the en-US model). Record Amazon's output, including F8.
5. The device checklist D1–D5 on the Echo Show 5 under Alexa+, with the additions above, and the exit decision in phase-1.md.

**Next.** Phase 3 starts only after the Owner accepts Phase 1. Ideally it follows the device check, because the exit decision sets D8's word budget. On entry:
- Phase 3 takes over Deviation 1 (the SS2 relaunch test).
- It extends `createStage` and `CREATE_MESSAGES`.
- It decides where `CreateStage` lives.

Phase 2 stays independent and waits for the Owner's story choices.

## Phase 1 release (2026-10-08)

The Owner accepted Phase 1 and authorized steps 1–4: the local merge, `pnpm build`, the two CDK stack deploys and `ask deploy`. The Owner then authorized continuing with Phase 2.

1. **Merge.** `develop` was fast-forwarded to `e26e8b8` (`feat/demo-spike`), the tree the gate verified. Nothing was pushed. `main` was not updated: it is still at `c2c8316`, and the deployed code is `develop`'s. `docs/release.md` says a release merges `develop` into `main` first.
2. **Build.** `pnpm build` passed. The skill bundle contains the takes manifest and the teleprompter document.
3. **CDK.**
   - **Diff.** Read-only `cdk diff SpokenLetterAlexaSkill SpokenLetterAlexaSimulator --exclusively`: code-asset changes only, with no IAM or resource changes. They were the skill Lambda, the two notification Lambdas (their bundle picks up `develop`'s shared code, including the undeployed es-ES work the Owner authorized for AWS on 2026-10-07) and the fixtures `BucketDeployment` source.
   - **`SpokenLetterAlexaSkill`:** deployed (✅, 30.5 s).
   - **`SpokenLetterAlexaSimulator`:** not deployed. Asset publishing of `Fixtures/Asset1` hung twice: about 16 minutes, then about 17 minutes, with near-zero CPU and S3 connections open. The zip never reached the CDK staging bucket, and both runs were stopped before CloudFormation. The stack stayed `UPDATE_COMPLETE` from 2026-09-29.
   - **Consequence:** `fixtures/takes/` is not on S3 yet, so take playback (D3) has nothing to play until this stack deploys.
   - **API.** The API stack was not part of this authorization. Per es-ES SS4, Spanish sessions keep English backend lines until it deploys; nothing fails.
4. **`ask deploy`.** Passed with ask-cli 2.30.7; the models built at 13:37. Amazon accepted the APL interface without `supportedViewports` (F8 resolved).
   - **Read-back** of the development stage: the interfaces are `AUDIO_PLAYER` and `ALEXA_PRESENTATION_APL`. en-US has 38 intents, including `RecordStoryIntent` and `TheEndIntent`; es-ES has 36, without them.
   - The ASK CLI's rewrite of `skill.json` was semantically equal and was discarded.

**Simulator retry.** The Owner ran the deploy from their own terminal with `--verbose`. The hang was the S3 upload itself: a 14.8 MB zip at about 40 KB/s, sampled with `nettop`. The earlier runs inside the agent session showed no upload progress before they were stopped. `SpokenLetterAlexaSimulator` reached `UPDATE_COMPLETE` at 2026-10-08T13:17:43Z. CloudFront serves `https://alexa.spokenletter.com/fixtures/takes/spike_plain.mp3`: HTTP 200, `audio/mpeg`, 131,420 bytes, the same size as the local file.

**Device check D1–D5:** not run yet. Everything it needs is deployed.

## Phase 2 progress (2026-10-08, paused for an Owner reboot)

**Authorization and choices.** The Owner approved the production pull (permission rule, 2026-10-08). Owner decisions:
- Consent to publish: yes.
- Children's names in titles or audio: acceptable.
- Display names: the Owner is fine with the names used.
- Story selection: delegated to random picks.

**Committed on `feat/more-storytellers`:**
- `2466bd7`: `scripts/pull-fixture-story.mjs` (`--list`, story pull, `--as-take`) and `registerStory` exported from `add-fixture-story.mjs`. The S5 tests (12) pass.
- The follow-up commit: production refs are `spaces/<s>/stories/<d>/final/brand-chime-v1.mp3`, so the path guard now allows nested files. The CLI retries a transient `fetch failed`.

**Candidates.** Pulled into the session scratchpad only, never the repository. Local Whisper transcripts were used to identify narrators and content. Usable, with the narrator taken from her own introduction:

| Doc id | Title | Narrator |
| --- | --- | --- |
| `Cg0tS0NfyhiQMKiSs1L1` | Andrea and the Crocodile | Aunt Jordan |
| `Jh7vzb4DlYQxOD0A8Tnu` | Peach and Walla's Red Rock Adventure | Aunt Jordan |
| `SWXIxqk44OihjgoY9vIt` | A Kitten Book Club | Aunt Jordan (same space, listener and cat) |

Rejected:
- **Aunt Whitney (Owner's answer):** Princess Ana and the Peas; Rupert and Sam Play Football.
- **Readings of published picture books (copyright):** Don't Worry Little Crab (×2), Pirañas Don't Eat Bananas.
- **IP characters:** a Peppa Pig story.
- **Music, not narration:** Transcendental, Story for Ana.
- **Spanish:** two stories.

**Open.** The plan needs 2–3 storytellers other than Aunt Whitney; one is found so far. Next:
- Sample more English stories from the main family space for a self-introduced narrator. The batch with ids `1LrCeBdx…`, `CZ7pww4S…`, `GRVWOJgx…`, `TpPE9pEA…`, `Q3YGEWtF…` and `482LTRLY…` was interrupted by the reboot.
- Or the Owner names a second narrator.
- Or the Owner accepts Aunt Jordan alone, recorded as a deviation.

Then: pull into the worktree, regenerate the models, update the simulator mock and its tests, then review, simplify and the full gate.

## Jordan's demo script (2026-10-08)

**Source.** Jordan filed her final demo script as private-repo issue #2263 ("Sam on the Moon" walkthrough, 42 turns). A verbatim copy is kept locally in `docs/agents/2026-10-08-jordan-demo-script-issue-2263.md` (gitignored: family names and production paths). It is Phase 6's input and changes Phases 3–5 as recorded below.

**Owner decisions (2026-10-08):**
- **Listener name (exception to D9 and ADR 0013 for this demo).** The listener's real first name, as used in Jordan's script and spoken in the supplied narration, may appear in the skill copy, the fixtures and the audio in this public repository. Owner answer: yes. No other recipient data is exposed.
- **Fixed lines (deviation from D6).** Every Alexa line in the script is fixed copy, and the on-screen script is Jordan's supplied text verbatim. Bedrock no longer generates the demo conversation or script. The AWS Builder rule still holds through the agent API and the simulator's Strands agent on Bedrock. The README and friction log must say the demo's create flow uses fixed copy.
- **Credits (narrows D10).** The purchase scene (script lines 9–15) is dropped in favour of Jordan's own fallback: the account already has credits. No pack names, prices or currency are spoken.
- **Removed from scope by the script:** same-name listener disambiguation (D9's two listeners named Sam), and script review with revision feedback (Goal step 4).

**Supplied material, delivered.** "Sam on the Moon" was `sent`, not `downloaded`, so the delivered-only rule and `pull-fixture-story.mjs` refused it. The Owner approved it with the app's Prepare MP3 download (not Send to Yoto, which would deliver to a real player). A field-masked read then showed `status: downloaded`, `mixStatus: ready`. Pulled into the session scratchpad only, not into the repository yet:
- voice-only narration: WebM/Opus, mono, 48 kHz, 135.96 s (script line 33)
- finished mix with music and effects: MP3, 139.46 s (line 42). It is byte-identical to the Owner's downloaded MP3.

**Open for implementation:**
- `pull-fixture-story.mjs --as-take` fetches only `finalMixRef`. The voice-only narration needs a pull option for the narration ref and a WebM-to-MP3 conversion through `add-demo-take.mjs`.
- The narration opens with a greeting that is not in the on-screen script, and ends with "The end."
- The script is about 450 words (136 s of narration) against D8's 70-word budget. The script relies on a time cut, so the session-window outcome of the device check (D1–D5, still pending) decides the fallback. Line 30 has "The end" without the wake word.
- The finished mix alone is 139.5 s, so the clips must be trimmed to keep the video under three minutes.
- Phrases differ from the spike: "record" (spike: "record story"), "playback", "re-record", "next", "send story".
- Script lines 5–7 need "El Trasgu" by Tío Manuel. Production holds a delivered "El Trasgu del Sotano" in the same family space. The Owner confirmed Tío Manuel narrates it, so it became Phase 2's second storyteller (below). Spanish names in an en-US model need synonym coverage and a device check.

## Phase 2 implementation (2026-10-08, after the reboot)

**Second storyteller.** Jordan's demo script (private-repo issue #2263, recorded on `develop` in "Jordan's demo script") needs "El Trasgu" by Tío Manuel. Production holds it as "El Trasgu del Sotano", delivered on 2026-07-27. The Owner confirmed Tío Manuel is the narrator. Further sampling stopped.

**Deviation: a Spanish story in the catalog.** "Spanish" was a rejection reason during sampling, because the add-on locale is en-US. Jordan's script plays a short clip of this story, so it is included as is, with its production title. The en-US model gains `tío` kinship forms ("Tio Manuel", "Uncle Manuel"), and playlist and simulator matching ignore accents.

**Per-story confirmations (phase-2.md Entry; yes or no, no names):**

| Story id | Storyteller consent to publish | Child's name check | Display name |
| --- | --- | --- | --- |
| `st_andrea_and_the_crocodile` | yes (Owner, 2026-10-08) | names acceptable (Owner, 2026-10-08) | Aunt Jordan |
| `st_peach_and_walla` | yes | names acceptable | Aunt Jordan |
| `st_a_kitten_book_club` | yes | names acceptable | Aunt Jordan |
| `st_el_trasgu` | yes | names acceptable | Tío Manuel (Owner-confirmed narrator) |

The Owner's "acceptable" answer is a recorded exception to Entry (b), alongside the demo-listener exception on `develop`.

**Pulled with `scripts/pull-fixture-story.mjs`:** each story was `downloaded` with `mixStatus: ready`. The newest is now A Kitten Book Club; the first in catalog order is still Ignacio.

**Independent review findings and dispositions:**
1. Example-phrase tests pinned to Aunt Whitney: fixed. The gate found the same failure.
2. Consent and child-name record: recorded above.
3. Device script order (5.3) and the storyteller claim (4.1): fixed.
4. The simulator mock missed typed "Tio Manuel": fixed with accent folding and an unaccented test.
5. Kinship lookup assumed NFC: now normalizes to NFC first.
6. The playlist normalize change only widens matching ("Peña" matches "Pena"): accepted, no change.
7. The README lacked `--as-take`, and its provenance wording was inaccurate: fixed.

**Gate.** `python3 .rpi/scripts/rpi-verify.py` passed all 5 checks on `f21dcbe`: 786 tests, 8 of 8 E2E.

**Accepted.** The Owner accepted Phase 2 on 2026-10-08 and authorized continuing through the remaining phases' local implementation ("keep going until everything is implemented and we'll test at the end"). Deploys, push and the device check stay separate Owner gates. `feat/more-storytellers` was merged into `develop` locally; this notes file was the only conflict.
