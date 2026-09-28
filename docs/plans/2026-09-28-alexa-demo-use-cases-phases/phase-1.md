# Phase 1: playback journeys

Base and scope: `develop` at `9d58fbb6616bbdad252a35eba3e30bf71e90c273`, subject to revalidation on entry. This phase absorbs the unfinished playback and conversation pieces of `docs/plans/2026-09-10-alexa-skill-interaction-ux-phases/phase-4.md:1-11`, `:54-115`, and `:129-172`. Before editing, record the five outstanding Phase 3 device checks named in `docs/plans/2026-09-10-alexa-skill-interaction-ux-notes.md:165-172` and reconcile any contrary live observations. The phase is local until its separate deploy gate.

## Behavioral oracles

1. “Play my stories” starts a bounded playlist of delivered fixture stories in a shuffled order; a second start does not start with the prior first story when at least two stories exist. “Play my new stories” uses `deliveredAt` descending. “Play my stories from [adult storyteller]” filters first, then uses the requested order. The fixture provider is newest-first today (`packages/mcp-server/src/provider/fixtures.ts:58-76`); the existing suggestion tool is oldest-first, so it is not the playlist controller (`packages/mcp-server/src/tools/suggest.ts:51-70`).
2. “Play [title]” picks one unique delivered story. Multiple matching titles or creators produce a clarification, not an arbitrary first match. A missing title is spoken as unavailable, with an available choice. The current `PlayStoryIntent` carries title/storyteller slots (`packages/skill/src/handler.ts:138-145`).
3. “Skip” advances exactly once; “previous” goes back within the active playlist; “start over” and “play again” restart the current recording at offset zero; “start the playlist over” resets the list position. Outside a playlist, “next” uses the existing suggestion behavior and a previous request has a truthful fallback (`packages/skill/src/handler.ts:148-152`, `packages/skill/src/handler.ts:213-226`).
4. `PlaybackNearlyFinished` may enqueue one fresh next stream using the current token as `expectedPreviousToken`. A stale event after a voice skip cannot enqueue. `PlaybackFinished` records completion but does not speak feedback. Amazon's [AudioPlayer reference](https://developer.amazon.com/en-US/docs/alexa/custom-skills/audioplayer-interface-reference.html), retrieved 2026-09-28, requires that token for `ENQUEUE` and bars speech in the `PlaybackFinished` response.
5. A play-oriented agent reply without audio either asks a specific disambiguation question or takes a deterministic catalog fallback. It never says a story is playing without an `AudioPlayer.Play` directive (`packages/skill/src/handler.ts:253-264`; `packages/agent/src/persona.ts:4-10`). Help/reprompt names only available fixtures, extending the prior Phase 4 goal (`docs/plans/2026-09-10-alexa-skill-interaction-ux-phases/phase-4.md:97-115`).

## Implementation specification

- Add a playlist state record keyed by the hashed device identity, with ordered delivered IDs, current index, generation, last event/request ID, mode, and TTL. Reuse the two-hour session-store pattern and conditional writes for event races (`packages/agent/src/sessions.ts:5-25`, `packages/agent/src/sessions.ts:82-114`). The store must expose an atomic compare-and-set or equivalent so concurrent voice skip and nearly-finished callbacks cannot both advance. No raw Alexa ID or audio URL is persisted.
- Put deterministic catalog selection and next/previous lookup in one server-side controller. The skill uses a narrowly scoped internal command route for playlist operations; authenticate it independently of a caller-supplied device ID. Keep the ordinary `/agent/turn` text path for conversational requests (`packages/agent/src/routes.ts:162-179`). Do not rely on model prose to advance an index. The controller obtains fresh audio via the current provider/MCP read path before returning `play` (`packages/mcp-server/src/tools/get.ts:24-42`).
- Extend `AgentClient` for that command route and the skill handler for playlist intents and audio events. `playDirective` gains an `ENQUEUE` variant with `expectedPreviousToken`; `REPLACE_ALL` stays for direct play and skip (`packages/skill/src/agent-client.ts:7-18`; `packages/skill/src/audio.ts:20-33`, `packages/skill/src/audio.ts:89-102`). Keep application-ID validation before all commands (`packages/skill/src/handler.ts:187-192`).
- Add only skill intents required for speech routing; the three MCP tools stay unchanged. Extend `generate.ts`, then regenerate committed `en-US.json`; never hand-edit the generated model (`packages/skill/src/model/generate.ts:270-295`; `packages/skill/src/model/generate.test.ts:173-176`). Reconcile prior Phase 4's `needsAnswer`, truthful failure copy, catalog-derived examples, and session-backed suggestion goal where they serve this phase, and record any deliberate divergence.

```
@ advancePlaylist(deviceKey, observedToken, eventId) -> playbackAction
ctx: playlistStore, catalogProvider, freshAudio, clock
pre: deviceKey is authenticated; playlist exists
do:
  1. lookup playlist and validate token generation
  2. compute next index from saved order
  3. fetch fresh delivered-story audio
  4. write next index with conditional version and event ID
  5. emit ENQUEUE or REPLACE_ALL playback action
br: if stale or duplicate -> emit no directive; if end -> mark complete
fail: missing audio -> disclose on next invocation and keep prior index
risk: an out-of-order callback can otherwise enqueue a skipped story
```

## Work units and tests

Unit A owns playlist store/controller and its tests in `packages/agent` plus the new internal route. Unit B owns skill audio/handler/client/model and their tests after A's response contract is fixed; these are sequential because B consumes A. Existing MCP tool tests remain unchanged unless a discovered provider contract issue demands a separately recorded adjustment. A single integration owner merges both locally; no working-branch push or PR.

Write failing tests first for shuffled no-immediate-repeat, newest-first, creator filtering, ambiguous title, empty and over-20 catalogs, voice skip versus stale callback interleavings, duplicate callback idempotency, last-track end, previous at first track, restart versus playlist reset, expired audio, no `play` from the model, and no child name in logs or responses. The failure test must assert both the safe outcome and the next spoken recovery path. Test generated model drift and ASK model validation before metadata publication.

Run `python3 .rpi/scripts/rpi-verify.py` sequentially after the phase; the policy enumerates typecheck, lint, test, CDK synth, and simulator E2E (`.rpi/policy.json:7-42`). Record the exact commit/worktree and every result. Manual acceptance, after separately authorized deploy: parent says “play all,” “skip,” “previous,” “start over,” “play again,” “play new stories,” a creator name, and one title on an Echo; capture actual intent, response, stream token transition, and device playback. Stop for Phase 1 acceptance before Phase 2.

## Handoff

The existing skill handles one `REPLACE_ALL` stream at a time and returns empty `AudioPlayer.*` responses (`packages/skill/src/audio.ts:89-102`; `packages/skill/src/handler.ts:198-201`). Phase 1 replaces that behavior only after the prior Phase 3 on-device observations have been recorded. The next phase can rely on the playlist's completed-play marker for reaction timing, but must revalidate its actual schema and tested identity.
