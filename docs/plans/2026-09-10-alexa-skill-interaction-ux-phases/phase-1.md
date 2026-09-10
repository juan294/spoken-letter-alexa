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

*(empty until the manual run — Phase 2 does not start until this section is filled)*

**D-U4 second claim, to be discharged here.** The sub-40 ms empty responses at 08:56:33,
08:56:57, 08:57:05, 08:57:28, 08:57:48 and 08:58:04 (twice) were inferred to be
`SessionEndedRequest` and `AudioPlayer.*` events from their timing shape alone. Record
what `requestType` actually says, and correct the friction-log entry if the inference was
wrong.

## 8. Handoff

**Next.** Phase 2, but only once section 7 is filled and the Owner has confirmed the
deploy. Carry forward: the measured p50/p95 of `SkillTurnMs` by intent (Phase 2's
acceptance criterion is stated against it), the true request types from section 7, and
whatever section 7 reveals about the zero-tool play turn.
