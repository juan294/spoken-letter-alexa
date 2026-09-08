import {
  type AuthInfo,
  bearerAuthChallengeResponse,
  OAuthError,
  OAuthErrorCode,
  type OAuthTokenVerifier,
  requireBearerAuth,
} from "@modelcontextprotocol/server";
import { constantTimeEqual } from "@spoken-letter-alexa/shared";

export const MCP_SCOPES = ["mcp:tools", "mcp:resources"] as const;

/** A bearer gate: resolves to AuthInfo or to the ready-to-return 401/403 challenge. */
export type BearerGate = (request: Request) => Promise<AuthInfo | Response>;

export function resourceMetadataUrl(publicBaseUrl: string): string {
  return `${publicBaseUrl.replace(/\/$/, "")}/.well-known/oauth-protected-resource`;
}

/**
 * Phase 1 gate: one static development token maps to the `demo` subject. Phase 2 and 4
 * replace it with `requireBearerAuth` over the JWT verifier; the challenge response is
 * already the one Amazon's quickstart checks for.
 */
export function devTokenGate(options: { devToken: string; publicBaseUrl: string }): BearerGate {
  const challenge = { resourceMetadataUrl: resourceMetadataUrl(options.publicBaseUrl) };
  return (request) => {
    const header = request.headers.get("authorization") ?? "";
    const match = /^Bearer\s+(\S+)$/i.exec(header);
    if (!match?.[1] || !constantTimeEqual(match[1], options.devToken)) {
      return Promise.resolve(
        bearerAuthChallengeResponse(new OAuthError(OAuthErrorCode.InvalidToken, "Invalid or missing bearer token"), challenge),
      );
    }
    return Promise.resolve({
      token: match[1],
      clientId: "dev",
      scopes: [...MCP_SCOPES],
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      extra: { subject: "demo" },
    });
  };
}

/** Scopes that open `/mcp`: the parent's link (`mcp:tools`) or the AgentCore Gateway's service tier. */
export const MCP_ACCESS_SCOPES = ["mcp:tools", "mcp:service"] as const;

/**
 * Phase 4 gate: `requireBearerAuth` over the JWT verifier. Any of `MCP_ACCESS_SCOPES`
 * is enough (the SDK's `requiredScopes` demands all of them, which would lock out the
 * client_credentials tier, so the scope check is explicit here).
 */
export function jwtGate(options: { verifier: OAuthTokenVerifier; publicBaseUrl: string }): BearerGate {
  const challenge = { resourceMetadataUrl: resourceMetadataUrl(options.publicBaseUrl) };
  const gate = requireBearerAuth({ verifier: options.verifier, ...challenge });
  return async (request) => {
    const auth = await gate(request);
    if (auth instanceof Response) return auth;
    if (!auth.scopes.some((scope) => (MCP_ACCESS_SCOPES as readonly string[]).includes(scope))) {
      return bearerAuthChallengeResponse(
        new OAuthError(OAuthErrorCode.InsufficientScope, `Token needs one of ${MCP_ACCESS_SCOPES.join(", ")}`),
        { ...challenge, requiredScopes: [...MCP_ACCESS_SCOPES] },
      );
    }
    return auth;
  };
}

/** Tries each gate in order; the first non-challenge wins, otherwise the last challenge is returned. */
export function firstGate(gates: BearerGate[]): BearerGate {
  return async (request) => {
    let last: Response | undefined;
    for (const gate of gates) {
      const result = await gate(request);
      if (!(result instanceof Response)) return result;
      last = result;
    }
    return last ?? new Response("Unauthorized", { status: 401 });
  };
}

/** Reads the subject bound by the gate. Every gate stores it under `extra.subject`. */
export function subjectFromAuth(ctx: {
  http?: { authInfo?: { extra?: Record<string, unknown> | undefined } | undefined } | undefined;
}): string {
  const subject = ctx.http?.authInfo?.extra?.subject;
  if (typeof subject !== "string" || subject.length === 0) {
    throw new OAuthError(OAuthErrorCode.InvalidToken, "Token carries no subject");
  }
  return subject;
}
