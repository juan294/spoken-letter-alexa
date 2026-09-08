// Local development server on :4310. `pnpm -F @spoken-letter-alexa/mcp-server dev`.
import { randomBytes } from "node:crypto";
import path from "node:path";

import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { log } from "@spoken-letter-alexa/shared";
import { Hono } from "hono";

import { readServerEnv } from "./env.ts";
import { createApp } from "./http.ts";
import { FixtureProvider, loadFixtureCatalog } from "./provider/fixtures.ts";

const env = readServerEnv();
const devToken = env.MCP_DEV_TOKEN ?? randomBytes(24).toString("base64url");

const stories = await loadFixtureCatalog(env.FIXTURES_PATH).catch((error: unknown) => {
  log.warn("fixtures_missing", {
    path: env.FIXTURES_PATH,
    message: error instanceof Error ? error.message : String(error),
  });
  return [];
});

const fixtures = new FixtureProvider({ stories, publicBaseUrl: env.PUBLIC_BASE_URL });
const app = new Hono();
// `fixtures/audio/<file>` next to the catalog; Phase 6 serves the same files from S3.
const fixturesDir = path.dirname(path.resolve(env.FIXTURES_PATH));
app.use("/fixtures/audio/*", serveStatic({ root: path.dirname(fixturesDir), rewriteRequestPath: (p) => p.replace(/^\/fixtures/, `/${path.basename(fixturesDir)}`) }));
app.route("/", createApp({ publicBaseUrl: env.PUBLIC_BASE_URL, devToken, providerFor: () => fixtures }));

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  log.info("mcp_ready", {
    port: info.port,
    publicBaseUrl: env.PUBLIC_BASE_URL,
    stories: stories.length,
    devTokenSource: env.MCP_DEV_TOKEN ? "env" : "generated",
  });
  if (!env.MCP_DEV_TOKEN) {
    // The generated token is printed once so `curl` can use it. Set MCP_DEV_TOKEN to pin it.
    process.stdout.write(`MCP_DEV_TOKEN=${devToken}\n`);
  }
});
