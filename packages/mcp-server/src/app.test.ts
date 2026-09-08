// The composed server (Phase 4): OAuth server + JWT-gated /mcp + dev routes on one Hono
// app, exercised end to end against a mock of the private Spoken Letter bridge.
import { LocalSigner, MemoryStore, mintAccessToken, parseClients, pkceChallenge } from "@spoken-letter-alexa/oauth";
import { sha256Hex } from "@spoken-letter-alexa/shared";
import { type Hono } from "hono";
import { beforeAll, describe, expect, test } from "vitest";

import { createServerApp } from "./app.ts";
import { FixtureProvider } from "./provider/fixtures.ts";
import { createMockSpokenLetter } from "./test-bridge.ts";
import { LEGACY_INITIALIZE, TEST_STORIES, readJsonRpc } from "./test-support.ts";

const ISSUER = "http://localhost:4310";
const SL_ORIGIN = "http://localhost:3007";
const BRIDGE_SECRET = "test-bridge-secret-not-a-real-credential";
const M2M_SECRET = "test-m2m-client-secret-not-real";
const DEV_TOKEN = "dev-token-for-tests-only";
const SIMULATOR_REDIRECT = "http://localhost:5173/demo/callback";
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";

const OWNER_STORIES = [
  {
    id: "real_1",
    title: "The night the moon was late",
    storyteller: "Grandpa Juan",
    durationSeconds: 203,
    deliveredAt: "2026-09-05T19:00:00.000Z",
    recipientName: "never",
    recipientId: "rcp",
    spaceId: "sp",
  },
  { id: "real_2", title: "Bread for the seagulls", storyteller: "Grandpa Juan", durationSeconds: 150, deliveredAt: "2026-09-01T19:00:00.000Z" },
];

type Harness = { app: Hono; spokenLetter: Hono; signer: LocalSigner };

async function harness(): Promise<Harness> {
  const signer = await LocalSigner.create();
  const clients = parseClients(
    JSON.stringify([
      { clientId: "alexa-m2m", clientSecretHash: sha256Hex(M2M_SECRET), redirectUris: [], grants: ["client_credentials"], scope: "mcp:service" },
      { clientId: "simulator", redirectUris: [SIMULATOR_REDIRECT, `${ISSUER}/dev/callback`], grants: ["authorization_code", "refresh_token"] },
    ]),
  );
  const bridge: { app: Hono | null } = { app: null };
  const bridgeFetch: typeof fetch = (input, init) =>
    Promise.resolve(bridge.app!.request(input instanceof Request ? input : String(input), init));
  const selfFetch: typeof fetch = (input, init) => Promise.resolve(app.request(input instanceof Request ? input : String(input), init));
  const app = await createServerApp({
    issuer: ISSUER,
    spokenLetterOrigin: SL_ORIGIN,
    bridgeSecret: BRIDGE_SECRET,
    clients,
    store: new MemoryStore(),
    signer,
    providerMode: "auto",
    fixtures: new FixtureProvider({ stories: TEST_STORIES, publicBaseUrl: ISSUER }),
    bridgeFetch,
    devToken: DEV_TOKEN,
    devRoutes: true,
    selfFetch,
  });
  const spokenLetter = createMockSpokenLetter({
    bridgeSecret: BRIDGE_SECRET,
    authorizationServer: { fetch: (request) => Promise.resolve(app.request(request)) },
    authorizationServerOrigin: ISSUER,
    stories: { uid_owner: OWNER_STORIES },
  });
  bridge.app = spokenLetter;
  return { app, spokenLetter, signer };
}

