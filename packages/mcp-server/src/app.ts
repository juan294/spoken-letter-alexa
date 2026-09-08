// One Hono app for everything on alexa.spokenletter.com: the OAuth server, the JWT-gated
// dual-era MCP endpoint and (optionally) the dev routes. Phase 5 mounts the agent API.
import {
  createDevAuthRoutes,
  createJwtVerifier,
  createOAuthApp,
  type OAuthStore,
  type Signer,
  type StaticClient,
  type TokenBucket,
} from "@spoken-letter-alexa/oauth";
import { Hono } from "hono";

import { type BearerGate, devTokenGate, firstGate, jwtGate } from "./auth.ts";
import { createApp } from "./http.ts";
import { type FixtureProvider } from "./provider/fixtures.ts";
import { HttpProvider } from "./provider/http.ts";
import { createProviderResolver, type ProviderMode } from "./provider/registry.ts";
import { type SuggestionMemory } from "./tools/suggest.ts";

export type ServerAppConfig = {
  /** Public origin; also the OAuth issuer and the PRM's authorization server. */
  issuer: string;
  spokenLetterOrigin: string;
  bridgeSecret: string;
  clients: StaticClient[];
  store: OAuthStore;
  signer: Signer;
  providerMode: ProviderMode;
  fixtures: FixtureProvider;
  /** Injected in tests; the bridge is reached with the global `fetch` otherwise. */
  bridgeFetch?: typeof fetch | undefined;
  /** Optional static token for the Inspector and curl; JWTs are always accepted. */
  devToken?: string | undefined;
  /** Mounts `/dev/start` and `/dev/callback` (never in production). */
  devRoutes?: boolean | undefined;
  /** How the dev callback reaches this app's own token endpoint. */
  selfFetch?: typeof fetch | undefined;
  now?: (() => number) | undefined;
  rateLimit?: TokenBucket | undefined;
  suggestions?: SuggestionMemory | undefined;
  /** Inspector contingency (MCP_LEGACY_SESSIONS=1); single instance only, never on Lambda. */
  legacySessions?: boolean | undefined;
  /** Further Hono apps mounted at `/` (the agent API from packages/app). */
  extraApps?: Hono[] | undefined;
};

export async function createServerApp(config: ServerAppConfig): Promise<Hono> {
  const app = new Hono();
  const { issuer } = config;

  const oauth = createOAuthApp({
    issuer,
    spokenLetterOrigin: config.spokenLetterOrigin,
    bridgeSecret: config.bridgeSecret,
    clients: config.clients,
    store: config.store,
    signer: config.signer,
    now: config.now,
    rateLimit: config.rateLimit,
  });

  // The verifier reads the signer's own public key: same process, no JWKS round trip.
  const verifier = createJwtVerifier({ jwks: { keys: [await config.signer.publicJwk()] }, issuer, audience: `${issuer}/mcp` });
  // The JWT gate goes last so its challenge (401 invalid_token or 403 insufficient_scope)
  // is the one a client sees; the static dev token is a cheap constant-time pre-check.
  const gates: BearerGate[] = [];
  if (config.devToken) gates.push(devTokenGate({ devToken: config.devToken, publicBaseUrl: issuer }));
  gates.push(jwtGate({ verifier, publicBaseUrl: issuer }));

  const http = config.spokenLetterOrigin
    ? new HttpProvider({ base: config.spokenLetterOrigin, secret: config.bridgeSecret, fetch: config.bridgeFetch })
    : null;
  const mcp = createApp({
    publicBaseUrl: issuer,
    providerFor: createProviderResolver({ mode: config.providerMode, fixtures: config.fixtures, http }),
    bearerGate: firstGate(gates),
    suggestions: config.suggestions,
    legacySessions: config.legacySessions,
  });

  app.route("/", oauth);
  app.route("/", mcp);
  for (const extra of config.extraApps ?? []) app.route("/", extra);
  if (config.devRoutes) {
    app.route(
      "/",
      createDevAuthRoutes({
        issuer,
        clientId: "simulator",
        fetch:
          config.selfFetch ??
          ((input, init) => Promise.resolve(app.request(input instanceof Request ? input : String(input), init))),
      }),
    );
  }
  return app;
}
