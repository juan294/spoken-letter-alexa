# Friction log

## By tool (submission summary; the dated entries below are the evidence)

| Tool | Severity | One-line suggested fix |
| --- | --- | --- |
| Alexa+ MCP Toolkit access (`alexa-ai` CLI, Inspector, simulator) | high | A self-serve access tier for hackathon entrants, and the manifest schema outside the gated toolkit. |
| Alexa+ audio playback contract | high | One page stating which content types Alexa+ renders and plays from a tool result (`resource_link`, screened vs screenless). |
| Alexa+ protocol facts | medium | Publish the live client's `initialize` version (2025-03-26), the Inspector's (2025-06-18) and its `Mcp-Session-Id` expectation on one page. |
| Alexa+ routing to development-stage custom skills | high | Say whether development skills run under Alexa+, keep support answers consistent, and give developers a per-skill way to test under Alexa+. |
| Alexa custom skill turn budget | high | State the endpoint timeout as a number, and report per-turn endpoint latency against it in the simulator. |
| Alexa progressive responses (Directive Service) | medium | Connect `apiEndpoint`/`apiAccessToken` to slow endpoints in the latency guidance, and ship it in the audio-player sample. |
| ASK CLI interaction model validation | medium | Fail or warn when a manifest declares `AUDIO_PLAYER` but the model omits the required playback intents, or when two `AMAZON.SearchQuery` intents share carrier prefixes. |
| `AMAZON.FirstName` built-in slot | low | Cover kinship-qualified names ("Aunt Whitney"), or document that a custom slot type is required. |
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
- **First real-device playback (2026-09-09, phase-9 success criterion).** On the Owner's
  smaller Echo Show in the office, Amazon account of the skill's vendor, device language
  English (US): "Alexa, open spoken letter" answered the greeting; "play Ignacio" hit
  `PlayStoryIntent`, the agent called `get_family_story` (39 ms) and the Echo played the
  recording through `AudioPlayer.Play`; the lifecycle events followed. The turn took
  5.7 s end to end, nearly all Bedrock, so the agent budget moves from 6 to 7 s inside
  Alexa's 8. The Alexa+ Echo Show 11 (2025) test, the plan's open question about
  development-stage skills on Alexa+ devices, is still to be run.
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

| tools/call (n=20) | Madrid | GitHub runner, us-east-1 |
| --- | --- | --- |
| p50 | 340 ms | 95 ms |
| p95 | 377 ms | 107 ms |
| p99 | 382 ms | 109 ms |
| first SSE frame | 361 ms | 73 ms |

The plan's p95 < 500 ms target is met from both vantage points. The runner figures come
from the manual `latency` workflow (run 34377641274, 2026-09-09) with `SLA_M2M_SECRET`
set by the Owner; every check passed there too. Direct function URL
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

## 2026-09-10: first unscripted conversation on a real Echo

Six spoken turns between 08:56 and 08:58 UTC, plus one at 08:28, reconstructed from
`/aws/lambda/sla-alexa-skill` and `/aws/lambda/sla-alexa-api`. This is the first entry
written from an ordinary use of the skill rather than a scripted demo run, and the first
time end-to-end turn latency was measured as the speaker experiences it.

| Time (UTC) | Turn | Tools called | Played | Lambda duration |
| --- | --- | --- | --- | --- |
| 08:28:15 | PlayStoryIntent (cold) | list, get | yes | 6892 ms (billed 7033) |
| 08:56:20 | LaunchRequest (cold) | — | — | 36 ms |
| 08:56:33 | empty response | — | — | 2.1 ms |
| 08:56:43 | PlayStoryIntent | **none** | **no** | **6357 ms** |
| 08:56:57 | empty response | — | — | 4.2 ms |
| 08:57:05 | empty response | — | — | 2.6 ms |
| 08:57:14 | WhatIsNewIntent | list | no | 3077 ms |
| 08:57:28 | empty response | — | — | 14 ms |
| 08:57:40 | PlayStoryIntent | get | yes | 3216 ms |
| 08:57:48 | empty response | — | — | 1.8 ms |
| 08:58:04 | empty response ×2 | — | — | ~1.8 ms |

