// Test harness: an in-process MCP server (fixtures mode) plus a service token, reached
// through a fetch stand-in so no port is opened.
import { createServerApp, FixtureProvider, type FixtureStory } from "@spoken-letter-alexa/mcp-server";
import { LocalSigner, MemoryStore, mintAccessToken, parseClients } from "@spoken-letter-alexa/oauth";
import { sha256Hex } from "@spoken-letter-alexa/shared";
import { type Hono } from "hono";

export const ISSUER = "http://localhost:4310";
export const MCP_URL = `${ISSUER}/mcp`;
export const M2M_SECRET = "test-m2m-client-secret-not-real";

export const TEST_STORIES: FixtureStory[] = [
  {
    id: "st_owl",
    title: "The owl who forgot how to hoot",
    storyteller: "Grandpa Juan",
    durationSeconds: 184,
    deliveredAt: "2026-08-30T19:12:00.000Z",
    file: "st_owl.mp3",
  },
  {
    id: "st_lighthouse",
    title: "A lighthouse for Mateo",
    storyteller: "Grandpa Juan",
    durationSeconds: 241,
    deliveredAt: "2026-09-02T20:05:00.000Z",
    file: "st_lighthouse.mp3",
  },
];

export type McpHarness = {
  app: Hono;
  fetch: typeof fetch;
  signer: LocalSigner;
  serviceToken: () => Promise<string>;
  userToken: (subject: string) => Promise<string>;
};

export async function mcpHarness(): Promise<McpHarness> {
  const signer = await LocalSigner.create();
  const app = await createServerApp({
    issuer: ISSUER,
    spokenLetterOrigin: "http://localhost:3007",
    bridgeSecret: "test-bridge-secret-not-a-real-credential",
    clients: parseClients(
      JSON.stringify([
        { clientId: "alexa-m2m", clientSecretHash: sha256Hex(M2M_SECRET), redirectUris: [], grants: ["client_credentials"], scope: "mcp:service" },
      ]),
    ),
    store: new MemoryStore(),
    signer,
    providerMode: "fixtures",
    fixtures: new FixtureProvider({ stories: TEST_STORIES, publicBaseUrl: ISSUER }),
  });
  const fetchImpl: typeof fetch = (input, init) => Promise.resolve(app.request(input instanceof Request ? input : String(input), init));
  const serviceToken = async () => {
    const response = await app.request("/oauth/token", {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`alexa-m2m:${M2M_SECRET}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    return ((await response.json()) as { access_token: string }).access_token;
  };
  const userToken = async (subject: string) =>
    (await mintAccessToken({ signer, issuer: ISSUER, audience: MCP_URL, subject, clientId: "simulator", scope: "mcp:tools mcp:resources" })).token;
  return { app, fetch: fetchImpl, signer, serviceToken, userToken };
}
