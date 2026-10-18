# Product feedback

The hackathon asks for feedback on every Amazon tool, API or SDK used. There is one section per tool. Each section gives the live state on 2026-10-18 and answers four questions: what worked, what needs improvement, the onboarding experience, and whether we would use it again. The dated evidence is in `docs/friction-log.md` and the plan notes under `docs/plans/`.

## Alexa+ MCP Toolkit (`alexa-ai` CLI, Local Inspector, web simulator)

Not exercised: access is partner-gated (friction log, 2026-09-03). The packaging path in `amazon/` is prepared so the remaining steps are CLI commands: `addon.json` with every uncertain field name listed in `addon-fields.md`, the runbook, the US account checklist, the Inspector guide and the session-id contingency (`MCP_LEGACY_SESSIONS=1`, tested). Feedback so far is about documentation: the manifest schema, the Inspector's exact session expectations and the audio playback contract are the three pages we could not read without access.

## Alexa+ on a real Echo (as a host for a development-stage custom skill)

Live state: the full staged demo script ran on an Echo Show 5 under Alexa+ on Jordan's US account on 2026-10-18, twice. The second run needed a different invocation phrase (see below). The skill reaches Alexa+ through a beta test of the development stage.

- What worked: when Alexa+ hands a turn to the skill, the skill's AudioPlayer playback, APL screens and session state work as they do under classic Alexa. Ending Alexa+ Early Access on the Spain account made the same skill work end to end within minutes (2026-10-07). The Alexa+ voice history titles ("Video", "Request") were the clearest evidence of how Alexa+ routed each utterance.
- What needs improvement: routing is not predictable, and no developer tool shows it.
  - Invocation. From 2026-09-29 Alexa+ classified "open spoken letter" as a video request ("not supported on this device") and answered "let's create a story" with its own story creation (2026-10-07). On 2026-10-18 "Alexa, open spoken letter" again answered "Sorry, that is not supported on this device" on two Echo Show devices and in the Alexa app, and no request reached the skill. "Alexa, open the spoken letter skill" worked.
  - Slots. "Play a story by Aunt Whitney" arrived with only the `title` slot filled, while the developer-console simulator filled `storyteller` for the same line (2026-10-13).
  - Intents. A one-word "Record" arrived as `AMAZON.FallbackIntent` although "record" is a sample of the skill's own `RecordStoryIntent`, and a "Yes" arrived as `WhatIsNewIntent`. The NLU profiler and the simulator map the same utterances to the expected intents (2026-10-17).
  - During playback, Alexa+ answered some requests itself ("Sorry, I can't answer that question right now") and the skill received no event (2026-10-13).
  - SSML: `<w role="amazon:VB">` was ignored on the Alexa+ voice (2026-10-17).
  - Support answers about development skills on Alexa+ accounts were inconsistent (2026-10-07).
- Onboarding: there is no documented way to test a custom skill under Alexa+. We needed a second, US account with a beta-test invitation to run the skill under Alexa+ in English. Each routing fix was found only by running the script on the device and reading the skill log afterwards, because the intent request history API returned HTTP 500.
- Would use again: yes for reach, because Alexa+ is where families will talk to Alexa. For a dated demo, not until skill invocation by name is deterministic and developers can see how Alexa+ routes each turn. The skill now follows the demo script for any intent Alexa+ picks, which is a workaround, not a fix.

## Alexa Skills Kit, ASK CLI and the Skill Management API (SMAPI)

Live state: a development-stage custom skill (`packages/skill`, `SkillStack`, Lambda `sla-alexa-skill`) with en-US and es-ES interaction models, AudioPlayer and an APL teleprompter, published with ASK CLI 2.30.7 and shared through a beta test.

- What worked:
  - `ask deploy` publishes the manifest and both models in one command. A read-back with `ask api get-model` matched the generated JSON every time (2026-10-01, 2026-10-09).
  - AudioPlayer: the stream token carries the whole play object, so pause and resume need no store. The first real-device playback worked on 2026-09-09.
  - APL: Amazon accepted the teleprompter interface without `supportedViewports` (2026-10-09).
  - The NLU profiler (`profileNlu`) confirmed the intent and slots for all 18 script utterances, and an SMAPI simulation of the 19 script utterances gave the script's reply for every line (2026-10-17). On 2026-10-18 an SMAPI simulation of "open spoken letter" reached the `LaunchRequest` while the devices refused the same phrase, which isolated the fault to Alexa+ routing.
  - `submit-skill-validation` returned `SUCCESSFUL` with the initial functional tests passed (2026-09-10).
  - The beta test let a second, US account run the development skill on its own Echo devices.
