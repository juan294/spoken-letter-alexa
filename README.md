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
| Lambda function URL (RESPONSE_STREAM), CloudFront, ACM, Route53 | `ApiStack` (one arm64 Lambda from `packages/app`, streaming URL behind an OAC) and `EdgeStack` (distribution, WAF rate rule, HSTS, DNS aliases) | Phase 6: synthesized and tested; deploy is an Owner step |
| DynamoDB | OAuth state (`sla-oauth`: pending authorizations, link tokens, codes, refresh tokens) | Phase 2: `DynamoStore` with mocked-client tests; deployed in Phase 6 |
| KMS (asymmetric RSA) | JWT signing (`RSASSA_PKCS1_V1_5_SHA_256`) and the JWKS document | Phase 2: `KmsSigner` with mocked-client tests; deployed in Phase 6 |
| Secrets Manager | `sla/bridge` and `sla/oauth-clients`, read once per cold start | Phase 6: `CoreStack`, `seed:secrets`, `loadSecretsIntoEnv` tested |
| S3 | Simulator SPA, fixture audio, Polly replies (1-day lifecycle) | Phase 6: `SimulatorStack`, OAC policy in `EdgeStack` |
| Amazon Bedrock + Strands Agents | The simulated Alexa+ agent: `BedrockModel` (Claude Haiku 4.5 by default, Nova as fallback), `McpClient` over the same `/mcp` | Phase 5: agent loop and structured output tested with a scripted model; live Bedrock is an Owner step (model access) |
| Bedrock AgentCore Gateway | `GatewayStack`: gateway with IAM inbound auth, MCP server target on `/mcp`, outbound client_credentials via an AgentCore Identity OAuth2 provider | Phase 6: synthesized and tested; deploy is an Owner step |
| Amazon Transcribe (streaming) | Voice input: WebM/Opus from the browser, converted to 16 kHz PCM, streamed | Phase 5: mocked-client test plus a real `ffmpeg` conversion test |
| Amazon Polly | Spoken replies in the simulator, neural `Joanna` `en-US` (never story narration) | Phase 5: mocked-client test; S3 store for the deployed reply audio |
| CloudWatch + X-Ray | `ObservabilityStack`: EMF `ToolLatencyMs` dashboard, p95 > 400 ms alarm to SNS email, active tracing, 30-day logs | Phase 6: synthesized and tested |
| Kiro Crew | CDK scaffold draft | Not available on the build machine (friction log) |

## Quick start

Requirements: Node.js 24, pnpm 11, and for Phase 6 onward the AWS CLI with the `archy`
profile. Python 3.11 or newer runs the cc-rpi lifecycle scripts under `.rpi/`.

```bash
pnpm install
pnpm typecheck && pnpm lint && pnpm test && pnpm -F infra synth
```

The same four commands, plus the simulator's Playwright smoke (`pnpm test:e2e`), are the
single `verify` job in `.github/workflows/verify.yml`.
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

The whole link flow can be driven locally without the private repository:

```bash
DEV_ROUTES=1 PROVIDER_MODE=auto pnpm dev                       # prints ALEXA_BRIDGE_SECRET once
ALEXA_BRIDGE_SECRET=<printed> node scripts/mock-spoken-letter.mjs   # :3007, stands in for Spoken Letter
node scripts/e2e-link.mjs                                       # authorize → confirm → code → JWT → tools
```

Open `http://localhost:4310/dev/start` in a browser for the same flow by hand. Copy
`.env.example` to `.env` to pin the generated values.

The simulated Alexa+ client runs with `pnpm dev` (server on `:4310`, Vite on
`:5173/demo/`, AWS credentials from the `archy` profile for Bedrock, Polly and Transcribe)
or `pnpm dev:offline` (scripted model, canned transcript, no AWS). `pnpm test:e2e` runs
the Playwright smoke against the simulator's in-app mock.

Deploy (Owner, Phase 6 onward): `pnpm deploy`. Release procedure: `docs/release.md`.

Real device (Phase 9): a thin classic Alexa Skill in `packages/skill` calls the same agent
endpoint and plays the family MP3 through `AudioPlayer` on an Echo. `pnpm -F skill generate`
rebuilds the interaction model from the tool metadata; `pnpm -F skill deploy` creates the
development-stage skill with the ASK CLI (Owner gate); `pnpm -F skill record:pull` collects
real phrasings while `RECORD_UTTERANCES=1`.

## Repository layout

```
packages/shared      env parsing, JSON logger, vendored agent-tool contract
packages/mcp-server  dual-era MCP server, fixture provider, three read-only tools (Phase 1)
fixtures/            the Owner's recorded stories for the demo subject (see fixtures/README.md)
packages/oauth       OAuth 2.1 authorization server: PKCE, client_credentials, RFC 8414/9728, JWT verifier (Phase 2)
                     app.ts composes OAuth + JWT-gated /mcp + dev routes; HttpProvider talks to the bridge (Phase 4)
packages/agent       Strands + Bedrock agent loop, scripted offline model, Polly, Transcribe, sessions (Phase 5)
packages/simulator   simulated Alexa+ SPA: Vite + React, brand tokens, Playwright smoke (Phase 5)
packages/app         the composed server: OAuth + MCP + agent on one Hono app; local and Lambda entry points
packages/skill       classic Alexa Skill front end for real-device footage: handler, agent client, generated interaction model (Phase 9)
infra/               CDK app: Core, Simulator, Api, Edge, Gateway, Observability, Skill stacks; bundle and seed scripts
amazon/              addon.json, agent-skill placeholder, runbook, US account checklist, Inspector guide (Phase 7)
scripts/             mock-spoken-letter.mjs (stand-in for the private bridge), e2e-link.mjs, verify-deploy.mjs, add-fixture-story.mjs
docs/                research, plans, decisions, friction log, product feedback, release
```

## Built during the hackathon window

Everything in this repository was created between 2026-09-03 (plan) and the submission
date, on the public `develop` and `main` branches. The dated history lives in
`docs/plans/2026-09-03-alexa-plus-mcp-add-on-notes.md` (one handoff per phase, every
review finding and its disposition, and the deviation register D1 to D21) and in
`docs/friction-log.md`. The private Spoken Letter repository receives only the small
bridge described in Phase 3 of the plan, after its freeze lifts on 2026-10-01; that pull
request is linked here when it exists.

Manual `latency` workflow: `.github/workflows/latency.yml` runs `scripts/verify-deploy.mjs`
from a `us-east-1` runner against the deployed host (never deploys).

## Working in this repository

Agent workflow follows cc-rpi (Research, Plan, Implement, Validate). Shared project
facts and boundaries are in `AGENTS.md`; Claude Code reads them through `CLAUDE.md`.

- Plan: `docs/plans/2026-09-03-alexa-plus-mcp-add-on.md` and its phase files.
- Research: `docs/research/`. Decisions: `docs/decisions/`.
- Friction log: `docs/friction-log.md`. Product feedback: `docs/product-feedback.md`.

## Licence

MIT. See `LICENSE`.
