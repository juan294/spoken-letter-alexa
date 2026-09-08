# Plan: Alexa+ MCP add-on for the Amazon App Dev 2026 hackathon

Date: 2026-09-03
Status: Planned. No phase started.
Research inputs: `docs/research/2026-09-03-alexa-plus-hackathon-mcp-add-on.md` (hackathon rules, access, geography, MCP spec, audio contract, Owner decisions in section 12), `docs/research/2026-08-17-alexa-plus-device-playback-integration.md` (platform analysis), four Explore sweeps on 2026-09-03 (MCP route and claim-token flow, story catalog and audio, route and test conventions, design system), and direct inspection of `@modelcontextprotocol/server` 2.0.0 type definitions.

## Goal

Enter the Alexa+ track and the AWS Builder mini challenge with a new public repository, `juan294/spoken-letter-alexa` (MIT), that contains:

1. A self-hosted MCP server on the newest MCP specification (2026-07-28) served in dual-era mode so Alexa+'s 2025-era client can connect. Tools are read-only and parent-scoped: list the stories a parent has already delivered to their child, fetch one story with a time-limited audio URL, and suggest the next story.
2. An OAuth 2.1 authorization server that meets Amazon's published add-on checklist (authorization code with PKCE S256, client_credentials tier, RFC 8414 and RFC 9728 metadata, no Dynamic Client Registration).
3. A simulated Alexa+ experience, sanctioned by the rules as the fallback when partner tooling is unavailable, built on AWS: a Strands Agents plus Bedrock agent that calls the MCP server, Transcribe for voice input, Polly for spoken replies, and the untouched family MP3 for the story itself.
4. The Amazon packaging path (`addon.json`, Add-on Agent Skill scaffold, deploy runbook, US account checklist) ready to run the day toolkit access is granted.
5. Everything deployed on AWS through CDK at `alexa.spokenletter.com`, with the observability that proves the sub-500 ms tool latency Amazon requires.

The private Spoken Letter repository gains a small bridge: three bearer-authenticated routes, a link-confirmation page reusing the ADR 0016 one-time-token pattern, a server-only `alexaLinks` collection, and a Connect Alexa settings card.

## Owner decisions already made (research section 12)

- Licence MIT. Repository `juan294/spoken-letter-alexa`. Host `alexa.spokenletter.com` (Route53 zone `Z066897727OCGC5BEA1V8` in AWS account `106403001709`, profile `archy`, verified 2026-09-03).
- The public repository owns the OAuth authorization server and the MCP server. Spoken Letter exposes a minimal account-provider API. No Firebase Admin or private schema in the public repository.
- Both the Amazon packaging path and the simulated client are first-class deliverables.
- AWS Builder is a full commitment: every AWS service listed below performs real work, is called in code, and is documented in the README and friction log.
- Demo fixture audio is Juan's own recorded stories (author's voice, no consent issue, no AI narration).
- The US account topology (research section 3.3) is executed by the Owner only when access is granted.

## Hard constraints