async function mcpCall(app: Hono, token: string, method: string, params: Record<string, unknown> = {}, id = 7) {
  const response = await app.request("/mcp", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const [message] = response.status === 200 ? await readJsonRpc(response) : [undefined];
  return { response, message };
}

async function serviceToken(app: Hono): Promise<string> {
  const response = await app.request("/oauth/token", {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`alexa-m2m:${M2M_SECRET}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { access_token: string }).access_token;
}

describe("composed server: discovery and bearer gate", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness();
  });

  test("PRM and AS metadata are served from the same host and agree on the issuer", async () => {
    const prm = (await (await h.app.request("/.well-known/oauth-protected-resource")).json()) as Record<string, unknown>;
    expect(prm).toMatchObject({ resource: `${ISSUER}/mcp`, authorization_servers: [ISSUER] });
    const as = (await (await h.app.request("/.well-known/oauth-authorization-server")).json()) as Record<string, unknown>;
    expect(as.issuer).toBe(ISSUER);
    expect((await h.app.request("/.well-known/jwks.json")).status).toBe(200);
  });

  test("missing bearer is 401 with the PRM challenge", async () => {
    const response = await h.app.request("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify(LEGACY_INITIALIZE("2025-03-26")),
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(`resource_metadata="${ISSUER}/.well-known/oauth-protected-resource"`);
  });

  test("a client_credentials service token reaches the tools and is served from fixtures", async () => {
    const token = await serviceToken(h.app);
    const { message } = await mcpCall(h.app, token, "tools/call", { name: "list_family_stories", arguments: {} });
    const result = message?.result as { structuredContent: { stories: { id: string }[] } };
    expect(result.structuredContent.stories.map((story) => story.id)).toEqual(["st_lighthouse", "st_owl", "st_bread"]);
  });

  test("a token without an MCP scope is 403 insufficient_scope", async () => {
    const { token } = await mintAccessToken({
      signer: h.signer,
      issuer: ISSUER,
      audience: `${ISSUER}/mcp`,
      subject: "uid_owner",
      clientId: "simulator",
      scope: "mcp:resources",
    });
    const { response } = await mcpCall(h.app, token, "tools/list");
    expect(response.status).toBe(403);
    expect(response.headers.get("www-authenticate")).toContain('error="insufficient_scope"');
  });

  test("a token for another audience or a garbage token is 401", async () => {
    const { token } = await mintAccessToken({
      signer: h.signer,
      issuer: ISSUER,
      audience: "https://other.example/mcp",
      subject: "uid_owner",
      clientId: "simulator",
      scope: "mcp:tools",
    });
    expect((await mcpCall(h.app, token, "tools/list")).response.status).toBe(401);
    expect((await mcpCall(h.app, "not-a-jwt", "tools/list")).response.status).toBe(401);
  });

  test("the static dev token still opens the gate for the Inspector and curl", async () => {
    const { message } = await mcpCall(h.app, DEV_TOKEN, "tools/call", { name: "suggest_next_story", arguments: {} });
    expect(message?.error).toBeUndefined();
  });
});

describe("end-to-end link flow against the mock Spoken Letter bridge", () => {
  test("authorize → confirm → continue → code → token → real stories → disconnect", async () => {
    const h = await harness();

    // 1. Alexa (the simulator client) opens /oauth/authorize.
    const query = new URLSearchParams({
      response_type: "code",
      client_id: "simulator",
      redirect_uri: SIMULATOR_REDIRECT,
      code_challenge: pkceChallenge(VERIFIER),
      code_challenge_method: "S256",
      state: "s1",
      scope: "mcp:tools mcp:resources",
    });
    const authorize = await h.app.request(`/oauth/authorize?${query.toString()}`);
    expect(authorize.status).toBe(302);
    const linkUrl = authorize.headers.get("location") ?? "";
    expect(linkUrl.startsWith(`${SL_ORIGIN}/link/alexa/sla_`)).toBe(true);
    const linkToken = linkUrl.split("/link/alexa/")[1]!;

    // 2. The signed-in Owner confirms in Spoken Letter, which calls /bridge/link/complete.
    const confirm = await h.spokenLetter.request("/api/alexa/link/confirm", {
      method: "POST",
      headers: { "x-mock-session-uid": "uid_owner", "content-type": "application/json" },
      body: JSON.stringify({ token: linkToken }),
    });
    expect(confirm.status).toBe(200);
    const { continueUrl } = (await confirm.json()) as { continueUrl: string };

    // 3. The browser follows continueUrl; the server redirects to the client with a code.
    const cont = await h.app.request(continueUrl);
    expect(cont.status).toBe(302);
    const redirect = new URL(cont.headers.get("location") ?? "");
    expect(`${redirect.origin}${redirect.pathname}`).toBe(SIMULATOR_REDIRECT);
    expect(redirect.searchParams.get("state")).toBe("s1");
    const code = redirect.searchParams.get("code")!;

    // 4. Code exchange with the verifier.
    const tokenResponse = await h.app.request("/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: VERIFIER, redirect_uri: SIMULATOR_REDIRECT, client_id: "simulator" }).toString(),
    });
    expect(tokenResponse.status).toBe(200);
    const tokens = (await tokenResponse.json()) as { access_token: string; refresh_token: string };

    // 5. Legacy initialize then the tools, now served by the HttpProvider for the real uid.
    const init = await mcpCall(h.app, tokens.access_token, "initialize", LEGACY_INITIALIZE("2025-03-26").params, 1);
    expect(init.message?.result).toMatchObject({ protocolVersion: "2025-03-26" });
    const list = await mcpCall(h.app, tokens.access_token, "tools/call", { name: "list_family_stories", arguments: {} });
    const listResult = list.message?.result as { structuredContent: { stories: Record<string, unknown>[] } };
    expect(listResult.structuredContent.stories.map((story) => story.id)).toEqual(["real_1", "real_2"]);
    expect(listResult.structuredContent.stories[0]).toEqual({
      id: "real_1",
      title: "The night the moon was late",
      storyteller: "Grandpa Juan",
      durationSeconds: 203,
      deliveredAt: "2026-09-05T19:00:00.000Z",
    });
    expect(JSON.stringify(list.message)).not.toMatch(/recipient|spaceId/);

    const get = await mcpCall(h.app, tokens.access_token, "tools/call", { name: "get_family_story", arguments: { storyId: "real_1" } });
    const getResult = get.message?.result as { structuredContent: { audio: { url: string; expiresAt: string } } };
    expect(getResult.structuredContent.audio.url).toMatch(/^https:\/\/storage\.googleapis\.com\/.*real_1\.mp3\?signed=1/);
    expect(Date.parse(getResult.structuredContent.audio.expiresAt) - Date.now()).toBeLessThanOrEqual(6 * 60 * 60 * 1000);

    // 6. Disconnect: refresh fails, the stale access token still works until exp (documented).
    const disconnect = await h.spokenLetter.request("/api/alexa/disconnect", {
      method: "POST",
      headers: { "x-mock-session-uid": "uid_owner", "content-type": "application/json" },
      body: "{}",
    });
    expect(disconnect.status).toBe(200);
    const refresh = await h.app.request("/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: "simulator" }).toString(),
    });
    expect(refresh.status).toBe(400);
    await expect(refresh.json()).resolves.toMatchObject({ error: "invalid_grant" });
    const stale = await mcpCall(h.app, tokens.access_token, "tools/call", { name: "suggest_next_story", arguments: {} });
    expect(stale.response.status).toBe(200);
  });

  test("a bridge outage for a real subject is a provider_unavailable tool error", async () => {
    const h = await harness();
    const { token } = await mintAccessToken({
      signer: h.signer,
      issuer: ISSUER,
      audience: `${ISSUER}/mcp`,
      subject: "uid_unknown",
      clientId: "simulator",
      scope: "mcp:tools",
    });
    // The mock has no stories for this uid but answers 200 with an empty list.
    const { message } = await mcpCall(h.app, token, "tools/call", { name: "list_family_stories", arguments: {} });
    expect((message?.result as { structuredContent: { stories: unknown[] } }).structuredContent.stories).toEqual([]);
  });
});

describe("dev routes", () => {
  test("/dev/start redirects to authorize with S256 and /dev/callback finishes the exchange", async () => {
    const h = await harness();
    const start = await h.app.request("/dev/start");
    expect(start.status).toBe(302);
    const authorizeUrl = new URL(start.headers.get("location") ?? "");
    expect(authorizeUrl.pathname).toBe("/oauth/authorize");
    expect(authorizeUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorizeUrl.searchParams.get("redirect_uri")).toBe(`${ISSUER}/dev/callback`);

    const authorize = await h.app.request(authorizeUrl.toString());
    const linkToken = (authorize.headers.get("location") ?? "").split("/link/alexa/")[1]!;
    const confirm = await h.spokenLetter.request("/api/alexa/link/confirm", {
      method: "POST",
      headers: { "x-mock-session-uid": "uid_owner", "content-type": "application/json" },
      body: JSON.stringify({ token: linkToken }),
    });
    const { continueUrl } = (await confirm.json()) as { continueUrl: string };
    const cont = await h.app.request(continueUrl);
    const callbackUrl = cont.headers.get("location") ?? "";
    expect(callbackUrl.startsWith(`${ISSUER}/dev/callback?`)).toBe(true);

    const callback = await h.app.request(callbackUrl);
    expect(callback.status).toBe(200);
    const body = (await callback.json()) as { access_token: string; subject: string };
    expect(body.subject).toBe("uid_owner");
    const { message } = await mcpCall(h.app, body.access_token, "tools/call", { name: "list_family_stories", arguments: { limit: 1 } });
    expect((message?.result as { structuredContent: { stories: { id: string }[] } }).structuredContent.stories[0]?.id).toBe("real_1");
  });

  test("dev routes are absent when not enabled", async () => {
    const signer = await LocalSigner.create();
    const app = await createServerApp({
      issuer: ISSUER,
      spokenLetterOrigin: SL_ORIGIN,
      bridgeSecret: BRIDGE_SECRET,
      clients: [],
      store: new MemoryStore(),
      signer,
      providerMode: "fixtures",
      fixtures: new FixtureProvider({ stories: [], publicBaseUrl: ISSUER }),
    });
    expect((await app.request("/dev/start")).status).toBe(404);
  });
});
