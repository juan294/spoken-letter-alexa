# Spoken Letter Alexa device manual test script

Use this script with an `en-US` Echo signed in to the Owner's Alexa developer account. An adult speaks every line. The script tests the **fixture demo** implemented on `develop` at `621b6610fab69d2916306c04cf5b53b7812267f4`. It does not test real story delivery, a child account, creator messaging, or a credit purchase.

## Before you speak

1. Have the operator confirm that the **development** skill, interaction model, skill Lambda, agent API, fixture catalog, and notification worker match the candidate being tested. Record the source commit, ASK skill ID and development version, AWS stack outputs, device model and locale, and notification opt-in state with the run results. If the candidate is not deployed, mark the device run **NOT RUN**. A local test pass does not make the new voice paths available on an Echo.
2. Use the three delivered fixtures: **Ignacio the snail** (4:48), **Mauricio the train riding bull** (5:09), and **Martina the music loving mermaid** (6:14), all by **Aunt Whitney**. Newest-first order is Mauricio, Martina, Ignacio. A shuffled playlist can start with any of them, but two consecutive starts must have different first stories. [Catalog: `fixtures/stories.json:1-31`; invocation: `packages/skill/src/model/generate.ts:23`.]
3. Keep a run note for each numbered check. Record the exact words spoken, Alexa's exact reply, whether audio actually played, the story title and order, the observed intent and slot names from the ASK console, and **PASS**, **FAIL**, or **NOT RUN**. For playback, the operator also records whether the stream token changed, the offset reset, and whether `ENQUEUE` used the prior token. Redact raw tokens, Alexa user IDs, secrets, and any personal names from saved evidence.
4. Start with the event and notification checks below. Fixture updates are read once, so an earlier launch may consume them. A completed story prompts for a reaction on a later launch, which can take priority over an update. If this device has already consumed an event, mark that event **NOT RUN: previously read**. Do not call it a pass based on the offline simulator.
5. When a line says **Open**, say **“Alexa, open Spoken Letter.”** Then speak the quoted request during that skill session. If Alexa has closed the session, open it again before the next request. For playback controls, speak directly to Alexa while the audio is playing.

## 1. One development notification on the Owner device

Run this section only after the development manifest is published and validated, the Owner has opted in to notifications for this skill, and the Owner has separately authorized **one** development-stage Proactive Events send. The operator performs the send; the device tester only observes it. If any prerequisite is absent, mark this section **NOT RUN**, then continue with the in-skill tests.

- [ ] **1.1 Opt-in.** Confirm the skill's notification permission is enabled for the Owner's test account and the subscription change reached the notification worker. Record the observed opt-in state without saving the raw Alexa user ID.
- [ ] **1.2 Send and observe.** The operator sends one event for `fixture_new_mermaid_story` through the development-only sender. Record the Amazon API result and reference ID in redacted form. The expected API result is HTTP `202`; the Echo should receive Amazon's generic Spoken Letter message alert. It must not announce a story title, child name, wish text, or a made-up direct message from a creator. An API receipt without a device observation is **not** a device pass.
- [ ] **1.3 Match in-skill detail.** Continue with the launches in section 2. The birthday fixture may appear first; the next unread item should identify Martina and Aunt Whitney. Match its event ID to the send in operator evidence. If the event was already read before the alert, mark this detail check **NOT RUN: previously read**; do not manufacture a second send.

## 2. Fixture updates and family occasion

