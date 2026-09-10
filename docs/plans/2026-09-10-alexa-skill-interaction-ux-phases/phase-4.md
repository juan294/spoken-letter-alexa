# Phase 4 — Conversation shape and spoken copy

The phase that decides whether the skill feels like a product. Four defects, all live
behaviour, none observable in a unit test alone.

## 1. A story leads somewhere

`handler.ts:127` answers every `AudioPlayer.*` and `PlaybackController.*` event with an
empty response. So `PlaybackNearlyFinished` enqueues nothing, `PlaybackFinished` stages
nothing, and a five-minute story ends into silence.

```
@ audioEvent(event) -> response
ctx: stream token (carries the played story), session state
pre: token decodes
do:
  1. branch on request type
  2. NearlyFinished -> if continuous play is on, enqueue the next story
  3. Finished -> record the story as played; stage the follow-up
  4. PlaybackFailed -> log with the error; do not retry silently
br: if not continuous -> NearlyFinished returns EMPTY as today
fx: at most one ENQUEUE directive; one session write
fail: token undecodable -> EMPTY, logged
risk: ENQUEUE with the wrong expectedPreviousToken is dropped silently by Alexa
```

`AudioPlayer.Play` with `playBehavior: "ENQUEUE"` requires `expectedPreviousToken` to match
the currently playing token, so the enqueue must be built from the token Alexa reports in
the `PlaybackNearlyFinished` request, never from local state.

