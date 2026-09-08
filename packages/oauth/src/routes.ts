import { constantTimeEqual, hmacSha256Hex, log, randomToken, sha256Hex } from "@spoken-letter-alexa/shared";
import { type Context, Hono } from "hono";
import { z } from "zod";

import { authenticateClient, findClient, type StaticClient } from "./clients.ts";
import { authorizationServerMetadata, MCP_SCOPES, SERVICE_SCOPE } from "./metadata.ts";
import { isValidChallenge, verifyPkce } from "./pkce.ts";
import { TokenBucket } from "./rate-limit.ts";
import { type Signer } from "./signer/types.ts";
import { LINK_TOKEN_TTL_SECONDS, type OAuthStore, REFRESH_TTL_SECONDS } from "./store/types.ts";
import { ACCESS_TOKEN_TTL_SECONDS, mintAccessToken, mintLinkToken, mintRefreshToken } from "./tokens.ts";

export type OAuthDeps = {
  /** `https://alexa.spokenletter.com` in production, `http://localhost:4310` locally. */
  issuer: string;
  /** Spoken Letter origin that hosts `/link/alexa/<token>`. */
  spokenLetterOrigin: string;
  /** Shared with the private Spoken Letter API; authenticates `/bridge/*`. */
  bridgeSecret: string;
  clients: StaticClient[];
  store: OAuthStore;
  signer: Signer;
  /** Epoch seconds. */
  now?: (() => number) | undefined;
  rateLimit?: TokenBucket | undefined;
};

const CONTINUE_TTL_SECONDS = 5 * 60;
const NO_STORE = { "cache-control": "no-store", pragma: "no-cache" } as const;

type OAuthErrorCode =
  | "invalid_request"
  | "invalid_client"
  | "invalid_grant"
  | "unauthorized_client"
  | "unsupported_grant_type"
  | "invalid_scope"
  | "invalid_token"
  | "not_found"
  | "temporarily_unavailable";

function oauthError(c: Context, status: 400 | 401 | 404 | 429, error: OAuthErrorCode, description: string, headers: Record<string, string> = {}) {
  return c.json({ error, error_description: description }, status, { ...NO_STORE, ...headers });
}

/**
 * Rate-limit key. Behind CloudFront the trustworthy address is `CloudFront-Viewer-Address`
 * (`ip:port`, set by the edge); the last `X-Forwarded-For` hop is the fallback because
 * CloudFront appends the viewer address while a viewer can forge earlier entries.
 */
function clientIp(c: Context): string {
  const viewer = c.req.header("cloudfront-viewer-address");
  if (viewer) return viewer.replace(/:\d+$/, "");
  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded === undefined) return "local";
  const last = forwarded.split(",").at(-1)?.trim();
  if (last) return last;
  return "unknown";
}

