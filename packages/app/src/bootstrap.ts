// Builds the whole server from the environment: OAuth + JWT-gated MCP (packages/mcp-server)
// and the agent API (packages/agent) on one Hono app. Shared by the local server and Lambda.
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { KMSClient } from "@aws-sdk/client-kms";
import { PollyClient } from "@aws-sdk/client-polly";
import { S3Client } from "@aws-sdk/client-s3";
import { TranscribeStreamingClient } from "@aws-sdk/client-transcribe-streaming";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
  createAgentApp,
  createOfflineDeps,
  createTranscriber,
  DataUrlSpeechStore,
  DynamoSessionStore,
  MemorySessionStore,
  PollySpeech,
  S3SpeechStore,
  type AgentDeps,
} from "@spoken-letter-alexa/agent";
import { createServerApp, FixtureProvider, loadFixtureCatalog } from "@spoken-letter-alexa/mcp-server";
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
import { BedrockModel } from "@strands-agents/sdk";
import { type Hono } from "hono";

import { type ServerEnv } from "./env.ts";

export type Bootstrapped = {
  app: Hono;
  /** Values generated for this process because the environment did not set them. Local only. */
  generated: { bridgeSecret?: string; m2mSecret?: string; devToken?: string };
  stories: number;
};

const M2M_CLIENT_ID = "alexa-m2m";

/** Local development clients: the simulator (public, PKCE) and the agent's service client. */
function devClients(issuer: string, m2mSecret: string): StaticClient[] {
  return [
    {
      clientId: "simulator",
      redirectUris: [`${issuer}/dev/callback`, "http://localhost:5173/demo/callback", `${issuer}/demo/callback`],
      grants: ["authorization_code", "refresh_token"],
    },
    { clientId: M2M_CLIENT_ID, clientSecretHash: sha256Hex(m2mSecret), redirectUris: [], grants: ["client_credentials"], scope: "mcp:service" },
  ];
}

async function signerFromEnv(env: ServerEnv): Promise<Signer> {
  if (env.JWT_SIGNER === "kms") {
    if (!env.KMS_KEY_ID) throw new Error("KMS_KEY_ID is required when JWT_SIGNER=kms");
    return new KmsSigner({ client: new KMSClient({ region: env.AWS_REGION }), keyId: env.KMS_KEY_ID });
  }
  return LocalSigner.create();
}

function documentClient(env: ServerEnv): DynamoDBDocumentClient {
  return DynamoDBDocumentClient.from(new DynamoDBClient({ region: env.AWS_REGION }), { marshallOptions: { removeUndefinedValues: true } });
}

function storeFromEnv(env: ServerEnv): OAuthStore {
  return env.OAUTH_STORE === "dynamo" ? new DynamoStore({ client: documentClient(env), tableName: env.OAUTH_TABLE }) : new MemoryStore();
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

  let m2mSecret = env.OAUTH_M2M_SECRET;
  let clients: StaticClient[];
  if (env.OAUTH_CLIENTS) {
    clients = parseClients(env.OAUTH_CLIENTS);
    if (!m2mSecret) throw new Error("OAUTH_M2M_SECRET is required with OAUTH_CLIENTS");
    if (!clients.some((client) => client.clientId === M2M_CLIENT_ID)) {
      clients = [...clients, { clientId: M2M_CLIENT_ID, clientSecretHash: sha256Hex(m2mSecret), redirectUris: [], grants: ["client_credentials"], scope: "mcp:service" }];
    }
  } else {
    if (!options.allowGenerated) throw new Error("OAUTH_CLIENTS is required");
    m2mSecret ??= randomToken(32);
    if (!env.OAUTH_M2M_SECRET) generated.m2mSecret = m2mSecret;
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

  // The agent reaches this same app in-process when MCP_URL is our own /mcp (local and the
  // single-Lambda topology); the AgentCore Gateway URL (Phase 6) goes over the network.
  const holder: { app: Hono | null } = { app: null };
  const selfFetch: typeof fetch = (input, init) => {
    if (!holder.app) throw new Error("server app is not ready");
    return Promise.resolve(holder.app.request(input instanceof Request ? input : String(input), init));
  };
  const mcpFetch = env.MCP_URL === `${issuer}/mcp` ? selfFetch : undefined;
  const m2m = m2mSecret;
  const demoToken = async (): Promise<string> => {
    const response = await selfFetch(`${issuer}/oauth/token`, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${M2M_CLIENT_ID}:${m2m}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    if (!response.ok) throw new Error(`demo token request failed: ${response.status}`);
    return ((await response.json()) as { access_token: string }).access_token;
  };

  const agentDeps: AgentDeps =
    env.AGENT_OFFLINE === "1"
      ? createOfflineDeps({ mcpUrl: env.MCP_URL, mcpFetch, demoToken })
      : {
          model: new BedrockModel({ region: env.AWS_REGION, modelId: env.BEDROCK_MODEL_ID, maxTokens: 600, temperature: 0.3 }),
          modelId: env.BEDROCK_MODEL_ID,
          mcpUrl: env.MCP_URL,
          mcpFetch,
          sessions:
            env.AGENT_SESSIONS_STORE === "dynamo"
              ? new DynamoSessionStore({ client: documentClient(env), tableName: env.AGENT_SESSIONS_TABLE })
              : new MemorySessionStore(),
          speech: new PollySpeech({
            client: new PollyClient({ region: env.AWS_REGION }),
            store: env.ASSETS_BUCKET
              ? new S3SpeechStore({ client: new S3Client({ region: env.AWS_REGION }), bucket: env.ASSETS_BUCKET, publicBaseUrl: issuer })
              : new DataUrlSpeechStore(),
          }),
          transcribe: createTranscriber({ client: new TranscribeStreamingClient({ region: env.AWS_REGION }) }),
          demoToken,
          offline: false,
        };

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
    extraApps: [createAgentApp(agentDeps)],
  });
  holder.app = app;
  return { app, generated, stories: stories.length };
}
