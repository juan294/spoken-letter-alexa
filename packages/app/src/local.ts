// Local development server on :4310 (`pnpm dev` at the root also starts the simulator).
import path from "node:path";

import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { log } from "@spoken-letter-alexa/shared";
import { Hono } from "hono";

import { bootstrap } from "./bootstrap.ts";
import { readServerEnv } from "./env.ts";

const env = readServerEnv();
const { app: server, generated, stories } = await bootstrap(env, { allowGenerated: true });

const app = new Hono();
// `fixtures/audio/<file>` next to the catalog; Phase 6 serves the same files from S3.
const fixturesDir = path.dirname(path.resolve(env.FIXTURES_PATH));
app.use(
  "/fixtures/audio/*",
  serveStatic({
    root: path.dirname(fixturesDir),
    rewriteRequestPath: (p) => p.replace(/^\/fixtures/, `/${path.basename(fixturesDir)}`),
  }),
);
app.route("/", server);

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  log.info("server_ready", {
    port: info.port,
    issuer: env.PUBLIC_BASE_URL,
    spokenLetterOrigin: env.SPOKEN_LETTER_ORIGIN,
    providerMode: env.PROVIDER_MODE,
    stories,
    devRoutes: env.DEV_ROUTES === "1",
    agentOffline: env.AGENT_OFFLINE === "1",
    model: env.AGENT_OFFLINE === "1" ? null : env.BEDROCK_MODEL_ID,
    generated: Object.keys(generated),
  });
  // Generated secrets are printed once so curl and the mock bridge can use them. Set the
  // variables to pin them across restarts.
  for (const [name, value] of Object.entries({
    MCP_DEV_TOKEN: generated.devToken,
    ALEXA_BRIDGE_SECRET: generated.bridgeSecret,
    OAUTH_M2M_SECRET: generated.m2mSecret,
  })) {
    if (value) process.stdout.write(`${name}=${value}\n`);
  }
});
