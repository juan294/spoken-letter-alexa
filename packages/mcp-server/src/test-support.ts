// Shared helpers for this package's tests. Not exported from the package.
import { type Hono } from "hono";

import { createApp, type AppDeps } from "./http.ts";
import { FixtureProvider, type FixtureStory } from "./provider/fixtures.ts";

export const TEST_BASE_URL = "http://localhost:4310";
export const TEST_DEV_TOKEN = "dev-token-for-tests-only";

/** Three delivered stories, newest first once sorted by deliveredAt. */
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
  {
    id: "st_bread",
    title: "The morning the bread sang",
    storyteller: "Grandpa Juan",
    durationSeconds: 156,
    deliveredAt: "2026-08-21T18:40:00.000Z",
    file: "st_bread.mp3",
  },
];

export function testDeps(overrides: Partial<AppDeps> = {}): AppDeps {
  const fixtures = new FixtureProvider({ stories: TEST_STORIES, publicBaseUrl: TEST_BASE_URL });
  return {
    publicBaseUrl: TEST_BASE_URL,
    devToken: TEST_DEV_TOKEN,
    providerFor: () => fixtures,
    ...overrides,
  };
}

export function testApp(overrides: Partial<AppDeps> = {}): Hono {
  return createApp(testDeps(overrides));
}

export const LEGACY_INITIALIZE = (protocolVersion: string) => ({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion,
    capabilities: {},
    clientInfo: { name: "Alexa+ MCP Client", version: "1.0.0" },
  },
});

export const MODERN_VERSION = "2026-07-28";
export const MODERN_ENVELOPE = {
  "io.modelcontextprotocol/protocolVersion": MODERN_VERSION,
  "io.modelcontextprotocol/clientCapabilities": {},
  "io.modelcontextprotocol/clientInfo": { name: "spoken-letter-tests", version: "1.0.0" },
};

export type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: Record<string, unknown>;
  error?: { code: number; message: string; data?: unknown };
};

/** Parses a JSON or SSE (`event: message` / `data:`) body into JSON-RPC responses. */
export async function readJsonRpc(response: Response): Promise<JsonRpcResponse[]> {
  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();
  if (contentType.includes("text/event-stream")) {
    return text
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => JSON.parse(line.slice(5).trim()) as JsonRpcResponse);
  }
  const parsed = JSON.parse(text) as JsonRpcResponse | JsonRpcResponse[];
  return Array.isArray(parsed) ? parsed : [parsed];
}

export async function mcpPost(
  app: Hono,
  body: unknown,
  options: { headers?: Record<string, string>; token?: string | null } = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    ...options.headers,
  };
  const token = options.token === undefined ? TEST_DEV_TOKEN : options.token;
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return app.request("/mcp", { method: "POST", headers, body: JSON.stringify(body) });
}

export async function legacyCall(
  app: Hono,
  method: string,
  params: Record<string, unknown> = {},
  id = 2,
): Promise<JsonRpcResponse> {
  const response = await mcpPost(app, { jsonrpc: "2.0", id, method, params });
  const [first] = await readJsonRpc(response);
  if (!first) throw new Error(`no JSON-RPC response for ${method} (status ${response.status})`);
  return first;
}

export async function modernCall(
  app: Hono,
  method: string,
  params: Record<string, unknown> = {},
  id = 3,
): Promise<{ response: Response; message: JsonRpcResponse }> {
  const headers: Record<string, string> = {
    "mcp-protocol-version": MODERN_VERSION,
    "mcp-method": method,
  };
  const name = params.name;
  if (typeof name === "string") headers["mcp-name"] = name;
  const response = await mcpPost(
    app,
    { jsonrpc: "2.0", id, method, params: { ...params, _meta: MODERN_ENVELOPE } },
    { headers },
  );
  const [first] = await readJsonRpc(response);
  if (!first) throw new Error(`no JSON-RPC response for ${method} (status ${response.status})`);
  return { response, message: first };
}
