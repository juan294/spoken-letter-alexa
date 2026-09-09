# Friction log

## By tool (submission summary; the dated entries below are the evidence)

| Tool | Severity | One-line suggested fix |
| --- | --- | --- |
| Alexa+ MCP Toolkit access (`alexa-ai` CLI, Inspector, simulator) | high | A self-serve access tier for hackathon entrants, and the manifest schema outside the gated toolkit. |
| Alexa+ audio playback contract | high | One page stating which content types Alexa+ renders and plays from a tool result (`resource_link`, screened vs screenless). |
| Alexa+ protocol facts | medium | Publish the live client's `initialize` version (2025-03-26), the Inspector's (2025-06-18) and its `Mcp-Session-Id` expectation on one page. |
| CloudFront OAC in front of a Lambda function URL | high | Document that the OAC overwrites the viewer's `Authorization` header, or let the OAC use another header; the viewer-request copy function is the workaround. |
| MCP TypeScript SDK v2 | low | Export the modern revision constant; one "minimal modern request" example (three `_meta` keys, three headers). |
| Strands Agents SDK | medium | Map `structuredContent` in `McpTool`; ship a 2.x-compatible client transport; stop pulling native optional dependencies. |
| AgentCore Gateway (CDK L2) | low | Enumerate 2025-11-25 and 2026-07-28 in `MCPProtocolVersion`; avoid the wildcard secret grant when the ARN is a token. |
| Amazon Transcribe streaming | low | Accept Opus so browsers need no `ffmpeg` hop. |
| Amazon Polly | none | Nothing yet. |
| Bedrock model access | medium | Surface "model access not enabled" before the first invoke, ideally from the CLI. |
| AWS CDK (`NodejsFunction`, typings) | medium | Run esbuild through its API when the bin is a native binary; add `| undefined` to optional members for `exactOptionalPropertyTypes`; document the S3 OAC cross-stack cycle. |
| Kiro Crew | low | Publish an installable CLI. |
| pnpm 11 (not Amazon) | low | Recorded for completeness: minimum release age and `allowBuilds` prompts. |

Dated entries, kept from day one, for the AWS Builder mini challenge and the hackathon's
product-feedback requirement. Each entry names the tool, what happened, the severity
(low, medium, high) and a one-line suggested fix. The final pass (Phase 8) groups the
entries by tool.

## 2026-09-03: research findings (before any code)

- **Alexa+ MCP Toolkit access is partner-only.** Severity high. The `alexa-ai` CLI, the
  Local Inspector and the web simulator sit behind a private CodeArtifact registry and a
  Solutions Architect invitation. A hackathon entrant with a public developer account
  cannot install the toolkit. Fix: a self-serve access tier for the hackathon window.
- **US-only, en-US-only.** Severity medium. Add-ons distribute only in the United States
  with one `en-US` locale block; the developer is in Spain. Fix: document the US account
  topology in the quickstart instead of leaving it to be discovered.
- **Audio playback from an MCP tool result is undocumented.** Severity high. The
  `resource_link` content block is the only spec-shaped way to hand Alexa an MP3, and
  the docs never say whether a screened or screenless device plays it. Fix: one page
  that states which content types Alexa+ renders and plays.
- **The live client sends `protocolVersion: "2025-03-26"`; the Local Inspector sends
  `2025-06-18` and expects `Mcp-Session-Id`.** Severity medium. A server on the newest
  spec (2026-07-28) has to serve two eras. The TypeScript SDK v2 does this by default
  (`legacy: 'stateless'`), but the stateless mode mints no session id, so the Inspector
  may fail. Fix: publish the exact client versions and the session expectation on one
  page. (Contingency implemented in Phase 7.)

## 2026-09-08: Phase 0 (repository bootstrap)

- **Kiro Crew was not available on the development machine.** Severity low. Phase 0 asked
  Kiro Crew to draft `infra/lib/core-stack.ts` and its test. Neither `kiro` nor
  `kiro-cli` is installed and the tool is not on npm or Homebrew from this account, so the
  stack and test were written by hand from the plan's resource list (DynamoDB `sla-oauth`,
  KMS RSA_2048 `alias/sla-jwt`, Secrets Manager `sla/bridge`). Fix: publish Kiro Crew as
  an installable CLI with a documented install command. The draft can be re-run through
  Kiro later for comparison; the plan's "what it got right" record is therefore empty.
