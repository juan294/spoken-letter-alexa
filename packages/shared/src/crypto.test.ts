import { describe, expect, test } from "vitest";

import { constantTimeEqual, hmacSha256Hex, randomToken, sha256Base64Url, sha256Hex } from "./crypto.ts";

describe("constantTimeEqual", () => {
  test("is true only for identical strings", () => {
    expect(constantTimeEqual("same-value", "same-value")).toBe(true);
    expect(constantTimeEqual("same-value", "same-valuf")).toBe(false);
    expect(constantTimeEqual("short", "much longer")).toBe(false);
    expect(constantTimeEqual("", "")).toBe(true);
  });

  test("handles multi-byte input without throwing", () => {
    expect(constantTimeEqual("ñ", "ñ")).toBe(true);
    expect(constantTimeEqual("ñ", "n")).toBe(false);
  });
});

describe("digests", () => {
  test("sha256Hex matches the FIPS 180-2 test vector for 'abc'", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  test("sha256Base64Url is the PKCE S256 transform (RFC 7636 appendix B)", () => {
    expect(sha256Base64Url("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  test("hmacSha256Hex is keyed", () => {
    expect(hmacSha256Hex("key-one", "value")).not.toBe(hmacSha256Hex("key-two", "value"));
    expect(hmacSha256Hex("key-one", "value")).toHaveLength(64);
  });

  test("randomToken is base64url of the requested byte length", () => {
    const token = randomToken(24);
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(randomToken(24)).not.toBe(token);
  });
});
