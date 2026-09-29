import { describe, expect, test } from "vitest";

import { MemoryDemoDraftStore } from "./demo-drafts.ts";
import { MemoryPlaylistStore } from "./playlist.ts";
import { createAgentApp } from "./routes.ts";
import { ScriptedModel } from "./scripted-model.ts";
import { deviceSessionId, MemorySessionStore } from "./sessions.ts";

function appWithDrafts(options: { generate?: () => Promise<{ place: "quiet shore"; challenge: "small mystery"; ending: "kindness" }> } = {}) {
  const store = new MemoryDemoDraftStore();
  const app = createAgentApp({
    model: new ScriptedModel(), modelId: null, mcpUrl: "http://localhost:4310/mcp", sessions: new MemorySessionStore(),
    speech: { synthesize: () => Promise.resolve(null) }, transcribe: () => Promise.resolve(""),
    demoToken: () => Promise.resolve("unused"), offline: true,
    playlist: { store: new MemoryPlaylistStore(), secret: "test-skill-secret" },
    drafts: { store, generator: options.generate ?? (() => Promise.resolve({ place: "quiet shore", challenge: "small mystery", ending: "kindness" })) },
  });
  const post = (path: string, body: unknown, secret = "test-skill-secret") => app.request(path, {
    method: "POST", headers: { "content-type": "application/json", "x-alexa-skill-secret": secret }, body: JSON.stringify(body),
  });
  return { store, post };
}

describe("authenticated demo draft routes", () => {
  test("authenticates before reading identity, saves a canonical draft, and reads it back", async () => {
    const { store, post } = appWithDrafts();
    const unauthorized = await post("/agent/demo/draft", { deviceUserId: "amzn1.ask.account.OWNER", requestId: "r1", theme: "mermaids" }, "wrong");
    expect(unauthorized.status).toBe(401);
    expect((await post("/agent/demo/draft", { deviceUserId: 1 }, "wrong")).status).toBe(401);
    const latest = await post("/agent/demo/draft/latest", { deviceUserId: "amzn1.ask.account.OWNER" });
    await expect(latest.json()).resolves.toEqual({ status: "none" });
    const saved = await post("/agent/demo/draft", { deviceUserId: "amzn1.ask.account.OWNER", requestId: "r1", theme: "mermaids for Mateo" });
    expect(saved.status).toBe(200);
    const receipt = await saved.json() as { status: string; draftId: string; outline: string; theme: string };
    expect(receipt).toMatchObject({ status: "saved", theme: "mermaids" });
    expect(receipt.outline).not.toContain("Mateo");
    expect(await (await post("/agent/demo/draft/latest", { deviceUserId: "amzn1.ask.account.OWNER" })).json()).toEqual(receipt);
    expect(await store.get("amzn1.ask.account.OWNER")).toBeNull();
    expect((await store.get(deviceSessionId("amzn1.ask.account.OWNER")))?.receipts).toHaveLength(1);
  });

  test("unsupported theme and model failure never claim a save", async () => {
    const { post } = appWithDrafts();
    const unsupported = await post("/agent/demo/draft", { deviceUserId: "owner", requestId: "r1", theme: "for Mateo" });
    expect(unsupported.status).toBe(422);
    const badBody = await unsupported.json() as { error: string; message: string };
    expect(badBody.error).toBe("unsupported_theme");
    expect(badBody.message).not.toMatch(/saved|sent|charged/i);
    const failed = appWithDrafts({ generate: () => Promise.reject(new Error("model down")) });
    const unavailable = await failed.post("/agent/demo/draft", { deviceUserId: "owner", requestId: "r1", theme: "forest" });
    expect(unavailable.status).toBe(503);
    const failure = await unavailable.json() as { error: string; message: string };
    expect(failure.error).toBe("draft_unavailable");
    expect(failure.message).toMatch(/no draft was saved/i);
    expect(await (await failed.post("/agent/demo/draft/latest", { deviceUserId: "owner" })).json()).toEqual({ status: "none" });
  });
});
