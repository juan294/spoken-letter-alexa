# Phase 3 — Private-repo bridge `[batch-eligible]`

Spoken Letter repository, branch `feat/alexa-bridge` created from `develop`, implemented and verified locally, **not pushed until 2026-10-01**. Adds the account-provider API, the link-confirmation page, the `alexaLinks` collection, the Connect Alexa settings card, and ADR 0018. Mirrors the ChatGPT channel's structure (`docs/plans/2026-08-25-chatgpt-app-mcp-draft-handoff-phases/`).

## Design-system note

Two surfaces. The link-confirmation page (`/[locale]/link/alexa/[token]`) mirrors the claim page (`src/app/[locale]/claim/[token]/page.tsx`): cream ground, mono eyebrow, serif headline with one italic accent, a white card, one amber pill call to action, matching `design/exports/Spoken Letter - Settings.dc.html:129-159` for the card. The Connect Alexa card in Settings copies `src/components/settings/yoto-connect-card.tsx` composition exactly (`appCardVariants`, `eyebrowVariants`, 46px icon chip at `--radius-lg` with `--icon-chip-tint`, `StatusPill`, `buttonVariants`) and mounts directly after the Yoto card at `src/app/[locale]/(app)/settings/page.tsx:302-305`. No new tokens are expected; if one is needed it goes into `design/tokens.json` and `globals.css` with `pnpm run check:design-tokens` re-run. The three `sl-design` ESLint rules block hex, font-name literals, and tiny font sizes.

## 1. Collection and rules

- `src/lib/firestore/collections.ts`: add `alexaLinks: "alexaLinks"` (alphabetical). `collections.test.ts` census pin updated (red first).
- `firestore.rules`, next to `chatgptDrafts` (`firestore.rules:206-209`):

```
match /alexaLinks/{uid} {
  // Alexa+ account links: written only by the Admin SDK after an Owner confirms in-app.
  allow read, write: if false;
}
```

- `tests/rules/firestore.rules.test.ts`: client read and write on `alexaLinks/{uid}` denied for the owner uid and a stranger.

## 2. Schema (`src/lib/alexa/links.ts`, hand-rolled parser per repo convention)

```ts
export type AlexaLink = { subject: FirestoreId /* == uid */; linkedAt: FirestoreTimestamp; issuer: string; scope: string };
export async function getAlexaLink(uid): Promise<AlexaLink | null>
export async function recordAlexaLink(uid, { issuer, scope }): Promise<void>     // set with merge
export async function deleteAlexaLink(uid): Promise<void>
```

## 3. Bridge auth (`src/lib/alexa/bridge-auth.ts`)

```ts
export function assertBridgeBearer(request: NextRequest): void {
  const secret = process.env.ALEXA_BRIDGE_SECRET;
  const auth = request.headers.get("authorization") ?? "";
  if (!secret || !constantTimeEqual(auth, `Bearer ${secret}`)) throw httpError("alexa_bridge_unauthorized", "Unauthorized.");
}
export function bridgeOrigin(): string   // ALEXA_BRIDGE_ORIGIN, e.g. https://alexa.spokenletter.com; throws if unset
export async function bridgeFetch(path, init): Promise<Response>   // adds bearer, 5 s timeout, no retries
```

The static route-auth census (`scripts/lib/route-auth.ts`) is satisfied because the bridge routes reference `constantTimeEqual`.

## 4. Catalog and audio URL (`src/lib/alexa/catalog.ts`, `src/lib/alexa/audio-url.ts`, `src/lib/audio/storage-stream.ts`)

