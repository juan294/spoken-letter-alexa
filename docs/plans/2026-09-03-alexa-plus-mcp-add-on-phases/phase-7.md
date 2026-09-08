# Phase 7 — Amazon packaging path `[batch-eligible]`

`amazon/`. Everything Amazon's quickstart asks for, prepared so that the day toolkit access arrives the remaining steps are `alexa-ai` commands. The file deliverables need no access; the verification steps run only if access exists and are recorded either way.

## Design-system note

Add-on icons and any listing artwork use the brand's amber arc mark and cream ground from the vendored tokens; export sizes per Amazon's asset validator once known. Otherwise non-visual.

## 1. Files

- `amazon/addon.json`: name "Spoken Letter", `distributionCountries: ["US"]`, one `en-US` locale block with summary, description (adult, parent-operated family audio; no child targeting language), example phrases ("Alexa, ask Spoken Letter to play the story Grandma sent", "Alexa, what family stories are new in Spoken Letter", "Alexa, play the next family story"), keywords, privacy URL `https://spokenletter.com/privacy`, terms URL `https://spokenletter.com/terms`, MCP endpoint `https://alexa.spokenletter.com/mcp`, auth block: authorization endpoint, token endpoint, scopes `mcp:tools mcp:resources`, PKCE S256, client_credentials tier with scope `mcp:service`. Field names follow the quickstart's example; unknown fields are flagged in the friction log for Amazon.
- `amazon/AGENT_SKILL.md`: the Add-on Agent Skill instructions copied from Amazon's page when access exists; until then a placeholder that states the URL and that the content is gated.
- `amazon/runbook.md`: numbered steps from `set-up-your-development-environment.html` (AWS profile `alexa-ai` assuming the Amazon role, CodeArtifact login, `alexa-ai new mcp --locale en-US`, `alexa-ai deploy`, web simulator, Physical Device Config), with the exact commands and where each output goes.
- `amazon/us-account-checklist.md`: research section 3.3 as a checklist (US developer console identity, US amazon.com Alexa+ entitlement, one Echo re-registered with `en-US`, Alexa app preferred marketplace), plus the two unknowns to test first (Alexa+ activation on a US-registered device in Spain; billing address).
- `amazon/inspector.md`: how to run Amazon's Local Inspector against `pnpm dev`, and the decision tree for the session-id risk.

## 2. Session-id contingency (implemented, behind a flag)

`packages/mcp-server/src/legacy-sessions.ts`: when `MCP_LEGACY_SESSIONS=1`, requests classified by `isLegacyRequest` are routed to a hand-wired `WebStandardStreamableHTTPServerTransport` with `sessionIdGenerator: randomUUID` and an in-memory session map, in front of the dual-era handler configured with `legacy: 'reject'` (the pattern the SDK documents). Tests: legacy `initialize` returns `Mcp-Session-Id`; a follow-up `tools/list` with the header succeeds; without it 400. This mode is single-instance only; `amazon/inspector.md` says that if the Inspector needs it, deploy the flag on a single Fargate task (CDK `LegacyStack`, written but not deployed) rather than Lambda.

## 3. Verification if access exists

1. Run the Local Inspector; record the `initialize` version it sends and whether stateless mode passes.
2. `alexa-ai deploy` to the development stage; open the web simulator; run the three example phrases; record which tool results Alexa speaks and whether the `resource_link` produces playback on a screened device.
3. Physical Device Config → the re-registered Echo; record the utterance, the response, and whether audio plays. This is the only path to real-device footage.
4. Everything learned goes into the friction log and `docs/product-feedback.md`.

## Success criteria

Automated: `pnpm -F mcp-server test` covers `legacy-sessions.ts`; `amazon/addon.json` validates against a zod schema in `amazon/addon.test.ts` (required fields present, no child-targeting words from a denylist in the description).

Manual: files reviewed by the Owner; if access exists, steps 1 to 3 recorded with screenshots.
