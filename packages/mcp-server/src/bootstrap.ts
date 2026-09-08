// Builds the composed app from the environment. Shared by the local server and Lambda.
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { KMSClient } from "@aws-sdk/client-kms";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
  DynamoStore,
  KmsSigner,
  LocalSigner,
  MemoryStore,
  parseClients,
  type OAuthStore,
  type Signer,
  type StaticClient,
} from "@spoken-letter-alexa/oauth";
import { log, randomToken, sha256Hex } from "@spoken-letter-alexa/shared";
import { type Hono } from "hono";

import { createServerApp } from "./app.ts";
import { type ServerEnv } from "./env.ts";
import { FixtureProvider, loadFixtureCatalog } from "./provider/fixtures.ts";

export type Bootstrapped = {
  app: Hono;
  /** Values generated for this process because the environment did not set them. Local only. */
  generated: { bridgeSecret?: string; m2mSecret?: string; devToken?: string };
  stories: number;
};

/** Local development clients: the simulator (public, PKCE) and a service client for the agent. */
function devClients(issuer: string, m2mSecret: string): StaticClient[] {
  return [
    {
      clientId: "simulator",
      redirectUris: [`${issuer}/dev/callback`, "http://localhost:5173/demo/callback", `${issuer}/demo/callback`],
      grants: ["authorization_code", "refresh_token"],
    },
    { clientId: "alexa-m2m", clientSecretHash: sha256Hex(m2mSecret), redirectUris: [], grants: ["client_credentials"], scope: "mcp:service" },
  ];
}

async function signerFromEnv(env: ServerEnv): Promise<Signer> {
  if (env.JWT_SIGNER === "kms") {
    if (!env.KMS_KEY_ID) throw new Error("KMS_KEY_ID is required when JWT_SIGNER=kms");
    return new KmsSigner({ client: new KMSClient({ region: env.AWS_REGION }), keyId: env.KMS_KEY_ID });
  }
  return LocalSigner.create();
}

function storeFromEnv(env: ServerEnv): OAuthStore {
  if (env.OAUTH_STORE === "dynamo") {
    const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: env.AWS_REGION }), {
      marshallOptions: { removeUndefinedValues: true },
    });
    return new DynamoStore({ client, tableName: env.OAUTH_TABLE });
  }
  return new MemoryStore();
}

export async function bootstrap(env: ServerEnv, options: { allowGenerated: boolean }): Promise<Bootstrapped> {
  const generated: Bootstrapped["generated"] = {};
  const issuer = env.PUBLIC_BASE_URL;

  let bridgeSecret = env.ALEXA_BRIDGE_SECRET;
  if (!bridgeSecret) {
    if (!options.allowGenerated) throw new Error("ALEXA_BRIDGE_SECRET is required");
    bridgeSecret = randomToken(32);
    generated.bridgeSecret = bridgeSecret;
  }

  let clients: StaticClient[];
  if (env.OAUTH_CLIENTS) {
    clients = parseClients(env.OAUTH_CLIENTS);
  } else {
    if (!options.allowGenerated) throw new Error("OAUTH_CLIENTS is required");
    const m2mSecret = randomToken(32);
    generated.m2mSecret = m2mSecret;
    clients = devClients(issuer, m2mSecret);
  }

  let devToken = env.MCP_DEV_TOKEN;
  if (!devToken && options.allowGenerated) {
    devToken = randomToken(24);
    generated.devToken = devToken;
  }

  const stories = await loadFixtureCatalog(env.FIXTURES_PATH).catch((error: unknown) => {
    log.warn("fixtures_missing", { path: env.FIXTURES_PATH, message: error instanceof Error ? error.message : String(error) });
    return [];
  });

  const app = await createServerApp({
    issuer,
    spokenLetterOrigin: env.SPOKEN_LETTER_ORIGIN,
    bridgeSecret,
    clients,
    store: storeFromEnv(env),
    signer: await signerFromEnv(env),
    providerMode: env.PROVIDER_MODE,
    fixtures: new FixtureProvider({ stories, publicBaseUrl: issuer }),
    devToken,
    devRoutes: env.DEV_ROUTES === "1",
    legacySessions: env.MCP_LEGACY_SESSIONS === "1",
  });
  return { app, generated, stories: stories.length };
}
