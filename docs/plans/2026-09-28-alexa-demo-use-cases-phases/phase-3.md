# Phase 3: wishes, reactions, and updates

Entry: Phases 1 and 2 accepted and their store contracts revalidated on the actual integration commit. This phase adds parent-operated, fixture-only update flows. The existing skill has no notification permission, feedback state, or wish provider operation (`packages/skill/skill-package/skill.json:31-49`; `packages/mcp-server/src/provider/types.ts:25-28`). It does not add an MCP write tool.

## Behavioral oracles

1. When a fixture story finishes for the first time, record completion through the `AudioPlayer.PlaybackFinished` callback. At the parent's **next skill invocation**, ask “Did you like or love that story?” once. A “like” or “love” response saves a demo reaction tied to the delivered story ID and adult creator alias, and says it was saved for the demo. It does not say it reached the creator. A dismissal ends the pending prompt. `PlaybackFinished` itself returns no speech, per Amazon's [AudioPlayer reference](https://developer.amazon.com/en-US/docs/alexa/custom-skills/audioplayer-interface-reference.html), retrieved 2026-09-28.
2. “I want a story about mermaids” creates a demo wish after the parent confirms its topic. “Ask [adult storyteller] for another mermaid story” additionally resolves that storyteller against the fixture catalog. An unknown creator yields a clarification. The wish is visible in the fixture inbox; no email or private-app record is made. The current provider exposes storyteller names and delivery time, but no wish operation (`packages/mcp-server/src/provider/types.ts:5-28`).
3. Opening the skill can announce a fixture new-story update, a saved reaction or wish update, or a synthetic family occasion, each with a timestamp and type. A birthday example uses “a family birthday” with no child name or birth date. The parent can ask for the detail inside the skill and start a demo draft. The event is marked read only after it is spoken or explicitly dismissed.
4. On an opted-in Owner device, one `AMAZON.MessageAlert.Activated` development event produces Amazon's generic notification wording and a subsequent skill invocation reads its fixture detail. The event uses a stable idempotency reference and no child name, story title, wish text, or other personal text in the Proactive Events payload. Amazon's [schema reference](https://developer.amazon.com/en-US/docs/alexa/smapi/schemas-for-proactive-events.html), retrieved 2026-09-28, controls the message template; the [Proactive Events guide](https://developer.amazon.com/en-US/docs/alexa/smapi/proactive-events-api.html), retrieved 2026-09-28, defines manifest publication, device opt-in, and development endpoint testing.

## Implementation specification

- Extend the demo store with typed `playback-completion`, `reaction`, `wish`, `event`, and `notification-subscription` records. Key only by hashed device identity, fixture story ID, and generated demo IDs; use TTL and conditional writes to deduplicate callbacks and retries. A raw Alexa user ID is necessary only at the Amazon notification API boundary after opt-in; keep it encrypted, limit access to the notification worker, and erase it on unsubscribe. The existing device hash establishes the normal internal identity (`packages/agent/src/sessions.ts:41-47`).
- Add a fixture inbox and event seed file under `fixtures/`, validated at startup. Story delivery events must reference IDs in `fixtures/stories.json`; occasion fixtures carry an event type and date but no person. The skill's launch flow reads the next unread item and pending reaction before a generic prompt (`packages/skill/src/handler.ts:63-68`, `packages/skill/src/handler.ts:198-201`).
- Add generated `WishStoryIntent`, `ReactToStoryIntent`, and `UpdatesIntent` with topic and adult storyteller slots where appropriate. Validate raw speech in code and keep the model generator's child-word and Class C sample filters (`packages/skill/src/model/generate.ts:169-186`, `packages/skill/src/model/generate.ts:270-295`). Do not use a model completion as proof that a wish or reaction was saved.
- Add the manifest's Proactive Events publication and notification permission, and a subscription-event handler. A worker uses the Amazon development endpoint and a skill credential token; secrets are stored outside source. ASK validation must confirm the schema and event subscription before a send is attempted. The notification is sent only after device opt-in and separate authorization for that outward-facing API call. The in-skill inbox remains available when opt-in is absent.

```
@ recordReaction(deviceKey, storyId, choice, requestId) -> receipt
ctx: demoStore, completedPlayback, fixtureCatalog
pre: parent invocation; choice is like or love
do:
  1. validate story is delivered and completed for this device
  2. lookup prior receipt for requestId
  3. write reaction once and clear pending prompt
  4. emit demo-only saved receipt
br: if canceled -> clear prompt without reaction
fail: store unavailable -> say nothing was saved and keep prompt retryable
risk: duplicate callbacks and retries can otherwise create extra reactions
```

## Work units and tests

Unit A owns demo store/event seed and agent routes. Unit B owns skill intents, launch/prompt handling, and model generation after A's response contract is fixed. Unit C owns Amazon notification adapter and manifest; it is `[batch-eligible]` with A because it owns separate files and consumes only the agreed event schema. One integration owner checks all results and merges locally; no branch push or PR.

TDD tests cover first completed play versus repeat, `PlaybackStopped` versus `PlaybackFinished`, next-invocation reaction timing, like/love/cancel, wish topic and adult-creator resolution, unknown creator, new-story/occasion inbox order, duplicate event delivery, subscription opt-in/out-of-order/unsubscribe, notification API denial, no-opt-in disclosure, and absence of child fields in payloads/logs. Verify recovery after a failed save or rejected notification; a safety-only refusal test is insufficient. ASK development manifest validation and a single Owner-device development notification are manual acceptance, not unit-test substitutes.

Run the full sequential `python3 .rpi/scripts/rpi-verify.py` gate (`.rpi/policy.json:7-42`). Stop for Phase 3 acceptance after the Owner has authorized and observed the development event and has read back the saved fixture wish/reaction. A failure to get a device notification is recorded as a failed phase result, not reclassified as a successful spoken update.

## Handoff

This phase does not make creator email, child-originated wishes, named birthdays, or account-linked updates real. Phase 4's video script must label each fixture demonstration and must not use the Owner's source-list sentences verbatim where they imply a child spoke or received a story.