- **Freeze.** No push, PR, Dependabot merge, or production deploy for the private repository until 2026-09-30. Phase 3 is implemented on a local branch and lands after the freeze. The public repository is a different remote; its first push (Phase 0) is outward-facing and waits for an explicit Owner "push" at implement time. Creating the repository as private first and flipping it to public at submission is not acceptable: the Open Source mini challenge needs a public repository created in the window, so it is public from the first push.
- **Hackathon deadline** Friday 2026-10-23 12:00 PT. Submission window opened 2026-08-31.
- **Alexa+ client facts** (research section 5): the live client sends `initialize` with `protocolVersion: "2025-03-26"`; the Local Inspector sends `2025-06-18` and expects `Mcp-Session-Id`. A 2026-07-28-only server fails. `createMcpHandler` with `legacy: 'stateless'` (the default) answers both eras per request but returns 405 for GET and DELETE and mints no session id. The Inspector risk is carried explicitly in Phase 1 and Phase 7.
- **Amazon server checklist:** Streamable HTTP; OAuth 2.1 authorization code with PKCE S256; client_credentials tier with HTTP Basic at the token endpoint; RFC 8414 metadata listing `client_credentials`; 401 with Protected Resource Metadata on unauthenticated requests; round trip under 500 ms; no DCR, OIDC, or step-up; tool signatures locked after certification; add-on content in `en-US`.
- **Child safety.** The add-on is the parent's tool. It exposes only stories with `status === "downloaded"` (the Owner's deliberate delivery, written identically by the download-confirm and Yoto-send paths). No child account, voice, or data exists on this path. The stored Recipient first name never leaves the private repository: ADR 0013's closed allowlist has four vendor boundaries and Alexa is not one. Story titles and adult-authored content may contain names, as ADR 0013 already permits. Demo scripts show the parent asking Alexa, never a child.
- **Agent-tool contract.** Tool names, description budgets, annotations, and the denylist follow `src/lib/agent-tools/contract.ts` (name 30 chars, description 500, parameter description 150, output 1500; denylisted fragments include send, download, recipient, audio, yoto, approve, record, upload). The public repository vendors these rules as a test.
- **Simplicity.** No new release gates in the private repository. The public repository has one CI workflow (typecheck, lint, test, CDK synth) and one deploy command. AWS services are isolated behind small interfaces so any of them can be removed after the hackathon without a rewrite.
- **Language.** All submission materials in English. The add-on locale is `en-US`. Story audio can be in any language.

## Design system (MANDATORY, whole-site)

All UI-bearing work in this plan faithfully applies the `/design` artifacts: the tokens in `design/tokens.json` (via the theme vars in `src/app/globals.css`) and the composition DNA in `design/exports/*.dc.html` plus `design/CLAUDE.md`'s Design Language section. Style only through tokens / `buttonVariants` (no hardcoded hex, rgb, oklch, font sizes, or radii). If a needed token is missing, add it to `design/tokens.json` and the `globals.css` mapping rather than inlining. Read the closest export and the Design Language section before building. Run `pnpm run check:design-tokens`, then re-run typecheck, lint, and test after any `design/tokens.json` change.

Two UI surfaces exist in this plan. The Connect Alexa settings card (Phase 3) is inside the private repository and uses the normal token pipeline; it matches `design/exports/Spoken Letter - Settings.dc.html:129-159` and mirrors `src/components/settings/yoto-connect-card.tsx` composition (`appCardVariants`, `eyebrowVariants`, icon chip at `--radius-lg`, `StatusPill`, `buttonVariants`). The simulated Alexa+ client (Phase 5) is outside the Tailwind pipeline: Phase 5 vendors `design/tokens.json` and the `:root` alias set into the public repository with a parity test that pins the vendored values to the source file's hashes, and it matches the "Now Playing" phone in `design/exports/Spoken Letter - Applications.dc.html:143-168` (ink panel, amber arc mark with radial glow, serif cream title, mono amber status chip) plus the five brand signatures (mono eyebrow above every heading, serif headline with one italic accent, the wordmark never plain text, cream to white to dark rhythm, warm tactile depth).

## Architecture

