import { OAuthError } from "@modelcontextprotocol/server";
import { describe, expect, test } from "vitest";

import { LocalSigner } from "./signer/local.ts";
import { mintAccessToken } from "./tokens.ts";
import { createJwtVerifier } from "./verify.ts";

const ISSUER = "https://alexa.spokenletter.com";
const AUDIENCE = `${ISSUER}/mcp`;

describe("createJwtVerifier", () => {
  test("accepts a token from the local signer and maps it to AuthInfo", async () => {
    const signer = await LocalSigner.create();
    const verifier = createJwtVerifier({ jwks: { keys: [await signer.publicJwk()] }, issuer: ISSUER, audience: AUDIENCE });
    const { token, expiresAt } = await mintAccessToken({
      signer,
      issuer: ISSUER,
      audience: AUDIENCE,
      subject: "uid_1",
      clientId: "alexa",
      scope: "mcp:tools mcp:resources",
      ttlSeconds: 3600,
    });
    const info = await verifier.verifyAccessToken(token);
    expect(info).toMatchObject({
      token,
      clientId: "alexa",
      scopes: ["mcp:tools", "mcp:resources"],
      expiresAt,
      extra: { subject: "uid_1" },
    });
  });

  test.each([
    { name: "issuer mismatch", mint: { issuer: "https://evil.example" }, verify: {} },
    { name: "audience mismatch", mint: { audience: "https://other.example/mcp" }, verify: {} },
    { name: "expired", mint: { ttlSeconds: -10 }, verify: {} },
    { name: "unknown kid", mint: {}, verify: { otherKey: true } },
    { name: "tampered signature", mint: { tamper: true }, verify: {} },
  ])("rejects $name with invalid_token", async ({ mint, verify }) => {
    const signer = await LocalSigner.create();
    const keySigner = verify.otherKey ? await LocalSigner.create() : signer;
    const verifier = createJwtVerifier({ jwks: { keys: [await keySigner.publicJwk()] }, issuer: ISSUER, audience: AUDIENCE });
    const minted = await mintAccessToken({
      signer,
      issuer: mint.issuer ?? ISSUER,
      audience: mint.audience ?? AUDIENCE,
      subject: "uid_1",
      clientId: "alexa",
      scope: "mcp:tools",
      ttlSeconds: mint.ttlSeconds ?? 3600,
    });
    const token = mint.tamper ? `${minted.token.slice(0, -4)}AAAA` : minted.token;
    await expect(verifier.verifyAccessToken(token)).rejects.toSatisfy(
      (error: unknown) => error instanceof OAuthError && error.code === "invalid_token",
    );
  });

  test("fetches a remote JWKS when given a URL", async () => {
    const signer = await LocalSigner.create();
    const jwks = { keys: [await signer.publicJwk()] };
    const fetchImpl: typeof fetch = () => Promise.resolve(new Response(JSON.stringify(jwks), { headers: { "content-type": "application/json" } }));
    const verifier = createJwtVerifier({ jwksUrl: `${ISSUER}/.well-known/jwks.json`, issuer: ISSUER, audience: AUDIENCE, fetch: fetchImpl });
    const { token } = await mintAccessToken({ signer, issuer: ISSUER, audience: AUDIENCE, subject: "demo", clientId: "simulator", scope: "mcp:tools", ttlSeconds: 60 });
    await expect(verifier.verifyAccessToken(token)).resolves.toMatchObject({ extra: { subject: "demo" } });
  });
});
