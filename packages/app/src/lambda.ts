// Lambda entry point (Phase 6 wires the function URL with RESPONSE_STREAM). Secrets and
// clients come from the environment CDK fills from Secrets Manager; nothing is generated
// here and the dev routes are never mounted.
import { streamHandle } from "hono/aws-lambda";

import { bootstrap } from "./bootstrap.ts";
import { readServerEnv } from "./env.ts";
import { type HeaderedEvent, originVerified, rewriteForwardedAuthorization } from "./forwarded-auth.ts";

const env = readServerEnv();
if (env.DEV_ROUTES === "1") throw new Error("DEV_ROUTES must not be enabled on Lambda");
if (env.AGENT_OFFLINE === "1") throw new Error("AGENT_OFFLINE must not be enabled on Lambda");

const originVerifySecret = process.env.ORIGIN_VERIFY_SECRET;
if (!originVerifySecret) throw new Error("ORIGIN_VERIFY_SECRET is required on Lambda (loaded from sla/origin-verify)");

const { app } = await bootstrap(env, { allowGenerated: false });
const stream = streamHandle(app);

export { app };
/**
 * The function URL handler. The URL is public (D18): a request without CloudFront's
 * `x-origin-verify` value is refused before the app sees it; then the viewer bearer
 * CloudFront forwarded is restored and the response streams.
 */
export const handler: typeof stream = (event, context, callback) => {
  if (!originVerified(event as HeaderedEvent, originVerifySecret)) {
    return Promise.resolve({
      statusCode: 403,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
      body: JSON.stringify({ error: "forbidden", message: "Requests must come through alexa.spokenletter.com" }),
    }) as ReturnType<typeof stream>;
  }
  return stream(rewriteForwardedAuthorization(event as HeaderedEvent) as typeof event, context, callback);
};
