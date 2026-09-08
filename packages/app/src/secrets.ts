import { GetSecretValueCommand, type SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { log } from "@spoken-letter-alexa/shared";

/**
 * Lambda cold start: copy the two Secrets Manager values into the process environment
 * the way `readServerEnv` expects them. `sla/bridge` is the raw bridge secret;
 * `sla/oauth-clients` is JSON `{ clients: StaticClient[], m2mSecret: string }` written by
 * `pnpm -F infra seed:secrets`.
 */
export async function loadSecretsIntoEnv(
  client: SecretsManagerClient,
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  const bridgeArn = env.SECRETS_BRIDGE_ARN;
  const clientsArn = env.SECRETS_OAUTH_CLIENTS_ARN;
  if (!bridgeArn || !clientsArn) throw new Error("SECRETS_BRIDGE_ARN and SECRETS_OAUTH_CLIENTS_ARN are required");

  const [bridge, clients] = await Promise.all([
    client.send(new GetSecretValueCommand({ SecretId: bridgeArn })),
    client.send(new GetSecretValueCommand({ SecretId: clientsArn })),
  ]);
  if (!bridge.SecretString) throw new Error("sla/bridge has no value");
  if (!clients.SecretString) throw new Error("sla/oauth-clients has no value");

  const parsed = JSON.parse(clients.SecretString) as { clients?: unknown; m2mSecret?: unknown };
  if (!Array.isArray(parsed.clients) || typeof parsed.m2mSecret !== "string") {
    throw new Error("sla/oauth-clients must be JSON with clients[] and m2mSecret");
  }
  env.ALEXA_BRIDGE_SECRET = bridge.SecretString;
  env.OAUTH_CLIENTS = JSON.stringify(parsed.clients);
  env.OAUTH_M2M_SECRET = parsed.m2mSecret;
  log.info("secrets_loaded", { clients: parsed.clients.length });
}