- [ ] **2.1 First launch.** Open Spoken Letter. On fresh demo state, Alexa should speak the synthetic family birthday update and call it a fixture. It must not name a child or a real birth date. Record the exact reply and whether `LaunchRequest` read `fixture_family_birthday`.
- [ ] **2.2 Occasion to draft.** After the birthday prompt, say **“Let's create a story.”** Alexa should ask for a general theme. Say **“About forest.”** Alexa should confirm a saved **demo draft**, without claiming that a birthday story was delivered. This is a synthetic occasion, not a calendar reminder for a named person.
- [ ] **2.3 New story.** Open again, or say **“Show my demo updates.”** Continue only until Alexa speaks the fixture new-story update. It should identify **Martina the music loving mermaid** by **Aunt Whitney** and say it is a fixture update. Record the linked event ID `fixture_new_mermaid_story` from operator evidence; Alexa does not need to speak the ID.
- [ ] **2.4 Read-once behavior.** Say **“Show my demo updates.”** after both seed events have been heard. Alexa should say there are no unread demo updates. If a wish or reaction was saved meanwhile, its own update may appear first; drain those separately and record the order.

## 3. Reaction after a completed story

- [ ] **3.1 Complete one recording.** Open; say **“Play the story Martina the music loving mermaid.”** Let its 6:14 recording finish naturally. Do not use Stop or Next for this check. No spoken feedback prompt should come from the `PlaybackFinished` callback itself.
- [ ] **3.2 Next invocation.** Open Spoken Letter. Alexa should ask whether the parent liked or loved **Martina the music loving mermaid**. Say **“I love that story.”** Alexa should confirm a **demo reaction** was saved and say it was **not sent to the storyteller**. The operator checks one receipt tied to Martina's story ID and Aunt Whitney, without exposing a user ID.
- [ ] **3.3 No repeated prompt.** Open again. The same completed story should not trigger a second reaction prompt. Say **“Show my demo updates.”** A saved-reaction fixture update may be read once. Do not describe this as an email or a message from a child to the creator.

## 4. Entire playlist and playback controls

- [ ] **4.1 Shuffled start.** Open; say **“Play all my stories.”** A delivered fixture should start playing, with its title and Aunt Whitney spoken. Record the first story ID. Stop playback, open again, and repeat **“Play all my stories.”** With at least two fixtures, the second first story must differ from the first. Also try the source phrasing **“Play my Spoken Letter stories.”** and record whether it reaches the same path. This tests randomized start, not a favorites list.
- [ ] **4.2 Skip and previous.** While a playlist story plays, say **“Alexa, next.”** Exactly one different fixture should start. Say **“Alexa, previous.”** The prior fixture should return. Record title order and new stream tokens. If Alexa ignores the control or jumps twice, mark **FAIL**.
- [ ] **4.3 Restart and repeat.** While a story plays, say **“Alexa, start over.”** It should restart the **current recording** at offset zero. Say **“Alexa, play it again.”** The same recording should restart at offset zero with a fresh token. This is distinct from restarting the entire playlist.
- [ ] **4.4 Reset playlist.** After moving to the second story, open and say **“Start the playlist over.”** The playlist's first story should play again. Record the first title and token transition. Also try the source phrase **“Alexa, start all over.”** and record whether Alexa restarts the current recording or the whole playlist; only the explicit playlist phrase has a defined playlist-reset path in this skill.
- [ ] **4.5 Pause and resume.** While a story plays, say **“Alexa, pause.”** Confirm that audio stops. Say **“Alexa, resume.”** Confirm that the same story continues near its prior position; record the observed offset. It should not silently start an unrelated story.
- [ ] **4.6 Automatic next track.** Start a playlist and let one fixture recording finish without a voice command. The next distinct fixture should begin. The operator checks for one `AudioPlayer.PlaybackNearlyFinished` enqueue with `expectedPreviousToken`, followed by real audio playback of the queued story. An `ENQUEUE` directive alone is not a device pass. On the next launch, dismiss any reaction prompt for that completed track with **“No”** before continuing.
- [ ] **4.7 Shuffle voice command.** While a story plays, say **“Alexa, shuffle on.”** The current skill should answer that it plays family stories one at a time; this command does not toggle an active shuffle mode. Record the actual routing. The shuffled-start behavior in 4.1 is the implemented randomization.