The request type is not logged, so the sub-40 ms empty responses are identified only by
their timing shape: they are `SessionEndedRequest` and `AudioPlayer.*` events. The 13 s
gap between the launch at 08:56:20 and the empty response at 08:56:33 fits an unanswered
open question; the pair at 08:58:04 fits playback being stopped about 21 s into a
five-minute story. Nothing in the logs confirms either reading. That is itself the last
finding below.

**The measurement that matters: turn latency is model round trips, nothing else.**
`tool_latency` reports 0.02–0.33 ms server-side and 9.9–25.4 ms client-side for every call
in the session. One tool call produces a ~3.1 s turn; two produce ~5.7–6.9 s. Each model
round trip therefore costs about 2.8 s and the MCP backend costs nothing measurable. The
p95 of 107 ms recorded on 2026-09-09 is a true number about a layer the speaker never
perceives. The only latency lever is the number of model round trips per turn.

### Amazon-facing

- **A custom skill's ~8 s turn budget is not reconcilable with an agentic turn, and
  nothing in the tooling says so.** Severity high. A two-tool agent turn measured 6892 ms
  on a cold container, 100 ms under this repo's own 7 s client abort and roughly 1 s under
  Alexa's ceiling. The developer console, `ask deploy` and `ask validate` never mention a
  budget, and there is no warning, metric or simulator check that a skill endpoint is
  approaching it. Fix: state the endpoint timeout in the custom-skill documentation as a
  number, and have the simulator report per-turn endpoint latency against it.
- **Progressive responses are the documented remedy for exactly this and are almost
  invisible.** Severity medium. `context.System.apiEndpoint` and `apiAccessToken` arrive in
  every request envelope and are the whole mechanism, but nothing in the request reference,
  the skill templates or the ASK SDK quickstart connects them to slow endpoints. Fix:
  mention the Directive Service in the custom-skill latency guidance and ship it in the
  audio-player sample skill.
