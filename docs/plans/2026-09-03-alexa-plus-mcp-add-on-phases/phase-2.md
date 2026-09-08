# Phase 2 — OAuth 2.1 authorization server `[batch-eligible]`

`packages/oauth`. Hono routes mounted on the same app as `/mcp` (Phase 4 wires the JWT verifier into the MCP bearer gate). Store interface with an in-memory implementation for tests and DynamoDB for deployment. Signer interface with a local RSA key for tests and KMS for deployment.

## Design-system note

The consent step renders inside Spoken Letter (Phase 3), so this package has no UI except one error page for a bad `authorize` request. That page uses the vendored brand tokens from Phase 5 once they exist; until then it is plain text on cream (`#F7F1E7` via the token file, never inlined).

## 1. Store (`src/store/{types,memory,dynamo}.ts`)

```ts
interface OAuthStore {
  getClient(clientId): Promise<StaticClient | null>                   // static clients come from env, not the store
  putPendingAuth(p: PendingAuth): Promise<void>                        // pk AUTH#<id>, ttl 15 min
  leaseLinkToken(tokenHash): Promise<PendingAuth | null>               // conditional update status pending→linked; null if missing/used/expired
  bindSubject(authId, subject): Promise<void>
  issueCode(authId): Promise<string>                                   // pk CODE#<hash>, ttl 5 min, single use
  consumeCode(codeHash): Promise<PendingAuth | null>                   // conditional delete
  putRefreshToken(rt: RefreshRecord): Promise<void>                    // pk RT#<hash>, ttl 90 d, subject, scope, clientId, rotatedFrom
  rotateRefreshToken(oldHash): Promise<RefreshRecord | null>          // conditional; reuse of a rotated token revokes the family
  revokeSubject(subject): Promise<void>                                // Phase 3 disconnect → all RT for subject
}
```

Every secret value is stored as `sha256(value)`. The DynamoDB implementation uses one table (`sla-oauth`, from Phase 0's CoreStack) with `pk`/`sk` and the `expiresAt` TTL attribute; `dynamo.test.ts` runs against `@aws-sdk/client-dynamodb` with `aws-sdk-client-mock`.

## 2. Static clients (`src/clients.ts`)

`OAUTH_CLIENTS` env is JSON: `[{ clientId, clientSecretHash, redirectUris: [...], grants: ["authorization_code","refresh_token"] }, { clientId: "alexa-m2m", clientSecretHash, grants: ["client_credentials"], scope: "mcp:service" }, { clientId: "simulator", ... }]`. Amazon's redirect URIs are added when access arrives (Phase 7). No DCR endpoint exists; a request to `/oauth/register` returns 404.

## 3. Endpoints (`src/routes.ts`)

| Route | Behaviour |
|---|---|
| `GET /.well-known/oauth-authorization-server` | RFC 8414: issuer `https://alexa.spokenletter.com`, `authorization_endpoint`, `token_endpoint`, `jwks_uri`, `revocation_endpoint`, `grant_types_supported: ["authorization_code","refresh_token","client_credentials"]`, `code_challenge_methods_supported: ["S256"]`, `token_endpoint_auth_methods_supported: ["client_secret_basic","client_secret_post"]`, `scopes_supported: ["mcp:tools","mcp:resources","mcp:service"]`, `response_types_supported: ["code"]` |
| `GET /.well-known/jwks.json` | public key(s) from the signer |
| `GET /oauth/authorize` | validate client, `redirect_uri` exact match, `response_type=code`, `code_challenge` + `S256`, `state`; store PendingAuth; mint link token (`sla_` + 24 random bytes base64url, hash stored); `302` to `${SPOKEN_LETTER_ORIGIN}/link/alexa/<token>` |
| `POST /bridge/link/complete` | bearer `ALEXA_BRIDGE_SECRET` (constant-time compare); body `{ token, subject }`; `leaseLinkToken` → `bindSubject`; returns `{ continueUrl: /oauth/continue?auth=<id>&sig=<hmac> }`; 404 on unknown/used/expired token |
| `GET /oauth/continue` | verify `sig` (HMAC of auth id with the bridge secret, 5-minute window); `issueCode`; `302` to client `redirect_uri?code&state` |
| `POST /oauth/token` | `authorization_code` (+ `code_verifier` S256 check, exact `redirect_uri`), `refresh_token` (rotation), `client_credentials` (HTTP Basic or post body; scope `mcp:service`); returns `{ access_token, token_type: "Bearer", expires_in: 3600, refresh_token?, scope }` |
| `POST /oauth/revoke` | RFC 7009 for refresh tokens |
| `POST /bridge/link/revoke` | bearer bridge secret; `{ subject }` → `revokeSubject` |

All error responses use RFC 6749 shapes (`error`, `error_description`). Rate limit: 60 requests per minute per IP on `/oauth/*` using an in-memory token bucket per instance (Phase 6 adds a CloudFront rate rule instead of another service).

## 4. Tokens (`src/tokens.ts`, `src/signer/{types,local,kms}.ts`)

Access token: JWT RS256, `iss` = issuer, `sub` = subject (Spoken Letter uid, or `demo` for the fixture subject, or `svc:<clientId>` for client_credentials), `aud` = `https://alexa.spokenletter.com/mcp`, `scope`, `exp` 1 h, `jti`. The KMS signer calls `Sign` with `RSASSA_PKCS1_V1_5_SHA_256` and caches the public key for JWKS. The local signer generates an RSA key at startup for tests and `dev`.

`src/verify.ts` exports `createJwtVerifier({ jwksUrl | jwks, issuer, audience })` returning an `OAuthTokenVerifier` for `requireBearerAuth` from `@modelcontextprotocol/server` (Phase 4 wires it; Phase 2 tests it standalone). Rejects `iss` mismatch (RFC 9207 posture), wrong `aud`, expired, unknown `kid`.

## 5. Conformance tests (`src/routes.test.ts`, `src/pkce.test.ts`, `src/tokens.test.ts`)

Drive the Hono app with `fetch`-style requests and the memory store:

- Full authorization-code + PKCE round trip: authorize → link token → `/bridge/link/complete` → continue → code → token; wrong `code_verifier` → `invalid_grant`; code reuse → `invalid_grant` and the refresh family for that code is revoked.
- Missing or plain `code_challenge_method` → `invalid_request`.
- `client_credentials` with HTTP Basic → token with `scope: "mcp:service"`; wrong secret → 401 `invalid_client`.
- Refresh rotation; reuse of a rotated refresh token → family revoked.
- Metadata document fields exactly as the table above (snapshot test).
- `/bridge/*` without the bridge secret → 401; timing-safe comparison unit test.
- JWT verifier accepts a token from the local signer and rejects the five failure classes.

## Success criteria

Automated: `pnpm -F oauth test` green with the memory store and local signer; DynamoDB and KMS implementations covered by mocked-client tests; `pnpm typecheck && pnpm lint` green.

Manual: none. (Deployment verification is Phase 6.)
