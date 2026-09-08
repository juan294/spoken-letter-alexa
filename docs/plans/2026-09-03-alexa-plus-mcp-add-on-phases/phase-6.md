# Phase 6 — AWS deployment: CDK stacks, domain, AgentCore Gateway, observability

`infra/`. First real deploy. Touches only AWS account `106403001709` (profile `archy`, region `us-east-1`) and the public repository; nothing in the private repository or its production changes.

## Design-system note

Non-visual. The SPA deployed here is Phase 5's unchanged.

## 1. Stacks

| Stack | Resources |
|---|---|
| `CoreStack` (Phase 0, extended) | DynamoDB `sla-oauth` and `sla-agent-sessions` (on-demand, TTL), KMS RSA key with alias `alias/sla-jwt`, Secrets Manager `sla/bridge` and `sla/oauth-clients` |
| `ApiStack` | One Lambda (Node 24, arm64, 1024 MB, bundled with esbuild from `packages/mcp-server/src/lambda.ts` which mounts mcp-server, oauth, and agent on one Hono app), function URL with `invokeMode: RESPONSE_STREAM` and `authType: AWS_IAM` behind CloudFront OAC, environment from Secrets Manager at cold start, X-Ray active tracing, reserved concurrency 20 |
| `SimulatorStack` | S3 bucket (private, OAC) holding the built SPA and `fixtures/audio`, deployed with `BucketDeployment` |
| `EdgeStack` | CloudFront distribution: default behaviour → Lambda function URL origin (all methods, no caching, forward `Authorization`, `MCP-Protocol-Version`, `Mcp-*`, `Accept`), `/demo/*` and `/fixtures/*` → S3 origin (cached), ACM certificate from Phase 0, Route53 A/AAAA alias `alexa.spokenletter.com`, response headers policy (HSTS, nosniff), a WAF rate-based rule of 300 requests per 5 minutes per IP on `/oauth/*` |
| `GatewayStack` | AgentCore Gateway with an MCP server target at `https://alexa.spokenletter.com/mcp`, outbound auth `CLIENT_CREDENTIALS` via an AgentCore Identity OAuth credential provider using the `alexa-m2m` client (token endpoint `/oauth/token`, scope `mcp:service`), inbound auth for the agent Lambda (IAM), `ListingMode: DEFAULT`, `SynchronizeGatewayTargets` run by a custom resource after deploy; protocol versions left at the default set that includes 2026-07-28 |
| `ObservabilityStack` | CloudWatch dashboard: tool latency p50/p95/p99 (custom metric `sla/mcp ToolLatencyMs` by tool name, emitted with EMF from `withLatencyMetric`), OAuth error rate, Lambda duration and errors, function URL 5xx; alarm on `ToolLatencyMs p95 > 400` over 5 minutes → SNS email to the Owner; log group retention 30 days |

IAM: the Lambda role gets `bedrock:InvokeModel*` on the chosen model, `polly:SynthesizeSpeech`, `transcribe:StartStreamTranscription`, `kms:Sign` and `kms:GetPublicKey` on the key, `dynamodb:*Item` on the two tables, `secretsmanager:GetSecretValue` on the two secrets, `s3:PutObject` on a `polly/` prefix with 1-hour lifecycle. Nothing broader.

CDK tests (`infra/test/*.test.ts`, `Template.fromStack`): every stack synthesizes; the Lambda has `InvokeMode: RESPONSE_STREAM`; no IAM statement uses `Resource: "*"` except the Transcribe and Polly actions that require it; the OAuth table has TTL enabled.

## 2. Deploy procedure (`docs/release.md`, executed by the Owner's machine)

```
aws sso login / profile archy
pnpm build                                   # packages + SPA
pnpm -F infra cdk bootstrap                  # once
pnpm deploy                                  # cdk deploy --all --require-approval broadening
pnpm -F infra seed:secrets                   # writes OAUTH_CLIENTS json and a fresh ALEXA_BRIDGE_SECRET; prints the bridge secret ONCE for Vercel
```

The bridge secret goes into Vercel (`vercel env add ALEXA_BRIDGE_SECRET production` plus `ALEXA_BRIDGE_ORIGIN=https://alexa.spokenletter.com`) only in Phase 8 after the freeze; in September the deployed server runs with the fixture provider for every subject (`PROVIDER_MODE=fixtures`).

## 3. Streaming verification

`scripts/verify-deploy.mjs`: `curl` the PRM and AS metadata; legacy `initialize` through CloudFront; a modern `server/discover`; `tools/call` timing from an EC2-less vantage (the Owner's machine in Spain and a GitHub Actions runner in `us-east-1` via `workflow_dispatch`) asserting p95 under 500 ms from the runner; an SSE stream test that a progress notification arrives before the result (proves CloudFront is not buffering; if it is, switch the `/mcp` behaviour to the function URL hostname and record it in the friction log).

## 4. AgentCore Gateway wiring in the agent

`MCP_URL` becomes the gateway's MCP endpoint; the agent authenticates with SigV4 (IAM inbound). The "Under the hood" drawer shows the gateway-prefixed tool names (Gateway prefixes target names; the SPA strips the prefix for display and shows the raw name on hover). Record the gateway's synchronize duration and any tool-name limits in the friction log.

## Success criteria

Automated: `pnpm -F infra test` and `synth` green in CI; `scripts/verify-deploy.mjs` green from the `us-east-1` runner.

Manual: `https://alexa.spokenletter.com/demo` plays a fixture story end to end in the Owner's browser; the CloudWatch dashboard shows tool latencies; the alarm is in `OK`; the AgentCore Gateway target status is `READY`; certificate and DNS resolve from Spain and from the runner.