- **CDK CLI detects an AI agent and switches to `--progress errors-only`.** Severity low,
  pleasant surprise: `cdk synth` prints only errors when run from an agent session.
- **`cdk synth` warns that 71 feature flags are unconfigured.** Severity low. A fresh
  `cdk.json` from the plan does not know which flags matter. Fix: `cdk init` output could
  be the documented baseline; we kept the common recommended flags.
- **pnpm 11 minimum release age.** Severity low, not Amazon. pnpm refused to install
  packages published in the last days without an explicit exclusion list and wrote that
  list into `pnpm-workspace.yaml`. Recorded in ADR 0001.
- **ACM certificate not requested yet.** Any AWS mutation is an Owner gate in this
  repository, so `aws acm request-certificate` for `alexa.spokenletter.com` waits for
  the Owner (read-only check on 2026-09-08 with profile `archy`: no certificates exist in
  `us-east-1`).

## 2026-09-08: Phase 1 (MCP server core)

- **MCP SDK v2 reports `LATEST_PROTOCOL_VERSION = "2025-11-25"` while serving
  2026-07-28.** Severity low. The constant names the newest *legacy* revision; the modern
  revision is internal (`FIRST_MODERN_PROTOCOL_VERSION`). Discovered by probing
  `createMcpHandler` directly. Fix: export the modern revision constant and say so in the
  migration guide.
- **The modern envelope needs three `_meta` keys, not one.** Severity low. A 2026-07-28
  request is rejected with `-32602` unless `params._meta` carries
  `io.modelcontextprotocol/protocolVersion`, `.../clientCapabilities` and `.../clientInfo`
  together with the `MCP-Protocol-Version`, `Mcp-Method` and (for `tools/call`)
  `Mcp-Name` headers. The error message names the missing key, which made it a
  ten-minute detour rather than an hour. Fix: one "minimal modern request" example in
  the server package README.
- **Legacy responses are SSE even for a single JSON-RPC reply.** Severity low. With
  `Accept: application/json, text/event-stream` the stateless legacy fallback answers
  `text/event-stream` with one `event: message` frame; modern requests answer plain
  JSON. Tests parse both. Alexa+'s client handles SSE per the Streamable HTTP spec, so
  this is informational.
- **`WWW-Authenticate` carries `error` and `error_description` before
  `resource_metadata`.** Severity low. Amazon's quickstart text shows only the
  `resource_metadata` parameter; the SDK's `bearerAuthChallengeResponse` emits the RFC
  6750 parameters too, which is spec-conformant. Kept the SDK shape; the test asserts the
  parameter, not the whole header.
- **Tool auth reaches handlers under `ctx.http.authInfo`.** Severity low. The v2
  handler signature is `(args, ctx)` and the pass-through `authInfo` is nested under
  `ctx.http`, not at the top level as the v1 `extra.authInfo` was. The migration guide
  covers it; noted here because the plan's pseudo-code assumed `ctx.authInfo`.
- **Latency with the fixture provider.** Measured by `latency.test.ts` on the build
  machine (Apple silicon, Node 24.18, 50 calls per tool through the full handler, run
  2026-09-08): list p50 0.4 ms / p95 1.0 ms / p99 2.2 ms; get p50 0.3 / p95 0.6 /
  p99 1.3 ms; suggest p50 0.3 / p95 0.4 / p99 0.9 ms. Amazon's 500 ms budget is spent
  on the network, not the handler; Phase 6 measures the rest.
- **Fixture recordings are an Owner step.** No author-voice story exists anywhere in the
  private repository (only placeholder samples, AI voice auditions and marketing audio),
  so `fixtures/audio/` and `fixtures/stories.json` wait for the Owner's MP3 export;
  `scripts/add-fixture-story.mjs` measures the duration with `ffprobe` and appends the
  entry. The local server and the tests run without them.

## 2026-09-08: Phase 2 (OAuth 2.1 authorization server)

