# Staged demo flow for the hackathon video

Planned 2026-10-08 on `develop` at `c2c8316` in `/Users/juan/code/spoken-letter-alexa` (clean tree). This plan follows the Owner's direction of 2026-10-08. The hackathon video must show the customer experience that Alexa+ with MCP would give. Today a classic custom skill can't deliver that, and external developers have no real Alexa+ integration path; the event organizers accept a staged flow. The plan specifies local implementation, then each deploy and device step as a separate Owner gate. It doesn't authorize implementation, push, ASK publication, CDK deployment or private-app changes.

## Goal

An adult on the real Echo Show 5 (Jordan's US account, en-US, Alexa+, development skill through the beta test) can film this end to end:

- **Play stories.** Stories from several storytellers play with the existing AudioPlayer card.
- **Create a story** through Jordan's eight steps:
  1. Choose a listener, with a question when two listeners share a name.
  2. Credit check.
  3. An open-ended story conversation.
  4. Script review with feedback such as "make it shorter".
  5. Recording, with the script on screen, "record story", a 3-2-1 countdown and "Alexa, the end".
  6. Listen back to the take, then record again or continue.
  7. A sound choice.
  8. Send.

Each step is either real or staged:

| Step | Treatment |
| --- | --- |
| Conversation, script and revision | Real: Bedrock through Strands, run by the agent API |
| Creation state and generation cache | Real: DynamoDB |
| Takes and mixes | Real files, served from S3 and CloudFront |
| Listener and family data | Fictional fixture |
| Credit balance | Fictional fixture |
| Audio capture | Staged: none happens; listen-back plays a take an adult recorded beforehand of the same script |
| Send | Staged confirmation |

Jordan's final demo script is still pending. The plan keeps every spoken line in one catalog and every name and number in one fixture, so her script changes data, not code. Phase 6 applies it.

## Evidence and limits

Every citation below was checked on `c2c8316`. Platform facts come from a check of Amazon's developer docs in this session (memory `project-demo-recording-strategy`). Code structure came from two read-only search assignments whose reports were spot-checked against source. The `graphify_local` server failed to connect in this session.

### Device findings

Jordan's findings, saved locally at `docs/agents/2026-10-08-jordan-device-issues.md` (gitignored):
- **Former #2256:** only the three Aunt Whitney fixtures are playable.
- **Former #2257:** "mermaids or space" only, a draft hand-off, login requested at the end, no listener, and her eight-step flow.

### Current creation path

- **Prompt:** `StartStoryIntent` asks for a theme (`packages/skill/src/handler.ts:163`, `:566-569`). The theme prompt is `packages/skill/src/messages.ts:78`.
- **Save:** `saveDemoDraft` posts `/agent/demo/draft` (`handler.ts:386-397`, `agent-client.ts:157-163`).
- **Bedrock's role:** it only chooses outline parts from fixed enums (`packages/agent/src/demo-drafts.ts:138-150`). The prose is templated, and themes must match a fixed table (`demo-drafts.ts:103-135`).
- **Ending:** the session ends with the hand-off line (`messages.ts:101`).

### Skill state and responses

- **No dialog model.** The only session state is whitelisted strings rebuilt each turn by `validatedSession` (`handler.ts:98-110`), with `demoFlow`, `demoTopic`, `demoStoryteller` and `fallbackCount`.
- **Responses:** built by `speak`, `question`, `closing` and `audioControl` (`handler.ts:143-162`). Telemetry names a `ResponseKey` and a `Flow` (`handler.ts:267-290`).
- **Locales:** messages are `Record<SkillLocale, Messages>`, and a missing locale key fails `tsc` (`messages.ts:6`, `:67`).
- **Copy rules:**
  - The handler tests forbid `demo`, `fixture`, `simulation`, `prototype` and "not sent" or "not a real" in speech (`packages/skill/src/handler.test.ts:36-40`).
  - The generator test forbids denylisted fragments, `record` and `audio` in samples. Its only exemptions are "send" in the handoff samples and "credit" in the credits-help samples (`packages/skill/src/model/generate.test.ts:153-172`; `generate.ts:184-190`, `:585`).
  - The denylist is `packages/shared/src/contract/agent-tools.ts:19-40`. It includes `send`, `credit`, `pay`, `purchase`, `recipient`, `record`, `audio`, `space` and `member`.

### Interaction model

- **Intents:** they come from `packages/skill/src/model/generate.ts`. The es-ES model must carry samples for every intent (`generate.ts:376-387`).
- **Free-form capture:** it uses `AMAZON.SearchQuery`, which needs a carrier phrase (catch-all `generate.ts:142-152`, `:316`; `StartStoryIntent` `:319-320`).
- **Named listeners:** `AppHandoffIntent` sends them to the app today (`generate.ts:349-353`; `handler.ts:548-551`).

### Display and audio

- **No APL anywhere.** The manifest declares `AUDIO_PLAYER` only (`packages/skill/skill-package/skill.json:63-67`). Nothing reads `supportedInterfaces`.
- **Card:** the AudioPlayer card is built in `packages/skill/src/audio.ts:93-117`. The Owner confirmed on the device on 2026-10-08 that it renders well, so it is not changed.
- **Screens:** the Echo Show 5 supports APL 2024.3. Slow scrolling needs repeated `Scroll` steps or `AnimateItem` (Amazon docs).
- **Session window:** on a screen device with `shouldEndSession` undefined, the session stays open for up to about 30 seconds with the microphone closed. "Alexa, <utterance>" in that window reaches the skill if the utterance is in the model (Amazon docs).
- **No raw audio:** a skill never receives raw audio. This is INFERRED: no ASK document states it outright, but the request format has no audio field.

### Backend and infrastructure

- **Time budget:** the agent client has a 7-second budget (`agent-client.ts:124-133`). The skill Lambda has an 8-second timeout (`infra/lib/skill-stack.ts:70`).
- **Progressive responses:** they exist (`packages/skill/src/progressive.ts:51`).
- **Bedrock settings:** Bedrock is Haiku 4.5 with `maxTokens` 600 and temperature 0.3 (`packages/app/src/bootstrap.ts:87`; `infra/lib/api-stack.ts:26`).
- **Demo state:** the table `sla-demo-state` is keyed by `deviceKey` with a TTL (`infra/lib/core-stack.ts:54-60`). The API has GetItem and PutItem on it (`api-stack.ts:108-111`). Updates use a key prefix (`packages/agent/src/demo-updates.ts:97`).
- **Fixtures:** all of `fixtures/` except `README.md` and `stories.json` is uploaded to S3 and served at `/fixtures/*` through CloudFront (`infra/lib/simulator-stack.ts:48-55`; `infra/lib/edge-stack.ts:223`). Local dev serves only `/fixtures/audio/*` and `/fixtures/art/*` (`packages/app/src/local.ts:19`).
- **Adding stories:** the path is ready. In a throwaway worktree this session, a fourth story by a second storyteller was added with `scripts/add-fixture-story.mjs`. Both models regenerated with 2 storytellers, and the suite passed 717 of 718. The one failure was `packages/simulator/src/agent/mock-journeys.test.ts` expecting Mauricio as newest.

## Decisions

| Decision | Selected | Alternative and trade-off |
| --- | --- | --- |
| D1: locale (Owner, 2026-10-08) | The new creation flow is en-US only. es-ES keeps today's theme-to-draft flow byte for byte. | Mirroring in es-ES doubles copy, matchers, samples and tests for a path the video doesn't use. |
| D2: boundaries (Owner, 2026-10-08) | Listener, credit, recording, sound and send are staged in the skill's voice flow with fictional fixtures. The MCP tools stay read-only, and `CLASS_C_DENYLIST` is unchanged for tools. The generator test gains explicit exemption sets for the new create intents only. The README, friction log and skill `testingInstructions` list which steps are staged. | Adding MCP write tools conflicts with the agent-tool contract and adds scope. Leaving the disclosure out misstates the repository to judges who read it. |
| D3: take and mixes (Owner, 2026-10-08) | Jordan reads the frozen demo script in the real Spoken Letter app and adds effects and music there. The Owner exports four MP3s: as is, effects, music, both. | A local ffmpeg mix or ElevenLabs beds are self-contained but sound less like the product. |
| D4: order (Owner, 2026-10-08) | A device spike comes first (Phase 1). It covers APL, the teleprompter, the countdown, "Alexa, the end" and in-session take playback, and it is deployed for one device check before the rest is built. | Building everything first saves a deploy but risks rework if Alexa+ treats screens or the session window differently. |
| D5: state location | The agent API owns a creation record in `sla-demo-state` under key `create_<deviceKey>`, with a 7-day TTL so filming can span days. The skill carries only `demoFlow=create` and the current stage in session attributes, and asks the API on launch so a dropped session resumes. | Session attributes alone lose the flow when "Alexa, the end" falls outside the window. The skill Lambda has no DynamoDB grant. |
| D6: real generation, reproducible on camera | Conversation questions, the script and each revision are real Bedrock calls. Each result is cached in `sla-demo-state` under `gen_<sha256(normalized inputs)>` (30-day TTL), storing only the output. A filming run that repeats the rehearsal's lines gets the rehearsal's real output, so the on-screen script matches the recorded take. Different lines generate a new result. | Re-generating on every run breaks continuity with the pre-recorded take. Hard-coding the script makes Bedrock decorative and breaks the AWS Builder rule. |
| D7: take playback | Inside the session, through SSML `<audio>` (MP3 at 48 kbps and 24 kHz; at most 240 s per response, to be verified on the device in Phase 1). After playback, the reprompt keeps the mic open for "record again" or "continue". The take and mixes live in `fixtures/takes/` with `manifest.json`, which maps the normalized script text to the four files. `scripts/add-demo-take.mjs` converts and registers them. | AudioPlayer playback ends the session, so "record again" and "continue" would go to Alexa instead of the skill. |
| D8: script length | The script word budget comes from the fixture (default 70 words, about 25 seconds read aloud). That keeps the read inside the about-30-second window, so "Alexa, the end" reaches the skill. | A long script needs a cut in the edit (SS2 covers the session dropping). |
| D9: listeners and credits | `fixtures/demo-family.json` holds the families, listeners, the creator's display name, the credit balance and the script word budget. Names are fictional and never belong to a real child. The default data has two families and two listeners named Sam, so disambiguation shows; Jordan can rename them in her script if the names stay fictional. A `ListenerName` slot type and a `FamilyName` slot type are generated from the fixture. | Real family names conflict with the child-safety rules and ADR 0013. |
| D10: credit step | Staged from the fixture balance. With 1 or more, Alexa says one credit is used and continues. With 0, Alexa offers to buy one; "yes" confirms without any amount spoken, and "no" pauses the flow. No in-skill purchase is used. | A real in-skill purchase adds console products and test resets but moves no real credit (no account linking). |
| D11: send wording | "Sent to <listener>'s family", meaning the family's grown-up approves and delivers. This matches the product's Owner-delivery rule. The sent story is recorded on the creation record. | "Sent to Sam" implies direct delivery to a child. |
| D12: create copy | A separate en-US-only catalog, `packages/skill/src/create-messages.ts`, with a `CreateMessages` type, so D1 holds and `MESSAGES` stays a complete two-locale record. The existing copy rules apply to it (`handler.test.ts:36-40`). | Adding keys to `Messages` forces es-ES values for an English-only flow. |
| D13: model scope | The new create intents are en-US only. The generator's es-ES coverage check (`generate.ts:376-387`) gains an explicit en-US-only intent list, and the es-ES output stays byte-identical. | Spanish placeholder samples would route Spanish speech into an English flow. |
| D14: screens | APL documents live in `packages/skill/src/apl/`. They are sent only when the request's `supportedInterfaces` includes `Alexa.Presentation.APL`, otherwise the flow is voice-only. The AudioPlayer card is untouched. | APL on every response would break devices without screens and the existing playback card. |

## Scope and invariants

- **Out of scope:** the private repository, real account linking, a real in-skill purchase, real audio capture, the simulator's creation journeys, es-ES changes and MCP tool changes.
- **The simulator stays unchanged.** The draft routes stay as they are, so es-ES and the simulator keep working (consumer sweep).
- **Child safety:** an adult speaks every line, and no child voice or data is involved. Fixture names are fictional. Logs keep slot presence only, never raw speech or names. The creation record stores the creator's answers for at most 7 days, and the generation cache stores only outputs.
- **AWS Builder:** no new AWS service. Bedrock, DynamoDB, S3, CloudFront and Lambda do real work in code. The README states which steps are staged (D2).
- **Unchanged contracts:** the three MCP tools, the 7-second client budget, the 8-second Lambda timeout, the single CI workflow and the existing AudioPlayer card.

## Phase sequence

| Phase | Outcome | Boundary |
| --- | --- | --- |
| [1: device spike](2026-10-08-alexa-staged-demo-flow-phases/phase-1.md) | APL plumbing, teleprompter with slow scroll and 3-2-1, "record story", "Alexa, the end" (voice and on-screen button), and in-session take playback, proven on the Echo under Alexa+ | Local gate, then Owner-gated deploys and one device check that decides SS2's fallback |
| [2: more storytellers](2026-10-08-alexa-staged-demo-flow-phases/phase-2.md) | Stories from 2–3 more storytellers play with the existing card | Independent track: starts when the Owner supplies MP3s; local gate; Owner-gated deploys |
| [3: flow skeleton, listener and credit](2026-10-08-alexa-staged-demo-flow-phases/phase-3.md) | en-US "create a story" runs on a creation record: listener with disambiguation, then the credit step | Local gate, Owner acceptance |
| [4: real conversation and script](2026-10-08-alexa-staged-demo-flow-phases/phase-4.md) | Bedrock conversation, script with on-screen review, revision by feedback, generation cache | Local gate, Owner acceptance |
| [5: record, review, sound, send](2026-10-08-alexa-staged-demo-flow-phases/phase-5.md) | The spike's recording joins the flow; take review, sound choice and send; staged-step disclosure | Local gate, Owner acceptance |
| [6: Jordan's script, rehearsal, release](2026-10-08-alexa-staged-demo-flow-phases/phase-6.md) | Copy, names and carrier phrases match her script; local rehearsal; frozen script → real-app takes; deploys; device acceptance | Local acceptance first; each deploy and device step needs Owner authorization |

Phases run sequentially, and this plan grants no continuation across phases. Phase 2 is an independent track. It can run at any point after plan acceptance, once the Owner's MP3s exist, and it integrates by regenerating the models.

Work happens in a local worktree off the revalidated `develop`. Each phase follows red tests, implementation, independent review, repair, simplify, then `python3 .rpi/scripts/rpi-verify.py` run sequentially. One integration owner merges accepted work into `develop` locally. No tests have run for these planning-only files.

## Consumer sweep

Commands run on `c2c8316`, each excluding `node_modules`, `dist` and `cdk.out`:
- `grep -rln -e AudioDirective -e AlexaResponseEnvelope packages infra scripts`
- `grep -rln demoFlow packages`
- `grep -rln -e saveDraft -e latestDraft -e /agent/demo/draft packages infra scripts`
- `grep -rln -e DEMO_STATE -e sla-demo-state packages infra scripts`
- `grep -rln CLASS_C_DENYLIST packages infra scripts`
- `grep -rln -e 'from "./messages.ts"' -e 'MESSAGES\[' packages infra scripts`
- `grep -rlnE "stories\.json|events\.json" .`

| Consumer | Disposition |
| --- | --- |
| `packages/skill/src/handler.ts`, `lambda.ts`, `index.ts`, `audio.ts` (response envelope, directives) | Phase 1: the directive union adds APL `RenderDocument` and `ExecuteCommands`; the envelope adds `context.System.device.supportedInterfaces` and the `Alexa.Presentation.APL.UserEvent` request. `audio.ts` output is unchanged (oracle R4). |
| `handler.test.ts`, `handler.es-es.test.ts`, `session-recovery.integration.test.ts`, `spanish-rehearsal.integration.test.ts` | en-US create-copy assertions are replaced in Phase 3 (listed there). es-ES files pass unmodified (D1). |
| `validatedSession` (`handler.ts:98-110`) | Phase 3: adds `demoFlow=create` and a `createStage` from a closed set |
| `agent-client.ts` (+ tests) | Phase 3 and 4: new `create*` calls; draft calls unchanged |
| `packages/agent/src/routes.ts`, `demo-draft-route.test.ts`, `spanish-routes.test.ts` | New `/agent/demo/create/*` routes in Phases 3–5; draft routes unchanged and their tests unmodified |
| `packages/simulator/src/agent/mock.ts` (draft calls) | Excluded: the simulator keeps the draft flow (scope) |
| `packages/app/src/env.ts`, `bootstrap.ts`, `bootstrap.test.ts` (demo-state table) | Phase 3: the creation store and generation cache reuse the same table and client; a bootstrap test proves wiring |
| `infra/lib/core-stack.ts`, `api-stack.ts`, `infra/test/*` | Unchanged: same table, same GetItem and PutItem grant. Phase 3 confirms no Query or Delete is needed. |
| `packages/skill/src/model/generate.ts`, `generate-cli.ts`, `generate.test.ts`, `generate.es-es.test.ts` | Phase 1 (record and the-end intents), Phase 3 (listener, family, credit intents, en-US-only list D13), Phase 4 (conversation and feedback carriers); es-ES output byte-identical |
| `packages/shared/src/contract/agent-tools.ts` and test | Unchanged (D2) |
| `messages.ts` consumers (skill and agent) | Unchanged; create copy lives in `create-messages.ts` (D12) |
| `fixtures/stories.json` readers: `env.ts:7,21`, `bootstrap.ts:130,136`, `mcp-server/src/provider/fixtures.ts:44`, `demo-updates.ts:42`, `notification-worker.ts:20,53`, `generate.ts:26,42`, `simulator/src/App.tsx:12`, `simulator/src/agent/mock.ts:3-10`; writer `scripts/add-fixture-story.mjs` | Phase 2: new stories through the writer; the simulator mock's three hard-coded imports gain the new files; tests pinning "newest = Mauricio" (`mock-journeys.test.ts:40`, `e2e/journeys.spec.ts:51-52`) updated to the real newest |
| New `fixtures/demo-family.json`, `fixtures/takes/manifest.json` | Phase 3 and 1/5: one parser each in `packages/shared`, used by the skill generator, the handler and the agent. Uploaded by the existing BucketDeployment (also `demo-family.json`; it holds fictional names only). |
| `packages/app/src/local.ts:19` | Phase 1: add `/fixtures/takes/*` for local dev |
| `packages/skill/skill-package/skill.json` | Phase 1 (APL interface), Phase 5 (`testingInstructions`, example phrase stays a playback phrase) |

## Stuck states and recovery

| State | Who sees what | How it ends | Proving test |
| --- | --- | --- | --- |
| SS1: device without APL | The adult hears the flow voice-only: the script is read aloud, then "Read it aloud, then say 'Alexa, the end'" | Automatic: no APL directive is sent | Phase 1: a request without `supportedInterfaces` gets no APL directive and gets the spoken script |
| SS2: "the end" falls outside the ~30 s window (the session closed) | The screen stays or clears; "Alexa, the end" goes to Alexa | The next "open Spoken Letter" resumes at take review: "Welcome back. Your recording is saved. Listen to it, or record again?" Phase 1 adds an on-screen "Done" button (APL `SendEvent`) as a second way to finish | Phase 1: launch with a creation record in `recording` resumes at review; a `UserEvent` "done" equals `TheEndIntent` |
| SS3: Bedrock fails or exceeds the budget in the conversation | The adult hears the next question from a fixed list (characters, place, twist) | Automatic, and the flow continues; the failure is logged without text | Phase 4: a failing model yields the fixed question and the stage advances |
| SS4: Bedrock fails while writing or revising the script | "I couldn't write the script just now. Say 'try again'." | "Try again" retries; the previous script, if any, stays on screen | Phase 4: a failure keeps the prior script and reprompts; the retry succeeds |
| SS5: no take matches the frozen script | "That recording isn't ready to play yet. Say 'record again', or 'continue'." Logged as `take_missing` | The adult continues or re-records. Phase 6's rehearsal catches it before filming. | Phase 5: an unmatched script gives that line and stays at review |
| SS6: creation record expired (7 days) or missing mid-flow | "Let's start a new story. Who is it for?" | A new record starts | Phase 3: a stage attribute without a record restarts at the listener question |
| SS7: an unknown listener name | "I don't see <name> in your families. You can choose Sam, Lucy or Theo." (from the fixture) | The adult names a listed listener | Phase 3: an unresolved `ListenerName` gives the list and keeps the stage |
| SS8: an answer with no carrier match (FallbackIntent) in the conversation | Recovery with an example: "Try: 'it's about a dragon who…'"; the second fallback says cancel works | The adult rephrases or cancels; the counter resets on progress | Phase 4: two fallbacks in `conversation` give the escalating lines |
| SS9: zero credits and "no" to buying | "Okay, your story is saved. Buy a credit any time to finish it." Session ends | The next launch resumes at the credit step | Phase 3: the "no" path ends with that line; relaunch asks again |
| SS10: the skill calls create routes on an API that predates them (404) | "Story creation isn't available right now." Logged `create_unavailable` | Deploy order in Phase 6: API before skill | Phase 3: a 404 from the client gives that line, and the session ends cleanly |
| SS11: a model drifts from the generator | CI fails, naming `pnpm -F @spoken-letter-alexa/skill generate` | Regenerate and commit | Existing drift tests plus new en-US-only assertions |
| SS12: Amazon's model build or APL validation rejects a deploy | `ask deploy` prints Amazon's error and the script exits non-zero | Fix and redeploy (shown in output) | Phase 1: APL documents are validated as JSON with required fields locally; deploy output is recorded in the notes |

## Acceptance

Automated, every phase: the full local gate passes. es-ES and simulator suites run unmodified. en-US assertions outside the create flow run unmodified.

Manual:
- **Phase 1:** the device spike checklist.
- **Phases 3–5:** the Owner reviews the create copy.
- **Phase 6:** Jordan and the Owner accept the rehearsal against her script, then the device run under Alexa+.

Deploys are Owner gates.

## Risks

- Alexa+ may handle custom-skill APL, the session window or SSML audio differently from the classic docs. Phase 1 exists to find out early.
- Free-form answers need carrier phrases. Jordan's exact lines become carriers in Phase 6. Answers outside them reach SS8.
- Bedrock output varies with ASR differences between the rehearsal and filming runs. D6 reuses a cached result only on identical normalized input; otherwise the take won't match (SS5), so the rehearsal must use the filming lines.
- The deadline is Friday 2026-10-23 12:00 PT. Phase 2 is parallel. If time runs short, the order of value is Phase 1 → 3 → 5 → 4. A staged fixed question list can stand in for Phase 4's real conversation only by the Owner's decision, because it weakens the AWS Builder claim.

## Handoff

- **Objective and scope:** as above. Owner decisions D1–D4 were given 2026-10-08 in this session. No implementation is authorized yet.
- **Base:** `develop` `c2c8316`, clean. Notes: `docs/plans/2026-10-08-alexa-staged-demo-flow-notes.md`.
- **Next:** the Owner accepts this plan and authorizes Phase 1. On entry, revalidate `develop` and the citations above. Phase 2 needs the Owner's MP3s plus consent and a no-child-name check per story.
