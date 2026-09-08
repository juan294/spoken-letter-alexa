// The session-id contingency (Phase 7, section 2). Amazon's Local Inspector opens with
// a legacy `initialize` at 2025-06-18 and expects `Mcp-Session-Id` on every later
// request. The default stateless dual-era handler mints no session id; this opt-in
// handler does, in front of a modern-only (`legacy: 'reject'`) handler for 2026-07-28.
import { McpServer } from "@modelcontextprotocol/server";
import { describe, expect, test } from "vitest";
import { z } from "zod";

import { createLegacySessionHandler } from "./legacy-sessions.ts";
import { LEGACY_INITIALIZE, MODERN_ENVELOPE, MODERN_VERSION, readJsonRpc } from "./test-support.ts";

const INSPECTOR_VERSION = "2025-06-18";

function factory(): McpServer {
  const server = new McpServer({ name: "legacy-session-test", version: "0.0.0" }, { capabilities: { tools: {} } });
  server.registerTool(
    "echo_word",
    { description: "Echoes one word back.", inputSchema: z.object({ word: z.string() }) },
    ({ word }) => ({ content: [{ type: "text", text: word }] }),
  );
  return server;
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost:4310/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

const TOOLS_LIST = { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} };

async function initialize(handler: ReturnType<typeof createLegacySessionHandler>): Promise<string> {
  const response = await handler.fetch(post(LEGACY_INITIALIZE(INSPECTOR_VERSION)));
  const sessionId = response.headers.get("mcp-session-id");
  if (!sessionId) throw new Error(`initialize returned no Mcp-Session-Id (status ${response.status})`);
  await response.text();
  return sessionId;
}

describe("createLegacySessionHandler", () => {
  test("a legacy initialize at 2025-06-18 (the Inspector's) is answered with an Mcp-Session-Id", async () => {
    const handler = createLegacySessionHandler(factory);
    const response = await handler.fetch(post(LEGACY_INITIALIZE(INSPECTOR_VERSION)));
    expect(response.status).toBe(200);
    expect(response.headers.get("mcp-session-id")).toMatch(/^[0-9a-f-]{36}$/);
    const [message] = await readJsonRpc(response);
    expect(message?.result).toMatchObject({ protocolVersion: INSPECTOR_VERSION, serverInfo: { name: "legacy-session-test" } });
    await handler.close();
  });

  test("a follow-up tools/list carrying the session id succeeds", async () => {
    const handler = createLegacySessionHandler(factory);
    const sessionId = await initialize(handler);
    const response = await handler.fetch(post(TOOLS_LIST, { "mcp-session-id": sessionId }));
    expect(response.status).toBe(200);
    const [message] = await readJsonRpc(response);
    const tools = (message?.result as { tools: { name: string }[] }).tools;
    expect(tools.map((tool) => tool.name)).toEqual(["echo_word"]);
    await handler.close();
  });

  test("two sessions are isolated: each id is distinct and both keep serving", async () => {
    const handler = createLegacySessionHandler(factory);
    const first = await initialize(handler);
    const second = await initialize(handler);
    expect(first).not.toBe(second);
    for (const sessionId of [first, second]) {
      const response = await handler.fetch(
        post({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "echo_word", arguments: { word: sessionId } } }, { "mcp-session-id": sessionId }),
      );
      const [message] = await readJsonRpc(response);
      expect(message?.result).toMatchObject({ content: [{ type: "text", text: sessionId }] });
    }
    await handler.close();
  });

  test("a legacy tools/list without the session id is 400", async () => {
    const handler = createLegacySessionHandler(factory);
    await initialize(handler);
    const response = await handler.fetch(post(TOOLS_LIST));
    expect(response.status).toBe(400);
    const [message] = await readJsonRpc(response);
    expect(message?.error?.code).toBe(-32000);
    await handler.close();
  });

  test("an unknown session id is 404", async () => {
    const handler = createLegacySessionHandler(factory);
    const response = await handler.fetch(post(TOOLS_LIST, { "mcp-session-id": "00000000-0000-4000-8000-000000000000" }));
    expect(response.status).toBe(404);
    const [message] = await readJsonRpc(response);
    expect(message?.error?.code).toBe(-32001);
    await handler.close();
  });

  test("DELETE with the session id ends it and the id stops working", async () => {
    const handler = createLegacySessionHandler(factory);
    const sessionId = await initialize(handler);
    const del = await handler.fetch(
      new Request("http://localhost:4310/mcp", { method: "DELETE", headers: { "mcp-session-id": sessionId } }),
    );
    expect(del.status).toBe(200);
    expect(handler.sessionCount()).toBe(0);
    const after = await handler.fetch(post(TOOLS_LIST, { "mcp-session-id": sessionId }));
    expect(after.status).toBe(404);
    await handler.close();
  });

  test("a modern 2026-07-28 server/discover still succeeds through the same handler", async () => {
    const handler = createLegacySessionHandler(factory);
    const response = await handler.fetch(
      post(
        { jsonrpc: "2.0", id: 4, method: "server/discover", params: { _meta: MODERN_ENVELOPE } },
        { "mcp-protocol-version": MODERN_VERSION, "mcp-method": "server/discover" },
      ),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("mcp-session-id")).toBeNull();
    const [message] = await readJsonRpc(response);
    expect(message?.result).toMatchObject({ supportedVersions: [MODERN_VERSION], resultType: "complete" });
    await handler.close();
  });

  test("authInfo passed to fetch reaches the legacy tool handler", async () => {
    const seen: string[] = [];
    const handler = createLegacySessionHandler(() => {
      const server = new McpServer({ name: "auth-test", version: "0.0.0" }, { capabilities: { tools: {} } });
      server.registerTool("who", { description: "Reports the caller.", inputSchema: z.object({}) }, (_args, ctx) => {
        seen.push(String(ctx.http?.authInfo?.clientId));
        return { content: [{ type: "text", text: "ok" }] };
      });
      return server;
    });
    const authInfo = { token: "t", clientId: "inspector", scopes: ["mcp:tools"], expiresAt: Math.floor(Date.now() / 1000) + 60 };
    const init = await handler.fetch(post(LEGACY_INITIALIZE(INSPECTOR_VERSION)), { authInfo });
    const sessionId = init.headers.get("mcp-session-id") ?? "";
    await init.text();
    const call = await handler.fetch(
      post({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "who", arguments: {} } }, { "mcp-session-id": sessionId }),
      { authInfo },
    );
    await call.text();
    expect(seen).toEqual(["inspector"]);
    await handler.close();
  });
});
