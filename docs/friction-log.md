# Friction log

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

## Kiro Crew

No session recorded yet; see the Phase 0 entry above.
