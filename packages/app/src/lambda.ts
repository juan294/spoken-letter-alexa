// Lambda entry point (Phase 6 wires the function URL with RESPONSE_STREAM). Secrets and
// clients come from the environment CDK fills from Secrets Manager; nothing is generated
// here and the dev routes are never mounted.
import { streamHandle } from "hono/aws-lambda";

import { bootstrap } from "./bootstrap.ts";
import { readServerEnv } from "./env.ts";
import { gateStreamingHandler, type HeaderedEvent, type StreamingHandler, type StreamingRuntime } from "./forwarded-auth.ts";

const env = readServerEnv();
if (env.DEV_ROUTES === "1") throw new Error("DEV_ROUTES must not be enabled on Lambda");
if (env.AGENT_OFFLINE === "1") throw new Error("AGENT_OFFLINE must not be enabled on Lambda");

const originVerifySecret = process.env.ORIGIN_VERIFY_SECRET;
if (!originVerifySecret) throw new Error("ORIGIN_VERIFY_SECRET is required on Lambda (loaded from sla/origin-verify)");

const { app } = await bootstrap(env, { allowGenerated: false });

/** Provided by the Node.js Lambda runtime when the function URL uses RESPONSE_STREAM. */
declare const awslambda: StreamingRuntime;

export { app };
/**
 * The function URL handler. The URL is public (D18): a request without CloudFront's
 * `x-origin-verify` value is refused before the app sees it; then the viewer bearer
 * CloudFront forwarded is restored and the response streams. Streamified end to end,
 * because Node.js 24 on Lambda rejects callback-style handlers (first deploy finding).
 */
export const handler = gateStreamingHandler(awslambda, streamHandle(app) as unknown as StreamingHandler<HeaderedEvent>, originVerifySecret);
