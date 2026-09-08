# Release verification: Wave A checklist

Adapted from cc-rpi `templates/e2e-pro-playbook-template.md` (template 1.0) on 2026-09-08.
Per `phase-0.md` section 2 this is a **checklist, not a gate**: no evidence machinery, no
required-check automation beyond the single CI job. `rpi-release` reads this file and
enforces the truthful-gate invariant in section "Wave A" by hand.

## Project Adaptation Profile

Values marked "Phase N" are fixed by the plan and become real when that phase lands.

| Area | Project value |
| --- | --- |
| Project | Spoken Letter for Alexa+ |
| Repository visibility | Public from the first push (Owner gate; not pushed yet) |
| Primary product type | Monorepo: MCP server, OAuth 2.1 server, agent API, static simulator SPA, CDK |
| Package/build system | pnpm workspaces, TypeScript 6, ESLint 9, vitest, AWS CDK (Phase 0) |
| Integration branch | `develop` (default local branch) |
| Production branch | `main` (receives `develop` by local merge; a deploy is an explicit `pnpm deploy`) |
| Merge strategy | Local integration on `develop`, local merge into `main` at release; no PR flow in September |
| Release artifact | Git commit on `main` deployed by CDK (Lambda code plus S3 assets) |
| Deployment provider | AWS CDK from the Owner's machine, profile `archy`, account `106403001709`, `us-east-1` |
| Local test target | Local vitest and CDK synth; Hono handler driven with raw HTTP fixtures |
| Preview target | None |
| Staging target | None |
| Production target | `https://alexa.spokenletter.com` (Phase 6) |
| Test runner(s) | vitest; CDK `Template.fromStack` assertions |
| Unit command | `pnpm test` |
| Integration command | `pnpm test` (protocol and OAuth conformance suites, Phases 1 and 2) |
| E2E command | Manual link flow in a browser (Phase 4); simulated client microphone flow (Phase 5) |
| Typecheck command | `pnpm typecheck` |
| Lint command | `pnpm lint` |
| Build command | `pnpm -F infra synth` |
| Release-report command | None; `rpi-release` writes the report by hand |
| Primary datastore | DynamoDB (`sla-oauth` and Phase 6 tables) |
| Object/media storage | S3 (simulator assets, fixture audio); private-repo GCS via signed URLs (Phase 4) |
| Queue/event system | None |
| Authentication | Own OAuth 2.1 server; KMS-signed JWT; bridge bearer secret to the private repo |
| Payments/entitlements | None |
| Email/notifications | None |
| Other external vendors | Amazon Alexa+ (partner toolkit, access pending); Bedrock, Transcribe, Polly |
| Observability | CloudWatch metrics, logs, dashboard, alarm; X-Ray (Phase 6) |
| Hardware/real-device surfaces | Alexa+ device only if toolkit access arrives (Phase 7) |
| Agent command directory | `.claude/skills/` and `.agents/skills/` |
| Capability registry owner | N/A (Wave C not adopted) |
| Release approver | Owner |
| Rollback authority | Owner (`cdk deploy` of the previous commit) |

### Environment truth table

| Environment | Exact artifact? | Real auth? | Real datastore? | Real vendors? | Safe writes? | Main limitations |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Local | YES | YES (own OAuth server) | NO (in-memory or fixtures) | NO | YES | KMS signing and DynamoDB mocked behind interfaces |
| CI | YES | NO | NO | NO | YES | Typecheck, lint, test, synth only; no deploy |
| Preview | NA | NA | NA | NA | NA | None exists |
| Staging | NA | NA | NA | NA | NA | None exists |
| Production | YES | YES | YES | YES | NO | First full-integration environment; see risk below |

Open release risk: production is the first environment where CloudFront, Lambda, KMS,
DynamoDB and AgentCore Gateway meet. Mitigation is the Phase 6 smoke list below and the
fixture provider, which lets every tool be exercised without the private repository.

## Wave A: truthful release checklist

### A1. One source of truth for release steps

- The release steps are this file plus `pnpm deploy`. `README.md`, `AGENTS.md` and the
  CI workflow link here and do not restate the sequence.
- Stale-text scan before each release: branch names, test commands, deploy command,
  domain, AWS account and profile.

### A2. A pass is non-empty

- `python3 .rpi/scripts/rpi-verify.py` must report every check in `.rpi/policy.json`
  as run and passed for the exact candidate commit. Zero checks run is a failure.
  A skipped required check is a failure. A failing check that was "quarantined" is a failure.

### A3. Required probes against the deployed candidate (Phase 6 onward)