```ts
// catalog.ts
export async function listDeliveredStoriesForOwner(uid, limit = 20): Promise<AlexaStorySummary[]> {
  spaces = familySpaces where ownerIds array-contains uid                       // pattern: src/lib/family/access.ts:137
  for each space: stories where spaceId == id and status == "downloaded" orderBy downloadedAt desc limit
  // status "downloaded" is the Owner's delivery act (owner.ts:539-554, yoto/send.ts:487-517); never "sent"
  map → { id, title, storyteller: senderDisplayName(story) /* sender.ts:513-660 helper, fallback "A storyteller" */,
          durationSeconds: story.finalMixDurationSeconds ?? displayNarrationDurationSeconds(story), deliveredAt: downloadedAt ISO }
  // NEVER include recipientId, recipientName, spaceId, senderId, yoto fields (ADR 0013 addendum)
}
// audio-url.ts
export async function signDeliveredStoryAudio(uid, storyId, ttlSeconds): Promise<{ url, expiresAt, contentType }> {
  await assertOwnerStoryAccess(storyId, uid, ["downloaded"]);                  // owner.ts:70-96
  const audio = bestAvailableDeliveryAudio(story); if (!audio) throw httpError("alexa_audio_unavailable", ...)
  return signStorageReadUrl(audio.path, clamp(ttlSeconds, 60, 21_600))       // new export below
}
// storage-stream.ts — new export next to trySignedStorageRedirect (:82-113); same allowlist gate, returns the URL string
export async function signStorageReadUrl(path, ttlMs): Promise<{ url: string; expiresAt: number }>
```

If a delivered-stories composite index (`spaceId`, `status`, `downloadedAt`) is missing, fall back to the per-space unfiltered query like `dashboard.ts:44-59`, and add the index to `firestore.indexes.json` so the release's `index-deploy-guard` covers it.

## 5. Routes

| Route | Wrapper | Body | Result |
|---|---|---|---|
| `GET /api/alexa/bridge/stories?subject=<uid>&limit=` | `assertBridgeBearer` | none | `{ stories }` from `listDeliveredStoriesForOwner` |
| `POST /api/alexa/bridge/audio-url` | `assertBridgeBearer` | `{ subject, storyId, ttlSeconds }` | `{ url, expiresAt, contentType: "audio/mpeg" }` |
| `POST /api/alexa/link/confirm` | `withSession` + `enforceRateLimit(\`alexa-link:${uid}\`, { limit: 10, windowMs: 60_000 })` | `{ token }` | calls `POST {bridge}/bridge/link/complete { token, subject: uid }`; on 200 `recordAlexaLink`, return `{ continueUrl }`; on 404 `alexa_link_unavailable` |
| `POST /api/alexa/disconnect` | `withSession` | `{}` | calls `POST {bridge}/bridge/link/revoke { subject: uid }`, then `deleteAlexaLink`; tolerant of an already-revoked link |

Bridge routes: `export const dynamic = "force-dynamic"`, plain `NextResponse.json`, and errors through `routeError` so codes are localized; never a bare `error:` string in a JSON body (the `check-api-error-contract` gate flags `legacy_error_value`). Each route has a `route.test.ts` following `src/app/api/chatgpt-drafts/claim/route.test.ts`: `vi.hoisted` state, mock `@/lib/auth/session`, mock `@/lib/rate-limit` through `importOriginal`, build requests with `sameOriginTestRequest` for the session routes and a plain `Request` with an `Authorization` header for the bridge routes.

## 6. API error codes (`src/lib/api-errors.ts` + `messages/{en,es,fr}/errors.json`)

`alexa_bridge_unauthorized` 401, `alexa_link_token_required` 400, `alexa_link_unavailable` 404, `alexa_bridge_unavailable` 503, `alexa_audio_unavailable` 404. Each with en, es, fr strings; `pnpm run check:i18n` enforces parity and the literal ratchet (11/11, zero margin: every user-visible string goes through the catalog).

## 7. Link page and client

