// Lambda entry point (Phase 6 wires the function URL with RESPONSE_STREAM). Phase 1
// exports the streaming handler over the same app the local server uses; Phase 6 mounts
// oauth and agent on this app and reads secrets at cold start.
import { log } from "@spoken-letter-alexa/shared";
import { streamHandle } from "hono/aws-lambda";

import { readServerEnv } from "./env.ts";
import { createApp } from "./http.ts";
import { FixtureProvider, loadFixtureCatalog } from "./provider/fixtures.ts";

const env = readServerEnv();
const stories = await loadFixtureCatalog(env.FIXTURES_PATH).catch((error: unknown) => {
  log.warn("fixtures_missing", { path: env.FIXTURES_PATH, message: error instanceof Error ? error.message : String(error) });
  return [];
});
const fixtures = new FixtureProvider({ stories, publicBaseUrl: env.PUBLIC_BASE_URL });

if (!env.MCP_DEV_TOKEN) throw new Error("MCP_DEV_TOKEN is required until Phase 2 wires the JWT verifier");

export const app = createApp({ publicBaseUrl: env.PUBLIC_BASE_URL, devToken: env.MCP_DEV_TOKEN, providerFor: () => fixtures });

export const handler = streamHandle(app);
