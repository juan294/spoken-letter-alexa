import { describe, expect, test } from "vitest";

import { MemoryPlaylistStore } from "./playlist.ts";
import { createAgentApp } from "./routes.ts";
import { ScriptedModel } from "./scripted-model.ts";
import { MemorySessionStore } from "./sessions.ts";
import { MCP_URL, mcpHarness } from "./test-support.ts";

describe("internal playlist route", () => {
  test("requires skill secret before accepting a device identity and returns fresh provider audio", async () => {
    const h = await mcpHarness();
    const store = new MemoryPlaylistStore();
    const app = createAgentApp({
      model: new ScriptedModel(), modelId: null, mcpUrl: MCP_URL, mcpFetch: h.fetch,
      deviceMcp: { url: MCP_URL, fetch: h.fetch }, sessions: new MemorySessionStore(),
      speech: { synthesize: () => Promise.resolve(null) }, transcribe: () => Promise.resolve(""),
      demoToken: h.serviceToken, offline: true, playlist: { store, secret: "test-skill-secret" },
    });
    const body = JSON.stringify({ deviceUserId: "amzn1.ask.account.OWNER", command: "start", order: "newest" });
    const denied = await app.request("/agent/playlist", { method: "POST", headers: { "content-type": "application/json" }, body });
    expect(denied.status).toBe(401);
    const response = await app.request("/agent/playlist", { method: "POST", headers: {
      "content-type": "application/json", "x-alexa-skill-secret": "test-skill-secret",
    }, body });
    expect(response.status).toBe(200);
    const result = (await response.json()) as { action: string; play?: { id: string; url: string }; token?: string };
    expect(result.action).toBe("play");
    expect(result.play).toMatchObject({ id: "st_lighthouse", url: "http://localhost:4310/fixtures/audio/st_lighthouse.mp3" });
    expect(result.token).toBeTruthy();
    expect((await store.get("amzn1.ask.account.OWNER"))).toBeNull();
  });
});
