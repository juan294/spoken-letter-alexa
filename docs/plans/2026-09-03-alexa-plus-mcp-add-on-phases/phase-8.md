# Phase 8 — Submission: video, friction log, product feedback, README, Devpost, October production wiring

Both repositories. Starts 2026-10-01 for the private side; public-side documentation work starts as soon as Phase 6 is deployed.

## Design-system note

The video's title cards and any thumbnail use the brand wordmark, cream ground, and Newsreader serif per `design/CLAUDE.md`. The README hero image is exported from the simulator's Now Playing panel.

## 1. Private repository after the freeze (Oct 1 to 8)

1. Push `feat/alexa-bridge`, open a PR into `develop`, wait for `verify`, `firebase-rules`, `mobile-e2e`, `ios-webkit`, merge with a merge commit.
2. Release `develop → main` per `docs/testing/release-gate.md` (11-step gate). Add Vercel production env `ALEXA_BRIDGE_SECRET`, `ALEXA_BRIDGE_ORIGIN`, `NEXT_PUBLIC_ALEXA_CONNECT_URL` before the release; deploy the `firestore.indexes.json` change with the release.
3. Switch the deployed public server to `PROVIDER_MODE=auto` (fixtures for `demo`, HTTP for real subjects) with `pnpm deploy`.
4. Owner links his own account from production Settings, plays a real delivered story in the simulator at `alexa.spokenletter.com/demo`.

## 2. Demo video (under 3 minutes, YouTube public)

Shot list:
1. 0:00 to 0:20. Title card, one sentence: a family voice reaching a child through Alexa+, built as an MCP add-on.
2. 0:20 to 1:10. Simulator on a laptop next to a real Echo at home: the parent says "Alexa, play the story Grandma sent"; the Under-the-hood drawer shows the legacy `initialize` at 2025-03-26 answered by a 2026-07-28 server, the two tool calls with latencies; Polly replies; the real recording plays.
3. 1:10 to 1:50. Connect flow: Settings card → link page → back to the simulator with the Owner's real stories.
4. 1:50 to 2:30. Architecture card (CloudFront, Lambda streaming, DynamoDB, KMS, AgentCore Gateway, Bedrock, Transcribe, Polly, CloudWatch) with the live dashboard.
5. 2:30 to 2:50. If access existed: real Echo footage from Phase 7. Otherwise: the packaging path files and a sentence that the same server deploys unchanged.
6. 2:50 to 3:00. What was built during the window (everything in the public repository, plus the bridge PR link).

Never show a child speaking to the device. The Recipient's name never appears on screen.

## 3. Written materials (public repository)

- `README.md`: final architecture, "Built during the hackathon window" section listing the PR and commit range, "Amazon tools used" table with one paragraph each and links to the friction-log entries, quick start, deploy, licence.
- `docs/friction-log.md`: dated entries throughout; the final pass groups them by tool (MCP Toolkit docs, Alexa AI CLI access, AgentCore Gateway, Bedrock model access, Transcribe streaming from Lambda, Polly, CDK, Kiro Crew) with severity and a one-line suggested fix each.
- `docs/product-feedback.md`: the hackathon's required feedback per Amazon tool, API, or SDK: what worked, what needs improvement, onboarding experience, future intent.
- Repository settings: one required check `verify` on `main`; topics `alexa-plus`, `mcp`, `aws`, `hackathon`.

## 4. Devpost submission (Owner authorization at the moment of submitting)

- Primary track: Alexa+. Mini challenge: AWS Builder (documented integrations list from the README). Open Source evidence: the repository URL, GitHub username `juan294`, contribution description.
- Fields: project name, tagline, text description with the "significantly updated" explanation, video URL, repository URL, product feedback, friction log link, team (individual).
- Forms: the $150 AWS credit form (early, in Phase 6 timeframe), any judge-access notes (the demo needs no account; a Spoken Letter test account with delivered stories is offered through the existing judge voucher path if judges want the linked mode).

## 5. Post-submission notes (recorded, not executed)

- After 2026-11-20 (judging ends): decide which AWS services stay. AgentCore Gateway and Transcribe are the first candidates for removal; the OAuth server and MCP server may fold into the private repository as a Next.js route with the account provider implemented in-process.
- Rotate `ALEXA_BRIDGE_SECRET` and the static client secrets after judging.

## Success criteria

Automated: public CI green on the submitted commit; private release gate green on the merged bridge.

Manual: video public and under three minutes; Devpost form complete; Owner-linked real story plays in production; friction log and product feedback reviewed by the Owner; submission confirmed before 2026-10-23 12:00 PT.
