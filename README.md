# Spoken Letter for Alexa+

Spoken Letter lets a family record a story in their own voice and deliver it to a child
far away. This public companion repository brings those delivered stories to Alexa+ as an
MCP add-on, built for the Amazon App Dev 2026 hackathon (Alexa+ track, AWS Builder and
Open Source mini challenges).

It contains a dual-era MCP server (2026-07-28 specification served alongside the
2025-era handshake Alexa+ sends), an OAuth 2.1 authorization server, a simulated Alexa+
client on AWS (Strands Agents, Bedrock, Transcribe, Polly), the Amazon packaging path,
and a CDK deployment at `alexa.spokenletter.com`. The add-on is the parent's tool: it
exposes only stories the parent has already delivered, and no child account, voice or
data exists on this path.

## Architecture

```
Alexa+ (Amazon, US, en-US)                   Simulated Alexa+ client (judges, Owner)
   │ OAuth 2.1 auth code + PKCE                  │ browser SPA at https://alexa.spokenletter.com/demo
   │ Streamable HTTP, legacy initialize          │ mic → agent API → Transcribe streaming
   ▼                                             ▼
https://alexa.spokenletter.com  (CloudFront → Lambda function URL, RESPONSE_STREAM, Hono)
   ├── /mcp                      createMcpHandler (2026-07-28 + legacy 'stateless'), bearer JWT
   ├── /.well-known/oauth-protected-resource      RFC 9728 → issuer = same host
   ├── /.well-known/oauth-authorization-server    RFC 8414
   ├── /.well-known/jwks.json    KMS asymmetric public key
   ├── /oauth/authorize|token|continue|revoke     packages/oauth, DynamoDB tables
   ├── /bridge/link/complete|revoke              bearer ALEXA_BRIDGE_SECRET, called by Spoken Letter
   ├── /agent/*                 packages/agent: Strands + Bedrock, Polly, Transcribe (Lambda)
   └── /demo/*                  packages/simulator static SPA (S3 origin)

Agent → AgentCore Gateway (MCP server target, outbound client_credentials) → /mcp
Alexa+ → /mcp directly (Amazon requires the server itself)
```

## Amazon tools used

Filled in per phase. Every entry does real work in code and has a friction-log entry.

| Tool | Function | Status |
| --- | --- | --- |
| AWS CDK | One-command deploy; `CoreStack` (DynamoDB, KMS, Secrets Manager) | Phase 0: synthesized and tested |
| MCP TypeScript SDK v2 (`@modelcontextprotocol/server`) | Dual-era `/mcp` handler: 2026-07-28 plus the 2025-era `initialize` Alexa+ sends | Phase 1: protocol and latency tests green |
| Lambda function URL (RESPONSE_STREAM), CloudFront, ACM, Route53 | Serves `alexa.spokenletter.com` | Phase 6 |
| DynamoDB | OAuth state, links, agent sessions | Phase 2 (memory store), Phase 6 |
| KMS (asymmetric RSA) | JWT signing and JWKS | Phase 2 (local signer), Phase 6 |
| Secrets Manager | Bridge secret, static client secrets | Phase 6 |
| S3 | Simulator assets, fixture audio | Phase 5, 6 |
| Amazon Bedrock + Strands Agents | The simulated Alexa+ agent | Phase 5 |
| Bedrock AgentCore Gateway | MCP server target for the agent | Phase 6 |
| Amazon Transcribe (streaming) | Voice input in the simulator | Phase 5 |
| Amazon Polly | Spoken replies in the simulator (never story narration) | Phase 5 |
| CloudWatch + X-Ray | Sub-500 ms tool latency proof | Phase 6 |
| Kiro Crew | CDK scaffold draft | Not available on the build machine (friction log) |

## Quick start

Requirements: Node.js 24, pnpm 11, and for Phase 6 onward the AWS CLI with the `archy`
profile. Python 3.11 or newer runs the cc-rpi lifecycle scripts under `.rpi/`.

```bash
pnpm install
pnpm typecheck && pnpm lint && pnpm test && pnpm -F infra synth
```

The same four commands are the single `verify` job in `.github/workflows/verify.yml`.
The complete local gate is declared in `.rpi/policy.json` and run by
`python3 .rpi/scripts/rpi-verify.py`.

Run the MCP server locally on `:4310` (prints a one-time `MCP_DEV_TOKEN` unless one is set):

```bash
pnpm dev
curl -s -X POST http://localhost:4310/mcp \
  -H "authorization: Bearer $MCP_DEV_TOKEN" -H "content-type: application/json" \
  -H "accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_family_stories","arguments":{}}}'
```

Deploy (Owner, Phase 6 onward): `pnpm deploy`. Release procedure: `docs/release.md`.

## Repository layout

```
packages/shared      env parsing, JSON logger, vendored agent-tool contract
packages/mcp-server  dual-era MCP server, fixture provider, three read-only tools (Phase 1)
fixtures/            the Owner's recorded stories for the demo subject (see fixtures/README.md)
packages/oauth       Phase 2: OAuth 2.1 authorization server
packages/agent       Phase 5: Strands + Bedrock agent, Polly, Transcribe
packages/simulator   Phase 5: simulated Alexa+ SPA
infra/               CDK app (CoreStack now; Phase 6 adds the rest)
amazon/              Phase 7: addon.json, runbook, US account checklist
docs/                research, plans, decisions, friction log, product feedback, release
```

## Working in this repository

Agent workflow follows cc-rpi (Research, Plan, Implement, Validate). Shared project
facts and boundaries are in `AGENTS.md`; Claude Code reads them through `CLAUDE.md`.

- Plan: `docs/plans/2026-09-03-alexa-plus-mcp-add-on.md` and its phase files.
- Research: `docs/research/`. Decisions: `docs/decisions/`.
- Friction log: `docs/friction-log.md`. Product feedback: `docs/product-feedback.md`.

## Licence

MIT. See `LICENSE`.