- **No AWS tool friction to report yet**: DynamoDB and KMS were exercised through
  `aws-sdk-client-mock` only. Two design notes for the Phase 6 deploy: the single-table
  layout needs two GSIs (`byFamily`, `bySubject`) so refresh-token families and subjects
  can be revoked without a scan (added to `CoreStack`), and KMS `Sign` with `MessageType:
  RAW` accepts the JWT signing input directly, so no local digest step is needed.
- **Amazon's checklist and RFC 6749 disagree on nothing, but the order of checks
  matters.** Severity low. Client authentication runs before grant validation, so a
  request with an unknown grant and no client credentials is `401 invalid_client`, not
  `400 unsupported_grant_type`. Documented in the conformance tests so a future reader
  does not "fix" it.
- **The consent page lives in Spoken Letter (Phase 3), so this server renders exactly
  two plain-text error pages** (unknown client, unregistered redirect). They are
  `text/plain` until the brand tokens are vendored in Phase 5 (D8).

## 2026-09-08: Phase 4 (HTTP provider, JWT gate, end-to-end link flow)

- **`requireBearerAuth`'s `requiredScopes` demands every listed scope.** Severity low.
  The plan's gate (`requiredScopes: ["mcp:tools"]`) would have locked out the
  client_credentials tier (`mcp:service`) that the AgentCore Gateway uses. The gate now
  verifies with the SDK helper and checks "any of `mcp:tools`, `mcp:service`" itself,
  answering `403 insufficient_scope` through `bearerAuthChallengeResponse` (D9). Fix: an
  `anyOfScopes` option on the helper.
- **The private bridge does not exist yet, so Phase 4's end-to-end proof runs against a
  mock.** `packages/mcp-server/src/test-bridge.ts` and `scripts/mock-spoken-letter.mjs`
  implement the two bridge routes and the two session routes exactly as phase-3.md
  section 5 specifies them (the script adds the link page itself); the automated `app.test.ts` drives authorize, confirm, continue,
  exchange, legacy initialize, both tools and disconnect through them (D10). The real
  run with a Spoken Letter session cookie is the Phase 8 step after the freeze.
- **Hono's `app.request` returns `Response | Promise<Response>`.** Severity low, not
  Amazon. Wrapping it in `Promise.resolve` is needed to use it as a `fetch` stand-in.

## 2026-09-08: Phase 7 (Amazon packaging path, session-id contingency)

- **`addon.json` field names are unrecorded.** Severity medium. The research captured
  only `distributionCountries` and the existence of one `en-US` block; every other key
  in `amazon/addon.json` is a conventional guess listed in `amazon/addon-fields.md` for
  Amazon to confirm. Fix: publish the manifest schema outside the gated toolkit.
- **`isLegacyRequest` is the entry's own classifier.** Severity low, pleasant. It clones a
  POST body internally so the request stays readable for whichever leg it is routed to,
  and routing anything it classifies as modern anywhere but the modern handler is wrong by
  contract. This made the per-session contingency (`legacy-sessions.ts`) a small module.
- **A stateful `WebStandardStreamableHTTPServerTransport` answers its own protocol
  errors.** A non-initialize request on a fresh session answers `400 -32000 "Server not
  initialized"`; a session mismatch `404 -32001`. The contingency relies on the first and
  answers the second itself because the session map, not one transport, owns the set.
- **`aws-cdk-lib` 2.268.0 under `exactOptionalPropertyTypes`.** Severity low. `IVpc` and
  `ICluster` optional members lack `| undefined`, so `new Vpc(...)` / `new Cluster(...)`
  fail assignability; `infra/lib/legacy-stack.ts` casts at the two sites with a comment.
  Fix: add `| undefined` to the optional members in the generated typings.
- **Toolkit gaps carried truthfully.** `amazon/runbook.md` names every step whose exact
  command the research did not record (role assumption snippet, CodeArtifact domain,
  CLI install, deploy flags, simulator URL) instead of inventing one;
  `amazon/AGENT_SKILL.md` records that the skill text is gated.

## 2026-09-08: Phase 5 (agent, Transcribe, Polly, simulator)

