// Conformance tests: drive the Hono app with fetch-style requests, memory store, local signer.
import { sha256Hex } from "@spoken-letter-alexa/shared";
import { beforeAll, describe, expect, test } from "vitest";

import {
  ALEXA_REDIRECT,
  ALEXA_SECRET,
  BRIDGE_SECRET,
  CHALLENGE,
  ISSUER,
  M2M_SECRET,
  SIMULATOR_REDIRECT,
  SPOKEN_LETTER_ORIGIN,
  VERIFIER,
  authorizeUrl,
  basicAuth,
  exchangeCode,
  form,
  harness,
  obtainCode,
  type Harness,
  type TokenResponse,
} from "./test-support.ts";
import { createJwtVerifier } from "./verify.ts";

describe("RFC 8414 metadata and JWKS", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await harness();
  });

  test("authorization server metadata has exactly the planned fields", async () => {
    const response = await h.app.request("/.well-known/oauth-authorization-server");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/oauth/authorize`,
      token_endpoint: `${ISSUER}/oauth/token`,
      jwks_uri: `${ISSUER}/.well-known/jwks.json`,
      revocation_endpoint: `${ISSUER}/oauth/revoke`,
      grant_types_supported: ["authorization_code", "refresh_token", "client_credentials"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
      scopes_supported: ["mcp:tools", "mcp:resources", "mcp:service"],
      response_types_supported: ["code"],
    });
  });

  test("jwks.json publishes the signer's public key", async () => {
    const response = await h.app.request("/.well-known/jwks.json");
    expect(response.status).toBe(200);
    const jwks = (await response.json()) as { keys: { kid: string; kty: string; alg: string }[] };
    expect(jwks.keys).toHaveLength(1);
    expect(jwks.keys[0]).toMatchObject({ kid: h.signer.kid, kty: "RSA", alg: "RS256" });
  });

  test("dynamic client registration does not exist", async () => {
    const response = await h.app.request("/oauth/register", { method: "POST", ...form({}) });
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: "invalid_request" });
  });
});

describe("authorization code with PKCE and the Spoken Letter link step", () => {
  test("authorize stores a pending authorization and redirects to the link page with a hashed token", async () => {
    const h = await harness();
    const response = await h.app.request(authorizeUrl({}));
    expect(response.status).toBe(302);
    const location = response.headers.get("location") ?? "";
    expect(location.startsWith(`${SPOKEN_LETTER_ORIGIN}/link/alexa/sla_`)).toBe(true);
    const token = location.split("/link/alexa/")[1]!;
    expect(token).toMatch(/^sla_[A-Za-z0-9_-]{32}$/);
    const pending = h.store.pendingByLinkHash(sha256Hex(token));
    expect(pending).toMatchObject({ clientId: "simulator", status: "pending", state: "state-123", codeChallenge: CHALLENGE });
    expect(JSON.stringify(h.store.dump())).not.toContain(token);
  });

  test("full round trip: authorize → link complete → continue → code → tokens", async () => {
    const h = await harness();
    const code = await obtainCode(h, "uid_1");
    const response = await exchangeCode(h, code);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as TokenResponse;
    expect(body).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "mcp:tools mcp:resources" });
    expect(body.refresh_token).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    const verifier = createJwtVerifier({ jwks: { keys: [await h.signer.publicJwk()] }, issuer: ISSUER, audience: `${ISSUER}/mcp` });
    await expect(verifier.verifyAccessToken(body.access_token)).resolves.toMatchObject({
      clientId: "simulator",
      scopes: ["mcp:tools", "mcp:resources"],
      extra: { subject: "uid_1" },
    });
  });

  test("continue redirects to the client's redirect_uri with code and state", async () => {
    const h = await harness();
    const authorize = await h.app.request(authorizeUrl({}));
    const token = (authorize.headers.get("location") ?? "").split("/link/alexa/")[1]!;
    const complete = await h.app.request("/bridge/link/complete", {
      method: "POST",
      headers: { authorization: `Bearer ${BRIDGE_SECRET}`, "content-type": "application/json" },
      body: JSON.stringify({ token, subject: "uid_1" }),
    });
    const { continueUrl } = (await complete.json()) as { continueUrl: string };
    expect(continueUrl.startsWith(`${ISSUER}/oauth/continue?`)).toBe(true);
    const cont = await h.app.request(continueUrl);
    expect(cont.status).toBe(302);
    const redirect = new URL(cont.headers.get("location") ?? "");
    expect(`${redirect.origin}${redirect.pathname}`).toBe(SIMULATOR_REDIRECT);
    expect(redirect.searchParams.get("state")).toBe("state-123");
    expect(redirect.searchParams.get("code")).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    // The continue link is single use.
    const again = await h.app.request(continueUrl);
    expect(again.status).toBe(400);
  });

  test("continue rejects a tampered or expired signature", async () => {
    const h = await harness();
    const authorize = await h.app.request(authorizeUrl({}));
    const token = (authorize.headers.get("location") ?? "").split("/link/alexa/")[1]!;
    const complete = await h.app.request("/bridge/link/complete", {
      method: "POST",
      headers: { authorization: `Bearer ${BRIDGE_SECRET}`, "content-type": "application/json" },
      body: JSON.stringify({ token, subject: "uid_1" }),
    });
    const { continueUrl } = (await complete.json()) as { continueUrl: string };
    const tampered = new URL(continueUrl);
    tampered.searchParams.set("sig", "0".repeat(64));
    expect((await h.app.request(tampered.toString())).status).toBe(400);
    h.clock.now += 6 * 60;
    expect((await h.app.request(continueUrl)).status).toBe(400);
  });

  test("wrong code_verifier is invalid_grant", async () => {
    const h = await harness();
    const code = await obtainCode(h);
    const response = await exchangeCode(h, code, `${VERIFIER}x`);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "invalid_grant" });
  });

  test("code reuse is invalid_grant and revokes the refresh family issued for that code", async () => {
    const h = await harness();
    const code = await obtainCode(h);
    const first = (await (await exchangeCode(h, code)).json()) as TokenResponse;
    const reuse = await exchangeCode(h, code);
    expect(reuse.status).toBe(400);
    await expect(reuse.json()).resolves.toMatchObject({ error: "invalid_grant" });
    const refresh = await h.app.request("/oauth/token", {
      method: "POST",
      ...form({ grant_type: "refresh_token", refresh_token: first.refresh_token!, client_id: "simulator" }),
    });
    expect(refresh.status).toBe(400);
    await expect(refresh.json()).resolves.toMatchObject({ error: "invalid_grant" });
  });

  test("redirect_uri must match exactly at token time", async () => {
    const h = await harness();
    const code = await obtainCode(h);
    const response = await h.app.request("/oauth/token", {
      method: "POST",
      ...form({ grant_type: "authorization_code", code, code_verifier: VERIFIER, redirect_uri: `${SIMULATOR_REDIRECT}/`, client_id: "simulator" }),
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "invalid_grant" });
  });

  test("a confidential client exchanges its code with HTTP Basic", async () => {
    const h = await harness();
    const code = await obtainCode(h, "uid_2", { client_id: "alexa", redirect_uri: ALEXA_REDIRECT });
    const response = await h.app.request("/oauth/token", {
      method: "POST",
      headers: { authorization: basicAuth("alexa", ALEXA_SECRET), "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: VERIFIER, redirect_uri: ALEXA_REDIRECT }).toString(),
    });
    expect(response.status).toBe(200);
    const bad = await h.app.request("/oauth/token", {
      method: "POST",
      headers: { authorization: basicAuth("alexa", "wrong"), "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: VERIFIER, redirect_uri: ALEXA_REDIRECT }).toString(),
    });
    expect(bad.status).toBe(401);
    expect(bad.headers.get("www-authenticate")).toMatch(/^Basic/);
    await expect(bad.json()).resolves.toMatchObject({ error: "invalid_client" });
  });
});

describe("authorize request validation", () => {
  test.each([
    { name: "missing code_challenge", params: { code_challenge: "" }, error: "invalid_request" },
    { name: "plain code_challenge_method", params: { code_challenge_method: "plain" }, error: "invalid_request" },
    { name: "missing state", params: { state: "" }, error: "invalid_request" },
    { name: "unsupported response_type", params: { response_type: "token" }, error: "invalid_request" },
    { name: "unknown scope", params: { scope: "mcp:admin" }, error: "invalid_scope" },
  ])("$name redirects back with $error", async ({ params, error }) => {
    const h = await harness();
    const response = await h.app.request(authorizeUrl(params));
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location") ?? "");
    expect(`${location.origin}${location.pathname}`).toBe(SIMULATOR_REDIRECT);
    expect(location.searchParams.get("error")).toBe(error);
    expect(location.searchParams.get("state")).toBe(params.state === "" ? null : "state-123");
  });

  test("unknown client or unregistered redirect_uri never redirects; a plain error page is shown", async () => {
    const h = await harness();
    const unknown = await h.app.request(authorizeUrl({ client_id: "nope" }));
    expect(unknown.status).toBe(400);
    expect(unknown.headers.get("content-type")).toMatch(/text\/plain/);
    expect(unknown.headers.get("location")).toBeNull();
    const badRedirect = await h.app.request(authorizeUrl({ redirect_uri: "https://evil.example/cb" }));
    expect(badRedirect.status).toBe(400);
    expect(badRedirect.headers.get("location")).toBeNull();
  });

  test("a client without the authorization_code grant is unauthorized_client", async () => {
    const h = await harness();
    const response = await h.app.request(authorizeUrl({ client_id: "alexa-m2m", redirect_uri: "https://x.example/cb" }));
    expect(response.status).toBe(400);
  });
});

describe("client_credentials", () => {
  test("HTTP Basic mints a service token with scope mcp:service and subject svc:<clientId>", async () => {
    const h = await harness();
    const response = await h.app.request("/oauth/token", {
      method: "POST",
      headers: { authorization: basicAuth("alexa-m2m", M2M_SECRET), "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", scope: "mcp:service" }).toString(),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as TokenResponse;
    expect(body).toMatchObject({ token_type: "Bearer", scope: "mcp:service", expires_in: 3600 });
    expect(body.refresh_token).toBeUndefined();
    const verifier = createJwtVerifier({ jwks: { keys: [await h.signer.publicJwk()] }, issuer: ISSUER, audience: `${ISSUER}/mcp` });
    await expect(verifier.verifyAccessToken(body.access_token)).resolves.toMatchObject({
      clientId: "alexa-m2m",
      scopes: ["mcp:service"],
      extra: { subject: "svc:alexa-m2m" },
    });
  });

  test("client_secret_post also works; a wrong secret is 401 invalid_client", async () => {
    const h = await harness();
    const ok = await h.app.request("/oauth/token", {
      method: "POST",
      ...form({ grant_type: "client_credentials", client_id: "alexa-m2m", client_secret: M2M_SECRET }),
    });
    expect(ok.status).toBe(200);
    const bad = await h.app.request("/oauth/token", {
      method: "POST",
      ...form({ grant_type: "client_credentials", client_id: "alexa-m2m", client_secret: "wrong" }),
    });
    expect(bad.status).toBe(401);
    await expect(bad.json()).resolves.toMatchObject({ error: "invalid_client" });
  });

  test("a client without the grant is unauthorized_client", async () => {
    const h = await harness();
    const response = await h.app.request("/oauth/token", {
      method: "POST",
      headers: { authorization: basicAuth("alexa", ALEXA_SECRET), "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials" }).toString(),
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "unauthorized_client" });
  });
});

describe("refresh tokens", () => {
  async function tokens(h: Harness): Promise<TokenResponse> {
    const code = await obtainCode(h);
    return (await (await exchangeCode(h, code)).json()) as TokenResponse;
  }

  function refresh(h: Harness, refreshToken: string) {
    return h.app.request("/oauth/token", {
      method: "POST",
      ...form({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: "simulator" }),
    });
  }

  test("rotation issues a new pair and the old token stops working", async () => {
    const h = await harness();
    const first = await tokens(h);
    const rotated = await refresh(h, first.refresh_token!);
    expect(rotated.status).toBe(200);
    const second = (await rotated.json()) as TokenResponse;
    expect(second.refresh_token).not.toBe(first.refresh_token);
    expect(second.access_token).not.toBe(first.access_token);
    expect(second.scope).toBe("mcp:tools mcp:resources");
    const third = await refresh(h, second.refresh_token!);
    expect(third.status).toBe(200);
  });

  test("reuse of a rotated refresh token revokes the whole family", async () => {
    const h = await harness();
    const first = await tokens(h);
    const second = (await (await refresh(h, first.refresh_token!)).json()) as TokenResponse;
    const reuse = await refresh(h, first.refresh_token!);
    expect(reuse.status).toBe(400);
    await expect(reuse.json()).resolves.toMatchObject({ error: "invalid_grant" });
    const afterReuse = await refresh(h, second.refresh_token!);
    expect(afterReuse.status).toBe(400);
  });

  test("a refresh token cannot be used by another client", async () => {
    const h = await harness();
    const first = await tokens(h);
    const response = await h.app.request("/oauth/token", {
      method: "POST",
      headers: { authorization: basicAuth("alexa", ALEXA_SECRET), "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: first.refresh_token! }).toString(),
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "invalid_grant" });
  });

  test("RFC 7009 revoke makes the refresh token unusable and always answers 200", async () => {
    const h = await harness();
    const first = await tokens(h);
    const revoke = await h.app.request("/oauth/revoke", {
      method: "POST",
      ...form({ token: first.refresh_token!, token_type_hint: "refresh_token", client_id: "simulator" }),
    });
    expect(revoke.status).toBe(200);
    expect((await refresh(h, first.refresh_token!)).status).toBe(400);
    const unknown = await h.app.request("/oauth/revoke", { method: "POST", ...form({ token: "never-issued", client_id: "simulator" }) });
    expect(unknown.status).toBe(200);
    const badClient = await h.app.request("/oauth/revoke", {
      method: "POST",
      headers: { authorization: basicAuth("alexa", "wrong"), "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: "x" }).toString(),
    });
    expect(badClient.status).toBe(401);
  });

  test("bridge revoke for a subject invalidates every refresh token of that subject", async () => {
    const h = await harness();
    const first = await tokens(h);
    const response = await h.app.request("/bridge/link/revoke", {
      method: "POST",
      headers: { authorization: `Bearer ${BRIDGE_SECRET}`, "content-type": "application/json" },
      body: JSON.stringify({ subject: "uid_1" }),
    });
    expect(response.status).toBe(200);
    expect((await refresh(h, first.refresh_token!)).status).toBe(400);
  });
});

describe("bridge authentication", () => {
  test.each(["", "Bearer wrong", `Bearer ${BRIDGE_SECRET}x`, "Basic abc"])("rejects %j with 401", async (header) => {
    const h = await harness();
    const response = await h.app.request("/bridge/link/complete", {
      method: "POST",
      headers: { ...(header && { authorization: header }), "content-type": "application/json" },
      body: JSON.stringify({ token: "sla_x", subject: "uid" }),
    });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: "invalid_token" });
  });

  test("an unknown, used or expired link token is 404 not_found", async () => {
    const h = await harness();
    const post = (token: string) =>
      h.app.request("/bridge/link/complete", {
        method: "POST",
        headers: { authorization: `Bearer ${BRIDGE_SECRET}`, "content-type": "application/json" },
        body: JSON.stringify({ token, subject: "uid_1" }),
      });
    expect((await post("sla_unknown")).status).toBe(404);
    const authorize = await h.app.request(authorizeUrl({}));
    const token = (authorize.headers.get("location") ?? "").split("/link/alexa/")[1]!;
    expect((await post(token)).status).toBe(200);
    expect((await post(token)).status).toBe(404);
    const second = await h.app.request(authorizeUrl({}));
    const token2 = (second.headers.get("location") ?? "").split("/link/alexa/")[1]!;
    h.clock.now += 16 * 60;
    expect((await post(token2)).status).toBe(404);
  });

  test("a malformed body is 400 invalid_request", async () => {
    const h = await harness();
    const response = await h.app.request("/bridge/link/complete", {
      method: "POST",
      headers: { authorization: `Bearer ${BRIDGE_SECRET}`, "content-type": "application/json" },
      body: JSON.stringify({ token: 5 }),
    });
    expect(response.status).toBe(400);
  });
});

describe("rate limiting", () => {
  test("/oauth/* allows 60 requests per minute per IP then answers 429", async () => {
    const h = await harness();
    const headers = { "x-forwarded-for": "203.0.113.9, 10.0.0.1" };
    const request = form({ client_id: "simulator" });
    let last = 0;
    for (let i = 0; i < 60; i += 1) {
      last = (await h.app.request("/oauth/token", { method: "POST", headers: { ...headers, ...request.headers }, body: request.body })).status;
    }
    expect(last).toBe(400);
    const limited = await h.app.request("/oauth/token", { method: "POST", headers: { ...headers, ...request.headers }, body: request.body });
    expect(limited.status).toBe(429);
    await expect(limited.json()).resolves.toMatchObject({ error: "temporarily_unavailable" });
    const other = await h.app.request("/oauth/token", { method: "POST", headers: { "x-forwarded-for": "203.0.113.10", ...request.headers }, body: request.body });
    expect(other.status).toBe(400);
    const wellKnown = await h.app.request("/.well-known/oauth-authorization-server", { headers });
    expect(wellKnown.status).toBe(200);
  });
});

describe("error shapes", () => {
  test("token endpoint errors use RFC 6749 fields", async () => {
    const h = await harness();
    const response = await h.app.request("/oauth/token", { method: "POST", ...form({ grant_type: "password", client_id: "simulator" }) });
    expect(response.status).toBe(400);
    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["error", "error_description"]);
    expect(body.error).toBe("unsupported_grant_type");
  });
});
