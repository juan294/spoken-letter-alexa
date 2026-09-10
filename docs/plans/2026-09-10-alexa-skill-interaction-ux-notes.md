# Implementation notes — Alexa skill interaction UX

Per-phase handoffs and deviations for `docs/plans/2026-09-10-alexa-skill-interaction-ux.md`.

## Phase 1 — Turn telemetry

**Status.** Complete. Automated scope merged to `develop` (`5dea549`/`a316dad`). The manual
gate (D-U2: Owner `pnpm deploy` with `-c sla:logSay=1`, one real six-turn device conversation)
was run by the Owner 2026-09-10; results are in `phase-1.md` section 7 (`c6fac58`), and the
stack was redeployed with `sla:logSay` unset afterward. D-U2 is satisfied; Phase 2 was
unblocked.

**Worktree.** `../spoken-letter-alexa-phase1`, branch `feat/skill-ux-phase1`, base `develop`
at `0dd92b0`.

## Deviations

**Plan said:** `outcome: 'ok' | 'agent_error' | 'timeout' | 'rejected'` and `errorClass:
constructor name plus AgentHttpError.code` (phase-1.md section 1), without specifying which
caught errors map to which outcome.
**Found:** `packages/skill/src/agent-client.ts` throws `AgentHttpError` for every
HTTP/protocol-contract failure from the agent service (non-2xx, non-JSON body, malformed
reply shape) and lets a timed-out `fetch` reject with the platform's abort error.
**Chose:** `classifyError` (`packages/skill/src/handler.ts`) maps `AgentHttpError` →
`rejected` (errorClass `AgentHttpError:<code>`), an abort (`DOMException` named
`AbortError`) → `timeout`, any other `Error` → `agent_error` (errorClass = constructor
name), and a non-`Error` throw → `agent_error` with `errorClass: "UnknownError"`.
**Why:** the plan names the union type but not the rule; this groups "the agent explicitly
answered but the turn failed" separately from "the client's own budget fired" and from
"something unexpected happened," which is the distinction Phase 1's own motivation (diagnose
the unexplained 6357 ms zero-tool turn) needs. Verified independently by a fresh reviewer
against the actual throw sites in `agent-client.ts` — no correction needed.

**Plan said (section 4):** `SkillTurnMs` is "dimensioned by Intent."
**Found:** most request types (`LaunchRequest`, `SessionEndedRequest`, `AudioPlayer.*`) carry
no `intent` at all.
**Chose:** the `Intent` dimension value is `telemetry.intent ?? requestType`, so non-intent
turns still contribute a coherent per-category series instead of being dropped from the
metric.
**Why:** section 4 doesn't address non-intent turns; dropping them from `SkillTurnMs`
entirely would have made the dashboard blind to launch/session-end latency, which section 1
says this phase exists to make visible. Flagged by an independent reviewer as a defensible
reading, not a bug — recorded here for visibility per Rule 70's spirit rather than left
silent.

**Plan said (section 1 pseudocode, line 39):** `compute base = { requestType, intent?,
slots?, sessionNew? }`.
**Found:** `sessionNew` does not appear anywhere in section 1's authoritative field table,
and none of section 6's acceptance tests reference it.
**Chose:** did not log a `sessionNew` field; followed the field table as the spec of record.
**Why:** the field table is titled "What gets logged" and enumerates every field
exhaustively; the pseudocode line reads as a stale draft fragment. Recorded here rather than
silently dropped, per an independent reviewer's flag.

## Simplify pass (post plan-compliance review)

Four-angle review (reuse / simplification / efficiency / altitude) on the Phase 1 diff found
two fixes, both applied:

- **Reuse + altitude, same finding.** `infra/lib/skill-stack.ts` hardcoded
  `EMF_NAMESPACE: "sla/mcp"` instead of importing the existing
  `METRIC_NAMESPACE` constant from `infra/lib/observability-stack.ts`. Fixed: now imports
  and uses `METRIC_NAMESPACE`, so the Lambda's EMF namespace and the dashboard/alarm
  namespace can't drift apart.
- **Altitude.** `packages/skill/src/handler.ts` computed `DeadEndPlay` from a standalone
  `PLAY_INTENTS` Set duplicating the same "which intents expect to play a story" fact already
  encoded in `textForIntent`'s switch, with nothing tying the two together. Fixed:
  `textForIntent` now returns `{ text, playOriented }`, and the `DeadEndPlay` metric reads
  `telemetry.playOriented` — one place decides which intents are play-oriented.

No efficiency or simplification findings; the new `packages/shared/src/metrics.ts` helper
was confirmed to be a clean extraction with no leftover duplication in
`packages/mcp-server/src/metrics.ts`.

Full local gate (`pnpm typecheck && pnpm lint && pnpm test && pnpm -F infra synth`, run
sequentially) is green after both fixes.

## Phase 2 — Perceived latency

