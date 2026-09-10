# Phase 1 — Turn telemetry

**Gate. Phases 2–4 do not start until this phase is deployed by the Owner and one real
device conversation has been recorded here (D-U2).**

Today `skill_turn` carries the intent name, the tool names with timings and a `played`
boolean (`packages/skill/src/handler.ts:156`). That cannot explain the 6357 ms turn that
called no tools and played nothing, and it cannot say what the sub-40 ms empty responses
were. Every later phase is designed against data this phase produces.

## 1. What gets logged

One line per request, for **every** request type — including the ones that currently
return `EMPTY` at `handler.ts:127` and log nothing at all.

| Field | Source | Note |
| --- | --- | --- |
| `requestType` | `event.request.type` | discharges D-U4's second claim |
| `intent` | `event.request.intent.name` | absent for non-intent requests |
| `slots` | `event.request.intent.slots` | names and values, `{}` when none |
| `ms` | wall clock around the whole handler | the number the speaker experiences |
| `played` | `Boolean(reply.play)` | kept |
| `storyId` | new, see section 2 | which story, not just that one played |
| `tools` | kept as today | |
| `say` | agent reply, truncated to 120 chars | **flag-gated, see section 3** |
| `outcome` | `ok` \| `agent_error` \| `timeout` \| `rejected` | |
| `errorClass` | constructor name plus `AgentHttpError.code` | absent when `outcome` is `ok` |

`AudioPlayer.*` and `SessionEndedRequest` lines carry `requestType`, `ms` and, for
`SessionEndedRequest`, `event.request.reason` and `event.request.error`. That reason field
is how an unanswered reprompt is distinguished from a user saying "stop".

```
@ handler(event) -> response
ctx: agent client, log, clock
pre: applicationId already checked
do:
  1. capture started = performance.now()
  2. compute base = { requestType, intent?, slots?, sessionNew? }
  3. dispatch as today (launch, audio event, intent)
  4. emit "skill_turn" with base + ms + outcome + result fields
br: if non-intent -> emit with requestType only; return EMPTY as today
fx: one stdout JSON line per request; EMF envelope when EMF_NAMESPACE set
fail: agent throws -> outcome from error class; still emit; speak per Phase 4
risk: `say` is model output — never logged unless the flag is on (section 3)
```

The emit must sit where it runs for every exit path. A `try/finally` around the dispatch,
not a call at each `return`, or the empty-response paths will keep logging nothing.

## 2. `storyId` reaches the skill

`playSchema` (`packages/agent/src/schema.ts`) carries `url`, `title`, `storyteller`,
`durationSeconds` and `artUrl` — no id. Add `id` to `playSchema` (required, the story id
from `get_family_story`) and to `Play` in `packages/skill/src/audio.ts`.

`encodeStreamToken` gains `id` in its canonical key order, which changes the token
format. Old tokens must still decode: `decodeStreamToken` already tolerates missing
fields, so `id` is read as `typeof parsed.id === "string" ? parsed.id : null`. Assert that
in a test — a token minted before this deploy will be echoed back by a device that is mid
story when the new bundle lands.

## 3. `say` is model output, and is flag-gated

`say` is generated text. `AGENTS.md` and ADR 0013 keep the stored Recipient first name out
of this repository entirely, and the persona is instructed never to name a child. Neither
guarantee is a reason to write model output to CloudWatch by default.

Log `say` only when `LOG_SAY=1`, wired the same way `RECORD_UTTERANCES` already is in
`packages/skill/src/lambda.ts:24` and `infra/lib/skill-stack.ts` (`-c sla:logSay=1`, off in
the committed default). The recorded device session for this phase runs with it on; the
flag goes back to `0` afterwards. Truncate to 120 characters regardless.

## 4. Metrics

`packages/mcp-server/src/metrics.ts` already emits EMF when `EMF_NAMESPACE` is set, and
`infra/lib/api-stack.ts:69` sets it to `sla/mcp`. **`infra/lib/skill-stack.ts` sets no
`EMF_NAMESPACE`**, so the skill Lambda emits no metrics today.

- Add `EMF_NAMESPACE: "sla/mcp"` to the `SkillStack` function environment
- Emit two metrics from the `skill_turn` line: `SkillTurnMs` (Milliseconds) dimensioned by
  `Intent` and undimensioned, and `DeadEndPlay` (Count) — `1` when the request was a play
  intent (`PlayStoryIntent` or `NextStoryIntent`) and `played` was false, `0` otherwise
- The EMF envelope builder in `metrics.ts` is tool-specific; factor the envelope shape into
  a small shared helper rather than copying it into the skill package. The skill bundle must
  not gain a dependency on `@spoken-letter-alexa/mcp-server` (`packages/skill/src/audio.ts`
  documents this constraint for the agent package; the same reasoning applies here) — put
  the helper in `packages/shared`

In `infra/lib/observability-stack.ts`, next to the existing `ToolLatencyP95` alarm
(line 46) and dashboard (line 57):

