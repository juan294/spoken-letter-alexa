// Lambda entry point (Phase 6 wires the function URL with RESPONSE_STREAM). Secrets and
// clients come from the environment CDK fills from Secrets Manager; nothing is generated
// here and the dev routes are never mounted.
import { streamHandle } from "hono/aws-lambda";

import { bootstrap } from "./bootstrap.ts";
import { readServerEnv } from "./env.ts";

const env = readServerEnv();
if (env.DEV_ROUTES === "1") throw new Error("DEV_ROUTES must not be enabled on Lambda");
if (env.AGENT_OFFLINE === "1") throw new Error("AGENT_OFFLINE must not be enabled on Lambda");

const { app } = await bootstrap(env, { allowGenerated: false });

export { app };
export const handler = streamHandle(app);