- **Strands' `McpTool` drops `structuredContent`.** Severity medium. Only the `content`
  blocks reach the model, so a tool whose useful data (story ids, audio URL) lives in
  `structuredContent` is unusable from Strands. The MCP specification asks servers to
  serialise structured content into a text block for backwards compatibility, so every
  tool now appends that JSON block (D11). Fix: map `structuredContent` to a json block in
  `McpTool`.
- **A `resource_link` content block becomes a Strands json block.** Severity low. The
  scripted model first mistook that block for the story JSON; readers must match on the
  key they need, not the first JSON-looking block.
- **Tool hooks fire for the structured-output validator.** Severity low.
  `AfterToolCallEvent` runs for `strands_structured_output` as well as for MCP tools; the
  trace filters it out so the drawer shows only real calls.
- **`McpClient` wants a 1.x transport.** As the plan's risk table predicted,
  `@modelcontextprotocol/sdk` 1.30.0 is used for the agent's client; the server stays on
  v2 and answers the 1.x client's legacy `initialize` without changes.
- **The Strands SDK pulls native optional dependencies.** Severity low. pnpm 11 stopped
  the install until `better-sqlite3`, `node-llama-cpp` and the `tree-sitter-*` builds were
  explicitly disallowed in `pnpm-workspace.yaml`; none of those code paths are used.
- **`ffmpeg-static` typings under NodeNext.** Severity low. The CommonJS default export
  arrives as a module namespace object; `resolveFfmpegPath` accepts both shapes.