/** Parses `Authorization: Basic` or the `client_id`/`client_secret` form fields. */
function clientCredentials(c: Context, body: URLSearchParams): { clientId: string; secret: string | undefined; viaBasic: boolean } | null {
  const header = c.req.header("authorization") ?? "";
  const basic = /^Basic\s+(\S+)$/i.exec(header);
  if (basic?.[1]) {
    const decoded = Buffer.from(basic[1], "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator < 0) return null;
    try {
      return {
        clientId: decodeURIComponent(decoded.slice(0, separator)),
        secret: decodeURIComponent(decoded.slice(separator + 1)),
        viaBasic: true,
      };
    } catch {
      return null; // malformed percent-encoding (RFC 6749 section 2.3.1 requires it)
    }
  }
  const clientId = body.get("client_id");
  if (!clientId) return null;
  return { clientId, secret: body.get("client_secret") ?? undefined, viaBasic: false };
}

function scopeSubset(requested: string | null, allowed: readonly string[]): string | null {
  const scopes = (requested ?? "").split(" ").filter(Boolean);
  if (scopes.length === 0) return allowed.join(" ");
  if (scopes.some((scope) => !allowed.includes(scope))) return null;
  return [...new Set(scopes)].join(" ");
}

const bridgeCompleteSchema = z.object({ token: z.string().min(1).max(200), subject: z.string().min(1).max(200) });
const bridgeRevokeSchema = z.object({ subject: z.string().min(1).max(200) });

export function createOAuthApp(deps: OAuthDeps): Hono {
  const app = new Hono();
  app.onError((error, c) => {
    log.error("oauth_unhandled", { path: c.req.path, message: error.message });
    return c.json({ error: "server_error", error_description: "The authorization server hit an internal error" }, 500, NO_STORE);
  });
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000));
  const bucket = deps.rateLimit ?? new TokenBucket({ limit: 60, windowMs: 60_000 });
  const audience = `${deps.issuer}/mcp`;

  const continueSignature = (authId: string, exp: number) => hmacSha256Hex(deps.bridgeSecret, `${authId}.${exp}`);

  const bridgeGate = (c: Context): Response | null => {
    const header = c.req.header("authorization") ?? "";
    const match = /^Bearer\s+(\S+)$/i.exec(header);
    if (!match?.[1] || !constantTimeEqual(match[1], deps.bridgeSecret)) {
      return oauthError(c, 401, "invalid_token", "Bridge secret required", { "www-authenticate": 'Bearer realm="bridge"' });
    }
    return null;
  };

  const issueTokens = async (subject: string, client: StaticClient, scope: string, familyId: string, rotatedFrom?: string) => {
    const access = await mintAccessToken({ signer: deps.signer, issuer: deps.issuer, audience, subject, clientId: client.clientId, scope, now });
    const refresh = mintRefreshToken();
    await deps.store.putRefreshToken({
      hash: refresh.hash,
      subject,
      scope,
      clientId: client.clientId,
      familyId,
      expiresAt: now() + REFRESH_TTL_SECONDS,
      rotatedFrom,
    });
    return { access_token: access.token, token_type: "Bearer", expires_in: ACCESS_TOKEN_TTL_SECONDS, refresh_token: refresh.token, scope };
  };

  app.use("/oauth/*", async (c: Context, next) => {
    if (!bucket.take(clientIp(c))) {
      return oauthError(c, 429, "temporarily_unavailable", "Too many requests; retry in a minute", { "retry-after": "60" });
    }
    await next();
  });

  app.get("/.well-known/oauth-authorization-server", (c) => c.json(authorizationServerMetadata(deps.issuer)));
  app.get("/.well-known/jwks.json", async (c) => c.json({ keys: [await deps.signer.publicJwk()] }, 200, { "cache-control": "public, max-age=300" }));

  app.all("/oauth/register", (c) => oauthError(c, 404, "invalid_request", "Dynamic client registration is not supported"));

  app.get("/oauth/authorize", async (c) => {
    const q = (name: string) => c.req.query(name) ?? "";
    const client = findClient(deps.clients, q("client_id"));
    // Errors before the redirect_uri is trusted must never redirect (RFC 6749 section 4.1.2.1).
    if (!client?.grants.includes("authorization_code")) {
      return c.text("Spoken Letter for Alexa+: unknown client. Nothing was linked.", 400, NO_STORE);
    }
    const redirectUri = q("redirect_uri");
    if (!client.redirectUris.includes(redirectUri)) {
      return c.text("Spoken Letter for Alexa+: the redirect address is not registered for this client. Nothing was linked.", 400, NO_STORE);
    }
    const state = q("state");
    const redirectError = (error: "invalid_request" | "invalid_scope", description: string) => {
      const target = new URL(redirectUri);
      target.searchParams.set("error", error);
      target.searchParams.set("error_description", description);
      if (state) target.searchParams.set("state", state);
      return c.redirect(target.toString(), 302);
    };
    if (q("response_type") !== "code") return redirectError("invalid_request", "response_type must be code");
    if (!isValidChallenge(q("code_challenge"))) return redirectError("invalid_request", "code_challenge (S256) is required");
    if (q("code_challenge_method") !== "S256") return redirectError("invalid_request", "code_challenge_method must be S256");
    if (!state) return redirectError("invalid_request", "state is required");
    const scope = scopeSubset(c.req.query("scope") ?? null, MCP_SCOPES);
    if (scope === null) return redirectError("invalid_scope", `scope must be a subset of ${MCP_SCOPES.join(" ")}`);

    const link = mintLinkToken();
    const id = randomToken(16);
    await deps.store.putPendingAuth({
      id,
      clientId: client.clientId,
      redirectUri,
      codeChallenge: q("code_challenge"),
      codeChallengeMethod: "S256",
      state,
      scope,
      status: "pending",
      linkTokenHash: link.hash,
      createdAt: now(),
      expiresAt: now() + LINK_TOKEN_TTL_SECONDS,
    });
    log.info("oauth_authorize", { clientId: client.clientId, authId: id });
    return c.redirect(`${deps.spokenLetterOrigin}/link/alexa/${link.token}`, 302);
  });

  app.post("/bridge/link/complete", async (c) => {
    const denied = bridgeGate(c);
    if (denied) return denied;
    const parsed = bridgeCompleteSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return oauthError(c, 400, "invalid_request", "token and subject are required");
    const auth = await deps.store.leaseLinkToken(sha256Hex(parsed.data.token));
    if (!auth) return oauthError(c, 404, "not_found", "Link token unknown, used or expired");
    await deps.store.bindSubject(auth.id, parsed.data.subject);
    const exp = now() + CONTINUE_TTL_SECONDS;
    const url = new URL(`${deps.issuer}/oauth/continue`);
    url.searchParams.set("auth", auth.id);
    url.searchParams.set("exp", String(exp));
    url.searchParams.set("sig", continueSignature(auth.id, exp));
    log.info("bridge_link_complete", { authId: auth.id });
    return c.json({ continueUrl: url.toString() }, 200, NO_STORE);
  });

  app.get("/oauth/continue", async (c) => {
    const authId = c.req.query("auth") ?? "";
    const exp = Number(c.req.query("exp") ?? "0");
    const sig = c.req.query("sig") ?? "";
    if (!authId || !Number.isFinite(exp) || exp <= now() || !constantTimeEqual(sig, continueSignature(authId, exp))) {
      return c.text("Spoken Letter for Alexa+: this link has expired. Start again from Alexa.", 400, NO_STORE);
    }
    const auth = await deps.store.getPendingAuth(authId);
    if (auth?.status !== "linked" || !auth.subject || auth.expiresAt <= now()) {
      return c.text("Spoken Letter for Alexa+: this link has already been used. Start again from Alexa.", 400, NO_STORE);
    }
    const code = await deps.store.issueCode(auth.id);
    if (!code) {
      return c.text("Spoken Letter for Alexa+: this link has already been used. Start again from Alexa.", 400, NO_STORE);
    }
    const target = new URL(auth.redirectUri);
    target.searchParams.set("code", code);
    target.searchParams.set("state", auth.state);
    return c.redirect(target.toString(), 302);
  });

  app.post("/oauth/token", async (c) => {
    const body = new URLSearchParams(await c.req.text());
    const credentials = clientCredentials(c, body);
    const client = credentials ? authenticateClient(deps.clients, credentials.clientId, credentials.secret) : null;
    if (!client) {
      return oauthError(c, 401, "invalid_client", "Client authentication failed", { "www-authenticate": 'Basic realm="oauth"' });
    }
    const grantType = body.get("grant_type");
    if (!grantType) return oauthError(c, 400, "invalid_request", "grant_type is required");

    if (grantType === "authorization_code") {
      if (!client.grants.includes("authorization_code")) return oauthError(c, 400, "unauthorized_client", "Grant not allowed for this client");
      const code = body.get("code");
      const verifier = body.get("code_verifier");
      const redirectUri = body.get("redirect_uri");
      if (!code || !verifier || !redirectUri) return oauthError(c, 400, "invalid_request", "code, code_verifier and redirect_uri are required");
      const consumed = await deps.store.consumeCode(sha256Hex(code));
      if (consumed.status === "reused") {
        await deps.store.revokeFamily(consumed.familyId);
        log.warn("oauth_code_reuse", { familyId: consumed.familyId });
        return oauthError(c, 400, "invalid_grant", "Authorization code already used; its tokens are revoked");
      }
      if (consumed.status === "missing") return oauthError(c, 400, "invalid_grant", "Authorization code unknown or expired");
      const { auth } = consumed;
      if (auth.clientId !== client.clientId || auth.redirectUri !== redirectUri || !auth.subject) {
        return oauthError(c, 400, "invalid_grant", "Authorization code does not match this client");
      }
      if (!verifyPkce(verifier, auth.codeChallenge)) return oauthError(c, 400, "invalid_grant", "code_verifier does not match");
      return c.json(await issueTokens(auth.subject, client, auth.scope, auth.id), 200, NO_STORE);
    }

    if (grantType === "refresh_token") {
      if (!client.grants.includes("refresh_token")) return oauthError(c, 400, "unauthorized_client", "Grant not allowed for this client");
      const refreshToken = body.get("refresh_token");
      if (!refreshToken) return oauthError(c, 400, "invalid_request", "refresh_token is required");
      const hash = sha256Hex(refreshToken);
      const rotated = await deps.store.rotateRefreshToken(hash);
      if (rotated.status === "reused") {
        await deps.store.revokeFamily(rotated.familyId);
        log.warn("oauth_refresh_reuse", { familyId: rotated.familyId });
        return oauthError(c, 400, "invalid_grant", "Refresh token already rotated; its family is revoked");
      }
      if (rotated.status === "missing") return oauthError(c, 400, "invalid_grant", "Refresh token unknown, expired or revoked");
      if (rotated.record.clientId !== client.clientId) {
        await deps.store.revokeFamily(rotated.record.familyId);
        return oauthError(c, 400, "invalid_grant", "Refresh token was issued to another client");
      }
      const scope = scopeSubset(body.get("scope"), rotated.record.scope.split(" "));
      if (scope === null) return oauthError(c, 400, "invalid_scope", "Requested scope exceeds the original grant");
      return c.json(await issueTokens(rotated.record.subject, client, scope, rotated.record.familyId, hash), 200, NO_STORE);
    }

    if (grantType === "client_credentials") {
      if (!client.grants.includes("client_credentials")) return oauthError(c, 400, "unauthorized_client", "Grant not allowed for this client");
      const allowed = client.scope ?? SERVICE_SCOPE;
      const scope = scopeSubset(body.get("scope"), allowed.split(" "));
      if (scope === null) return oauthError(c, 400, "invalid_scope", `scope must be ${allowed}`);
      const access = await mintAccessToken({
        signer: deps.signer,
        issuer: deps.issuer,
        audience,
        subject: `svc:${client.clientId}`,
        clientId: client.clientId,
        scope,
        now,
      });
      return c.json({ access_token: access.token, token_type: "Bearer", expires_in: ACCESS_TOKEN_TTL_SECONDS, scope }, 200, NO_STORE);
    }

    return oauthError(c, 400, "unsupported_grant_type", `grant_type ${grantType} is not supported`);
  });

  app.post("/oauth/revoke", async (c) => {
    const body = new URLSearchParams(await c.req.text());
    const credentials = clientCredentials(c, body);
    const client = credentials ? authenticateClient(deps.clients, credentials.clientId, credentials.secret) : null;
    if (!client) {
      return oauthError(c, 401, "invalid_client", "Client authentication failed", { "www-authenticate": 'Basic realm="oauth"' });
    }
    const token = body.get("token");
    if (!token) return oauthError(c, 400, "invalid_request", "token is required");
    // RFC 7009 section 2.1: only a token issued to the authenticating client is revoked.
    // Unknown tokens, other clients' tokens and access tokens (not revocable) still answer 200.
    const hash = sha256Hex(token);
    const record = await deps.store.peekRefreshToken(hash);
    if (record?.clientId === client.clientId) await deps.store.revokeRefreshToken(hash);
    return c.body(null, 200, NO_STORE);
  });

  app.post("/bridge/link/revoke", async (c) => {
    const denied = bridgeGate(c);
    if (denied) return denied;
    const parsed = bridgeRevokeSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return oauthError(c, 400, "invalid_request", "subject is required");
    await deps.store.revokeSubject(parsed.data.subject);
    log.info("bridge_link_revoke", {});
    return c.json({ revoked: true }, 200, NO_STORE);
  });

  return app;
}
