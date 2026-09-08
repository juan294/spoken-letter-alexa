# Phase 4 — HTTP account provider and end-to-end link flow

Both repositories, local only. Wires Phase 2's JWT verifier into Phase 1's bearer gate, adds the `HttpProvider`, and proves the whole link flow against `pnpm run dev` of the private repository on the Phase 3 branch.

## Design-system note

Non-visual; exercises the Phase 3 surfaces without changing them.

## 1. `HttpProvider` (`packages/mcp-server/src/provider/http.ts`)

```ts
export class HttpProvider implements AccountProvider {
  constructor(private base: string /* SPOKEN_LETTER_ORIGIN */, private secret: string /* ALEXA_BRIDGE_SECRET */) {}
  async listDeliveredStories(subject, limit) {
    r = await fetchWithTimeout(`${base}/api/alexa/bridge/stories?subject=${enc(subject)}&limit=${limit}`, { headers: bearer, timeoutMs: 1500 })
    if (!r.ok) throw new ProviderUnavailableError(`bridge ${r.status}`)
    return parseStories(await r.json())          // zod; drops unknown fields, never trusts extra keys
  }
  async getStory(subject, storyId) { ... POST /api/alexa/bridge/audio-url { subject, storyId, ttlSeconds: 21600 } ... }
}
```

Timeout 1.5 s keeps the tool round trip inside Amazon's 500 ms budget in the common case (the private API answers in tens of milliseconds from Vercel) while failing clean when it does not. A 30-second in-memory cache per subject for the story list halves repeat latency; the audio URL is never cached.

`providerFor(subject)` returns `FixtureProvider` for `subject === "demo"` and for `svc:*` subjects, `HttpProvider` otherwise.

## 2. Bearer gate wiring (`packages/mcp-server/src/http.ts`)

`requireBearerAuth({ verifier: createJwtVerifier({ jwksUrl: `${ISSUER}/.well-known/jwks.json`, issuer: ISSUER, audience: `${ISSUER}/mcp` }), requiredScopes: ["mcp:tools"], resourceMetadataUrl })` from `@modelcontextprotocol/server`. The PRM document now points `authorization_servers` at the same host.

## 3. Local topology

- Private repo: `pnpm run dev` on `:3007` (memory: local-dev-runtime) with `.env.local` additions `ALEXA_BRIDGE_SECRET=<random>`, `ALEXA_BRIDGE_ORIGIN=http://localhost:4310`, `NEXT_PUBLIC_ALEXA_CONNECT_URL=http://localhost:4310/oauth/authorize?client_id=simulator&...`.
- Public repo: `pnpm dev` on `:4310` with `SPOKEN_LETTER_ORIGIN=http://localhost:3007`, the same bridge secret, memory store, local signer, `OAUTH_CLIENTS` containing the `simulator` client with redirect `http://localhost:4310/dev/callback`.
- `packages/oauth/src/dev/callback.ts`: a dev-only route that finishes the code exchange and prints the access token, so the flow can be driven without the simulator (Phase 5).

## 4. End-to-end script (`scripts/e2e-link.mjs`, run by hand and in a vitest `e2e` project skipped in CI)

1. Open `/oauth/authorize` for `simulator` → capture the `302` to `/link/alexa/<token>`.
2. With a Spoken Letter session cookie from the local sign-in (the script asks for it once), POST `/api/alexa/link/confirm { token }` → `continueUrl`.
3. Follow `continueUrl` → code → `/oauth/token` with the verifier → JWT.
4. `POST /mcp` legacy `initialize` at `2025-03-26`, then `tools/call list_family_stories` with the JWT → the Owner's real delivered stories (title, storyteller, duration), no recipient fields (assert absent).
5. `get_family_story` → a signed GCS URL that `curl -I` answers `200 audio/mpeg` and that expires (assert `expiresAt` within 6 h).
6. `POST /api/alexa/disconnect` → a later `/mcp` call with a refreshed token fails `invalid_grant` on refresh, and the stale access token still works until `exp` (documented behaviour).

## Success criteria

Automated: `pnpm -F mcp-server test` includes `http.test.ts` with a mocked bridge (200, 401, 503, timeout, malformed JSON) and asserts no recipient field survives parsing.

Manual: `node scripts/e2e-link.mjs` completes steps 1 to 6 against the two local servers, and the Settings card reflects each state. Screenshot the card states for the friction log.