| Probe | Owner | Evidence |
| --- | --- | --- |
| Deployed identity: `/health` returns the candidate commit | Owner | curl body saved locally |
| Unauthenticated `POST /mcp` returns 401 with Protected Resource Metadata (RFC 9728) | Owner | curl body |
| `/.well-known/oauth-authorization-server` lists `client_credentials` (RFC 8414) | Owner | curl body |
| `/.well-known/jwks.json` serves the KMS public key | Owner | curl body |
| `initialize` at `protocolVersion: "2025-03-26"` and `server/discover` at `2026-07-28` both succeed | Owner | protocol test run against the deployed host |
| `tools/list` returns exactly `list_family_stories`, `get_family_story`, `suggest_next_story` with `readOnlyHint: true` | Owner | saved response |
| Round trip for each tool with the fixture provider under 500 ms (p95) | Owner | CloudWatch dashboard screenshot or metric export |
| Authorization denial: a token with the wrong scope is rejected on `/mcp` | Owner | curl body |
| Persistence readback: a refresh-token rotation writes and reads DynamoDB | Owner | test run output |
| Cleanup: demo subject data removed after the probe run | Owner | log line |

Before Phase 6 the probes run locally against the Hono handler (Phases 1 and 2 tests).

### A3a. Deploy procedure (Owner's machine, profile `archy`, account `106403001709`)

```bash
export AWS_PROFILE=archy
aws sso login                                     # or the profile's credential flow
pnpm build                                        # simulator dist + infra/dist/lambda + infra/dist/skill
pnpm -F infra exec cdk bootstrap                  # once per account/region

# Deploy 1: Core, Simulator, Api, Edge, Observability, Skill (no gateway yet)
pnpm deploy -c sla:certificateArn=arn:aws:acm:us-east-1:106403001709:certificate/<id>
pnpm -F infra seed:secrets                        # keeps existing values; --rotate-bridge / --rotate-m2m to rotate
node scripts/verify-deploy.mjs                    # DNS, TLS and the server answer before the gateway exists

# Deploy 2: the AgentCore Gateway (needs the public endpoint to resolve)
pnpm deploy -c sla:certificateArn=... -c sla:deployGateway=1
#   prints SpokenLetterAlexaGateway.GatewayUrl

# Deploy 3: the agent targets the gateway (SigV4-signed, D19)
pnpm deploy -c sla:certificateArn=... -c sla:deployGateway=1 -c sla:gatewayUrl=<GatewayUrl>

# Skill (Phase 9): create the development-stage skill, lock the Lambda to its id, finish the manifest
pnpm -F skill deploy                              # creates the skill; records sla:skillId (manifest validation fails until the permission exists)
pnpm deploy -c sla:certificateArn=... -c sla:deployGateway=1 -c sla:gatewayUrl=...
pnpm -F skill deploy                              # manifest and interaction model now deploy
```

Pass `-c` directly after `pnpm deploy` (a `--` separator makes pnpm swallow the flags
and the stacks silently skip). Put the context keys in `infra/cdk.context.json` after the
first run so the commands shorten to `pnpm deploy`. Keys: `sla:certificateArn` (the ACM certificate for
`alexa.spokenletter.com` in `us-east-1`; without it EdgeStack is skipped and the function
URL answers 403 to everything, since only CloudFront carries `x-origin-verify`, D18),
`sla:alertEmail` (defaults to the Owner's address), `sla:deployGateway` (`1` from the
second deploy on), `sla:gatewayUrl` (the `GatewayUrl` output; from the third deploy on
the agent's `MCP_URL` is the gateway), `sla:skillId` (written by `pnpm -F skill deploy`).
Every deploy runs with `PROVIDER_MODE=fixtures` for every subject; Phase 8 switches to
`auto` after the private bridge lands.

After every deploy: `node scripts/verify-deploy.mjs` (discovery, legacy `initialize`,
modern `server/discover`, tool latency, SSE pass-through); with `M2M_SECRET` from the
seeded `sla/oauth-clients` document the authenticated checks run too. From Spain set
`ASSERT_P95=0` and record the numbers; the p95 assertion is for the `us-east-1` runner.

### A4. Release ordering

1. Identify the candidate: merge `develop` into `main` locally, then `git rev-parse main`, clean tree.
2. Run the local gate: `python3 .rpi/scripts/rpi-verify.py`.
3. Deploy that candidate: `pnpm deploy` (Owner authorization).
4. Verify deployed identity (`/health`).
5. Run the A3 probes.
6. Record results in the friction log entry for the release.
7. Owner approval.
8. Tag last (`vX.Y.Z`), never before steps 1 to 7.

## Waves B to H

Not adopted, per the simplicity non-negotiable and `phase-0.md` section 2.

| Wave | Decision | Reason |
| --- | --- | --- |
| B exploratory charters | Not adopted now | A single hackathon deploy; `rpi-explore-release` can run once a deployed candidate exists |
| C capability registry | Not adopted | Three read-only tools; the tool table in the main plan is the registry |
| D combination engine | Not adopted | No feature combinations beyond the link flow |
| E plan compiler | Not adopted | One fixed gate for every change |
| F environment fidelity | Not adopted | No staging or preview; risk recorded above |
| G model-based tests | Not adopted | OAuth state machine covered by conformance tests in Phase 2 |
| H cadence and TTL | Not adopted | Solo project, 50-day horizon |