```
Alexa+ (Amazon, US, en-US)                   Simulated Alexa+ client (judges, Owner)
   │ OAuth 2.1 auth code + PKCE                  │ browser SPA at https://alexa.spokenletter.com/demo
   │ Streamable HTTP, legacy initialize          │ mic → agent API → Transcribe streaming
   ▼                                             ▼
https://alexa.spokenletter.com  (CloudFront → Lambda function URL, RESPONSE_STREAM, Hono)
   ├── /mcp                      createMcpHandler (2026-07-28 + legacy 'stateless'), bearer JWT
   ├── /.well-known/oauth-protected-resource      RFC 9728 → issuer = same host
   ├── /.well-known/oauth-authorization-server    RFC 8414
   ├── /.well-known/jwks.json    KMS asymmetric public key
   ├── /oauth/authorize|token|continue|revoke     packages/oauth, DynamoDB tables
   ├── /bridge/link/complete|revoke              bearer ALEXA_BRIDGE_SECRET, called by Spoken Letter
   ├── /agent/*                 packages/agent: Strands + Bedrock, Polly, Transcribe (Lambda)
   └── /demo/*                  packages/simulator static SPA (S3 origin)

Agent → AgentCore Gateway (MCP server target, outbound client_credentials) → /mcp
Alexa+ → /mcp directly (Amazon requires the server itself)

Account provider (packages/mcp-server/src/provider):
   FixtureProvider   Juan's recorded samples, used when no link exists and for judges
   HttpProvider      → https://spokenletter.com/api/alexa/bridge/{stories,audio-url}   bearer ALEXA_BRIDGE_SECRET

Spoken Letter (private repo, Vercel):
   /[locale]/link/alexa/[token]      direct-noindex page; session or signup/login with returnTo
   POST /api/alexa/link/confirm      withSession → POST {AS}/bridge/link/complete → alexaLinks/{uid}
   POST /api/alexa/disconnect        withSession → POST {AS}/bridge/link/revoke → delete alexaLinks/{uid}
   GET  /api/alexa/bridge/stories    constantTimeEqual bearer; Owner-delivered stories across owned spaces
   POST /api/alexa/bridge/audio-url  constantTimeEqual bearer; signed GCS URL, TTL ≤ 6 h
```

### Link flow (authorization code with a Spoken Letter confirmation)

1. Alexa (or the simulator) opens `GET /oauth/authorize?client_id&redirect_uri&code_challenge&code_challenge_method=S256&state&scope`.
2. The authorization server validates the static client and PKCE parameters, stores a pending authorization in DynamoDB, mints a random link token (`sla_` prefix, 24 random bytes base64url, stored only as a SHA-256 hash, 15-minute TTL, single use), and redirects to `https://spokenletter.com/link/alexa/<token>`.
3. The Spoken Letter page requires a session; an unauthenticated visitor gets signup and login buttons with `returnTo`. The signed-in Owner sees what will be shared (delivered stories and their audio, never Recipient profiles) and clicks Confirm.
4. `POST /api/alexa/link/confirm` calls `POST {AS}/bridge/link/complete { token, subject: uid }` with the bridge secret. The authorization server leases the token transactionally (conditional write on status), binds `subject` to the pending authorization, and returns `{ continueUrl }`. Spoken Letter writes `alexaLinks/{uid}` and returns the URL.
5. The browser opens `continueUrl` (`/oauth/continue?...`), the server issues the authorization code and redirects to Alexa's `redirect_uri` with `code` and `state`.
6. Alexa exchanges the code with `code_verifier` at `/oauth/token`; the server returns a KMS-signed JWT access token (subject = Spoken Letter uid, scope `mcp:tools mcp:resources`, 1 hour) and a refresh token (90 days, rotated).
7. Every `/mcp` call verifies the JWT against the JWKS, resolves the provider (`HttpProvider` when the subject is a real uid, `FixtureProvider` for the demo subject), and serves.

This mirrors ADR 0016's bearer-link conditions: the token is returned only to the requesting person's own browser, carries one pending authorization and nothing else, is random, hashed at rest, expiring, single-use, grants no ownership, membership, Recipient access, or delivery authority, and materialization requires an authenticated Spoken Letter session. Phase 3 records this as ADR 0018.

### Tool set

| Tool | Class | Input | Output (structured) | Failure classes |
|---|---|---|---|---|
| `list_family_stories` | read | `{ limit?: 1..20 }` | `{ stories: [{ id, title, storyteller, durationSeconds?, deliveredAt }] }` | `unauthenticated`, `provider_unavailable` |
| `get_family_story` | read | `{ storyId }` | `{ id, title, storyteller, durationSeconds?, audio: { url, expiresAt, contentType: "audio/mpeg" } }` plus a `resource_link` content block to the same URL | `story_not_found`, `audio_unavailable`, `provider_unavailable` |
| `suggest_next_story` | read | `{}` | `{ story: {...} \| null, reason }` picks the least recently delivered story not yet suggested this session | same as list |

