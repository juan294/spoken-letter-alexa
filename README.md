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

Open-source contribution: [aws/aws-cdk#39390](https://github.com/aws/aws-cdk/pull/39390)
(open pull request, issue [#39389](https://github.com/aws/aws-cdk/issues/39389)) adds
MCP protocol versions 2025-11-25 and 2026-07-28 to `MCPProtocolVersion` in
`aws-cdk-lib/aws-bedrockagentcore`, with unit tests, a README update and an integration
test deployed in this project's account.

## What the video shows

Amazon gives external developers no Alexa+ integration path yet, and a custom skill never
receives raw audio. The hackathon video therefore shows the envisioned experience on a real
Echo Show with a development-stage custom skill, following a fixed demo script written by
the family that recorded the demo story. Which steps are real and which are staged:

| Step | Treatment |
| --- | --- |
| Playing stories by storyteller or by title | Real: skill → agent API → MCP server → delivered fixture stories, played with the AudioPlayer |
| Credits | Staged: the account starts with no credits and a fixed purchase scene offers three packs from `fixtures/demo-create.json`; no store or payment is involved, so nothing is charged, and the next run starts with no credits again |
| Listener and saved wish | Staged: one listener and one wish from `fixtures/demo-create.json` |
| Story conversation | Staged: fixed replies from the demo script; no model call |
| Script on screen | Real: an APL teleprompter with a 3-2-1 countdown, showing the script the storyteller wrote in the Spoken Letter app |
| Recording | Staged: nothing is captured; "playback" plays a take recorded beforehand of the same script in the Spoken Letter app |
| Music and sound effects | Staged: the finished mix the Spoken Letter app produced for that take |
| Send | Staged: a confirmation only; nothing is delivered |
| Creation progress | Real: a creation record in DynamoDB (`sla-demo-state`), so a session that drops while the adult reads resumes at take review on a launch within 15 minutes |

The listener's first name in the demo is used with the family's consent. The
[Alexa+ simulator](#architecture) at `/demo` runs the real agent on Bedrock; the staged
create flow is English only, and the Spanish skill keeps its draft flow.

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

Every entry does real work in code and has a friction-log entry. The status column gives the live state on 2026-10-18 (account `106403001709`, `us-east-1`).

| Tool | Function | Status |
| --- | --- | --- |
| AWS CDK | One-command deploy (`pnpm run deploy`) of seven stacks: Core (DynamoDB, KMS, Secrets Manager), Simulator, Api, Edge, Gateway, Observability, Skill | Live: all seven stacks deployed. Last updates: Core and Edge 2026-09-28, Observability 2026-10-01, Simulator, Api, Gateway and Skill 2026-10-19 |
| MCP TypeScript SDK v2 (`@modelcontextprotocol/server`) | Dual-era `/mcp` handler: 2026-07-28 plus the 2025-era `initialize` Alexa+ sends | Live at `https://alexa.spokenletter.com/mcp`. The deployed check on 2026-09-09 passed legacy `initialize` at 2025-03-26, modern `server/discover` at 2026-07-28 and 20 of 20 `tools/call`. The 401 challenge with `resource_metadata` answers on 2026-10-18 |
| Lambda function URL (RESPONSE_STREAM), CloudFront, ACM, Route53 | `ApiStack` (one arm64 Lambda from `packages/app`, streaming URL behind an OAC) and `EdgeStack` (distribution, WAF rate rule, HSTS, DNS aliases) | Live: `/demo/` and the OAuth metadata answer 200 on 2026-10-18. `tools/call` p95 was 377 ms from Madrid and 107 ms from a `us-east-1` runner (2026-09-09) |
| Lambda@Edge | Origin-response function that restores the `WWW-Authenticate` challenge the function URL renames (D24) | Live since 2026-09-09; the challenge reaches clients through CloudFront on 2026-10-18 |
| DynamoDB | OAuth state (`sla-oauth`), agent sessions (`sla-agent-sessions`), demo drafts, wishes, reactions and creation records (`sla-demo-state`), notification subscriptions (`sla-notification-subscriptions`) | Live: four tables. The OAuth token flow passed on 2026-09-09; demo receipts read back from DynamoDB in the 2026-10-01 console journeys; the API accepted every creation record of the 2026-10-09 purchase-scene run |
| KMS | An asymmetric RSA key for JWT signing (`RSASSA_PKCS1_V1_5_SHA_256`) and the JWKS document; a symmetric key in `SkillStack` encrypts the stored Alexa user ID for notifications | Live: signs every access token, including the tokens the AgentCore Gateway uses for its tool calls (last on 2026-10-17) |
| Secrets Manager | `sla/bridge` and `sla/oauth-clients`, read once per cold start | Live: read at each API cold start (`secrets_loaded` in the API log) |
| S3 | Simulator SPA, fixture audio and demo takes, Polly replies (1-day lifecycle) | Live: CloudFront serves the SPA, the fixture stories and the takes (HTTP 200, each size equal to the local file, 2026-10-09) |
| Amazon Bedrock + Strands Agents | The agent behind the simulator and the skill's story requests: `BedrockModel` (Claude Haiku 4.5 by default, Nova as fallback), `McpClient` over the same `/mcp` | Live since 2026-09-09. The API log shows agent turns with Bedrock token counts from the Echo (device mode) and the simulator (demo mode) up to 2026-10-17. The staged create flow uses fixed lines and calls no model |
| Bedrock AgentCore Gateway | `GatewayStack`: gateway with IAM inbound auth, MCP server target on `/mcp`, outbound client_credentials via an AgentCore Identity OAuth2 provider | Live: gateway `sla-alexa` and target `spoken-letter` `READY`, last synchronized 2026-10-19 06:19 CEST. A demo turn played a story through it the same day (`played: true`; 2.2 s for the first call, 0.41 s for the second). Before that, the target had not synchronized since 2026-09-09, and the logged demo turns of 2026-10-10 and 2026-10-17 did not play (friction log, 2026-10-19). `pnpm -F infra verify:gateway` now checks the target status and the cached tool schemas after every deploy |
| Amazon Transcribe (streaming) | Voice input: WebM/Opus from the browser, converted to 16 kHz PCM, streamed | Deployed, live use not verified: the API log has no `transcribe_done` event in its 30-day retention window (2026-09-18 to 2026-10-18). Tests cover the request shape and a real `ffmpeg` conversion |
| Amazon Polly | Spoken replies in the simulator, neural `Joanna` `en-US` (never story narration) | Live: `AWS/Polly` counts successful `SynthesizeSpeech` calls on 2026-10-10 (1) and 2026-10-17 (5), the same days and counts as the simulator's demo turns. Device turns skip Polly (the Echo speaks the reply) |
| CloudWatch + X-Ray | `ObservabilityStack`: dashboard `sla-alexa`, EMF metrics (`ToolLatencyMs`, `SkillTurnMs`, `FallbackCount`), p95 alarms to SNS email, active tracing, 30-day logs | Live: alarms `sla-alexa-tool-latency-p95` and `sla-alexa-skill-turn-p95` in state `OK` on 2026-10-18; X-Ray traces on the notification Lambda the same day |
| Alexa Skills Kit, ASK CLI and SMAPI | Classic custom skill (`packages/skill`, `SkillStack`, Lambda `sla-alexa-skill`): AudioPlayer playback, an APL teleprompter, en-US and es-ES interaction models generated from the tool metadata, published with ASK CLI 2.30.7 | Live in the development stage with a beta test. Family stories played on a real Echo Show from 2026-09-09. On 2026-10-18 the full staged demo script ran on an Echo Show 5 under Alexa+ (US account) |
| Alexa proactive events | `sla-alexa-notifications` stores the notification permission (`AMAZON.MessageAlert.Activated`) and subscription changes; `sla-alexa-notification-send-dev` sends one development event | Partly live: the permission and subscription events reached `sla-alexa-notifications` on 2026-10-08 and 2026-10-18. The sender has never been invoked, so no notification was sent to a device |
| Kiro Crew | CDK scaffold draft | Not used: not available on the build machine (friction log, 2026-09-08) |

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

Deploy (Owner, Phase 6 onward): `pnpm run deploy`. Release procedure: `docs/release.md`.

Real device (Phase 9): a thin classic Alexa Skill in `packages/skill` calls the same agent
endpoint and plays the family MP3 through `AudioPlayer` on an Echo. `pnpm -F skill generate`
rebuilds the interaction model from the tool metadata; `pnpm -F @spoken-letter-alexa/skill run deploy` creates the
development-stage skill with the ASK CLI (Owner gate); `pnpm -F skill record:pull` imports
historical raw records only. Raw recording and model-speech logging are intentionally
disabled, including when the deprecated `RECORD_UTTERANCES` or `LOG_SAY` switches are set.
Safe diagnostics work without either switch. Legacy slot nulls mean redacted, not missing;
`slotPresence` reports missing/present. Flow, response keys, interaction results, and
domain-separated hashes of ephemeral session/request IDs support recovery analysis
without logging speech, names, or user/device IDs. `FallbackCount` is an undimensioned
CloudWatch counter; hashes are log fields only. Safe diagnostics cannot reconstruct
utterances or produce training transcripts.

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
review finding and its disposition, and the deviation register D1 to D25), in the later
plans' notes under `docs/plans/`, and in `docs/friction-log.md`.

The private Spoken Letter bridge (Phase 3 of the plan) is not part of this submission. The deployed server reads the delivered demo stories from the fixture catalog (`PROVIDER_MODE=fixtures`), and `scripts/mock-spoken-letter.mjs` stands in for the bridge in local runs.

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
