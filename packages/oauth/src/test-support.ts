// Helpers for this package's tests. Not exported from the package.
import { sha256Hex } from "@spoken-letter-alexa/shared";
import { type Hono } from "hono";

import { parseClients } from "./clients.ts";
import { pkceChallenge } from "./pkce.ts";
import { createOAuthApp, type OAuthDeps } from "./routes.ts";
import { LocalSigner } from "./signer/local.ts";
import { MemoryStore } from "./store/memory.ts";

export const ISSUER = "https://alexa.spokenletter.com";
export const SPOKEN_LETTER_ORIGIN = "https://spokenletter.com";
export const BRIDGE_SECRET = "test-bridge-secret-not-a-real-credential";
export const ALEXA_SECRET = "test-alexa-client-secret-not-real";
export const M2M_SECRET = "test-m2m-client-secret-not-real";
export const ALEXA_REDIRECT = "https://layla.amazon.com/api/skill/link/ABC";
export const SIMULATOR_REDIRECT = "http://localhost:5173/demo/callback";

export const CLIENTS_JSON = JSON.stringify([
  {
    clientId: "alexa",
    clientSecretHash: sha256Hex(ALEXA_SECRET),
    redirectUris: [ALEXA_REDIRECT],
    grants: ["authorization_code", "refresh_token"],
  },
  { clientId: "alexa-m2m", clientSecretHash: sha256Hex(M2M_SECRET), redirectUris: [], grants: ["client_credentials"], scope: "mcp:service" },
  { clientId: "simulator", redirectUris: [SIMULATOR_REDIRECT], grants: ["authorization_code", "refresh_token"] },
]);

export const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
export const CHALLENGE = pkceChallenge(VERIFIER);

export type Harness = {
  app: Hono;
  store: MemoryStore;
  signer: LocalSigner;
  deps: OAuthDeps;
  clock: { now: number };
};

export async function harness(overrides: Partial<OAuthDeps> = {}): Promise<Harness> {
  const clock = { now: 1_800_000_000 };
  const signer = await LocalSigner.create();
  const store = new MemoryStore({ now: () => clock.now });
  const deps: OAuthDeps = {
    issuer: ISSUER,
    spokenLetterOrigin: SPOKEN_LETTER_ORIGIN,
    bridgeSecret: BRIDGE_SECRET,
    clients: parseClients(CLIENTS_JSON),
    store,
    signer,
    now: () => clock.now,
    ...overrides,
  };
  return { app: createOAuthApp(deps), store, signer, deps, clock };
}

export function basicAuth(clientId: string, secret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${secret}`, "utf8").toString("base64")}`;
}

export function form(fields: Record<string, string>): { headers: Record<string, string>; body: string } {
  return {
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  };
}

export function authorizeUrl(params: Record<string, string>): string {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: "simulator",
    redirect_uri: SIMULATOR_REDIRECT,
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
    state: "state-123",
    scope: "mcp:tools mcp:resources",
    ...params,
  });
  return `/oauth/authorize?${query.toString()}`;
}

/** Runs authorize → bridge complete → continue and returns the authorization code. */
export async function obtainCode(h: Harness, subject = "uid_1", params: Record<string, string> = {}): Promise<string> {
  const authorize = await h.app.request(authorizeUrl(params));
  if (authorize.status !== 302) throw new Error(`authorize ${authorize.status}: ${await authorize.text()}`);
  const location = authorize.headers.get("location") ?? "";
  const token = location.split("/link/alexa/")[1];
  if (!token) throw new Error(`no link token in ${location}`);
  const complete = await h.app.request("/bridge/link/complete", {
    method: "POST",
    headers: { authorization: `Bearer ${BRIDGE_SECRET}`, "content-type": "application/json" },
    body: JSON.stringify({ token, subject }),
  });
  if (complete.status !== 200) throw new Error(`complete ${complete.status}: ${await complete.text()}`);
  const { continueUrl } = (await complete.json()) as { continueUrl: string };
  const cont = await h.app.request(continueUrl);
  if (cont.status !== 302) throw new Error(`continue ${cont.status}: ${await cont.text()}`);
  const redirect = new URL(cont.headers.get("location") ?? "");
  const code = redirect.searchParams.get("code");
  if (!code) throw new Error(`no code in ${redirect.toString()}`);
  return code;
}

export type TokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
};

export async function exchangeCode(h: Harness, code: string, verifier = VERIFIER): Promise<Response> {
  return h.app.request("/oauth/token", {
    method: "POST",
    ...form({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      redirect_uri: SIMULATOR_REDIRECT,
      client_id: "simulator",
    }),
  });
}
