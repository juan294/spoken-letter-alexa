import { sha256Hex } from "@spoken-letter-alexa/shared";
import { describe, expect, test, vi } from "vitest";

import { MemoryDemoUpdateStore, type DemoStory } from "./demo-updates.ts";
import { MemoryPlaylistStore, PLAYLIST_TTL_SECONDS } from "./playlist.ts";
import { createAgentApp } from "./routes.ts";
import { ScriptedModel } from "./scripted-model.ts";
import { deviceSessionId, MemorySessionStore } from "./sessions.ts";

const story: DemoStory = { id: "st_mermaid", title: "A mermaid story", storyteller: "Aunt Whitney", deliveredAt: "2026-08-03T00:00:00Z",
  audioUrl: "http://localhost:4310/fixtures/audio/st_mermaid.mp3" };
const legacyToken = (changes: Record<string, unknown> = {}) => Buffer.from(JSON.stringify({ id: story.id, title: story.title,
  storyteller: story.storyteller, durationSeconds: 60, url: story.audioUrl, ...changes }), "utf8").toString("base64url");

async function harness() {
  const playlist = new MemoryPlaylistStore();
  const updates = new MemoryDemoUpdateStore();
  const deviceKey = deviceSessionId("amzn1.ask.account.OWNER");
  const token = "pl_1_0_test-token";
  await playlist.compareAndSet(deviceKey, null, {
    ids: [story.id], index: 0, generation: 1, currentTokenDigest: sha256Hex(token), lastEventIdDigest: null,
    lastFinishedTokenDigest: null, pendingFinishedTokenDigest: null, mode: "title", completed: false,
    version: 1, expiresAt: Math.floor(Date.now() / 1000) + PLAYLIST_TTL_SECONDS,
  });
  const app = createAgentApp({
    model: new ScriptedModel(), modelId: null, mcpUrl: "http://localhost:4310/mcp", sessions: new MemorySessionStore(),
    speech: { synthesize: () => Promise.resolve(null) }, transcribe: () => Promise.resolve(""),
    demoToken: () => Promise.resolve("unused"), offline: true,
    playlist: { store: playlist, secret: "test-skill-secret" },
    updates: { store: updates, stories: [story], seed: [] },
  });
  const post = (path: string, body: unknown, secret = "test-skill-secret") => app.request(path, { method: "POST",
    headers: { "content-type": "application/json", "x-alexa-skill-secret": secret }, body: JSON.stringify(body) });
  return { post, updates, playlist, token, deviceKey };
}

