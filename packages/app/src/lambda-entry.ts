// The bundled Lambda entry (infra/lib/api-stack.ts): read the two Secrets Manager values
// into the environment once per cold start, then build the app exactly as `lambda.ts`
// does. The import is dynamic on purpose: a static re-export would evaluate `lambda.ts`
// before the secrets are in place.
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

import { loadSecretsIntoEnv } from "./secrets.ts";

await loadSecretsIntoEnv(new SecretsManagerClient({ region: process.env.AWS_REGION ?? "us-east-1" }));

const server = await import("./lambda.ts");

export const app = server.app;
export const handler = server.handler;