- `SkillTurnP95` alarm on `SkillTurnMs` p95 > 5000 ms, on the existing SNS topic
- Dashboard widgets: `SkillTurnMs` p50/p95/p99, and `DeadEndPlay` sum

5000 ms is chosen as the alarm threshold because it leaves visible headroom under the 7 s
client abort; it is not a target. Phase 2 sets the target.

## 5. Files

| File | Change | Unit |
| --- | --- | --- |
| `packages/skill/src/handler.ts` | try/finally telemetry, all request types | A |
| `packages/skill/src/handler.test.ts` | assertions per request type | A |
| `packages/skill/src/lambda.ts` | `LOG_SAY` flag | A |
| `packages/agent/src/schema.ts` | `id` on `playSchema` | B |
| `packages/skill/src/audio.ts` | `id` on `Play`, token round trip | B |
| `packages/skill/src/audio.test.ts` | old-token compatibility | B |
| `packages/agent/src/persona.ts` | instruct the model to return the id | B |
| `packages/shared/src/metrics.ts` (new) | EMF envelope helper | C |
| `packages/mcp-server/src/metrics.ts` | use the shared helper | C |
| `infra/lib/skill-stack.ts` | `EMF_NAMESPACE`, `LOG_SAY` | D |
| `infra/lib/observability-stack.ts` | alarm + widgets | D |
| `infra/test/*` | synth assertions | D |

Units C and D are `[batch-eligible]` against each other. A and B are not: B changes the
`Play` type that A logs. One integration owner; no working-branch push, no PR.

## 6. Acceptance

**Automated.** `pnpm typecheck && pnpm lint && pnpm test && pnpm -F infra synth`,
sequential, all pass. New tests must include:

- a `skill_turn` line is emitted for `LaunchRequest`, `SessionEndedRequest`,
  `AudioPlayer.PlaybackStarted` and an `IntentRequest`
- `say` is absent from the line when `LOG_SAY` is unset and present when set
- a stream token minted without `id` still decodes, with `id` null
- `cdk synth` shows `EMF_NAMESPACE` on the skill function and the `SkillTurnP95` alarm

**Manual, Owner.** `pnpm deploy` with profile `archy`, `-c sla:logSay=1`. Then one real
conversation on the Echo of at least six turns, deliberately including:

1. `open spoken letter`, then stay silent until the session ends
2. a play request phrased the way the skill's own help text suggests
3. `what is new`
4. a play request naming a story
5. `next one` while the story is playing
6. `stop`

Paste the resulting `skill_turn` lines into section 7 below. Then redeploy with
`sla:logSay` unset.

## 7. Recorded evidence

Recorded 2026-09-10, 14:48:07-14:56:46 UTC, real Echo device, `sla-alexa-skill` deployed
with `-c sla:logSay=1` (commit `a316dad`). Pulled from `/aws/lambda/sla-alexa-skill` via
`aws logs filter-log-events --filter-pattern "skill_turn"`, two passes (one to close the
"next one" gap below), nothing elided.

| Time (UTC) | requestType | intent | slots | ms | played | outcome | note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 14:48:07.179 | LaunchRequest | — | — | 0 | false | ok | "open spoken letter" |
| 14:48:52.694 | SessionEndedRequest | — | reason: USER_INITIATED | 0 | false | ok | reprompt unanswered, session closed |
| 14:48:52.792 | LaunchRequest | — | — | 0 | false | ok | re-launched |
| 14:49:11.557 | IntentRequest | WhatIsNewIntent | — | **7005** | false | **timeout** (`DOMException`) | hit the 7 s agent-client abort |
| 14:49:26.783 | IntentRequest | WhatIsNewIntent | — | 3737 | false | ok | retry; tools=[list_family_stories:7.6ms]; say: "You have the same three stories—no new ones since last time. The newest is still..." |
| 14:49:37.799 | IntentRequest | AMAZON.FallbackIntent | — | 0 | false | ok | unrecognized utterance (raw speech not logged) |
| 14:49:50.182 | IntentRequest | PlayStoryIntent | title: "grandpa sent" | 3327 | false | ok, **DeadEndPlay=1** | say: "I don't see any stories from Grandpa—all three stories are from Aunt Whitney. Would you like me to play one of those ins[tead]..." |
| 14:49:58.773 | IntentRequest | AMAZON.FallbackIntent | — | 0 | false | ok | unrecognized utterance |
| 14:50:11.681 | IntentRequest | PlayStoryIntent | title: "Ignacio" | 3936 | true | ok | storyId: st_ignacio_the_snail; tools=[get_family_story:10.4ms]; say: "Here's \"Ignacio the snail\" from Aunt Whitney!" |
| 14:50:15.686 | AudioPlayer.PlaybackStarted | — | — | 0 | false | ok | |
| 14:52:20.057 | IntentRequest | AMAZON.PauseIntent | — | 0 | false | ok | "stop" (routed to Pause, not Stop/Cancel) |
| 14:52:21.304 | AudioPlayer.PlaybackStopped | — | — | 0 | false | ok | |
| 14:55:41.455 | LaunchRequest | — | — | 0 | false | ok | re-launched to close the "next one" gap |
| 14:55:55.468 | IntentRequest | AMAZON.FallbackIntent | — | 0 | false | ok | unrecognized utterance |
| 14:56:13.184 | IntentRequest | PlayStoryIntent | storyteller: "aunt Whitney" | 6251 | true | ok | storyId: st_mauricio_the_bull; tools=[suggest_next_story:25.9ms, get_family_story:10.4ms]; say: "Here's the newest one from Aunt Whitney—\"Mauricio the train riding bull\"!" |
| 14:56:18.645 | AudioPlayer.PlaybackStarted | — | — | 0 | false | ok | |
| 14:56:30.217 | IntentRequest | **AMAZON.NextIntent** | — | 0 | false | ok | "next one" said while playing; **not a case `createHandler`'s switch handles** — falls through to `textForIntent` -> null -> "Which family story would you like?" (the dead-end the Owner heard) |
| 14:56:41.999 | IntentRequest | NextStoryIntent | — | 3925 | true | ok | storyId: st_martina_the_mermaid; tools=[suggest_next_story:7.1ms, get_family_story:6.8ms]; say: "Here's \"Martina the music loving mermaid\" from Aunt Whitney!" — same spoken request, this time routed to the intent the skill does handle |
| 14:56:43.816 | AudioPlayer.PlaybackStopped | — | — | 0 | false | ok | |
| 14:56:46.552 | AudioPlayer.PlaybackStarted | — | — | 0 | false | ok | |

