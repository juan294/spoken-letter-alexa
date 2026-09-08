// Dev-only routes that drive the authorization-code flow without the simulator (Phase 5):
// `GET /dev/start` redirects to `/oauth/authorize` with a fresh PKCE pair, and
// `GET /dev/callback` finishes the code exchange and prints the tokens. Mounted only when
// DEV_ROUTES=1; never in the Lambda build.
import { randomToken } from "@spoken-letter-alexa/shared";
import { Hono } from "hono";

import { pkceChallenge } from "../pkce.ts";

export type DevAuthOptions = {
  issuer: string;
  clientId: string;
  /** How to reach this server's own token endpoint. */
  fetch: typeof fetch;
};

export function createDevAuthRoutes(options: DevAuthOptions): Hono {
  const app = new Hono();
  const verifiers = new Map<string, string>();
  const redirectUri = `${options.issuer}/dev/callback`;

  app.get("/dev/start", (c) => {
    const verifier = randomToken(48);
    const state = randomToken(12);
    verifiers.set(state, verifier);
    const url = new URL(`${options.issuer}/oauth/authorize`);
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: options.clientId,
      redirect_uri: redirectUri,
      code_challenge: pkceChallenge(verifier),
      code_challenge_method: "S256",
      state,
      scope: "mcp:tools mcp:resources",
    }).toString();
    return c.redirect(url.toString(), 302);
  });

  app.get("/dev/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state") ?? "";
    const error = c.req.query("error");
    if (error) return c.json({ error, error_description: c.req.query("error_description") ?? "" }, 400);
    const verifier = verifiers.get(state);
    if (!code || !verifier) return c.json({ error: "invalid_request", error_description: "unknown state or missing code" }, 400);
    verifiers.delete(state);
    const response = await options.fetch(`${options.issuer}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
        client_id: options.clientId,
      }).toString(),
    });
    const body = (await response.json()) as Record<string, unknown>;
    if (!response.ok) return c.json(body, 400);
    const accessToken = String(body.access_token);
    const claims = JSON.parse(Buffer.from(accessToken.split(".")[1] ?? "", "base64url").toString("utf8")) as { sub?: string };
    return c.json({ ...body, subject: claims.sub ?? null, redirect_uri: redirectUri }, 200, { "cache-control": "no-store" });
  });

  return app;
}
