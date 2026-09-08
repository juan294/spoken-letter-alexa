import { sha256Hex } from "@spoken-letter-alexa/shared";
import { describe, expect, test } from "vitest";

import { LocalSigner } from "./signer/local.ts";
import { LINK_TOKEN_PREFIX, mintAccessToken, mintLinkToken, mintRefreshToken } from "./tokens.ts";

function decode(part: string | undefined): Record<string, unknown> {
  return JSON.parse(Buffer.from(part ?? "", "base64url").toString("utf8")) as Record<string, unknown>;
}

describe("mintAccessToken", () => {
  test("produces an RS256 at+jwt with the planned claim set", async () => {
    const signer = await LocalSigner.create();
    const { token, expiresAt, claims } = await mintAccessToken({
      signer,
      issuer: "https://alexa.spokenletter.com",
      audience: "https://alexa.spokenletter.com/mcp",
      subject: "uid_1",
      clientId: "alexa",
      scope: "mcp:tools mcp:resources",
      ttlSeconds: 3600,
      now: () => 1_800_000_000,
    });
    const [header, payload, signature] = token.split(".");
    expect(decode(header)).toEqual({ alg: "RS256", typ: "at+jwt", kid: signer.kid });
    expect(decode(payload)).toEqual({
      iss: "https://alexa.spokenletter.com",
      sub: "uid_1",
      aud: "https://alexa.spokenletter.com/mcp",
      scope: "mcp:tools mcp:resources",
      client_id: "alexa",
      iat: 1_800_000_000,
      exp: 1_800_003_600,
      jti: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/) as string,
    });
    expect(expiresAt).toBe(1_800_003_600);
    expect(claims.exp).toBe(expiresAt);
    expect(signature).toMatch(/^[A-Za-z0-9_-]{300,}$/);
  });
});

describe("opaque tokens", () => {
  test("refresh tokens are 32 random bytes stored as sha256", () => {
    const { token, hash } = mintRefreshToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toBe(sha256Hex(token));
    expect(mintRefreshToken().token).not.toBe(token);
  });

  test("link tokens carry the sla_ prefix and 24 random bytes", () => {
    const { token, hash } = mintLinkToken();
    expect(token.startsWith(LINK_TOKEN_PREFIX)).toBe(true);
    expect(token).toMatch(/^sla_[A-Za-z0-9_-]{32}$/);
    expect(hash).toBe(sha256Hex(token));
  });
});