describe("demo update routes", () => {
  test("finished opaque playlist token resolves a delivered fixture story and prompts only on next invocation", async () => {
    const { post, token, updates, deviceKey } = await harness();
    const deviceUserId = "amzn1.ask.account.OWNER";
    const finished = await post("/agent/playlist", { deviceUserId, command: "finished", observedToken: token, eventId: "alexa-event-1" });
    expect(finished.status).toBe(200);
    expect(await finished.json()).toEqual({ action: "none", say: null });
    const first = await post("/agent/demo/next", { deviceUserId });
    expect(await first.json()).toMatchObject({ pendingReaction: { storyId: "st_mermaid", storyteller: "Aunt Whitney" } });
    expect(await (await post("/agent/demo/next", { deviceUserId })).json()).toEqual({});
    expect((await updates.get(deviceKey))?.completions).toHaveLength(1);
    expect(JSON.stringify(await updates.get(deviceKey))).not.toContain("alexa-event-1");
  });

  test("stale token and stopped event do not create a reaction prompt", async () => {
    const { post } = await harness();
    const deviceUserId = "amzn1.ask.account.OWNER";
    await post("/agent/playlist", { deviceUserId, command: "finished", observedToken: "pl_1_0_wrong", eventId: "stale" });
    expect(await (await post("/agent/demo/next", { deviceUserId })).json()).toEqual({});
    expect((await post("/agent/demo/playback-stopped", { deviceUserId, observedToken: "pl_1_0_test-token" })).status).toBe(404);
  });

  test("legacy direct-play callback validates delivered fixture ID and exact audio URL, then dedupes", async () => {
    const { post, updates, deviceKey } = await harness();
    const deviceUserId = "amzn1.ask.account.OWNER";
    for (const token of [legacyToken({ id: "missing" }), legacyToken({ url: "https://evil.example/st_mermaid.mp3" }), "not-a-token"]) {
      const response = await post("/agent/demo/playback-finished", { deviceUserId, observedToken: token, eventId: "e1" });
      expect(await response.json()).toEqual({ status: "ignored" });
    }
    expect((await updates.get(deviceKey))?.completions).toBeUndefined();
    const valid = await post("/agent/demo/playback-finished", { deviceUserId, observedToken: legacyToken(), eventId: "e1" });
    expect(await valid.json()).toEqual({ status: "recorded" });
    const repeated = await post("/agent/demo/playback-finished", { deviceUserId, observedToken: legacyToken(), eventId: "e1" });
    expect(await repeated.json()).toEqual({ status: "duplicate" });
    expect((await updates.get(deviceKey))?.completions).toHaveLength(1);
    expect(JSON.stringify(await updates.get(deviceKey))).not.toContain(story.audioUrl);
  });

  test("failed legacy completion save makes no prompt and retry can recover", async () => {
    const { post, updates } = await harness();
    const deviceUserId = "amzn1.ask.account.OWNER";
    vi.spyOn(updates, "compareAndSet").mockRejectedValueOnce(new Error("storage down"));
    const failed = await post("/agent/demo/playback-finished", { deviceUserId, observedToken: legacyToken(), eventId: "e1" });
    expect(failed.status).toBe(503);
    expect(await (await post("/agent/demo/next", { deviceUserId })).json()).toEqual({});
    const recovered = await post("/agent/demo/playback-finished", { deviceUserId, observedToken: legacyToken(), eventId: "e1" });
    expect(await recovered.json()).toEqual({ status: "recorded" });
  });

  test("requires skill credential for reaction, wish, and inbox before parsing device ID", async () => {
    const { post } = await harness();
    for (const route of ["/agent/demo/next", "/agent/demo/reaction", "/agent/demo/wish", "/agent/demo/event", "/agent/demo/inbox", "/agent/demo/playback-finished"]) {
      expect((await post(route, { deviceUserId: 1 }, "wrong")).status).toBe(401);
    }
  });

  test("confirmed wish and reaction write receipts, unknown creator has a recovery error", async () => {
    const { post, token } = await harness();
    const deviceUserId = "amzn1.ask.account.OWNER";
    const unconfirmed = await post("/agent/demo/wish", { deviceUserId, requestId: "w1", topic: "mermaids", confirmed: false });
    expect(unconfirmed.status).toBe(422);
    const unknown = await post("/agent/demo/wish", { deviceUserId, requestId: "w1", topic: "mermaids", storyteller: "Unknown", confirmed: true });
    expect(unknown.status).toBe(422);
    expect((await unknown.json() as { message: string }).message).toMatch(/Aunt Whitney/);
    const wish = await post("/agent/demo/wish", { deviceUserId, requestId: "w1", topic: "mermaids for Mateo", storyteller: "Aunt Whitney", confirmed: true });
    expect(await wish.json()).toMatchObject({ status: "saved", topic: "mermaids", storyteller: "Aunt Whitney" });
    await post("/agent/playlist", { deviceUserId, command: "finished", observedToken: token, eventId: "e1" });
    await post("/agent/demo/next", { deviceUserId });
    const reaction = await post("/agent/demo/reaction", { deviceUserId, requestId: "r1", choice: "like" });
    expect(await reaction.json()).toMatchObject({ status: "saved", choice: "like", storyId: "st_mermaid" });
  });
});