Continuous play is opt-in, set when the speaker asks for it ("play them all", "keep
going") and cleared by Stop/Cancel. Default off: a family story is a deliberate thing, and
auto-advancing through a grandparent's recordings uninvited is the wrong default.

The audio URL expires (`AUDIO_TTL_MS`, one hour). An enqueued story must be fetched fresh
through `get_family_story` at `PlaybackNearlyFinished`, not carried from an earlier turn.
The same expiry is a latent hazard for `AMAZON.ResumeIntent`, which rebuilds a directive
from a token of any age — with fixtures the URL is static so it works today, but the real
bridge will sign it. Record that as a known limitation here; fixing it belongs with the
bridge work after the freeze lifts, not in this phase.

## 2. A play request never dead-ends

The 6357 ms turn on 2026-09-10 called no tools, played nothing, and answered with a
question. At `handler.ts:157` a `played: false` reply is spoken as-is.

For `PlayStoryIntent` and `NextStoryIntent` specifically: if the agent returns no `play`,
fall back rather than dead-ending.

```
@ playIntentFallback(reply, session) -> response
pre: intent is a play intent; reply.play is null
do:
  1. if reply.say asks a genuine disambiguation -> ask it, with YesIntent armed
  2. else fetch the newest story from the session catalog
  3. play it, prefixed by a one-line acknowledgement
br: if catalog empty -> "Nothing has been delivered yet." and end
fx: one extra get_family_story call on the fallback path only
risk: overriding a legitimate clarifying question — hence step 1
```

Step 1 needs a signal, not a guess. The cheapest reliable one: add an optional
`needsAnswer: boolean` to `turnOutputSchema` (`packages/agent/src/schema.ts`) and instruct
the persona to set it when `say` is a question the speaker must answer. Then the fallback
triggers only on `play === null && !needsAnswer` — a model that talks without acting.
When `needsAnswer` is set, arm `AMAZON.YesIntent`/`NoIntent` (Phase 3) by storing the
pending question on the session so "yes" resolves against it.

Phase 1's telemetry says how often this path fires. If it fires on most play turns, the
persona is the problem and the fallback is a bandage — record that here rather than
declaring the phase done.

## 3. Failure copy by error class

`RETRY` (`handler.ts:51`) is spoken for every exception: timeout, auth loss, provider
outage. `FALLBACK_SAY` (`packages/agent/src/schema.ts`) tells the speaker to reconnect the
skill in the Alexa app even when a model call timed out.

Phase 1 already classifies the error into `outcome` and `errorClass`. Use the same
classification:

| Cause | Spoken |
| --- | --- |
| Client abort / timeout | "That one took too long to find. Ask me again and I'll have it ready." |
| `unauthenticated` | "Spoken Letter needs reconnecting in the Alexa app." |
| `provider_unavailable` | "Spoken Letter isn't reachable right now. Try again in a moment." |
| Empty catalog | "Nothing has been delivered yet." |
| Anything else | the current generic line |

`FALLBACK_SAY` becomes the provider-unavailable case only; the timeout case gets its own
string. The tool-level `ERROR_TEXT` map at
`packages/mcp-server/src/tools/index.ts:37` is already written this way — reuse its
wording so the two layers do not contradict each other.

## 4. Copy the catalog can back

`handler.ts:48`, `:50` and `:53` all offer "play the story Grandpa sent". The catalog holds
three stories, all by Aunt Whitney.

The session already carries the catalog after Phase 2. Derive `REPROMPT`, `HELP` and
`NOTHING_TO_PLAY` from it — "You can say: play Ignacio the snail, or ask what's new." The
skill Lambda gets the catalog from the agent's session-open reply, so
`/agent/session` returns a small `examples` array alongside `sessionId`.

Keep a constant fallback for the pre-session case (`LaunchRequest` answers before any
agent call): a generic "Which family story would you like?" with no invented name in it.
A name that is not in the catalog must never appear in spoken copy again — assert it in a
test that reads `fixtures/stories.json`.

## 5. `suggest_next_story` becomes reachable

`packages/mcp-server/src/tools/index.ts:100` registers it. `packages/agent/src/persona.ts`
names only `list_family_stories` and `get_family_story`, so the model has never been told
it exists. Add it to the persona with an explicit rule: for "next", "another" or "what
should I hear next", call `suggest_next_story`, then `get_family_story` with the id it
returns.

`SuggestionMemory` (`packages/mcp-server/src/tools/suggest.ts:22`) is a per-container
in-memory ring, and containers recycled six times in 50 minutes on 2026-09-10, so "next"
is not reliably next. Move the ring onto the agent session record, which is already in
DynamoDB with a 2-hour TTL and already keyed per device
(`deviceSessionId`, `packages/agent/src/sessions.ts:35`). The tool's `SuggestionMemory`
interface stays; only its backing store changes, so `suggest.test.ts` keeps its shape.

## 6. Files

| File | Change | Unit |
| --- | --- | --- |
| `packages/skill/src/handler.ts` | audio events, fallback, error copy, catalog copy | A |
| `packages/skill/src/handler.test.ts` | one case per branch | A |
| `packages/skill/src/audio.ts` | ENQUEUE directive builder | A |
| `packages/agent/src/schema.ts` | `needsAnswer`, failure strings | B |
| `packages/agent/src/persona.ts` | `suggest_next_story`, `needsAnswer` rule | B |
| `packages/agent/src/routes.ts` | `examples` in the session reply | B |
| `packages/mcp-server/src/tools/suggest.ts` | session-backed ring | C |
| `packages/mcp-server/src/tools/suggest.test.ts` | persistence across containers | C |

C is `[batch-eligible]` against A and B. A and B are not independent — A consumes
`needsAnswer` and `examples` from B. One integration owner; no working-branch push, no PR.

## 7. Acceptance

**Automated.** Full gate, sequential. New tests must include:

- `PlaybackNearlyFinished` with continuous play on returns an ENQUEUE directive whose
  `expectedPreviousToken` is the token from the request
- `PlaybackNearlyFinished` with continuous play off returns an empty response
- a play intent with `play: null, needsAnswer: false` plays the newest story
- a play intent with `play: null, needsAnswer: true` asks the question and does not play
- a play intent with `play: null` and an empty catalog says nothing has been delivered
- each error class produces its own spoken string
- no spoken constant contains a name absent from `fixtures/stories.json`
- the suggestion ring survives a simulated container restart

**Manual, Owner.** Deploy, then on the Echo:

1. Let a story play to the end — something follows, or silence is deliberate
2. `play them all`, then let one finish — the next starts
3. `stop` mid-story, then `resume` — resumes at the offset
4. Ask for a story that does not exist — a real answer, and something plays or a real
   question is asked; no dead end
5. `next one` three times — three different stories, not the same one
6. `help` — the example names a story that exists

Paste the `skill_turn` lines into section 9.

## 8. Known limitation carried forward

`AMAZON.ResumeIntent` and any enqueue rebuild a play directive from a stream token that
may be older than the audio URL's one-hour TTL. Harmless with static fixture URLs; a real
defect once the private-repository bridge signs them. Belongs to the Phase 3 bridge work
in `docs/plans/2026-09-03-alexa-plus-mcp-add-on-phases/phase-3.md`, after the freeze lifts
on 2026-10-01. Do not fix it here.

## 9. Recorded evidence

*(empty until the manual run)*

## 10. Handoff

**Next.** Nothing in this plan. Fold the outcome into
`docs/plans/2026-09-03-alexa-plus-mcp-add-on-notes.md` and update the friction-log entry
with anything the four phases proved wrong. If Phase 2's p95 landed above 4000 ms, D-U3
(the model bypass) is still open and needs an Owner decision before submission.
