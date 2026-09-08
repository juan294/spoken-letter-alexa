#!/usr/bin/env node
// `pnpm -F infra seed:secrets` (Owner, after the first deploy): writes the static OAuth
// clients document and fresh secrets into Secrets Manager. Prints the bridge secret ONCE
// for the private repository's Vercel environment (Phase 8) and nothing else.
//
//   AWS_PROFILE=archy node infra/scripts/seed-secrets.mjs [--dry-run]
//
// Secrets written:
//   sla/bridge          raw string: ALEXA_BRIDGE_SECRET shared with spokenletter.com
//   sla/oauth-clients   JSON { clients: StaticClient[], m2mSecret }  (packages/oauth/src/clients.ts)
// The Alexa client's redirect URIs are added when Amazon grants access (Phase 7): re-run
// with --alexa-redirect <uri> --alexa-secret <secret> then.
import { createHash, randomBytes } from "node:crypto";

import { PutSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

const args = process.argv.slice(2);
const flag = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const dryRun = args.includes("--dry-run");
const region = process.env.AWS_REGION ?? "us-east-1";
const publicBaseUrl = process.env.PUBLIC_BASE_URL ?? "https://alexa.spokenletter.com";
const alexaRedirect = flag("--alexa-redirect");
const alexaSecret = flag("--alexa-secret");

const token = (bytes) => randomBytes(bytes).toString("base64url");
const sha256 = (value) => createHash("sha256").update(value, "utf8").digest("hex");

const bridgeSecret = token(32);
const m2mSecret = token(32);
const clients = [
  {
    clientId: "simulator",
    redirectUris: [`${publicBaseUrl}/demo/callback`],
    grants: ["authorization_code", "refresh_token"],
  },
  {
    clientId: "alexa-m2m",
    clientSecretHash: sha256(m2mSecret),
    redirectUris: [],
    grants: ["client_credentials"],
    scope: "mcp:service",
  },
];
if (alexaRedirect && alexaSecret) {
  clients.push({
    clientId: "alexa",
    clientSecretHash: sha256(alexaSecret),
    redirectUris: [alexaRedirect],
    grants: ["authorization_code", "refresh_token"],
  });
}

const document = JSON.stringify({ clients, m2mSecret });

if (dryRun) {
  console.log(JSON.stringify({ dryRun: true, region, clients: clients.map((c) => c.clientId), bridgeSecretLength: bridgeSecret.length }));
  process.exit(0);
}

const client = new SecretsManagerClient({ region });
await client.send(new PutSecretValueCommand({ SecretId: "sla/bridge", SecretString: bridgeSecret }));
await client.send(new PutSecretValueCommand({ SecretId: "sla/oauth-clients", SecretString: document }));
console.log(JSON.stringify({ event: "secrets_seeded", region, clients: clients.map((c) => c.clientId) }));
console.log("Add to the private repository (Vercel, Phase 8), then never print again:");
console.log(`ALEXA_BRIDGE_SECRET=${bridgeSecret}`);
console.log(`ALEXA_BRIDGE_ORIGIN=${publicBaseUrl}`);
