import { type AuthInfo, OAuthError, OAuthErrorCode, type OAuthTokenVerifier } from "@modelcontextprotocol/server";
import { createLocalJWKSet, createRemoteJWKSet, customFetch, type JSONWebKeySet, type JWTPayload, type JWTVerifyGetKey, jwtVerify } from "jose";

export type JwtVerifierOptions = {
  issuer: string;
  audience: string;
  /** Static key set (tests, single-process dev). */
  jwks?: JSONWebKeySet | undefined;
  /** Remote key set URL (`/.well-known/jwks.json`); fetched and cached by jose. */
  jwksUrl?: string | undefined;
  fetch?: typeof fetch | undefined;
};

/**
 * `OAuthTokenVerifier` for `requireBearerAuth`. Rejects issuer mismatch (RFC 9207
 * posture), wrong audience, expiry, unknown `kid` and bad signatures with
 * `invalid_token`, which the bearer helpers turn into the RFC 9728 challenge.
 */
export function createJwtVerifier(options: JwtVerifierOptions): OAuthTokenVerifier {
  const keySet: JWTVerifyGetKey | undefined = options.jwks
    ? createLocalJWKSet(options.jwks)
    : options.jwksUrl
      ? createRemoteJWKSet(new URL(options.jwksUrl), options.fetch ? { [customFetch]: options.fetch } : {})
      : undefined;
  if (!keySet) throw new Error("createJwtVerifier needs jwks or jwksUrl");

  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      let payload: JWTPayload;
      try {
        ({ payload } = await jwtVerify(token, keySet, {
          issuer: options.issuer,
          audience: options.audience,
          algorithms: ["RS256"],
          typ: "at+jwt",
        }));
      } catch (error) {
        throw new OAuthError(OAuthErrorCode.InvalidToken, error instanceof Error ? error.message : "invalid token");
      }
      const { sub, exp, scope, client_id: clientId } = payload;
      if (typeof sub !== "string" || typeof exp !== "number" || typeof scope !== "string" || typeof clientId !== "string") {
        throw new OAuthError(OAuthErrorCode.InvalidToken, "token is missing required claims");
      }
      return {
        token,
        clientId,
        scopes: scope.split(" ").filter(Boolean),
        expiresAt: exp,
        resource: new URL(options.audience),
        extra: { subject: sub },
      };
    },
  };
}
