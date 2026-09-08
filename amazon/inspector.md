# Amazon's Local Inspector against `pnpm dev`

The Local Inspector is part of the gated toolkit
(https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-local-inspector.html).
What the research recorded about it (`docs/research/2026-09-03-alexa-plus-hackathon-mcp-add-on.md`,
section 5.1): it opens with `initialize` at `protocolVersion: "2025-06-18"` and "requires
`Mcp-Session-Id` on later requests". The live Alexa+ client is different: it opens at
`2025-03-26` and "The session is based on the customer's previous conversations with
Alexa+ rather than an explicit identifier" (client lifecycle page). The research does not
record how the Inspector is launched or configured; read that from its page when access
exists. This document covers our side.

## 1. Start the server

```bash
MCP_DEV_TOKEN=<at least 16 characters> pnpm dev
```

- Listens on `http://localhost:4310`; the MCP endpoint is `http://localhost:4310/mcp`.
- Without `MCP_DEV_TOKEN` the server generates a token and prints one line
  `MCP_DEV_TOKEN=...` at startup; set it explicitly so the Inspector's configuration does
  not change between restarts.
- Every `/mcp` request needs `Authorization: Bearer <MCP_DEV_TOKEN>`. An unauthenticated
  request answers 401 with a `WWW-Authenticate` challenge whose `resource_metadata` points
  at `http://localhost:4310/.well-known/oauth-protected-resource`; the Inspector may follow
  it, which is the behaviour Amazon's quickstart checks for.
- Health: `curl -s http://localhost:4310/healthz`.

Point the Inspector at `http://localhost:4310/mcp` with that bearer token. Public
`alexa.spokenletter.com` is not needed for this check.

## 2. What to record, whatever happens

In `docs/friction-log.md`, from the server log and the Inspector's output:

1. The `protocolVersion` the Inspector sent in `initialize` (expected `2025-06-18`).
2. Whether the Inspector proceeded past `initialize` in the default stateless mode.
3. The first failing request and its status, if any.
4. The `tools/list` result as the Inspector displays it (names, descriptions, annotations).

## 3. Decision tree for the session-id risk

The default server (`packages/mcp-server/src/server.ts`) is dual-era with
`legacy: 'stateless'`: it answers every 2025-era request from a fresh instance and mints
no `Mcp-Session-Id`. GET and DELETE answer 405. This is right for the live client and for
Lambda, and it may be wrong for the Inspector.

```
Inspector runs initialize at 2025-06-18 and continues to tools/list and tools/call
  yes -> stateless mode passes. Record it. Nothing changes. Done.
  no  -> what failed?
         The Inspector refused to continue because no Mcp-Session-Id came back,
         or it sent a GET /mcp stream and got 405
           -> restart with MCP_LEGACY_SESSIONS=1 (section 4) and repeat.
              passes -> the flag is needed for the Inspector only.
                        Keep production on Lambda in stateless mode unless
                        the deployed development stage (alexa-ai deploy) fails
                        the same way; then section 5.
              fails  -> a different problem; record the request/response pair
                        and stop. Do not deploy LegacyStack for it.
         Something else (auth, tool schema, timeout)
           -> not a session problem; fix that first with the flag off.
```

## 4. The contingency: `MCP_LEGACY_SESSIONS=1`

`packages/mcp-server/src/legacy-sessions.ts` (`createLegacySessionHandler`) is the opt-in
sessionful mode the SDK documents: requests the SDK's own `isLegacyRequest` classifies as
2025-era go to one `WebStandardStreamableHTTPServerTransport` per session
(`sessionIdGenerator: randomUUID`, in-memory map, `onsessionclosed` removes the entry),
and 2026-07-28 requests go to a `createMcpHandler(factory, { legacy: 'reject' })`. That
is the only place `legacy: 'reject'` exists; the main handler never uses it. Tests in
`legacy-sessions.test.ts` cover: initialize at 2025-06-18 returns a session id, a
follow-up `tools/list` with the header succeeds, without the header 400, an unknown id
404, DELETE ends the session, and a modern `server/discover` still passes through.

```bash
MCP_LEGACY_SESSIONS=1 MCP_DEV_TOKEN=<token> pnpm dev
```

Constraints of this mode:

- **Single instance only.** Sessions live in process memory. Two processes, or Lambda's
  per-invocation instances, would answer 404 for each other's sessions.
- **Sessions die with the process.** A restart invalidates every id; the Inspector must
  re-run `initialize`.
- **No eviction.** A session stays until the client sends DELETE or the process ends.
  Acceptable for an Inspector run; not for public traffic.

## 5. If the flag is needed in production: one Fargate task

Only if the deployed development stage or the live client also needs sessions (section 3,
second branch). Then serve `/mcp` from `infra/lib/legacy-stack.ts` (`LegacyStack`): one
ECS Fargate task (`desiredCount: 1`) with `MCP_LEGACY_SESSIONS=1` and `PORT=4310` behind an
internet-facing application load balancer with `/healthz` as the target health check.
It is written and tested (`infra/test/legacy-stack.test.ts`) but not in `infra/bin/app.ts`
and not deployed. To use it:

1. Build and push a container image of `packages/mcp-server` (no Dockerfile exists yet;
   the stack takes the image reference as a required `image` prop with no default).
2. Add `new LegacyStack(app, "SpokenLetterAlexaLegacy", { env, image })` to
   `infra/bin/app.ts` and run `pnpm deploy` (Owner gate: every AWS mutation is).
3. Point `alexa.spokenletter.com/mcp` at the load balancer, or give Amazon the load
   balancer's hostname for the MCP endpoint while the issuer stays on the custom domain
   (the plan already allows a separate `/mcp` hostname for the CloudFront risk).
4. Keep `desiredCount` at 1. Never scale it out: the in-memory map is not shared.

Lambda is never the place for this mode.