**Status.** Automated scope complete, merged to `develop`. The manual gate (deploy, then ten
play turns on the Echo across at least two cold containers, `SkillTurnMs` p95 for
`PlayStoryIntent` read from CloudWatch) is **not done** — it requires the Owner's AWS deploy
access and a physical Echo. Phase 3 stays gated on that step per this plan's "every phase
stops at its own acceptance gate."

**Worktree.** `../spoken-letter-alexa-phase2`, branch `feat/skill-ux-phase2`, base `develop`
at `c6fac58`.

### Fixed before merge: MCP client cache leaked tokens across linked-mode sessions

An independent reviewer found a real bug in the first pass at section 3 (MCP client reuse),
not a judgment call: `mcpClientFor` (`packages/agent/src/turn.ts`) cached one `McpClient` per
`(mcpUrl, fetch identity)` with a single mutable bearer-token box overwritten on every call.
`packages/agent/src/routes.ts` called it for every session mode, but only device sessions
share one token by construction (`cachedServiceToken`) — a `linked` session's `accessToken`
is a real per-user OAuth token, and `deps.mcpFetch`/`deps.mcpUrl` are single instances reused
for every linked session in the container (`packages/app/src/bootstrap.ts`). Two
concurrently-turning linked sessions sharing that cache entry could have one user's in-flight
MCP call pick up the token last written by a different user's turn — reproducible under the
real concurrent Node server (`packages/app/src/local.ts`), and not something the code
documented or guarded against for the general case.

**Fix.** `TurnOptions.reuseMcpClient` (boolean, default false): device turns
(`routes.ts`: `reuseMcpClient: session.mode === "device"`) use the cached, token-box client;
every other mode builds a fresh, single-use `McpClient` with the token fixed at construction
(`freshMcpClient`) and disconnects it after the turn, exactly as before Phase 2. A regression
test (`turn.test.ts`, "without reuseMcpClient, two turns sharing an mcpUrl/fetch never share
a token") starts two turns — one with a bad token, one with a good one — without awaiting
either first, and asserts the bad one still fails cleanly; it fails against the pre-fix code
and passes against the fix.

### Deviation: kept the mode-scoped fix over a token-keyed cache

**Plan said (section 3):** "Cache one connected McpClient per mcpUrl for the life of the
container... This is the smallest of the three wins. If it turns out to require reaching into
SDK internals, drop it and record that here — it is not worth a fragile coupling."
**Found (simplify pass, altitude angle):** the mode-scoped `reuseMcpClient` boolean is a
special case standing in for the real invariant ("same token"), not a fix at the right depth;
keying the cache by `(mcpUrl, fetch, accessToken)` instead and dropping the mutable token box
would make reuse automatically safe for any caller — including linked sessions, whose stable
per-session token means they could safely reuse a client too, recovering a benefit the
mode-scoped fix leaves on the table for that mode.
**Chose:** kept the mode-scoped `reuseMcpClient` boolean; did not implement token-keying.
**Why:** the reviewer's own analysis notes token-keying needs an eviction bound (LRU/TTL) so
the cache doesn't grow unboundedly across many distinct linked-user tokens over a long-running
container — a second piece of machinery the plan's own "smallest win... drop if fragile"
framing argues against building for an optimization it already calls the least valuable of
the three. The mode-scoped fix delivers the win the plan's prose actually motivates (device
sessions hitting the in-process endpoint) with no security exposure and no unbounded cache.
Recorded as a disposition rather than silently dropped, since it's a real architectural
trade-off a reviewer surfaced.

### Deviation: catalog fetch stays on the session-open critical path

**Found (simplify pass, efficiency angle):** `/agent/session` awaits `fetchCatalog` (two
sequential MCP round trips) before responding, adding to the latency of a cold-session or
15-minute-stale turn — in tension with this phase's own goal of cutting turn latency.
**Considered:** making the fetch fire-and-forget in the background (like
`scheduleProgressiveResponse`), so session-open returns immediately.
**Chose:** left it synchronous.
**Why:** the two round trips are to the in-process device MCP endpoint (`selfFetch`, no real
network hop) — the same friction-log evidence this plan is built on measured MCP calls at
0.02-0.33 ms server-side / 9.9-25.4 ms client-side, negligible next to the ~2.8 s
per-model-round-trip cost this phase targets. Backgrounding it correctly requires the
background write and the immediately-following turn's history write (both to the same
session id) not to race and lose an update — real concurrency-control work disproportionate
to a sub-50 ms cost that isn't what section 6's `SkillTurnMs` p95 acceptance criterion is
measuring. Recorded as a disposition rather than silently dropped.

### Simplify pass (post plan-compliance review, after the token-leak fix above)

One fix applied: `packages/agent/src/routes.ts`'s hand-rolled `isCatalogStory` type guard
replaced with a `zod` schema (`catalogStorySchema`/`catalogStoriesSchema`), matching this
file's own established validation convention (`sessionBodySchema`, `turnBodySchema`). A
second reuse finding (a duration formatter duplicating `mcp-server`'s `spokenDuration` in a
different format) was left as-is: `packages/agent` only depends on `@spoken-letter-alexa/
mcp-server` as a devDependency, and promoting it to a runtime dependency for a differently-
formatted helper is outside this diff's scope. The two disposed findings above (MCP
client cache keying, catalog-fetch backgrounding) came from this same pass's altitude and
efficiency angles.