- `src/app/[locale]/link/alexa/[token]/page.tsx`: server component, `robots: { index: false, follow: false }` (direct-noindex policy in `src/lib/page-route-contract.test.ts`), verifies the session cookie; unauthenticated → signup and login buttons with `returnTo=/link/alexa/<token>` (claim page pattern `:32`, `:58-69`); authenticated → `<LinkConfirmClient token>`.
- `src/components/alexa/link-confirm-client.tsx`: explains in one sentence what Alexa will see (delivered stories and their audio; nothing about the child), one Confirm button; on click POSTs `/api/alexa/link/confirm`, then `window.location.assign(continueUrl)`; error via `useApiErrorMessage`. Tracks `alexa_link_confirmed` in GA4 through the existing analytics helper.
- Messages under `app.alexaLink.*` in `messages/{en,es,fr}/app.json`.
- Route census: `/link` is a new top-level family. Add it to `DIRECT_NOINDEX_FAMILIES` in `src/lib/page-route-contract.test.ts:99` (next to `/claim`) with a reason, and to `BASELINE_CSP_ROUTE_PREFIXES` or `STRICT_CSP_ROUTE_PREFIXES` in `src/lib/page-route-contract.ts` (copy whichever `/claim` uses). Add `src/app/[locale]/link/layout.tsx` mirroring `src/app/[locale]/claim/layout.tsx` so the route-rooted client message provider parity check in `pnpm run check:i18n` passes.

## 8. Settings card

- `src/components/settings/alexa-connect-card.tsx`: props `{ link: AlexaLink | null }`; states `connected | disconnected`; connect is an anchor to `${ALEXA_CONNECT_URL}` (public env `NEXT_PUBLIC_ALEXA_CONNECT_URL`, points at the authorization server's `/oauth/authorize` with the Spoken Letter simulator client until Amazon's own link entry exists) with the same ESLint disable comment the Yoto card uses for OAuth navigation (`yoto-connect-card.tsx:228-244`); disconnect posts `/api/alexa/disconnect` with the `submittingRef` lock pattern (`:76-85`).
- Mount at `settings/page.tsx` after the Yoto card; the page loads `getAlexaLink(uid)` alongside the Yoto status.
- Messages `app.settings.alexa.*` (title, description, status.connected, status.disconnected, connect, disconnect, disconnectError, note.us-only: "Alexa+ add-ons are available in the United States in English for now.").
- French: update `docs/localization/logs/fr/app.md` and `logs/fr/errors.md` domain records and the aggregate `french-translation-log.md` hashes per its header rule.

## 9. Env, health, docs

- `.env.example`: `ALEXA_BRIDGE_SECRET=`, `ALEXA_BRIDGE_ORIGIN=`, `NEXT_PUBLIC_ALEXA_CONNECT_URL=` with comments.
- `src/app/api/health/route.ts` `optionalChecks`: `alexaBridge: envCheck(["ALEXA_BRIDGE_SECRET","ALEXA_BRIDGE_ORIGIN"], { ... noStrayWhitespace })`. Absence never blocks a deploy.
- `docs/decisions/0018-alexa-plus-bridge.md`: the bearer-link exception scoped like ADR 0016 (conditions listed in the main plan), the bridge secret model, and the "delivered means `downloaded`" rule.
- `docs/decisions/0013-child-name-vendor-egress.md`: add the row `| Alexa+ (MCP add-on) | None. |` with a dated addendum note.
- `docs/partners/device-integration-partners.md`: Alexa row status → "Bridge implemented (Phase 3), add-on in the public repository".

## Success criteria

Automated (run sequentially, never in parallel Bash calls):
`pnpm run typecheck; pnpm run lint; pnpm run test -- --coverage; pnpm run check:i18n; pnpm run check:design-tokens; pnpm check-route-auth; pnpm vitest run -c vitest.rules.config.ts`
All green; coverage thresholds unchanged (`vitest.config.ts:96-101`); knip reports no new unused exports.

Manual:
- With `pnpm run dev` and the public repository's `pnpm dev` (Phase 4), the Settings card shows Disconnected, Connect opens the authorization server, the link page confirms, the card shows Connected with the linked date, Disconnect returns it to Disconnected.
- Branch stays local until 2026-10-01; then PR into `develop` with a merge commit after `verify`, `firebase-rules`, `mobile-e2e`, `ios-webkit`.