## 5. Storyteller, title, favorite example, and newest stories

- [ ] **5.1 Adult storyteller.** Open; say **“Play my stories from Aunt Whitney.”** Only Aunt Whitney's delivered fixtures should play. Record the first title and confirm that audio, not only a spoken claim, starts. The original example name **Mila** is absent from this fixture catalog; the test uses the available adult storyteller.
- [ ] **5.2 Exact title.** Open; say **“Play the story Ignacio the snail.”** Ignacio's recording should play. Also try the original short form **“Play the Ignacio story.”** and record whether it resolves to the same fixture. This covers the original “favorite story” example by title; the skill has no saved favorites collection. Test **“I want to hear Martina the music loving mermaid.”** Martina's recording should play. Record the actual intent and `title` slot for each phrasing.
- [ ] **5.3 Newest-first.** Open; say **“Play my new stories.”** Mauricio should play first. Let it advance, or say **“Alexa, next,”** and confirm Martina second, then Ignacio third. Record each actual title and audio transition.
- [ ] **5.4 Missing delivery.** Open; say **“Play the story The unseen dragon.”** Alexa should say it could not find a delivered story and offer an available choice. It must not play invented audio or claim the story exists.

## 6. Guided demo draft and listener handoff

- [ ] **6.1 Missing theme.** Open; say **“Let's create a bedtime story.”** Alexa should ask for a general theme. Say **“About mermaids.”** It should confirm that a **demo draft** was saved, then direct the parent to the Spoken Letter app to choose a listener and finish it.
- [ ] **6.2 Readback.** Open; say **“Read my demo draft.”** Alexa should read an actual short outline about mermaids. It should contain no listener name and should not say a story was sent or delivered. The operator checks that the saved receipt and readback refer to the same demo draft.
- [ ] **6.3 Named listener.** Use only a fictional alias that is not a stored Recipient. Open; say **“Can you send Morgan a Spoken Letter?”** and **“Can you create a story for Morgan?”** These carrier phrases should reach the safe app handoff. Also try the original bare form **“Send Morgan a Spoken Letter.”** and record its actual routing separately. Alexa must not claim that Morgan received anything, save the alias in demo state, or repeat the alias in its response. If the bare form misses the handoff, mark that source phrasing **FAIL** even if a carrier phrase works.
- [ ] **6.4 Canceled draft.** Open; say **“Let's create a story.”** When Alexa asks for a theme, say **“Cancel.”** Alexa should say no new demo draft was saved. A draft saved earlier in this run can still exist; this check concerns only the canceled attempt.

## 7. Story wishes and their fixture updates

- [ ] **7.1 Topic wish.** Open; say **“I want a story about mermaids.”** Alexa should ask whether to save a **demo wish**, state that nobody will be contacted, and wait for confirmation. Say **“Yes.”** It should confirm a saved demo wish and say it was not sent to the storyteller. The operator checks one receipt with the canonical topic `mermaids`.
- [ ] **7.2 Adult storyteller wish.** Open; say **“Ask Aunt Whitney for another mermaid story.”** Alexa should confirm a demo wish about mermaids **from Aunt Whitney**. Say **“Yes.”** It should save a distinct demo wish, with no outbound creator message. The operator checks the adult storyteller on the receipt.
- [ ] **7.3 Update and cancellation.** Say **“Show my demo updates.”** The fixture inbox should report the wish update once. Start another wish with **“I want a story about space,”** then say **“No.”** Alexa should say no new demo wish was saved. If other unread updates exist, record their order and continue until the wish update is heard.
- [ ] **7.4 Unknown creator.** Open; say **“Ask Mila for another mermaid story.”** Mila is not in the delivered fixture catalog. Alexa should ask which adult storyteller from the demo catalog is meant and should not save or send a wish.

## 8. Help and story credits

