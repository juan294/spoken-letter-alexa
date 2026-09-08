import { randomToken, sha256Hex } from "@spoken-letter-alexa/shared";

import { type Signer } from "./signer/types.ts";

export const ACCESS_TOKEN_TTL_SECONDS = 3600;

function base64url(input: string | Uint8Array): string {
  return Buffer.from(input).toString("base64url");
}

export type AccessTokenClaims = {
  iss: string;
  sub: string;
  aud: string;
  scope: string;
  client_id: string;
  iat: number;
  exp: number;
  jti: string;
};

/**
 * Mints an RS256 JWT access token (`typ: at+jwt`). The signer produces the raw
 * signature so KMS and the local key share this code path.
 */
export async function mintAccessToken(options: {
  signer: Signer;
  issuer: string;
  audience: string;
  subject: string;
  clientId: string;
  scope: string;
  ttlSeconds?: number;
  now?: () => number;
}): Promise<{ token: string; expiresAt: number; claims: AccessTokenClaims }> {
  const now = options.now ? options.now() : Math.floor(Date.now() / 1000);
  const ttl = options.ttlSeconds ?? ACCESS_TOKEN_TTL_SECONDS;
  const { kid } = await options.signer.publicJwk();
  const header = { alg: "RS256", typ: "at+jwt", kid };
  const claims: AccessTokenClaims = {
    iss: options.issuer,
    sub: options.subject,
    aud: options.audience,
    scope: options.scope,
    client_id: options.clientId,
    iat: now,
    exp: now + ttl,
    jti: randomToken(16),
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signature = await options.signer.sign(new TextEncoder().encode(signingInput));
  return { token: `${signingInput}.${base64url(signature)}`, expiresAt: claims.exp, claims };
}

/** Opaque refresh token: 32 random bytes, stored only as its sha256. */
export function mintRefreshToken(): { token: string; hash: string } {
  const token = randomToken(32);
  return { token, hash: sha256Hex(token) };
}

export const LINK_TOKEN_PREFIX = "sla_";

/** Link token handed to Spoken Letter's confirmation page: `sla_` + 24 random bytes. */
export function mintLinkToken(): { token: string; hash: string } {
  const token = `${LINK_TOKEN_PREFIX}${randomToken(24)}`;
  return { token, hash: sha256Hex(token) };
}
