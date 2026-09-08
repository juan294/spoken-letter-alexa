import { describe, expect, test } from "vitest";

import { pkceChallenge, verifyPkce } from "./pkce.ts";

// RFC 7636 appendix B vector.
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

describe("PKCE S256", () => {
  test("derives the RFC 7636 challenge", () => {
    expect(pkceChallenge(VERIFIER)).toBe(CHALLENGE);
  });

  test("accepts the matching verifier and rejects everything else", () => {
    expect(verifyPkce(VERIFIER, CHALLENGE)).toBe(true);
    expect(verifyPkce(`${VERIFIER}x`, CHALLENGE)).toBe(false);
    expect(verifyPkce("", CHALLENGE)).toBe(false);
  });

  test("rejects verifiers outside the RFC 7636 length and alphabet", () => {
    const short = "a".repeat(42);
    expect(verifyPkce(short, pkceChallenge(short))).toBe(false);
    const long = "a".repeat(129);
    expect(verifyPkce(long, pkceChallenge(long))).toBe(false);
    const bad = `${"a".repeat(42)}!`;
    expect(verifyPkce(bad, pkceChallenge(bad))).toBe(false);
  });
});
