import { describe, expect, it, vi } from "vitest";
import { buildAuthorizeUrl, challengeFor, exchangeCode, generateVerifier, randomState } from "./pkce.ts";

const BASE64URL = /^[A-Za-z0-9_-]+$/;

describe("PKCE helpers", () => {
  it("generates a 43-character base64url verifier from 32 random bytes", () => {
    const verifier = generateVerifier();
    expect(verifier).toHaveLength(43);
    expect(verifier).toMatch(BASE64URL);
    expect(generateVerifier()).not.toBe(verifier);
  });

  it("derives the S256 challenge of RFC 7636 appendix B", async () => {
    await expect(challengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).resolves.toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("produces a base64url state", () => {
    expect(randomState()).toMatch(BASE64URL);
    expect(randomState().length).toBeGreaterThanOrEqual(16);
  });

  it("builds the authorize URL for the public simulator client", () => {
    const url = new URL(
      buildAuthorizeUrl({
        origin: "http://localhost:5173",
        redirectUri: "http://localhost:5173/demo/callback",
        challenge: "abc",
        state: "xyz",
      }),
    );
    expect(url.origin + url.pathname).toBe("http://localhost:5173/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: "simulator",
      redirect_uri: "http://localhost:5173/demo/callback",
      code_challenge: "abc",
      code_challenge_method: "S256",
      state: "xyz",
      scope: "mcp:tools mcp:resources",
    });
  });

  it("exchanges the code with a form-encoded token request", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        Response.json({ access_token: "jwt", token_type: "Bearer", expires_in: 900, refresh_token: "r", scope: "mcp:tools" }),
      ),
    );
    const tokens = await exchangeCode({
      origin: "http://localhost:5173",
      code: "c0de",
      verifier: "v",
      redirectUri: "http://localhost:5173/demo/callback",
      fetchImpl,
    });
    expect(tokens.access_token).toBe("jwt");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:5173/oauth/token");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("content-type")).toBe("application/x-www-form-urlencoded");
    expect(Object.fromEntries(new URLSearchParams(init.body as string))).toEqual({
      grant_type: "authorization_code",
      code: "c0de",
      code_verifier: "v",
      redirect_uri: "http://localhost:5173/demo/callback",
      client_id: "simulator",
    });
  });

  it("surfaces the token endpoint error description", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(Response.json({ error: "invalid_grant", error_description: "code expired" }, { status: 400 })),
    );
    await expect(
      exchangeCode({ origin: "http://x", code: "c", verifier: "v", redirectUri: "http://x/demo/callback", fetchImpl }),
    ).rejects.toThrow("code expired");
  });
});
