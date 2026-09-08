# Product feedback

The hackathon asks for feedback on every Amazon tool, API or SDK used. One section per
tool. Each section answers the same four questions once the tool has been exercised:
what worked, what needs improvement, the onboarding experience, and whether we would use
it again. Sections are filled in the phase that first uses the tool; "Not yet exercised"
is the truthful state until then. The dated detail lives in `docs/friction-log.md`.

## Alexa+ MCP Toolkit (`alexa-ai` CLI, Local Inspector, web simulator)

Not yet exercised: access is partner-gated (friction log, 2026-09-03). The packaging path
in `amazon/` is prepared so the remaining steps are CLI commands.

## Model Context Protocol TypeScript SDK v2 (`@modelcontextprotocol/server`)

- What worked: `createMcpHandler` with the default `legacy: 'stateless'` answered the
  2025-03-26, 2025-06-18 and 2025-11-25 `initialize` handshakes and 2026-07-28
  `server/discover` from one tool registration, with no code specific to either era.
  `registerTool` with zod input and output schemas published JSON Schema and validated
  `structuredContent` for free. `requireBearerAuth` and `bearerAuthChallengeResponse`
  produced the RFC 9728 challenge without hand-rolling headers.
- Needs improvement: the modern-era request envelope is underdocumented (three `_meta`
  keys plus three headers; see the friction log), and the exported
  `LATEST_PROTOCOL_VERSION` names the newest legacy revision rather than 2026-07-28.
- Onboarding: the type definitions are excellent and the error messages name the exact
  missing key, so a probe script answered every question in under an hour.
- Would use again: yes. It is the reason a 2026-spec server can serve Alexa+ at all.

## AWS CDK

Phase 0: `Template.fromStack` assertions and `cdk synth` were enough to test the core
stack without an account. See the friction log for the feature-flag warning.

## Kiro Crew

Not available on the development machine (friction log, 2026-09-08).

## Amazon Bedrock

Phase 5.

## Strands Agents SDK

Phase 5.

## Amazon Transcribe (streaming)

Phase 5.

## Amazon Polly

Phase 5.

## Amazon Bedrock AgentCore Gateway

Phase 6.

## AWS KMS (asymmetric signing) and DynamoDB (single table)

- What worked: the SDK v3 clients plus `aws-sdk-client-mock` let the whole OAuth
  server be tested without an account: conditional writes (`ConditionExpression`) and
  `ReturnValues: ALL_OLD` express "lease once", "consume once" and "rotate once"
  directly. KMS `GetPublicKey` returns SPKI DER that `node:crypto` turns into a JWK in
  two lines.
- Needs improvement: nothing blocking yet; the live behaviour of conditional updates
  under TTL expiry is verified only by the mocked tests until Phase 6.
- Onboarding: SDK v3 typings are precise; `ConditionalCheckFailedException` being a
  class made the "reuse" branch straightforward.
- Would use again: yes.

## AWS Lambda function URLs (response streaming), CloudFront, Secrets Manager, S3, CloudWatch, X-Ray

Phase 6.
