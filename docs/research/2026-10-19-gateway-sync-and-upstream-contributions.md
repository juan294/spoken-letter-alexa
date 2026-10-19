# Research: AgentCore Gateway target sync failure and upstream contribution candidates

- Date: 2026-10-19 (times in CEST unless marked UTC)
- Repository: `spoken-letter-alexa`, branch `develop`, commit `2ec1aa8e0f1ca7e7209f124494eda31d1fa39241` (clean tree)
- Workflow: `rpi-research` (descriptive). No product code, configuration or remote state was changed.
- Context: Amazon App Dev 2026 hackathon, deadline 2026-10-23 12:00 PT (21:00 CEST). The Devpost entry is submitted and stays editable until then; it enters the AWS Builder and Open Source mini challenges.

## Research questions

1. Why is AgentCore Gateway target `spoken-letter` (`sla-alexa-usrtpg2rea` / `BL0QFT4T2E`) `SYNCHRONIZE_UNSUCCESSFUL`? How does `GatewayStack` grant access to the AgentCore Identity secret, what do the live IAM policies and status reason say, and how does the simulator `/demo` path depend on the synced tool schemas (`artUrl`)?
2. What is the current upstream state of the two friction-log items that could become open-source contributions: Strands Agents TypeScript SDK handling of MCP `structuredContent` (friction log #8) and the AWS CDK AgentCore L2 `MCPProtocolVersion` (friction log #9)?

## Summary

1. The failing principal is the **sync custom resource's Lambda role**, not the gateway service role. The live status reason says that role "is not authorized to perform: secretsmanager:GetSecretValue" on the Identity secret `bedrock-agentcore-identity!default/oauth2/sla-alexa-m2m-f64cc41a-qCwtqn`. The gateway service role already has that permission. `GatewayStack` grants the custom resource only `SynchronizeGatewayTargets`, `GetWorkloadAccessToken` and `GetResourceOauth2Token` (`infra/lib/gateway-stack.ts:98-112`). The target last synchronized on 2026-09-09 12:11 UTC. The `artUrl` field was added to the tool schema on 2026-09-10 (`522ab4e`). So the gateway still serves a `get_family_story` output schema without `artUrl` and with `additionalProperties: false`. The agent's MCP client (MCP SDK 1.30.0) validates `structuredContent` against that cached schema. Every demo-mode turn in the logs since then reports `"played":false`. Every CloudFormation sync update reported `UPDATE_COMPLETE`, because `SynchronizeGatewayTargets` returns `SYNCHRONIZING` asynchronously. Nothing in the deploy or verify path reads the target status afterwards.
2. **Strands (friction #8):** the TypeScript SDK now lives in the monorepo `strands-agents/harness-sdk`; `strands-agents/sdk-typescript` is archived. On `main` (`26700e6`, 2026-10-17), `McpTool` still maps only `content[]` and `isError`. Open issue #3270 covers the gap, and so do two open PRs, #3431 and #4363. Both PRs conflict with `main`, neither is merged, and neither puts `structuredContent` into what the model receives. #3431 has unanswered maintainer design questions since 2026-08-12. From 1.20.0 the SDK peers on `@modelcontextprotocol/client` 2.x, which resolves the other half of friction #8. **CDK (friction #9):** `MCPProtocolVersion` in `aws-cdk-lib/aws-bedrockagentcore` still lists only `2025-06-18` and `2025-03-26`, on `main` (`1f752b6`, 2026-10-16) and in v2.273.0. It has an unvalidated `MCPProtocolVersion.of(string)` escape hatch, which our friction log does not mention. The AgentCore developer guide lists four supported versions: 2026-07-28, 2025-11-25, 2025-06-18 and 2025-03-26. No upstream issue or PR asks for the newer versions.

## 1. Gateway target sync failure

### 1.1 How `GatewayStack` wires identity and sync (repository)

- The OAuth2 credential provider `sla-alexa-m2m` is created with `OAuth2CredentialProvider.usingCustom`. Its client secret is a Secrets Manager dynamic reference to `sla/oauth-clients` field `m2mSecret` (`infra/lib/gateway-stack.ts:38-53`). AgentCore Identity stores the secret in its own secret `bedrock-agentcore-identity!default/oauth2/sla-alexa-m2m-*` (live, section 1.2).
- The gateway uses IAM inbound auth and MCP protocol configuration without explicit `supportedVersions` (`infra/lib/gateway-stack.ts:55-63`).
- The target is `GatewayTarget.forMcpServer` with `GatewayCredentialProvider.fromOauthIdentity(provider, { scopes: ["mcp:service"] })` (`infra/lib/gateway-stack.ts:65-71`). Listing mode `DEFAULT` is set by property override (`infra/lib/gateway-stack.ts:73`).
- The API role gets `bedrock-agentcore:InvokeGateway` (`infra/lib/gateway-stack.ts:77-83`).
- Sync: an `AwsCustomResource` calls `SynchronizeGatewayTargetsCommand` on create and update. Its physical id is `${gatewayId}:sync:${api.bundleHash}`, so it re-runs only when the API bundle hash changes (`infra/lib/gateway-stack.ts:88-97`, `infra/lib/api-stack.ts:82`).
- The custom resource policy holds two statements: `SynchronizeGatewayTargets` on the gateway, and `GetWorkloadAccessToken` + `GetResourceOauth2Token` on the workload identity and token vault ARNs (`infra/lib/gateway-stack.ts:98-112`). The comment records the earlier first-deploy finding "not authorized to perform GetWorkloadAccessToken" (`infra/lib/gateway-stack.ts:100-102`, commit `1bc34eb`, 2026-09-09 14:13 CEST). No `secretsmanager:*` action appears in this policy.
- The gateway service role's Identity grants, including `secretsmanager:GetSecretValue`, are generated by the L2 construct, not written in this file (live policy, section 1.2).
- Test coverage: `infra/test/stacks.test.ts:284-299` asserts that the gateway stack contains `InvokeGateway`, `SynchronizeGatewayTargets` and `GetWorkloadAccessToken`. No test asserts a Secrets Manager action for the sync custom resource.

### 1.2 Live state (read-only AWS CLI, profile `archy`, `us-east-1`, retrieved 2026-10-19)

- `get-gateway`: status `READY`, `roleArn` `SpokenLetterAlexaGateway-GatewayServiceRole162DEA77-gKhhBQJY2KzP`, `exceptionLevel` `DEBUG`, protocol `MCP` without `supportedVersions`, workload identity `.../workload-identity/sla-alexa-usrtpg2rea`.
- `get-gateway-target BL0QFT4T2E`: status `SYNCHRONIZE_UNSUCCESSFUL`, `lastSynchronizedAt` 2026-09-09T12:11:58Z, `updatedAt` 2026-10-01T14:49:13Z. `statusReasons[0]` (verbatim, request id kept): "Please check the OAuth setup. Access denied when retrieving secret 'arn:aws:secretsmanager:us-east-1:106403001709:secret:bedrock-agentcore-identity!default/oauth2/sla-alexa-m2m-f64cc41a-qCwtqn'. User: arn:aws:sts::106403001709:assumed-role/SpokenLetterAlexaGateway-AWS679f53fac002430cb0da5b7-Z21NodDXlPNd/SpokenLetterAlexaGateway-AWS679f53fac002430cb0da5b-H1tWKwRTUlSS is not authorized to perform: secretsmanager:GetSecretValue on resource: ... because no identity-based policy allows the secretsmanager:GetSecretValue action (Service: AgentCredentialProvider, Status Code: 403, Request ID: 7ad7c3f0-b727-411e-b3f2-7ba19b2c0c2c)".
- The assumed role in that message is the `AwsCustomResource` singleton Lambda role (`AWS679f53fac002430cb0da5b7...`). Its inline policy `SynchronizeTargetCustomResourcePolicy00D0E55A` matches `infra/lib/gateway-stack.ts:98-112` exactly and has no Secrets Manager action.
- The gateway service role's inline policy `GatewayServiceRoleDefaultPolicy5A851A93` holds `GetWorkloadAccessToken*` and `GetResourceOauth2Token`/`CompleteResourceTokenAuth` on `sla-alexa-*`. It also holds `secretsmanager:GetSecretValue` on `arn:aws:secretsmanager:us-east-1:106403001709:secret:bedrock-agentcore-identity!*`. This is the wildcard grant noted in `docs/friction-log.md:18`.
- The Identity secret and the credential provider were both created at 2026-09-09 14:07:47 CEST and have not changed since. The secret was last accessed on 2026-10-18 (Secrets Manager reports dates only).
- CloudFormation `SpokenLetterAlexaGateway`: `UPDATE_COMPLETE`, last updated 2026-10-01T14:47:51Z. `Custom::SlaSynchronizeGatewayTarget` events show `UPDATE_COMPLETE` on 2026-09-10, 2026-09-28, 2026-09-29 and 2026-10-01 (current physical id `sla-alexa-usrtpg2rea:sync:7b1301f0768163d1`).
- The custom resource Lambda log (`/aws/lambda/SpokenLetterAlexaGateway-AWS679f53fac002430cb0da5b-H1tWKwRTUlSS`) shows each call returning `'targets.0.status': 'SYNCHRONIZING'` and responding `SUCCESS` to CloudFormation (for example 2026-09-09T12:10:06Z, 2026-09-10T08:23:52Z, 2026-09-10T13:53:59Z). The synchronization outcome is reported later, only on the target resource.
- `sla-alexa-api` (`SpokenLetterAlexaApi-ApiF70053CD-DR5cGmVVfiJN`) has `MCP_URL=https://sla-alexa-usrtpg2rea.gateway.bedrock-agentcore.us-east-1.amazonaws.com/mcp` (last modified 2026-10-09T08:24Z).

### 1.3 The cached schemas and the `/demo` path

- Read-only `tools/list` through the gateway (SigV4, HTTP 200, 2026-10-19) returns three tools prefixed `spoken-letter___`. In `get_family_story`, `outputSchema.properties` is `id, title, storyteller, durationSeconds, deliveredAt, audio`, with `additionalProperties: false` and no `artUrl`. `list_family_stories` and `suggest_next_story` also have no `artUrl`.
- The server's current schema declares `artUrl` as an optional string (`packages/mcp-server/src/tools/schemas.ts:9`). The fixture provider sets `artUrl` for stories that have artwork (`packages/mcp-server/src/provider/fixtures.ts:70-71`). Two fixture stories carry `art` (`fixtures/stories.json:10`, `fixtures/stories.json:19`). `artUrl` first entered the code in `522ab4e` (2026-09-10, "story art on the Echo screen"), one day after the last successful sync.
- The agent uses the gateway only for the demo subject. Device (classic skill) sessions always use the in-process `/mcp` (`packages/agent/src/routes.ts:22-28`, `packages/app/src/bootstrap.ts:150-153`, `packages/app/src/bootstrap.ts:176-177`). Requests to a non-local `MCP_URL` are SigV4-signed (`packages/app/src/bootstrap.ts:148-153`, `packages/agent/src/sigv4-fetch.ts:7-12`).
- The installed MCP client `@modelcontextprotocol/sdk@1.30.0` validates `structuredContent` against the tool's cached `outputSchema` in `callTool`. On a mismatch it throws `McpError(InvalidParams, "Structured content does not match the tool's output schema: ...")` (`node_modules/.pnpm/@modelcontextprotocol+sdk@1.30.0_supports-color@9.4.0_zod@4.5.4/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js:485-498`). It builds the validators from `tools/list` (`.../client/index.js:533-535`).
- `sla-alexa-api` logs: every `mode:"demo"` turn on 2026-10-10 and 2026-10-17 lists `spoken-letter___*` tools with latencies of 327 ms to 2,399 ms and `"played":false`. This includes a turn that called `spoken-letter___get_family_story` (2026-10-17T11:31:52Z). Device-mode turns show local tool names, latencies of 5-22 ms, and `"played":true` after `get_family_story` (2026-09-28T16:33:14Z).
- Inference (not observed in a log line): the demo cannot play a story with artwork because the client rejects `get_family_story` results that contain `artUrl`. The API logs did not record the `McpError` text. The filter for "Structured content", "output schema" and error levels over the last 30 days returned nothing.

### 1.4 Recovery mechanism as it exists today

- Sync runs only when the API bundle hash changes (`infra/lib/gateway-stack.ts:92`). Changing only the custom resource's IAM policy does not change the physical id, so a deploy limited to the policy does not call `SynchronizeGatewayTargets` again (inferred from the `AwsCustomResource` update semantics; not tested here).
- A manual `aws bedrock-agentcore-control synchronize-gateway-targets` under a principal with the needed permissions was the earlier recovery: "`spoken-letter` `READY` after the manual sync" (`docs/friction-log.md:333`).
- Visibility: CloudFormation and the custom resource report success. `scripts/verify-deploy.mjs` checks the public server and does not read the gateway target status (`scripts/verify-deploy.mjs:4-5`, `scripts/verify-deploy.mjs:121`). The failure is visible only through `get-gateway-target` or the demo's behavior.

### 1.5 Correction to earlier records

The 2026-10-18 memory note `project-devpost-submission` states that the "gateway role lacks secretsmanager:GetSecretValue". The live status reason and policies show that the sync custom resource's role lacks it, and the gateway service role has it. The note also says "since 2026-10-01". 2026-10-01 is the target's `updatedAt`; the last successful sync was 2026-09-09.

## 2. Upstream contribution candidates

Two read-only subagents gathered these facts in parallel. Their assignment: read local files, run read-only `gh`, make shallow clones in the session scratchpad with no install or scripts run, and fetch primary web sources; no fork, issue, PR or comment; about 40 tool calls each; return six sections or state the gaps. Both returned all six sections. The parent re-checked the key claims marked "parent-checked" below. The clones are local evidence and are not tracked.

### 2.1 Strands Agents TypeScript SDK: MCP `structuredContent` (friction log #8)

Repository observations:

- Installed: `@strands-agents/sdk` 1.16.0, published 2026-08-31 (`packages/agent/node_modules/@strands-agents/sdk/package.json`). Its `McpTool` iterates `content`, maps `isError` to status, and ignores `structuredContent` (`node_modules/@strands-agents/sdk/dist/src/tools/mcp-tool.js:39-53`, mapping switch `:80-98`).
- Our agent calls `client.callTool` and reads `structuredContent` itself, without going through `McpTool` (`packages/agent/src/routes.ts:141`, `packages/agent/src/routes.ts:204`, `packages/agent/src/routes.ts:212`). The friction log entry for this gap is `docs/friction-log.md:170-175`.

External observations (retrieved 2026-10-19):

- `github.com/strands-agents/sdk-typescript` is archived. Its last push was 2026-06-03 and its last release v1.3.0 (2026-05-21). Development continues in `github.com/strands-agents/harness-sdk` under `strands-ts/` (Apache-2.0, default branch `main`, HEAD `26700e62d0e98b0976c095fc173561fb591f98c3`, 2026-10-17T03:03:25Z, parent-checked). The latest TypeScript release is `typescript/v1.21.0` (2026-10-14).
- `strands-ts/src/tools/mcp-tool.ts:60-84` on `main` maps only `rawResult.content` and `rawResult.isError` into a `ToolResultBlock`, and the file contains no `structuredContent` reference (parent-checked). `_mapMcpContent` (`:114-137`) maps `text`, `image` and `resource`; other types become `JsonBlock`. `structuredContent` is read only in `strands-ts/src/mcp/client.ts:1573-1600` (`validateToolOutput`), to validate it against `outputSchema`.
- MCP SDK dependency: 1.16.0 to 1.19.0 peer on `@modelcontextprotocol/sdk ^1.25.2`. From 1.20.0 (2026-10-08) the peer is `@modelcontextprotocol/client ^2.0.0` (`strands-ts/package.json:322`), through PR #4093 ("feat(mcp-ts)!: swap to @modelcontextprotocol/client 2.0", merged 2026-09-23). `McpTransport` (`strands-ts/src/mcp/client.ts:66-76`) still accepts 1.x transport instances.
- Issue #3270, "[FEATURE] TS: surface structuredContent from MCP tool results": open, by yonib05, created 2026-07-15 (parent-checked). Labels: enhancement, area-mcp, area-structured-output, area-tool, typescript. Its parent is #1659, the MCP 2026-07-28 spec adoption tracker. It proposes the Python shape and notes that SEP-2106 allows any JSON value.
- PR #3431, "feat(mcp): surface structuredContent from MCP tool results": open, by poshinchen, created 2026-07-23, last updated 2026-08-14, `mergeable_state` `dirty` (parent-checked). It adds `structuredContent?: JSONValue` to `ToolResultBlock` and `ToolResultBlockData` and keeps the field through context-management paths. An automated reviewer approved it on 2026-07-29. On 2026-08-12, maintainer pgrayy asked three questions: whether the field must be stripped before provider payloads, whether it belongs on an MCP-only type as in Python, and whether it duplicates `content`. The author replied on 2026-08-14. No maintainer response follows. The bot assessment states that the field does not enter model-provider payloads.
- PR #4363, "fix(mcp): surface structuredContent and result metadata on tool results": open, by chinesepowered, created 2026-09-16, no reviews, `dirty`. It adds `structuredContent` and `metadata` (from `_meta`) to `ToolResultBlock` and its JSON form. The stated motive is an MCP Apps host that needs `_meta["ui.resourceUri"]`. The subagent read only the description, not the diff.
- Python comparison: `strands-py/src/strands/tools/mcp/mcp_client.py:1457-1463` copies `structuredContent` (when not `None`), `metadata` and `isError` into `MCPToolResult`. The type is `strands-py/src/strands/tools/mcp/mcp_types.py:115`. Related merged Python PRs: #528, #2118 and #1237.
- Contribution rules: `CONTRIBUTING.md:249-256` says to open an issue first for significant work and to check open PRs. Conventional Commits are required (`CONTRIBUTING.md:265`, pre-commit hook at `CONTRIBUTING.md:90`). No CLA or DCO was found, and licensing is confirmed through the PR template. In `.github/PULL_REQUEST_TEMPLATE.md`, a "Human Overview" section "An AI agent MUST NOT fill out", and the checklist includes "I have reviewed and understand every line of code". `team/AI_USAGE_POLICY.md:7-11` requires AI disclosure and a human who can explain the change.
- Tests: vitest. From the root: `npm ci`, `npm run build`, `npm test`, `npm run lint`, `npm run type-check` (`CONTRIBUTING.md:153-160`). `npm test` runs `vitest run --project unit-node` in `strands-ts`. The McpTool unit tests are the `describe('McpTool')` block in `strands-ts/src/mcp/__tests__/client.test.ts:1089`; the JsonBlock cases are at about lines 1149-1267. MCP integration tests are in `strands-ts/test/integ/mcp/`.

### 2.2 AWS CDK AgentCore L2: `MCPProtocolVersion` (friction log #9)

Repository observations:

- `infra/lib/gateway-stack.ts:2` imports the stable module `aws-cdk-lib/aws-bedrockagentcore`. `infra/package.json` pins `aws-cdk-lib` 2.268.0, released 2026-09-02.
- Installed definition: `node_modules/.pnpm/aws-cdk-lib@2.268.0_constructs@10.8.1/node_modules/aws-cdk-lib/aws-bedrockagentcore/lib/gateway/protocol.d.ts:52-63` declares class `MCPProtocolVersion` with `MCP_2025_06_18`, `MCP_2025_03_26` and `of(value)`. `McpConfiguration.supportedVersions?: MCPProtocolVersion[]` is at line 117.
- `infra/lib/gateway-stack.ts:58-60` passes no `supportedVersions`. The live gateway shows no `supportedVersions` (section 1.2).
- `docs/friction-log.md:233-234` says the class "enumerates 2025-03-26 and 2025-06-18 only, so the protocol versions are left at the service default". The entry does not mention `of()`.

External observations (retrieved 2026-10-19):

- `aws/aws-cdk` `main` HEAD `1f752b67bfdd52181273e9ffb17ae9005c16b9f9` (2026-10-16). The latest release is v2.273.0 (2026-10-08).
- `packages/aws-cdk-lib/aws-bedrockagentcore/lib/gateway/protocol.ts:60-74` on `main` has `MCP_2025_06_18` (documented as "The latest version of the MCP protocol.") and `MCP_2025_03_26`. It also has `public static of(value: string)` "not yet defined in this class" (parent-checked). The constructor does not validate the string. `McpProtocolConfiguration._render()` (`:180-186`) emits `supportedVersions` as plain strings. The default configuration uses `[MCP_2025_03_26]` (`gateway.ts:454`, `gateway.ts:1027`). The unit test `test/agentcore/gateway/gateway-coverage.test.ts:1292` covers `of('2099-01-01')`.
- The deprecated alpha copy `packages/@aws-cdk/aws-bedrock-agentcore-alpha/lib/gateway/protocol.ts:64-70` is a TypeScript `enum` with the same two values. Open PR #39313 (2026-10-15) deprecates the alpha module.
- Service: the CloudFormation `MCPGatewayConfiguration.SupportedVersions` and the API `MCPGatewayConfiguration` types are plain string arrays with no allowed values listed. The AgentCore developer guide (`gateway-using.html`, `gateway-target-MCPservers.html`) lists "2026-07-28, 2025-11-25, 2025-06-18, and 2025-03-26". It also says that supported versions are "fixed when you create the gateway" unless the account is "enabled for MCP version updates".
- Upstream activity: searches for `MCPProtocolVersion`, `2025-11-25`, `2026-07-28` and related terms in issues and PRs return no request to add versions (parent-checked for two of the terms). Closed issue #36826 is unrelated. Open PR #38341 (session timeout and response streaming) edits `protocol.ts`, but adds no versions. `tools/@aws-cdk/enum-updater/lib/unmatched-enums.json` lists `bedrock-agentcore/MCPProtocolVersion` as unmatched.
- Contribution rules (`CONTRIBUTING.md` at HEAD): an issue is not required, but PRs without one are labeled P2. PRs come from a fork with maintainer edits allowed. The title format is `feat(module): ...`; recent PRs use the scope `bedrockagentcore` (inferred from #38341 and #38915). Each change needs a unit test and a README update, and README examples are compiled by rosetta. Codecov patch coverage must be at least 95%. Integration tests are required by default, and the guide lists "Adding a new supported version" as a case that needs one. Integration snapshots must come from a real deploy. A contributor who cannot deploy says so in the PR. The integration test directory is `packages/@aws-cdk-testing/framework-integ/test/aws-bedrockagentcore/test/agentcore/gateway/`. Build: `npx lerna run build --scope=aws-cdk-lib`, then `yarn test` in `packages/aws-cdk-lib`.

### 2.3 Gaps in section 2

- No upstream build or tests were run. The test commands come from the docs.
- The diffs of #3431 and #4363 were read only partly. The maintainers' preferred location for the field (generic block or MCP-only type) is unresolved in the thread.
- It was not checked whether 1.21.0's published tarball matches `main` for `mcp-tool.ts`. This is inferred: no structuredContent PR has merged.
- Not tested: whether CloudFormation accepts `2025-11-25` or `2026-07-28` in `SupportedVersions`, and whether account `106403001709` is "enabled for MCP version updates".

## Unresolved questions

- How did the first sync on 2026-09-09 succeed (`lastSynchronizedAt` 12:11:58Z) when the custom resource role never had `secretsmanager:GetSecretValue`? AWS returns only the latest `statusReasons`. So the outcomes of the 2026-09-10, 09-28 and 09-29 syncs are not observable. Impact: it is unknown whether granting the secret to the custom resource role alone is enough. The service might also have changed which identity it uses for the secret.
- The client-side `McpError` text for the demo failure is not in the API logs (section 1.3). Impact: the rejection mechanism is inferred from the cached schema and the SDK source, not observed.

## Handoff

- Objective: research only, as requested on 2026-10-19. The user also asked for a plan to follow ("let's get to work on a plan afterwards"). No implementation, deploy, fork or PR is authorized by this artifact.
- Base: `develop` at `2ec1aa8`, working tree `/Users/juan/code/spoken-letter-alexa`, clean.
- Owner gates still open: any `cdk deploy` or `SynchronizeGatewayTargets` call (AWS mutation), and any fork/issue/PR on an upstream repository (outward-facing).
- Next phase: `rpi-plan`.
