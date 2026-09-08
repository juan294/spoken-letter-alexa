import { constantTimeEqual, sha256Base64Url } from "@spoken-letter-alexa/shared";

/** RFC 7636 section 4.1: 43 to 128 unreserved characters. */
const VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/;
const CHALLENGE_RE = /^[A-Za-z0-9\-_]{43}$/;

export function isValidChallenge(challenge: string): boolean {
  return CHALLENGE_RE.test(challenge);
}

export function pkceChallenge(verifier: string): string {
  return sha256Base64Url(verifier);
}

/** S256 only; `plain` is never accepted. */
export function verifyPkce(verifier: string, challenge: string): boolean {
  if (!VERIFIER_RE.test(verifier)) return false;
  return constantTimeEqual(pkceChallenge(verifier), challenge);
}
