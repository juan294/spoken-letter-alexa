# Implementation notes — Alexa skill interaction UX

Per-phase handoffs and deviations for `docs/plans/2026-09-10-alexa-skill-interaction-ux.md`.

## Phase 1 — Turn telemetry

**Status.** Automated scope complete and merged to `develop`. The manual gate (D-U2: Owner
`pnpm deploy` with `-c sla:logSay=1`, one real six-turn device conversation, results pasted
into `phase-1.md` section 7) is **not done** — it requires the Owner's AWS deploy access and
a physical Echo, neither of which this session has. Phases 2-4 remain blocked on that
manual step per D-U2 until the Owner runs it.

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