- **Declaring `AUDIO_PLAYER` in `skill.json` does not add or require the playback
  intents.** Severity **low** (corrected 2026-09-10, D-U4 first claim — was "medium" and
  framed as a certification risk; it isn't one). The developer console adds
  `AMAZON.NextIntent`, `PreviousIntent`, `StartOverIntent`, `RepeatIntent`, `LoopOn/OffIntent`
  and `ShuffleOn/OffIntent` when the interface is switched on in the UI. A `skill-package`
  deployed with `ask deploy` keeps whatever the interaction model file contains, and this
  entry's own original text already noted `ask validate` did not object even when the model
  had none of them. Phase 3 (`docs/plans/2026-09-10-alexa-skill-interaction-ux-phases/
  phase-3.md` section 8) added all ten intents and re-ran `ask smapi submit-skill-validation`
  against the deployed result: `SUCCESSFUL`, "Initial functional tests" passed, no finding
  mentions `AUDIO_PLAYER` or the playback intents at all (the one `FAILED` item is
  "Eligibility to update your live skill instantly," unrelated — this skill has never been
  live). Two runs, with and without the intents, both validate clean: **certification does
  not require them.** The gap is real but purely functional — a person says "next" mid-story
  and nothing happens — which is why the intents were still worth adding. Fix (revised): no
  `ask validate` change needed; the earlier fix suggestion (have validation fail or warn on
  the gap) does not apply since validation was never actually checking for it.
- **Two `AMAZON.SearchQuery` slots in one interaction model route unpredictably, with no
  build-time warning.** Severity medium. `PlayStoryIntent.title` and `CatchAllIntent.text`
  are both `AMAZON.SearchQuery`, and their carrier phrases overlap (`i want to {text}`
  against `i want to hear {title}`). Amazon documents that `SearchQuery` cannot be combined
  with other slots in one sample, but not that two such intents in one model compete. Fix:
  warn at model build time when two `AMAZON.SearchQuery` intents share carrier prefixes.
- **`AMAZON.FirstName` does not cover the way families name each other.** Severity low.
  Every fixture story is recorded by "Aunt Whitney"; `AMAZON.FirstName` is built for
  "Whitney". A relationship word in front of a first name is the normal spoken form in this
  domain. Fix: either extend `AMAZON.FirstName` with relationship prefixes or document that
  a custom slot type is required for kinship-qualified names.

### Ours, not Amazon's

Recorded here because the same session produced them and the fixes are planned together.

- **The skill teaches an utterance that cannot succeed.** `packages/skill/src/handler.ts`
  lines 48, 50 and 53, and `skill.json`'s `examplePhrases` and `testingInstructions`, all
  offer "play the story Grandpa sent". `fixtures/stories.json` then held three stories, all
  by Aunt Whitney. Every prompt the skill speaks steers the speaker into a miss. (Since
  2026-10-08 it holds seven, by Aunt Whitney, Aunt Jordan and Tío Manuel.)
- **A play request dead-ended after 6.36 s.** The 08:56:43 turn called no tools, played
  nothing and answered with a question. Why is not recoverable from the logs.
- **`suggest_next_story` is registered but the agent is never told it exists.**
  `packages/mcp-server/src/tools/index.ts:100` registers it;
  `packages/agent/src/persona.ts` names only `list_family_stories` and `get_family_story`.
  `NextStoryIntent` reaches the model as free text with no tool behind it.
- **`SuggestionMemory` is per-container and in-memory.** `secrets_loaded` fired at 08:06,
  08:13, 08:24 (twice), 08:37 and 08:56, so containers recycle every 10–30 minutes and "the
  next story" is not reliably next.
- **Nothing bridges the end of a story.** `handler.ts:127` answers every `AudioPlayer.*`
  event with an empty response, so `PlaybackNearlyFinished` enqueues nothing and
  `PlaybackFinished` stages nothing. The story ends and the room goes quiet.
- **One failure string covers every failure.** `RETRY` (`handler.ts:51`) is spoken for
  timeouts, auth loss and provider outages alike, and `FALLBACK_SAY` tells the speaker to
  reconnect the skill in the Alexa app even when the cause was a model timeout.
- **The turn log cannot explain a turn.** `skill_turn` carries the intent name, the tool
  names with their timings and a `played` boolean: no request type, slot values, spoken
  text, story id, wall-clock duration or error class.

Remediation is planned in `docs/plans/2026-09-10-alexa-skill-interaction-ux.md`.

## Kiro Crew

No session recorded yet; see the Phase 0 entry above.

## 2026-09-28: local use-case rehearsal for the Alexa demo

This is an offline simulator rehearsal of the four-phase use-case plan, first implemented in local code commit `cc92a9b76b47f1f30adcf5510b2124e4a27383b6`. The final tested commit is identified in `.rpi/local/verification.json`. The simulator uses the `en-US` fixture catalog and in-app mock. No ASK skill version, development-stage skill ID, current AWS stack output, Echo model or device locale was measured in this rehearsal. Alexa intent and slot recognition are N/A for each row because these turns use the simulator's text parser. No Amazon playback token, notification receipt, recipient delivery, or payment was observed. `mock-N-*` tokens below are local simulation tokens, and `mock-reaction-*` and `mock-wish-*` are page-session receipts.

| Scene and exact input | Offline response and state observation | Result |
| --- | --- | --- |
| Playlist: `play all my stories`; `next story`; `previous story`; `restart this story`; `repeat this story`; simulated audio `ended` | Starts `st_ignacio_the_snail` with “Playing Ignacio the snail by Aunt Whitney. This is a delivered demo fixture.” The next turn plays `st_mauricio_the_bull`, previous returns to Ignacio, restart and repeat reset offset to `0`, and `ended` advances to Mauricio. Each play has a new `mock-N-*` token. The MP3 and artwork URLs resolve in Playwright. | Passed offline; Echo playback and Amazon token transitions unmeasured. |
| Selection: `play stories by Aunt Whitney`; `play Martina the music loving mermaid`; `play my newest story`; `play The unseen dragon` | Selects `st_ignacio_the_snail`, then `st_martina_the_mermaid`, then newest delivered `st_mauricio_the_bull`. The unknown title answers “I couldn't find that delivered story. Ask for your stories to hear what is available.” with no play object. | Passed offline; ASK routing and device audio unmeasured. |
| Draft: `let's create a bedtime story`; `about mermaids for Morgan`; `read my latest draft`; `send it to Morgan` | Asks for a general theme, saves a name-free demo outline, then reads back: “Your latest saved demo draft is about mermaids. A friendly mermaid finds a lost shell, asks a friend for help, and brings it home. This is an outline, not a delivered story.” The send request says to choose the listener in Spoken Letter and finish delivery there. The mock stores the canonical theme and outline only. | Passed offline; private-app delivery unmeasured and not attempted. |
| Update and reaction: `what is new?`; `play Martina the music loving mermaid`; simulated audio `ended`; `open spoken letter`; `I love that story`; `read my demo reactions` | The first update names Martina and Aunt Whitney once. Reopening prompts “Did you like or love that story?” once. A love reaction returns `mock-reaction-1`; readback gives one receipt tied to Martina. | Passed offline; persisted service receipt and Echo observation unmeasured. |
| Wish: `I want a story about mermaids`; `yes`; `ask Aunt Whitney for another mermaid story`; `yes`; `read my demo wishes` | Each request asks for confirmation before a save. The mock returns `mock-wish-1` and `mock-wish-2`, then reads back two demo wish receipts. It says neither wish was sent to a creator. A pending wish is dropped if playback interrupts it. | Passed offline; live demo-store readback unmeasured. |
| Notification: `check demo notification`; `what is new?` | The mock states “This offline simulator did not send a device notification.” It names `fixture_new_mermaid_story`, which matches the in-skill Martina event. No proactive send ran. | In-skill fixture path passed offline; opt-in, Amazon receipt and device observation unmeasured. |
| Occasion, help and credits: `any family occasions?`; `how do I create a story?`; `how do I add credits?`; `buy credits` | The birthday is called a synthetic fixture. Creation guidance hands off delivery to Spoken Letter. Credit guidance says Alexa cannot charge or change credits. | Passed offline; no entitlement write or charge attempted. |

The code and test review found and repaired four simulator issues: the next-invocation reaction prompt, bounded reaction and wish receipt readback, an obsolete storyteller example, and saved draft outline readback. The skill also checks wish and reaction receipts before claiming a save. The independent local source review passed after these repairs. At the time of this offline rehearsal, ASK routing needed a development skill test; the run below covers the story-start path. Echo playback and a generic development notification remain unmeasured.

## 2026-09-28: development skill story-start recovery

- The deployed interaction model did not contain `StartStoryIntent`, so the owner's
  “Let's create a story” attempt failed. The globally installed ASK CLI was v1.4.2:
  it printed `Target not recognized` for a deploy command but exited zero. A pinned
  ASK CLI v2 and a deploy-script version check now prevent that false success.
- The first model import rejected an `AMAZON.SearchQuery` sample containing a second
  slot. The next import rejected the same slot name with different slot types in two
  intents. The wish theme now uses a custom `DemoTopic` slot named `wishtopic`.
- After the model built, ASK dialog routed `let's create a story` to
  `StartStoryIntent`, but `about forest` could not save. The API returned 401 because
  CloudFront dropped `X-Alexa-Skill-Secret`. Adding an eleventh forwarded header
  exceeded CloudFront's policy limit, so the unused `Last-Event-ID` was replaced.
- The final local gate passed: typecheck, lint, 505 tests, CDK synth, and 8
  Playwright tests. The public draft API returned 200 for a synthetic forest draft.
  ASK development dialog then answered “What general theme should the demo draft
  have?” and “I saved a demo draft. Open Spoken Letter to choose the listener and
  finish it.” Echo hardware was not tested in this recovery.

## 2026-10-01: session-friction repair, local integrated rehearsal

The September 30 review observed four fallbacks among nine intent requests and two immediate story-start turns without a draft backend call. Missing theme input is an inference, not a reconstructed transcript; legacy redacted slot nulls do not establish input absence. The sanitized evidence and deployed-artifact identity remain in [the repair plan](plans/2026-10-01-alexa-session-friction.md). This entry does not replace the historical observations.

The local repair adds a bounded bare-theme custom intent alongside existing SearchQuery carriers, explicit creation paraphrases, matching reprompts, validated flow recovery, and fixed draft failure/limit guidance. A second consecutive fallback gives a usable carrier and cancel command. Safe diagnostics distinguish missing/present input, fallback, retry, completed action, handoff, cancellation, and no-action turns; they correlate ephemeral sessions without logging speech or names. `FallbackCount` uses the existing CloudWatch namespace with no dimensions and one dashboard sum widget; no new alarm or subscription was added. Deprecated recording flags remain inert, and the historical importer cannot reconstruct this session.

Measured local journeys I1–I4: four passed through the real handler, real HTTP client, Hono routes, and in-memory stores, with only network IO adapted to in-process requests and deterministic outline generation. I1 stored no receipt on two fallbacks, then one mermaids receipt and matching readback. I2 exposed a real HTTP 503 on generation failure, recovered to a canonical space receipt from “stars,” and duplicate request delivery retained the same single receipt without regenerating. I3 verified cancellation/reopening do not resurrect draft entry; fresh creation saved animals. I4 gave a name-free handoff, returned HTTP 422 for unsupported input, played through the real fixture MCP path without drafting, and subsequently saved one mermaids receipt. Names from adversarial input were absent from storage, logs, and those responses.

Independent review and each phase's required five-check gate are recorded in [the implementation notes](plans/2026-10-01-alexa-session-friction-notes.md). The final local receipt is retained under `.rpi/local/alexa-session-friction/`; its exact source/candidate identity takes precedence over a chat claim. Recognition/recovery mutations and privacy/metric mutations were killed locally. These are local behavior measurements, with no AWS/Bedrock rehearsal, ASK publication, deployment, outbound message, private-app write, or Echo observation for this repair. `amazon_routing=UNVERIFIED`; `echo_acceptance=UNVERIFIED`. The [focused device matrix](alexa-device-manual-test-script.md#9-october-1-session-friction-acceptance) has nine NOT RUN cases pending separate publication/deployment authorization and adult hardware observations. No latency improvement or p95 is claimed.

## 2026-10-01: authorized device-test publication, partial deployment

After the Owner authorized deployment, candidate `c7009edf12418855b8a4986f4871a1c06418aabb` passed build/preflight and its skill Lambda update completed. Downloaded Lambda code matched all three local bundle files; code SHA-256 is `jk38LPf49BJ49FXWGE4Zkf8raIy6IJKdqfGwd8y610g=`. ASK CLI 2.30.7 published the development model successfully, and Amazon's fetched model exactly matched the generated JSON. Development testing remained enabled. Seven planned NLU profiles passed for story-start paraphrases, bare mermaids/space, and the existing forest carrier. The full CDK deployment was still publishing the API asset at `2026-10-01T12:58:36Z`, with slow upload and TCP retransmissions observed.

The R1 ASK dialog rehearsal returned Amazon simulation-service errors for all five planned turns, with no skill/API log events observed in the checked window. The CLI's zero exit code did not mean success. This failed result is retained and was not retried. No live draft receipt/readback or Echo audio was proved. The [device guide's section 9](alexa-device-manual-test-script.md#9-october-1-session-friction-acceptance) separates passing NLU profiles from the failed dialog attempt and NOT RUN Echo cases. `amazon_routing=PARTIAL`; `echo_acceptance=UNVERIFIED`. Artifact and operational evidence is recorded in [the deployment continuation](plans/2026-10-01-alexa-session-friction-notes.md#october-1-deployment-continuation). No latency improvement, notification delivery, or private-app effect is claimed.

### October 1: console endpoint journeys and pnpm dispatch repair

The Owner authorized console testing, fixes and republishing. Eleven Amazon NLU plus Manual JSON endpoint journeys passed across 50 turns, with 500 evidence assertions and real DynamoDB receipt readback. Actual fallback recognition preserved draft state, bounded counts at 1/2 and accepted the next valid theme. Wish and reaction recovery preserved confirmed state and saved the expected receipts. Runtime logs contained only safe presence/result/flow fields and hashed session/request correlation. Global simulation still failed with Amazon's generic error after enablement refresh; the console Manual JSON launch succeeded. Echo audio, idle timing and natural completion remain unverified.

The root deploy script collided with pnpm 11's built-in workspace deploy command. Use `pnpm run deploy`; the root script now calls `pnpm -F infra run deploy`. ASK publication also uses explicit `run deploy`. Failed upload and simulation attempts remain in ignored local evidence.


### October 1: final console repairs and verified deployment

The final runtime candidate `c46be917a1c82d02dfc1dfd761b0c41d69e13ec9` fixes six observed console failures: short-title lookup, named-listener and credit-help routing, an omitted unknown storyteller, the source playlist phrase, and the source restart phrase. Independent review and the sequential five-check gate passed (569 tests and eight E2E cases). AWS readback matches every skill/API bundle file; all seven stacks completed. Amazon's fetched development model matches the generated model. The source/model/Lambda identities and operational recovery evidence are in [the implementation notes](plans/2026-10-01-alexa-session-friction-notes.md#october-1-final-console-repair-and-publication).

Sixteen final software cases passed 106 turns and 982 evidence assertions. Coverage includes actual stored drafts/readback, cancellation and contextual fallback, read-once wish/reaction/seed updates, all named handoffs and credits, short/exact titles, playlist stream/token/offset continuity, and three HTTP audio range checks. One Amazon API transport disconnect required an isolated playlist repeat; the failed attempt remains retained. The original manual guide's older exact no-send/cannot-charge wording is explicitly superseded by the preserved current copy.

The final full Alexa simulator still returned Amazon's generic unexpected error with zero observed skill/API log events in its 88.470-second window. The Owner also reports an Echo failure, whose exact words/time are not available. This confirms an unresolved full-invocation path, not a diagnosed broader outage. `amazon_routing=PARTIAL`; `echo_acceptance=UNVERIFIED`. The [updated guide](alexa-device-manual-test-script.md#9-october-1-session-friction-acceptance) marks actual audio, idle timing, natural playback events, and notification delivery as unverified. No latency improvement, notification send, or private-app effect is claimed.

## 2026-10-07: Alexa+ intercepts development-skill invocation

- **Alexa+ routing to a development-stage custom skill.** Severity high. The skill ran under
  Alexa+ on September 28 and 30. From September 29, Alexa+ classified "open spoken letter"
  as a video request ("not supported on this device"), answered "let's create a story" with
  its own built-in story creation, and then returned service-interruption replies. Ending
  Alexa+ Early Access made the same skill work end to end within minutes. Support first
  said the Spain account was not a blocker, then that it might be, and stated that
  development skills are not supported on Alexa+ accounts, which the voice history
  contradicts. Fix: document whether and how development-stage skills run under Alexa+,
  show invocation precedence when an Alexa+ built-in capability overlaps a skill's
  utterances, and give developers a way to test their skill under Alexa+.
- **Alexa+ language statement for Spain.** Severity low. The Amazon.es page says Alexa+ in
  Spain runs only in Spanish (Spain), yet English Alexa+ records appear on en-US devices.
  Fix: state the actual language rule.
- **Voice history as a debugging tool.** Severity low, positive. The Alexa+ record titles
  ("Video", "Request") were the clearest evidence of how Alexa+ routed each utterance.
  Fix: expose the same routing classification in the developer console.