- What needs improvement:
  - The endpoint turn budget (about 8 s) is not stated as a number, and no tool warns when a turn approaches it. A two-tool agent turn measured 6.9 s on a cold start (2026-09-10).
  - Progressive responses are the documented remedy for slow turns, but nothing connects `apiEndpoint` and `apiAccessToken` to slow endpoints.
  - Registration is circular: SMAPI refuses a Lambda endpoint whose trigger permission does not allow `alexa-appkit.amazon.com` yet, and the permission cannot be locked to a skill id that does not exist yet (2026-09-08).
  - Exit codes do not mean success. ASK CLI v1 printed "Target not recognized" for a v2 command and exited zero; dialog simulations returned "An unexpected error occurred" with exit code zero (2026-09-28, 2026-10-01).
  - The intent request history API (`GET /v1/skills/{skillId}/history/intentRequests`) returned HTTP 500 for this skill, with and without filters (2026-10-17).
  - Two `AMAZON.SearchQuery` intents with overlapping carrier phrases compete with no build-time warning; a `SearchQuery` sample without a carrier phrase is rejected; `AMAZON.FirstName` does not cover kinship names such as "Aunt Whitney".
  - A custom skill never receives the user's audio, so a "record your story" step cannot capture anything (2026-10-08).
  - The NLU profiler and the simulator show classic Alexa routing only, not Alexa+ routing (2026-10-17).
- Onboarding: the ASK CLI is a separate toolchain from the AWS CLI. Command shapes differ between CLI versions (our notes record both `ask smapi …` and `ask api …`), and an old global v1 install answered a v2 command with an error message and exit code zero. A pinned v2 and a version check in the deploy script fixed that.
- Would use again: yes. Today it is the only path for an external developer to put this experience on a real Echo.

## Alexa proactive events (notifications)

Live state: the manifest declares the notification permission for `AMAZON.MessageAlert.Activated`. `sla-alexa-notifications` stores permission and subscription changes; `sla-alexa-notification-send-dev` sends one development event. Permission events from the Alexa app reached `sla-alexa-notifications` on 2026-10-08 and twice on 2026-10-18 (14:26:56 and 14:26:59 CEST). The sender has never been invoked, so no notification was sent to a device.

- What worked: a change of the notification permission in the Alexa app reached the subscription Lambda within seconds, and the event carries everything needed to store the opt-in.
- What needs improvement: not assessed. The `AMAZON.MessageAlert.Activated` schema carries a generic message alert only, so the skill has to tell the parent the detail when it opens. That is a design constraint we accepted, not a defect we measured.
- Onboarding: not assessed beyond the subscription events.
- Would use again: not assessed; the send was not exercised.

## Model Context Protocol TypeScript SDK v2 (`@modelcontextprotocol/server`)

Live state: serves `https://alexa.spokenletter.com/mcp`. The deployed check on 2026-09-09 passed legacy `initialize` at 2025-03-26, modern `server/discover` at 2026-07-28 and 20 of 20 `tools/call`.

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

Live state: seven stacks deployed with `pnpm run deploy` (Core, Simulator, Api, Edge, Gateway, Observability, Skill). The last update was the Skill stack on 2026-10-17.

- What worked: `Template.fromStack` assertions and `cdk synth` tested every stack without an account from Phase 0. The AgentCore Gateway L2 constructs covered the design without L1s. Read-only `cdk diff --exclusively` before each deploy showed exactly which code assets changed. The CLI detects an agent session and prints only errors.
- What needs improvement:
  - `NodejsFunction` runs esbuild through pnpm's bin shim, which cannot run esbuild's native binary; we bundle through the esbuild JS API instead.
  - Several L2 interfaces declare optional members without `| undefined`, which breaks `exactOptionalPropertyTypes`.
  - S3 origin access control bucket policies form a cycle across stacks unless the bucket is imported by name.
  - Asset publishing with parallel multipart uploads failed on a weak uplink: two deploys died on 2026-09-09, and one failed after 75 minutes with S3 `RequestTimeout` on 2026-10-09. A resumable single-part uploader was the workaround.
  - `AwsCustomResource` has no SDK metadata for `bedrock-agentcore-control` in 2.268, so the first run installs the latest SDK.
  - A fresh `cdk.json` warns about 71 unconfigured feature flags.
