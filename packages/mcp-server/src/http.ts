import { type AuthInfo } from "@modelcontextprotocol/server";
import { Hono } from "hono";

import { type BearerGate, devTokenGate, MCP_SCOPES } from "./auth.ts";
import { type ProviderResolver } from "./provider/types.ts";
import { createHandler, SERVER_VERSION } from "./server.ts";
import { type SuggestionMemory } from "./tools/suggest.ts";

export type AppDeps = {
  /** Public origin of this deployment, e.g. `https://alexa.spokenletter.com` or `http://localhost:4310`. */
  publicBaseUrl: string;
  providerFor: ProviderResolver;
  /** Phase 1 static development token. Ignored when `bearerGate` is supplied (Phase 2/4). */
  devToken?: string | undefined;
  bearerGate?: BearerGate | undefined;
  suggestions?: SuggestionMemory | undefined;
};

/** RFC 9728 Protected Resource Metadata. Phase 1: the issuer is this host (Phase 2 mounts it). */
export function protectedResourceMetadata(publicBaseUrl: string) {
  const base = publicBaseUrl.replace(/\/$/, "");
  return {
    resource: `${base}/mcp`,
    authorization_servers: [base],
    bearer_methods_supported: ["header"],
    scopes_supported: [...MCP_SCOPES],
    resource_name: "Spoken Letter for Alexa+",
  };
}

/**
 * Builds the Hono app: bearer-gated `/mcp`, the PRM document and a health probe.
 * `createApp` is deterministic given its deps so tests drive it with `app.request()`.
 */
export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  const gate: BearerGate =
    deps.bearerGate ??
    (() => {
      if (!deps.devToken) throw new Error("createApp needs a bearerGate or a devToken");
      return devTokenGate({ devToken: deps.devToken, publicBaseUrl: deps.publicBaseUrl });
    })();
  const mcp = createHandler({ providerFor: deps.providerFor, ...(deps.suggestions && { suggestions: deps.suggestions }) });
  const prm = protectedResourceMetadata(deps.publicBaseUrl);

  app.get("/healthz", (c) => c.json({ ok: true, name: "spoken-letter", version: SERVER_VERSION }));
  app.get("/.well-known/oauth-protected-resource", (c) => c.json(prm));
  app.get("/.well-known/oauth-protected-resource/mcp", (c) => c.json(prm));

  app.all("/mcp", async (c) => {
    const auth: AuthInfo | Response = await gate(c.req.raw);
    if (auth instanceof Response) return auth;
    return mcp.fetch(c.req.raw, { authInfo: auth });
  });

  return app;
}