Full local gate (`pnpm typecheck && pnpm lint && pnpm test && pnpm -F infra synth`, run
sequentially) is green after the token-leak fix and the zod refactor.

## Phase 3 — Interaction model, slot types and manifest copy

**Status.** Automated scope complete, merged to `develop`. Owner authorized `ask deploy
--target skill-metadata` (2026-09-10); `ask smapi submit-skill-validation` afterward
discharged D-U4's first claim (certification does not require the playback intents — see
`phase-3.md` section 8 and the corrected `docs/friction-log.md` AUDIO_PLAYER entry). The one
remaining manual step is the Owner's five on-device checks (`phase-3.md` section 8); Phase 4
is gated on those plus their outcomes being carried forward.

**Worktree.** `../spoken-letter-alexa-phase3`, branch `feat/skill-ux-phase3`, base `develop`
at `fd993a3`.

### Deviation: `"send"` is denylisted; the plan's own literal sample text doesn't compile

**Plan said (section 4):** add `what did {storyteller} send` to `PlayStoryIntent` and
`what did {storyteller} send me` to `WhatIsNewIntent`. The plan explicitly flagged one other
sample in the same section (`play the story {storyteller} recorded`) as failing
`utteranceAllowed` on the `record` fragment and named the fix (`made`), but said nothing
about these two.
**Found:** `CLASS_C_DENYLIST` (`packages/shared/src/contract/agent-tools.ts:20`) includes the
fragment `"send"`, and `"what did {storyteller} send"` / `"...send me"` both contain it
literally — `generate.test.ts`'s existing `utteranceAllowed` assertion failed on first run.
**Chose:** substituted past-tense phrasing already used throughout the rest of the file for
this exact meaning (`"play the story {storyteller} sent"` etc.): `"what {storyteller} sent"`
and `"what {storyteller} sent me"`. `"sent"` does not contain `"send"` as a substring, so it
clears the filter; the phrasing is consistent with the file's existing style.
**Why:** this is the same class of bug the plan explicitly anticipated for `"recorded"`, just
on a fragment the plan's prose didn't call out. The fix follows the identical pattern already
established (find a same-meaning phrasing that avoids the fragment) rather than requesting a
new decision — it's a wording substitution, not an architectural choice. Verified
independently by a fresh reviewer against `CLASS_C_DENYLIST`'s actual contents.

### Deviation: `WhatIsNewIntent` referenced a slot it never declared — found by `ask deploy` itself

**Plan said (section 4):** add `what did {storyteller} send me` to `WhatIsNewIntent`'s
samples (see the `"send"` deviation above for why the actual text differs). The plan did not
address, and `TOOL_INTENTS`'s existing `WhatIsNewIntent` entry did not declare, a
`storyteller` slot — only `PlayStoryIntent` had one.
**Found:** the first real `ask deploy --target skill-metadata` failed Amazon's server-side
model build: `"the intent doesn't declare the slot 'storyteller'"` on
`WhatIsNewIntent`. Neither `utteranceAllowed`, `assertNoCarrierCollision`, nor any existing
generator check catches an undeclared slot reference — this is a class of bug only Amazon's
own validation surfaced, the same way `ask deploy`'s first run is explicitly there to catch
things local checks can't.
**Chose:** declared `slots: [{ name: "storyteller", type: "StorytellerName" }]` on
`WhatIsNewIntent` in `TOOL_INTENTS`, and added `assertSlotsDeclared` (mirroring
`assertNoCarrierCollision`'s pattern) to `generateInteractionModel`, so a future sample
referencing an undeclared slot fails `pnpm -F skill generate`/the test suite instead of
`ask deploy`. Regenerated, redeployed — model build succeeded.
**Why:** matches this phase's own established pattern (turn a class of live-mis-route/
deploy-time bug into a generate-time assertion, as already done for carrier collisions);
the handler doesn't need to consume the new slot value (WhatIsNewIntent's response text is
already fixed regardless of slots, unchanged from before this phase), so no handler.ts change
was needed beyond the model declaration.

### Simplify pass (post plan-compliance review)

One fix applied: `packages/skill/src/handler.ts`'s `AMAZON.ResumeIntent` and
`AMAZON.StartOverIntent`/`RepeatIntent` cases duplicated the same "decode the current
AudioPlayer token or fall back" pattern, differing only in the replay offset. Factored into
`resumablePlay(event)`, called by both with the offset supplied at the call site.

No other findings from the reviewer's four angles beyond the two already folded into this
phase's own record above (the `ask validate` placeholder, now filled in `phase-3.md` section
8, and this deviation entry).

Full local gate (`pnpm typecheck && pnpm lint && pnpm test && pnpm -F infra synth`, run
sequentially) is green after the extraction.