- Onboarding: `cdk synth` and the template assertions ran in the test suite from Phase 0, before any account work. The deploy problems we met came from the network, the account quota and the services, not from CDK concepts.
- Would use again: yes.

## Kiro Crew

Not used: not available on the development machine (friction log, 2026-09-08). Neither `kiro` nor `kiro-cli` is installed on 2026-10-18.

## Amazon Bedrock

Live state: Claude Haiku 4.5 (`us.anthropic.claude-haiku-4-5-20251001-v1:0`, temperature 0.3, 600 tokens) through Strands' `BedrockModel`, called from the API Lambda since 2026-09-09. The API log shows agent turns with token counts from the Echo and from the simulator up to 2026-10-17.

- What worked: once access was in place, `Converse` through Strands needed no Bedrock-specific code. A model round trip costs about 2.8 s, while each MCP tool call costs 10 to 25 ms, so the number of model round trips is the only latency lever (2026-09-10).
- What needs improvement: the first live call failed with "Model use case details have not been submitted for this account" from the Lambda and "not authorized to perform aws-marketplace:Subscribe" from the admin user, while the console showed access as authorized. The real cause was a missing Marketplace agreement (`agreementAvailability: NOT_AVAILABLE`). The error messages pointed at the wrong causes (2026-09-09).
- Onboarding: three separate gates (model access, the use-case form, the Marketplace agreement). Accepting the offer fixed it within minutes.
- Would use again: yes. A two-tool turn of 5.7 to 6.9 s is close to a custom skill's 8 s budget, so a voice front end must keep turns to one tool call where it can.

## Strands Agents SDK

Live state: runs the agent in the API Lambda since 2026-09-09.

- What worked: `Agent` with `structuredOutputSchema`, `McpClient` as a tool source and
  the `BeforeToolCallEvent`/`AfterToolCallEvent` hooks gave the simulator's "Under the
  hood" drawer (tool name, latency) in a few lines. The `Model` base class made a
  deterministic scripted provider easy, so the whole loop is tested and runs offline.
- Needs improvement: `McpTool` ignores `structuredContent` (friction log); the client
  needs an MCP SDK 1.x transport while the server ecosystem is on 2.x; the package pulls
  native optional dependencies that pnpm refuses to build silently.
- Onboarding: the README covered every concept used; the typings answered the rest.
- Would use again: yes for an agent that must talk MCP on AWS.

## Amazon Transcribe (streaming)

Live state: deployed in the API Lambda, but live use is not verified. The API log has no `transcribe_done` event in its 30-day retention window (2026-09-18 to 2026-10-18), and the plan notes record no live run.

- What worked (in code and tests): `StartStreamTranscriptionCommand` takes an async iterable of PCM chunks, which maps directly onto the browser's one-utterance recording; partial and final results are clearly flagged.
- Needs improvement: browsers record WebM/Opus and Transcribe wants PCM, so every integration re-implements the `ffmpeg` hop; a documented Opus path would remove it.
- Onboarding: the mocked-client test pins the request shape; a real `ffmpeg` conversion test covers the audio hop.
- Would use again: not assessed live.

## Amazon Polly

Live state: speaks the simulator's replies. `AWS/Polly` counts successful `SynthesizeSpeech` calls on 2026-10-10 (1) and 2026-10-17 (5), the same days and counts as the simulator's demo turns, with an average response latency of about 35 ms. Device turns skip Polly because the Echo speaks the reply.

- What worked: one `SynthesizeSpeech` call with the neural `Joanna` voice; the MP3 bytes become a data URL locally and an S3 object behind CloudFront when deployed.
- Needs improvement: nothing found.
- Onboarding: no setup beyond the IAM permission.
- Would use again: yes. Rule kept: Polly speaks Alexa's one-sentence replies only; the family recording is never synthesized.

## Amazon Bedrock AgentCore Gateway

Live state: gateway `sla-alexa` `READY` since 2026-09-09, with target `spoken-letter`. The simulator's demo turns call the tools through it (tool names carry the `spoken-letter___` prefix), last on 2026-10-17.