- [ ] **8.1 Creation help.** Open; say **“How do I create a story?”** Alexa should explain that the parent chooses a listener and completes delivery in the Spoken Letter app; it may offer a name-free demo draft on Alexa.
- [ ] **8.2 Credit help.** Open; say **“How do I add story credits?”** and **“Can you add story credits?”** Both should direct the parent to the app and say Alexa cannot charge or change credits. Also try the original bare form **“Add story credits.”** and record its routing separately. The operator confirms no payment or entitlement write occurred.

## Close the run

For every check, keep the device observation separate from ASK logs and backend readback. A test passes only when the expected **device behavior** occurred and the relevant receipt or playback evidence agrees. Record failures with the exact utterance, actual reply, actual intent and slot names, story ID, and redacted token transition. Use **NOT RUN** for missing deployment, exhausted read-once fixture state, absent opt-in, or an unauthorized notification send. Do not convert an offline simulator result or a successful Amazon API response into an Echo pass.

The original ideal list also asks for real recipient delivery, creator notifications or email, named birthdays, a favorites collection, and credit additions. These are outside the current fixture demo. The checks above verify the implemented handoff or demo-only behavior for those categories; they do not establish the original account effects.

## Source anchors

- Original categories: the Owner's seven-category use-case list supplied for this plan.
- Device model and supported phrases: `packages/skill/src/model/generate.ts:23`, `packages/skill/src/model/generate.ts:281-317`.
- Device routing and truthful receipts: `packages/skill/src/handler.ts:250-479`.
- Delivered fixtures and event IDs: `fixtures/stories.json:1-31`, `fixtures/events.json:1-17`.
- Notification payload and development endpoint: `packages/skill/src/proactive-events.ts:1-62`, `packages/skill/src/notification-worker.ts:31-72`.

## 9. October 1 session-friction acceptance

This section is the current acceptance matrix for [the session-friction plan](plans/2026-10-01-alexa-session-friction.md). Sections 1–8 describe the earlier fixture rehearsal; their older expected “demo/fixture” copy is not a requirement for this candidate. Current replies say “story draft,” “wish,” and “reaction.” The same fixture-only effects apply. These are designed test phrases, not a reconstruction of the September 30 speech.

Current status: local integrated journeys I1–I4 passed using the real skill handler, client, Hono routes, and in-memory draft store. `amazon_routing=UNVERIFIED`; `echo_acceptance=UNVERIFIED`. All cases below are **NOT RUN** on Amazon or Echo for this candidate. Local generated en-US model SHA-256: `bf3f7afa21acaa22d0f4d49eb1b7e0155aa958402b3d0b19e074972c11db7624`. The operational verification receipt identifies the tested source; a digest alone does not establish deployment.

An adult speaks the planned lines and observes audio. The agent/operator handles CLI publication, dialog requests, log retrieval, and backend readback after the applicable authorization. Every positive recognition case must work on its first attempt without fallback. An invalid turn must disclose recovery and permit the next valid answer without reopening. Record actual intent and slot presence rather than assume the invalid turn reached `AMAZON.FallbackIntent`.