- **Bedrock model access is an Owner step.** Read-only `list-foundation-models` and
  `list-inference-profiles` (profile `archy`, 2026-09-08) show Claude Haiku 4.5 and Nova
  Lite inference profiles available in the account; whether invocation is enabled is only
  known on the first live call (`AccessDeniedException` per the plan's risk table). The
  default `BEDROCK_MODEL_ID` is `us.anthropic.claude-haiku-4-5-20251001-v1:0`.
- **`aws-cdk-lib` typings, again.** The `sla-agent-sessions` table is now in `CoreStack`
  so the agent's DynamoDB session store has a home before Phase 6.
- **Playwright in CI runs against the SPA's in-app mock transport**, not against
  `pnpm dev:offline` as phase-5 says (D13): the CI job has no agent server and no AWS,
  and the mock keeps the smoke deterministic. `pnpm dev:offline` is the manual path.

## 2026-09-08: Phase 6 (CDK stacks, written and synthesized, not deployed)

- **CloudFront's origin access control replaces the viewer's `Authorization` header.**
  Severity high for any OAuth-protected MCP server behind a Lambda function URL with
  IAM auth: the SigV4 signature CloudFront adds overwrites the bearer token, and
  `Authorization` cannot be forwarded through an origin request policy either. The fix
  is a CloudFront Function on viewer-request that copies the header into
  `X-Forwarded-Authorization`, forwarded by policy, and a two-line rewrite on the Lambda
  event (`packages/app/src/forwarded-auth.ts`) before Hono sees it (D14). Fix for Amazon:
  document this on the "Lambda function URL with OAC" page, or let the OAC use a
  different header.
- **S3 OAC bucket policies cycle across stacks.** Severity low. The bucket in
  SimulatorStack, the distribution in EdgeStack and the Lambda grant in ApiStack made a
  three-stack cycle. Resolved by a fixed bucket name (`ASSETS_BUCKET_NAME`) so ApiStack
  and EdgeStack import it by name, and by EdgeStack owning the single bucket policy (OAC
  read plus a secure-transport deny; `enforceSSL` is off in SimulatorStack so it does not
  create a second policy) (D15).
- **pnpm's bin shim cannot run esbuild's native binary.** Severity medium.
  `NodejsFunction` shells out to `pnpm exec -- esbuild`; esbuild's postinstall replaces
  `bin/esbuild` with the Mach-O binary, and pnpm runs it through Node
  (`SyntaxError: Invalid or unexpected token`). The bundle is now produced by
  `infra/scripts/bundle-lambda.mjs` through the esbuild JS API, which also installs
  `ffmpeg-static` for linux/arm64 with `npm_config_platform`/`npm_config_arch` and copies
  the fixture catalog (D16). Verified: `pnpm -F infra build` produces a 5 MB `index.mjs`
  and an `ELF 64-bit ARM aarch64` ffmpeg.
- **`aws-cdk-lib` under `exactOptionalPropertyTypes`, again.** L2 interfaces such as
  `IBucket` and `IOAuth2CredentialProvider` declare optional members without
  `| undefined`; `infra/tsconfig.json` turns the flag off for the CDK app only.
- **AgentCore Gateway L2 constructs exist and are pleasant.** `Gateway`,
  `GatewayTarget.forMcpServer`, `GatewayAuthorizer.usingAwsIam`,
  `OAuth2CredentialProvider.usingCustom` with RFC 8414-style metadata and
  `GatewayCredentialProvider.fromOauthIdentity` covered the plan's design without L1s.
  Two notes: `MCPProtocolVersion` enumerates 2025-03-26 and 2025-06-18 only, so the
  protocol versions are left at the service default (D17); and the identity grant warns
  that a token-derived secret ARN gets a wildcard `bedrock-agentcore-identity!*` grant.
- **Cross-stack references default to strong references.** CDK warns that
  `SpokenLetterAlexaApi` imports values from Core and Gateway; expected for this
  topology, acknowledged in the deploy notes.
- **AWS mutations are Owner gates.** Nothing was deployed: `cdk bootstrap`, the first
  `cdk deploy`, `seed:secrets`, the ACM certificate and the AgentCore Gateway creation
  all wait for the Owner. `scripts/verify-deploy.mjs` is ready for the first run.

## 2026-09-08: Phase 6 review (function URL, gateway, rate limiting)

- **Lambda function URLs behind an origin access control refuse streaming POSTs.**
  Severity high (found in review, before any deploy). With an OAC, Lambda validates
  `x-amz-content-sha256` on every request that has a body; CloudFront does not compute
  it, so every JSON-RPC and OAuth POST would answer 403. The documented workaround (a
  Lambda@Edge or CloudFront function that hashes the body) cannot see streaming bodies.
  The stack now uses auth type NONE with a shared `x-origin-verify` header from Secrets
  Manager, checked in constant time inside the handler (D18). Amazon: a first-class
  "CloudFront only" option for function URLs that does not require the payload hash
  would remove a whole class of misconfiguration.
- **AgentCore Gateway inbound IAM means SigV4 from the agent.** Severity medium. The
  Strands MCP client takes a `fetch`; a SigV4-signing `fetch` (`@smithy/signature-v4`,
  service `bedrock-agentcore`) was 50 lines (D19). Documented nowhere for MCP clients.
- **Gateway targets synchronize at creation.** Severity medium. The MCP server target
  fetches `tools/list` when created, so the public endpoint must resolve first; a later
  tool change needs `SynchronizeGatewayTargets`, which the L2 does not expose. An
  `AwsCustomResource` runs it on every deploy (D20).
- **`X-Forwarded-For` is viewer-controlled up to the last hop.** Severity low. The rate
  limiter now keys on `CloudFront-Viewer-Address` (forwarded by the origin request
  policy) and otherwise on the last `X-Forwarded-For` entry.
- **`AwsCustomResource` has no SDK metadata for `bedrock-agentcore-control` in CDK
  2.268.** Severity low. The custom resource sets `InstallLatestAwsSdk`, so the first
  synchronization installs the SDK inside the provider Lambda (slow first run, then
  cached). A constant physical id would also have made the sync run once; the id now
  carries the synth time so every deploy refreshes the gateway's tool list.
- **Unversioned Secrets Manager dynamic references are not re-resolved.** Severity
  medium. Rotating `alexa-m2m` leaves the AgentCore credential provider on the old
  value until the resource changes; `seed:secrets --rotate-m2m` prints the new
  `VersionId` and the deploy passes it as `-c sla:m2mSecretVersion=...`.
- **`pnpm deploy -- -c key=value` loses the flags.** Severity medium (documentation).
  With the `--` separator pnpm does not forward `-c` to the nested `cdk deploy`, so the
  edge and gateway stacks silently skip; `pnpm deploy -c ...` works. Verified with
  `pnpm synth` on both forms.

## 2026-09-08: Phase 9 (classic-skill front end, written, not registered)

- **`AMAZON.SearchQuery` needs a carrier phrase.** Severity low. A sample that is only
  `{text}` is rejected by the console; intent-neutral carrier phrases ("to {text}",
  "can you {text}") route free text to the catch-all instead, and Alexa hands the skill
  only the slot value, so a carrier must never hold the verb (D21). The bridge's README
  does not mention either point.
- **A Lambda endpoint receives no request signature.** Severity low. Verification is
  the Alexa Skills Kit trigger permission (restricted with `EventSourceToken` to the
  skill id) plus the `applicationId` check in the handler; both are in place, and the
  permission does not exist until `sla:skillId` is known, so nothing can invoke the
  function before the skill does.
- **No store is needed for pause and resume.** The stream token Alexa echoes back
  carries the whole `play` object (URL, title, storyteller, duration), so
  `AMAZON.ResumeIntent` rebuilds the directive from the token and the reported offset.
- **ASK CLI is a separate toolchain, and registration is circular.** Severity medium.
  The Skill Management API refuses a Lambda endpoint whose resource policy does not yet
  allow `alexa-appkit.amazon.com` ("The trigger setting for the Lambda ... is invalid")
  and creates no skill at all, so no id exists to lock the permission to. The
  registration is three steps: an open trigger permission
  (`pnpm deploy -c sla:skillPermissionOpen=1`), `pnpm -F skill deploy`, then `pnpm
  deploy` to lock the trigger to the new id. Also: ask-cli 2.30.7 has no `--ignore-hook`;
  `--target skill-metadata` is the option that skips infrastructure. Whether an
  Alexa+ device in Spain routes to a development-stage `en-US` skill is still the open
  question from `amazon/us-account-checklist.md`; the first device test answers it.

## 2026-09-09: first deploy (Owner-authorized), account and network findings

- **Lambda concurrency quota of 10 blocks any reserved concurrency.** Severity medium.
  A fresh account's quota is 10 concurrent executions and Lambda keeps 10 unreserved, so
  `reservedConcurrentExecutions: 20` (or 1) fails the stack. Removed (D23); a quota
  increase is a Service Quotas request the Owner can file.
- **`cdk deploy` cannot survive a weak uplink.** Severity medium. With the Owner's link
  at about 33 KB/s the SDK's parallel multipart uploads of the 27 MB API asset and the
  21 MB CLI layer stalled on idle timeouts and the deploy died twice. Workaround that
  worked: zip the staged asset directory and upload the two keys with a single
  connection each (`aws s3 cp` with `multipart_threshold` above the file size), after
  which CDK finds the keys present and skips its own upload. A router restart later
  restored the link to about 100 Mbps.
- **Node.js 24 on Lambda rejects callback-style handlers.** Severity high (every
  request failed with `Runtime.CallbackHandlerDeprecated` on the first live probe). The
  origin-verify wrapper declared three parameters around Hono's streamified handler; the
  runtime treats any plain three-parameter export as callback-based and refuses it. The
  gate is now itself `awslambda.streamifyResponse`-wrapped and writes its 403 to the
  response stream (`gateStreamingHandler`, unit-tested with a fake runtime). Found only
  on the deployed function: the local gate cannot see the runtime's handler check.
- **Function URLs rename `WWW-Authenticate`.** Severity high for an MCP server. The
  function URL returns the challenge as `x-amzn-remapped-www-authenticate`, so the RFC
  9728 discovery hint never reached clients through CloudFront. A viewer-response
  CloudFront Function did not help: CloudFront skips viewer-response functions when the
  origin answers 400 or above (documented under "Restrictions on all edge functions").
  A Lambda@Edge origin-response function, which runs for every origin response, restores
  the header (D24). Amazon: the remapping is documented for function URLs but easy to
  miss when the protocol depends on that exact header on a 401.
- **Deploys 2 and 3 (2026-09-09, Owner-authorized).** Gateway `sla-alexa`, target
  `spoken-letter` `READY` after the manual sync, `GatewayUrl` recorded in
  `infra/cdk.context.json`; the API now targets the gateway with SigV4 (D19). A live demo
  turn through the gateway: `spoken-letter___list_family_stories` (the gateway prefixes
  tool names with the target name) answered in 2.3 s against 15 ms for the same tool
  called on `/mcp` directly, and the whole turn took 6.4 s against 4.2 s. The gateway path
  serves the demo subject as the plan intends; the latency figures go into the product
  feedback.
- **The gateway path is too slow for a classic skill turn.** Severity high for Phase 9.
  The first simulated "ask spoken letter to play the story aunt whitney sent" reached
  the Lambda through `CatchAllIntent` correctly, then hit the 6-second agent budget
  ("This operation was aborted"): one gateway tool call costs 2 to 3 seconds cold and a
  turn needs two plus two Bedrock calls. Device sessions now use the server's own `/mcp`
  (`deviceMcp` in the agent deps, 15 ms per tool) while the demo subject keeps the
  gateway; the skill's budget stays at 6 seconds inside Alexa's 8.
- **`SynchronizeGatewayTargets` needs identity permissions on the caller.** Severity
  medium. The first synchronization failed with "not authorized to perform
  bedrock-agentcore:GetWorkloadAccessToken on workload-identity/<gateway>": the sync
  fetches the target's outbound OAuth token under the caller's identity, not the
  gateway's role, so the custom resource's policy now grants `GetWorkloadAccessToken` and
  `GetResourceOauth2Token` on the gateway's workload identity and the `sla-alexa-m2m`
  provider. A manual sync as the admin user confirmed the OAuth setup itself worked.
- **`cdk deploy --require-approval broadening` prompts.** Severity low. An agent-driven
  deploy uses `--require-approval never` after the Owner's explicit authorization; the
  documented command keeps the prompt for hand runs.

## 2026-09-09: deploy 1 verified (release evidence, `docs/release.md` A3 and A4 step 6)

Candidate `cc79965` on `develop` (gate PASS: typecheck, lint, 319 tests, synth, e2e),
deployed with `AWS_PROFILE=archy` to account `106403001709`, `us-east-1`. Six stacks:
Core, Simulator, Api, Edge, Observability, Skill; the AgentCore Gateway waits for the
Owner's go (deploys 2 and 3). `scripts/verify-deploy.mjs` from Madrid, `ASSERT_P95=0`,
with the seeded `alexa-m2m` secret: every check passed. Discovery documents, the 401
challenge with `resource_metadata` (after D24), `client_credentials` token, legacy
`initialize` at `2025-03-26` echoed, modern `server/discover` at `2026-07-28`, 20 of 20
`tools/call`, SSE pass-through with the first frame after 361 ms.

| Measure from Madrid (n=20) | Value |
| --- | --- |
| tools/call p50 | 340 ms |
| tools/call p95 | 377 ms |
| tools/call p99 | 382 ms |

The plan's p95 < 500 ms target is met even from Europe; the `us-east-1` runner number
(`.github/workflows/latency.yml`) still needs `SLA_M2M_SECRET`. Direct function URL
answers 403 without `x-origin-verify`; `/demo/` serves the simulator; `/fixtures/audio/*`
answers 403 until the Owner's recordings are exported (`fixtures/README.md`) and the
catalog is bundled (`fixtures_missing` warning at cold start until then).

- **Anthropic models on Bedrock need a Marketplace agreement even when access shows as
  authorized.** Severity medium (found on the first live agent turn). The inference
  profile is `ACTIVE`, `get-foundation-model-availability` reports `AUTHORIZED` and
  `AVAILABLE`, the use-case form was already on file (`get-use-case-for-model-access`),
  yet the first `Converse` call from the Lambda answered "Model use case details have
  not been submitted for this account" and the same call from the admin IAM user answered
  "not authorized to perform aws-marketplace:Subscribe". The real state was
  `agreementAvailability: NOT_AVAILABLE`: no Marketplace agreement for Claude Haiku 4.5
  yet. Accepting the offer (console, 12:06 UTC) fixed it within minutes; the next turn
  called `list_family_stories` in 14.6 ms and answered in 4.2 s. Amazon: the two error
  messages point at the wrong causes; `agreementAvailability` was the field that told the
  truth.

## Kiro Crew

No session recorded yet; see the Phase 0 entry above.