- What worked: the CDK L2 (`aws-cdk-lib/aws-bedrockagentcore`) models the gateway, the MCP server target and the OAuth2 credential provider directly; the target's outbound client_credentials binding is one call. The gateway fetched tokens from our OAuth server and called our `/mcp` with no change to the server.
- Needs improvement:
  - Latency: one tool call through the gateway took 2.3 s against 15 ms on `/mcp` directly (2026-09-09). On 2026-10-17 the first call took 1.0 to 2.4 s and later calls 0.33 to 0.42 s. That is too slow for a custom skill turn, so device turns call `/mcp` directly.
  - Inbound IAM means the MCP client must sign with SigV4; this is documented nowhere for MCP clients.
  - The target reads `tools/list` only at creation; a tool change needs `SynchronizeGatewayTargets`, which the L2 does not expose, and the sync needs identity permissions on the caller, not on the gateway role.
  - The L2's `MCPProtocolVersion` stops at 2025-06-18 while the server serves 2025-11-25 and 2026-07-28; the identity grant falls back to a wildcard secret ARN when the secret is a token.
- Onboarding: the L2 made creation easy; the sync permissions took one failed deploy to find.
- Would use again: yes for agents that are not latency bound; not for a voice turn.

## AWS KMS (asymmetric signing) and DynamoDB (single table)

Live state: the RSA key `alias/sla-jwt` signs every access token, and four DynamoDB tables are in use (`sla-oauth`, `sla-agent-sessions`, `sla-demo-state`, `sla-notification-subscriptions`). The token flow passed on 2026-09-09, demo receipts read back from DynamoDB on 2026-10-01, and creation records saved without error in the 2026-10-09 run.

- What worked: the SDK v3 clients plus `aws-sdk-client-mock` let the whole OAuth server be tested without an account: conditional writes (`ConditionExpression`) and `ReturnValues: ALL_OLD` express "lease once", "consume once" and "rotate once" directly. KMS `GetPublicKey` returns SPKI DER that `node:crypto` turns into a JWK in two lines. KMS `Sign` with `MessageType: RAW` accepts the JWT signing input directly.
- Needs improvement: nothing found in the live deployment.
- Onboarding: SDK v3 typings are precise; `ConditionalCheckFailedException` being a class made the "reuse" branch straightforward.
- Would use again: yes.

## AWS Lambda function URLs (response streaming), CloudFront, Secrets Manager, S3, CloudWatch, X-Ray

Live state: `https://alexa.spokenletter.com` serves the API, `/mcp`, the OAuth endpoints and the simulator. `/demo/` and the OAuth metadata answer 200, and `/mcp` answers the RFC 9728 challenge (2026-10-18). `tools/call` p95 was 377 ms from Madrid and 107 ms from a `us-east-1` runner (2026-09-09). The alarms `sla-alexa-tool-latency-p95` and `sla-alexa-skill-turn-p95` are in state `OK` (2026-10-18).

- What worked: `InvokeMode.RESPONSE_STREAM` plus Hono's `streamHandle` needed no code specific to Lambda; `FunctionUrlOrigin.withOriginAccessControl` and `S3BucketOrigin.withOriginAccessControl` wire the OACs; EMF from a single log line becomes the `ToolLatencyMs` and `SkillTurnMs` metrics behind the dashboard and alarms.
- Needs improvement:
  - The OAC overwrites the viewer's `Authorization` header, which every OAuth-protected origin behind a function URL has to work around.
  - With an OAC, function URLs refuse POST bodies without `x-amz-content-sha256`, which CloudFront does not compute for streaming bodies; we use auth type NONE with a shared origin header instead.
  - Function URLs rename `WWW-Authenticate` to `x-amzn-remapped-www-authenticate`, and CloudFront skips viewer-response functions when the origin answers 400 or above, so a Lambda@Edge origin-response function restores the header.
  - The Node.js 24 runtime refused our three-parameter handler as callback-style (`Runtime.CallbackHandlerDeprecated`) on the first live request; no local check can see it.
  - A fresh account's Lambda concurrency quota of 10 blocks any reserved concurrency.
  - A CloudFront origin request policy forwards at most 10 headers, so a new skill header had to replace an unused one (2026-09-28).
  - Unversioned Secrets Manager dynamic references are not re-resolved after a rotation.
- Onboarding: well documented one service at a time; the problems above appear only where the services meet, and only on the deployed stack.
- Would use again: yes.
