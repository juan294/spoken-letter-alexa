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

## Kiro Crew

No session recorded yet; see the Phase 0 entry above.