**D-U4 second claim, discharged.** The sub-40 ms empty-response inference from the original
08:56-08:58 session was that they were `SessionEndedRequest` and `AudioPlayer.*` events,
guessed from timing shape alone. This recording confirms it directly: `SessionEndedRequest`,
`LaunchRequest` and every `AudioPlayer.*` line above measure 0 ms with `requestType` now
logged explicitly. The inference was correct; no friction-log correction needed.

**New finding: the timeout is not hypothetical.** `WhatIsNewIntent` at 14:49:11 hit the 7 s
client abort exactly as the 2026-09-10 friction-log entry described for `PlayStoryIntent`;
the identical turn 15 s later (retry, warm) took 3737 ms. This is a second, independent
measurement of the same "turn latency is model round trips" finding, now with an
`outcome: "timeout"` / `errorClass: "DOMException"` telemetry signature Phase 2 can alert on
directly.

**New finding: the dead-end play reproduced live.** "Grandpa sent" — the skill's own
advertised utterance (`packages/skill/src/handler.ts` help text) — produced
`DeadEndPlay: 1`: no story played, `say` explained no story is from a "Grandpa." This is
the exact defect Phase 3/4 are scoped to fix, now confirmed against a real user turn rather
than only the friction-log's synthetic reasoning.

**Item 5, closed with a live defect: "next one" mid-playback is not reliable.** The first
attempt (14:56:30) routed to `AMAZON.NextIntent`, which nothing in
`packages/skill/src/handler.ts`'s intent switch handles, so it fell through to
`textForIntent` returning `null` and the skill asked "Which family story would you like?" —
the exact dead-end the Owner heard live. A second, differently-phrased attempt (14:56:41)
routed to `NextStoryIntent`, which the skill does handle, and it played correctly. This is
the plan's own predicted risk (section 6, "Adding playback intents can shift NLU routing for
existing utterances... `AMAZON.NextIntent` will compete for it"), now observed from the
opposite direction: today `AMAZON.NextIntent` is not a competing route, it is an unhandled
dead end. **Carried into Phase 3:** the interaction model needs `AMAZON.NextIntent` routed to
the same behavior as `NextStoryIntent`, not just added alongside it as the plan's risk table
assumed.

## 8. Handoff

**Section 7 filled, deploy confirmed by the Owner (2026-09-10).** D-U2's gate is satisfied;
Phase 2 may start.

**Next.** Phase 2. Carry forward:

- **Measured `SkillTurnMs` (n=1 per turn, not yet a distribution — Phase 2's acceptance
  criterion needs at least ten play turns before it can be read as p95):**
  `WhatIsNewIntent` 7005 ms (timeout) then 3737 ms (warm retry); `PlayStoryIntent` 3327 ms
  (dead end, no tools called), 3936 ms (played, one tool), 6251 ms (played, two tools —
  `suggest_next_story` + `get_family_story`, cold); `NextStoryIntent` 3925 ms (played, two
  tools, warm). Consistent with the friction log's "~3.1 s one tool, ~5.7-6.9 s two tools"
  finding.
- **The true request types (section 7, D-U4 second claim):** confirmed —
  `SessionEndedRequest` and every `AudioPlayer.*` line measure 0 ms, matching the original
  inference.
- **The zero-tool play turn:** not reproduced this session (14:49:50's dead end called zero
  tools but that's the "grandpa sent" no-match case, not the original unexplained one) — no
  new evidence either way.
- **New for Phase 3:** `AMAZON.NextIntent` said mid-playback is an unhandled dead end today
  (section 7); the interaction-model work must route it to the same behavior as
  `NextStoryIntent`, not merely add it as a second option.