Names pass the vendored contract (snake_case, no denylisted fragments; `audio` appears in a field name, not the tool name). `readOnlyHint: true` on all three. Descriptions are written for the Alexa+ design guide ("you shape what Alexa says by designing structured data") and locked before certification.

### AWS services and the function each performs

| Service | Function | Phase |
|---|---|---|
| Lambda (function URL, RESPONSE_STREAM) | MCP server, OAuth server, agent API | 6 |
| CloudFront + ACM + Route53 | `alexa.spokenletter.com`, single origin set, streaming pass-through | 6 |
| DynamoDB | OAuth clients, pending authorizations, codes, tokens, links, agent sessions | 2, 6 |
| KMS (asymmetric RSA) | JWT signing, JWKS publication | 2, 6 |
| Secrets Manager | `ALEXA_BRIDGE_SECRET`, static client secrets | 6 |
| S3 | simulator static assets, fixture audio | 5, 6 |
| Amazon Bedrock | model behind the simulated Alexa+ agent | 5 |
| Strands Agents SDK | agent loop and MCP client | 5 |
| AgentCore Gateway | MCP server target with client_credentials, protocol-version translation | 6 |
| Amazon Transcribe (streaming) | voice input in the simulated client | 5 |
| Amazon Polly (neural) | spoken replies in the simulated client, never story narration | 5 |
| CloudWatch (metrics, logs, dashboard, alarm) + X-Ray | sub-500 ms latency proof, error rates | 6 |
| AWS CDK | one-command deploy | 0, 6 |
| Kiro Crew | scaffolds the CDK stacks and the friction log, documented | 0, 8 |

## Phase overview

| # | Phase | Repo | Batch | Depends on |
|---|---|---|---|---|
| 0 | Repository bootstrap, licence, CI, CDK skeleton, DNS, first push | public | no | none |
| 1 | MCP server core with fixture provider, dual-era tests, latency test | public | `[batch-eligible]` | 0 |
| 2 | OAuth 2.1 authorization server | public | `[batch-eligible]` | 0 |
| 3 | Private-repo bridge: routes, link page, `alexaLinks`, Connect Alexa card, ADR 0018 | private (local branch) | `[batch-eligible]` | none |
| 4 | HTTP account provider and end-to-end link flow against local dev | both | no | 1, 2, 3 |
| 5 | Simulated Alexa+ client: agent, Transcribe, Polly, SPA | public | no | 1, 2 |
| 6 | AWS deployment: CDK stacks, domain, AgentCore Gateway, observability | public | no | 1, 2, 5 |
| 7 | Amazon packaging path: `addon.json`, Add-on Agent Skill scaffold, runbook, Inspector check | public | `[batch-eligible]` | 1, 2 |
| 8 | Submission: video, friction log, product feedback, README, Devpost, October production wiring | both | no | all |

Phases 1, 2, 3, and 7 touch disjoint directories (and Phase 3 a different repository) and can run through `/batch`. Phase 7's Inspector and simulator checks execute only if access exists; its file deliverables do not depend on access.

## Schedule (50 days)

- Sept 3 to 6: Phase 0. Sept 6 to 14: Phases 1, 2, 3 in parallel. Sept 15 to 18: Phase 4 against local dev.
- Sept 19 to 26: Phase 5. Sept 27 to Oct 3: Phase 6 (the first real deploy, before the freeze lifts, touches only AWS and the public repository).
- Oct 1: freeze lifts. Phase 3 PR into `develop`, then `develop → main` release per `docs/testing/release-gate.md`. Oct 4 to 8: Phase 7.
- Oct 9 to 20: Phase 8: production wiring, video, friction log, forms. Oct 21 to 22: buffer. Oct 23 12:00 PT: deadline.

