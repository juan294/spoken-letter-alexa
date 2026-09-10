# Phase 2 — Perceived latency

**Entry condition: Phase 1 accepted, deployed, and `phase-1.md` section 7 filled (D-U2).**

Turn latency is model round trips and nothing else: MCP tool calls cost 0.02–0.33 ms
server-side, so a one-tool turn takes ~3.1 s and a two-tool turn ~5.7–6.9 s. Two levers
follow — remove a round trip, and speak over what remains.

## 1. The catalog moves into the prompt

Nearly every play turn spends one model round trip on `list_family_stories` purely to
learn which stories exist. The catalog is three stories in the fixtures and capped at 20
by `listInputSchema`; it fits in the system prompt.

At `/agent/session` (`packages/agent/src/routes.ts:83`), for device sessions, call
`list_family_stories` once through the same in-process MCP endpoint the turn uses
(`deps.deviceMcp`, wired in `packages/app/src/bootstrap.ts:149` to `${issuer}/mcp` over
`selfFetch`) and store the result on the session. `runTurn` composes it into the system
prompt after `ALEXA_PERSONA`.

```
@ openDeviceSession(deviceUserId) -> sessionId
ctx: deviceMcp (in-process /mcp), session store, service token
pre: mode == "device"
do:
  1. lookup existing session by deviceSessionId hash
  2. if absent or catalog stale -> call list_family_stories once
  3. compute catalogText (id, title, storyteller, duration per line)
  4. write session with catalog + catalogFetchedAt
br: if the call fails -> store no catalog; the turn falls back to calling the tool
fx: one extra in-process MCP call per session open, not per turn
fail: never fatal — a session without a catalog behaves exactly as today
risk: a story delivered mid-session is invisible until the catalog refreshes
```

The stale-catalog risk is real and bounded: refresh when `catalogFetchedAt` is older than
15 minutes, and keep `list_family_stories` in the persona's tool list so the model can
still call it when the speaker asks for something the catalog does not contain. The
catalog is a cache, never the authority.

Add to the persona: the catalog block, and an instruction that when the requested story is
in it the model goes straight to `get_family_story` with that id.

**Do not** put the audio URL in the catalog. `get_family_story` mints a time-limited link
(`AUDIO_TTL_MS`, one hour) and the real bridge will sign it; a cached URL would rot.

## 2. Progressive response

`context.System.apiEndpoint` and `context.System.apiAccessToken` arrive in every request
envelope and are absent from `AlexaRequestEnvelope` in `packages/skill/src/handler.ts:14`.
Add them, then POST a `VoicePlayer.Speak` directive to
`${apiEndpoint}/v1/directives` with `Authorization: Bearer ${apiAccessToken}` while the
agent call is in flight.

```
@ progressiveResponse(event, text) -> void
ctx: fetch, apiEndpoint + apiAccessToken from the envelope
pre: both present; request is an IntentRequest
do:
  1. build VoicePlayer.Speak directive with requestId
  2. post it, unawaited, with a 1500 ms AbortController
  3. swallow every error (log at warn, never throw)
fx: one outbound HTTPS call; no IAM, no role change
fail: any failure -> silently skipped; the turn is unaffected
risk: awaiting this on the critical path would make the worst case worse — never await it
```

Fire it at ~600 ms, not at 0 ms: a turn that finishes in 800 ms should not be preceded by
"one moment". A timer that the agent promise cancels on resolution gives that for free.

The text must be catalog-aware and not a filler noise — "Looking for that one" for a play
intent, "Checking what's new" for the list intent.

## 3. MCP client reuse

`packages/agent/src/turn.ts:36-40` builds a `StreamableHTTPClientTransport` and an
`McpClient` per turn and disconnects at line 77. For device sessions the endpoint is
in-process, so the handshake is cheap but not free, and containers recycle every 10–30
minutes (`secrets_loaded` fired six times in 50 minutes on 2026-09-10).

Cache one connected `McpClient` per `mcpUrl` for the life of the container. The bearer
token is passed per request in `requestInit.headers`, so a cached transport must take the
token per call rather than closing over one — check whether
`StreamableHTTPClientTransport` supports that before committing to the cache; if it does
not, cache per `(mcpUrl, token)` with the token's `exp` as the eviction key, since
`cachedServiceToken` (`routes.ts:60`) already re-mints only near expiry.

This is the smallest of the three wins. If it turns out to require reaching into SDK
internals, drop it and record that here — it is not worth a fragile coupling.

## 4. History trim

`routes.ts:110` writes `result.history` back whole with a 2-hour TTL. A long evening grows
the prompt every turn. Trim to the last 8 messages before persisting, preserving whole
tool-use/tool-result pairs — splitting a pair leaves a dangling `toolUse` the model will
reject.

## 5. Files

| File | Change | Unit |
| --- | --- | --- |
| `packages/agent/src/sessions.ts` | `catalog`, `catalogFetchedAt` on `AgentSession`; Dynamo round trip | A |
| `packages/agent/src/routes.ts` | catalog fetch at session open; history trim | A |
| `packages/agent/src/persona.ts` | catalog block, go-straight-to-get instruction | A |
| `packages/agent/src/turn.ts` | system prompt composition; client cache | A |
| `packages/skill/src/handler.ts` | envelope type, progressive response call | B |
| `packages/skill/src/progressive.ts` (new) | Directive Service client | B |
| `packages/skill/src/progressive.test.ts` (new) | timer, timeout, error swallowing | B |

Units A and B are `[batch-eligible]` against each other — no file overlap, no dependency.
One integration owner; no working-branch push, no PR.

## 6. Acceptance

**Automated.** Full gate, sequential. New tests must include:

- a device session opened with a stubbed MCP returns a session carrying the catalog
- a session whose catalog fetch throws still opens, with no catalog
- `runTurn` given a session catalog produces a system prompt containing every story title
- history longer than 8 messages is trimmed without splitting a tool-use/tool-result pair
- the progressive response is not awaited: a handler whose Directive Service call never
  resolves still returns within the agent budget
- a Directive Service 500 does not change the handler's response

**Manual, Owner.** Deploy, then ten play turns on the Echo across at least two cold
containers. Acceptance is stated over the Phase 1 telemetry, not over a single turn:

- `SkillTurnMs` p95 for `PlayStoryIntent` **below 4000 ms** (baseline: 6892 ms measured
  2026-09-10 for a cold two-tool turn)
- the median play turn calls `get_family_story` only — no `list_family_stories` in `tools`
- the progressive response is audible on any turn that exceeds ~1 s

If p95 lands between 4000 and 5000 ms, record the number here and treat D-U3 (the model
bypass) as the live question it was written to be, rather than tightening this phase.

## 7. Handoff

**Next.** Phase 3. Carry forward: the measured p95 by intent after this phase, whether the
MCP client cache was implemented or dropped (section 3), and the observed catalog staleness
behaviour if any story was delivered mid-session.