| Case | Planned input and sequence | Required observation | Current external status |
| --- | --- | --- | --- |
| R1 | Open → “let's create a story” → “mermaids” → reopen → “read my draft” | Start routes to `StartStoryIntent`, answer to `ThemeChoiceIntent`; theme prompt and reprompt; one stored mermaids receipt; readback matches its actual outline. | NOT RUN |
| R2 | Open → “let's make a story” → “space” | First-attempt start and bare-topic recognition; one space draft. | NOT RUN |
| R3 | Open → “I would like to create a story” → “about forest” | Start followed by existing `ThemeIntent`; one forest draft. | NOT RUN |
| R4 | Open → “I'd like to make a story about animals” | Explicit theme on `StartStoryIntent`; one animals draft without another question. | NOT RUN |
| R5 | Start creation → deliberately unknown response → another unknown response → “about mermaids” | Record actual routing on both invalid turns. If they reach fallback, neither writes; state stays draft, count advances 1 then 2, second guidance gives a carrier and cancel; final answer saves one draft without reopening. | NOT RUN |
| R6 | Start creation → wait for reprompt → “space” | Reprompt asks for a theme, not playback; valid answer saves one space draft. | NOT RUN |
| R7 | Start creation → “cancel” → reopen → “mermaids” → explicit start → valid theme | Cancellation and bare topic save nothing; reopening has no pending draft state; explicit fresh creation succeeds. Previously saved drafts can still exist. | NOT RUN |
| R8 | Control requests: “what is new,” “play all my stories,” “play the story Ignacio the snail,” then “Alexa, pause” | Existing intent routing and listing; actual recording starts, `PlaybackStarted` observed; pause stops audio. No draft write. | NOT RUN |
| R9 | When fixture state permits, pending wish → help/fallback → “yes”; pending reaction → help/fallback → “I love it” | Wish guidance uses yes/no; reaction guidance uses supported carriers and no; validated state survives; actual confirmed receipts agree; no unintended draft. Mark unavailable fixture state NOT RUN. | NOT RUN |

For each case, record PASS/FAIL/NOT RUN, observed intent, generated-slot presence flags, code-owned response key, interaction result, bounded fallback count, ephemeral session/request hashes, receipt/readback agreement, and elapsed turn time with cold/warm status. Report case counts and individual durations. Keep Echo observations distinct from ASK logs and backend readback; a Play directive or successful backend call does not prove device audio. Do not claim a latency percentile or improvement from this small sample. Save planned phrases only in local test evidence; runtime logs must not contain unsolicited raw speech, names, user/device IDs, tokens, URLs, or model replies.

### Operator checklist after separate authorization

1. Revalidate clean `develop`, the exact integration commit, and the five-check local receipt. Confirm the skill is `amzn1.ask.skill.0598e354-ee92-413f-940a-61e4a6a0a2a7`, development stage, en-US, endpoint `alexa.spokenletter.com`, and actual stack outputs. Resolve the installed ASK CLI with `pnpm -F @spoken-letter-alexa/skill exec ask --version`; require 2.x. No global 1.x CLI workaround is acceptable.
2. Apply [the documented release procedure](release.md) for `develop` → `main` and `pnpm deploy` only under release/deployment authorization. Publish metadata with the existing `pnpm -F @spoken-letter-alexa/skill deploy` only under separate ASK publication authorization. No notification send is part of this repair.
3. Verify Amazon model build status and fetch the development model. Compare its digest with the candidate's generated model. Record skill ID, stage, locale, model digest, actual endpoint, Lambda code SHA-256 and last-modified time, plus build evidence connecting the bundle to the source candidate. Never infer Git/AWS identity from timestamps alone.
4. Run development ASK dialog cases, then the adult Echo matrix. The operator performs software operations; the adult supplies hardware speech and observations. Preserve genuine `PlaybackStarted` and receipt-backed readback evidence.
5. Retrieve logs read-only using AWS profile `archy`, account `106403001709`, region `us-east-1`, skill group `/aws/lambda/sla-alexa-skill`, and API group `/aws/lambda/sla-alexa-api`. Check presence/result/flow fields, response keys, fallback counter, hashed correlation, and absence of raw values. Legacy `slots` nulls mean redacted, not missing. Keep `LOG_SAY` and `RECORD_UTTERANCES` off; neither is needed or enables raw recording.
6. A failed remote action is a retained failed result. Reproduce and repair locally and complete the new gates before requesting a new remote attempt. Do not automatically republish, redeploy, rerun CI, or send Proactive Events.

Local journey implementation: `packages/skill/src/session-recovery.integration.test.ts:1`. Safe turn diagnostics: `packages/skill/src/handler.ts:678`. Model generator: `packages/skill/src/model/generate.ts:268`.