## Verification strategy

Automated, per repository:

- Public: `pnpm typecheck && pnpm lint && pnpm test && pnpm -F infra synth` in CI on every push; protocol tests drive the handler with raw HTTP fixtures for `initialize` at 2025-03-26, 2025-06-18, 2025-11-25 and `server/discover` at 2026-07-28; a latency test asserts p95 under 250 ms locally for every tool with the fixture provider; contract tests vendor the private repository's agent-tool rules; OAuth conformance tests cover PKCE, client_credentials, metadata, 401 with PRM, refresh rotation, revocation.
- Private: `pnpm run typecheck; pnpm run lint; pnpm run test -- --coverage; pnpm run check:i18n; pnpm run check:design-tokens; pnpm check-route-auth` and the `firebase-rules` suite. Coverage thresholds stay at statements 98.83, branches 97.13, functions 98.89, lines 99.29 (`vitest.config.ts:96-101`), so every new module ships with its own tests.

Manual, listed per phase: DNS and certificate issuance, the first public push, the Owner link confirmation in a real browser, the simulated client's microphone flow, the demo recording, Amazon Inspector and simulator checks if access exists, and the Devpost forms.

## Risks and fallbacks

| Risk | Signal | Fallback |
|---|---|---|
| Local Inspector requires `Mcp-Session-Id` and rejects stateless legacy serving | Inspector fails after `initialize` | User-land routing with `isLegacyRequest` to a sessionful `WebStandardStreamableHTTPServerTransport` on a single Fargate task, kept as a documented branch in Phase 7 |
| CloudFront buffers the streaming function URL response | SSE frames arrive late in the simulator | Serve `/mcp` from the function URL directly (its own hostname is acceptable to Alexa; the issuer stays on the custom domain) |
| Toolkit access never arrives | No Solutions Architect reply by Oct 8 | The simulated path is the submission; Phase 7 ships as files plus runbook |
| Bedrock model access not enabled in the account | `AccessDeniedException` on first invoke | Enable model access in the console (manual, Phase 5) or switch to a Nova model |
| Freeze lift slips | Private PR not merged by Oct 10 | Submission uses the fixture provider end-to-end; the link flow is demonstrated against the Vercel preview of the Phase 3 branch |
| Strands `McpClient` needs a v1 client transport | Type mismatch with `@modelcontextprotocol/client` 2.0.0 | Use `@modelcontextprotocol/sdk` 1.30.0's `StreamableHTTPClientTransport` for the agent's client only; the server stays on v2 |

## Files touched

Public repository: everything under `juan294/spoken-letter-alexa`, laid out in Phase 0.

Private repository (Phase 3 only): `src/app/api/alexa/{link/confirm,disconnect,bridge/stories,bridge/audio-url}/route.ts` and tests, `src/app/[locale]/link/alexa/[token]/page.tsx`, `src/components/settings/alexa-connect-card.tsx`, `src/components/alexa/link-confirm-client.tsx`, `src/lib/alexa/{bridge-auth,links,catalog,audio-url}.ts` and tests, `src/lib/audio/storage-stream.ts` (new exported signer), `src/lib/firestore/collections.ts` and test, `firestore.rules`, `tests/rules/firestore.rules.test.ts`, `src/lib/api-errors.ts`, `messages/{en,es,fr}/{app,errors}.json`, `docs/localization/logs/fr/app.md` and `errors.md`, `docs/localization/french-translation-log.md`, `src/app/[locale]/(app)/settings/page.tsx`, `src/app/api/health/route.ts`, `.env.example`, `docs/decisions/0018-alexa-plus-bridge.md`, `docs/decisions/0013-child-name-vendor-egress.md` (addendum row), `docs/partners/device-integration-partners.md`.

## Phase files

- `2026-09-03-alexa-plus-mcp-add-on-phases/phase-0.md` through `phase-8.md`.
