import { type Hono } from "hono";
import { beforeAll, describe, expect, test, vi } from "vitest";

import { createOfflineDeps } from "./offline.ts";
import { createAgentApp, type AgentDeps } from "./routes.ts";
import { ScriptedModel } from "./scripted-model.ts";
import { deviceSessionId, MemorySessionStore, newSession } from "./sessions.ts";
import { ISSUER, MCP_URL, mcpHarness, type McpHarness } from "./test-support.ts";

type SessionBody = { sessionId: string; mode: string; subject: string; offline: boolean };
type TurnBody = {
  say: string;
  play: { url: string; title: string; storyteller: string; durationSeconds: number | null; artUrl: string | null } | null;
  speechUrl: string | null;
  toolCalls: { name: string; ms: number; era: string; ok: boolean }[];
};

async function post(app: Hono, path: string, body: unknown): Promise<Response> {
  return app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

describe("agent routes", () => {
  let h: McpHarness;
  let app: Hono;
  let deps: AgentDeps;

  beforeAll(async () => {
    h = await mcpHarness();
    deps = {
      model: new ScriptedModel(),
      modelId: "scripted",
      mcpUrl: MCP_URL,
      mcpFetch: h.fetch,
      sessions: new MemorySessionStore(),
      speech: { synthesize: (text) => Promise.resolve(`data:audio/mpeg;base64,${Buffer.from(text).toString("base64")}`) },
      transcribe: () => Promise.resolve("Alexa, play the story Grandpa sent"),
      demoToken: () => h.serviceToken(),
      offline: false,
    };
    app = createAgentApp(deps);
  });

  test("health reports the mode and model", async () => {
    const response = await app.request("/agent/health");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, offline: false, model: "scripted" });
  });

  test("demo session, a spoken turn with Polly audio and tool traces, then a follow-up", async () => {
    const created = await post(app, "/agent/session", { mode: "demo" });
    expect(created.status).toBe(200);
    const session = (await created.json()) as SessionBody;
    expect(session).toMatchObject({ mode: "demo", subject: "svc:alexa-m2m", offline: false });

    const turn = await post(app, "/agent/turn", { sessionId: session.sessionId, text: "Alexa, play the story Grandpa sent" });
    expect(turn.status).toBe(200);
    const body = (await turn.json()) as TurnBody;
    expect(body.play).toEqual({
      url: `${ISSUER}/fixtures/audio/st_lighthouse.mp3`,
      title: "A lighthouse for Mateo",
      storyteller: "Grandpa Juan",
      durationSeconds: 241,
      artUrl: `${ISSUER}/fixtures/art/st_lighthouse.png`,
    });
    expect(body.speechUrl?.startsWith("data:audio/mpeg;base64,")).toBe(true);
    expect(body.toolCalls.map((call) => call.name)).toEqual(["list_family_stories", "get_family_story"]);
    expect(body.toolCalls[0]).toMatchObject({ era: "legacy", ok: true });

    const next = (await (await post(app, "/agent/turn", { sessionId: session.sessionId, text: "play another" })).json()) as TurnBody;
    expect(next.play?.title).toBe("The owl who forgot how to hoot");
  });

  test("linked session uses the caller's token and reports its subject", async () => {
    const created = await post(app, "/agent/session", { mode: "linked", accessToken: await h.userToken("uid_owner") });
    const session = (await created.json()) as SessionBody;
    expect(session).toMatchObject({ mode: "linked", subject: "uid_owner" });
    const turn = (await (await post(app, "/agent/turn", { sessionId: session.sessionId, text: "what's new?" })).json()) as TurnBody;
    expect(turn.play).toBeNull();
    expect(turn.toolCalls.map((call) => call.name)).toEqual(["list_family_stories"]);
  });

  test("device mode keys the session by the Alexa user id, reuses it, never stores the id in clear, and talks to the device MCP endpoint", async () => {
    const deviceFetch = vi.fn<typeof fetch>((input, init) => h.fetch(input, init));
    const deviceApp = createAgentApp({ ...deps, mcpUrl: "https://gateway.invalid/mcp", mcpFetch: undefined, deviceMcp: { url: MCP_URL, fetch: deviceFetch } });
    const app = deviceApp;
    const first = (await (await post(app, "/agent/session", { mode: "device", deviceUserId: "amzn1.ask.account.OWNER" })).json()) as SessionBody;
    expect(first).toMatchObject({ mode: "device", subject: "svc:alexa-m2m", offline: false });
    expect(first.sessionId).toMatch(/^dev_[0-9a-f]{32}$/);
    expect(first.sessionId).not.toContain("OWNER");
    const turn = (await (await post(app, "/agent/turn", { sessionId: first.sessionId, text: "play a story" })).json()) as TurnBody;
    expect(turn.play?.title).toBe("A lighthouse for Mateo");
    const again = (await (await post(app, "/agent/session", { mode: "device", deviceUserId: "amzn1.ask.account.OWNER" })).json()) as SessionBody;
    expect(again.sessionId).toBe(first.sessionId);
    const next = (await (await post(app, "/agent/turn", { sessionId: again.sessionId, text: "play another" })).json()) as TurnBody;
    expect(next.play?.title).toBe("The owl who forgot how to hoot");
    expect(deviceFetch).toHaveBeenCalled();
    expect((await post(app, "/agent/session", { mode: "device" })).status).toBe(400);
  });

  test("a turn on a device session whose service token lapsed renews the token instead of failing", async () => {
    const stale = `x.${Buffer.from(JSON.stringify({ sub: "svc:alexa-m2m", exp: 1 })).toString("base64url")}.y`;
    const id = deviceSessionId("amzn1.ask.account.STALE");
    await deps.sessions.put(newSession({ id, mode: "device", subject: "svc:alexa-m2m", accessToken: stale }));
    const turn = (await (await post(app, "/agent/turn", { sessionId: id, text: "play a story" })).json()) as TurnBody;
    expect(turn.play?.title).toBe("A lighthouse for Mateo");
  });

  test("validation and unknown sessions answer RFC-style JSON errors", async () => {
    expect((await post(app, "/agent/session", { mode: "linked" })).status).toBe(400);
    expect((await post(app, "/agent/turn", { sessionId: "nope", text: "hi" })).status).toBe(404);
    await expect((await post(app, "/agent/turn", { sessionId: "nope", text: "hi" })).json()).resolves.toMatchObject({ error: "session_not_found" });
    expect((await post(app, "/agent/turn", { text: "hi" })).status).toBe(400);
    expect((await app.request("/agent/turn", { method: "POST", body: "not json" })).status).toBe(400);
  });

  test("transcribe accepts a raw audio body and rejects an oversized one", async () => {
    const ok = await app.request("/agent/transcribe", {
      method: "POST",
      headers: { "content-type": "audio/webm;codecs=opus" },
      body: new Uint8Array([1, 2, 3]),
    });
    expect(ok.status).toBe(200);
    await expect(ok.json()).resolves.toEqual({ text: "Alexa, play the story Grandpa sent" });
    const big = await app.request("/agent/transcribe", {
      method: "POST",
      headers: { "content-type": "audio/webm", "content-length": String(6 * 1024 * 1024) },
      body: new Uint8Array(10),
    });
    expect(big.status).toBe(413);
  });
});

describe("offline deps", () => {
  test("answer the contract without AWS: canned transcript, no speech, scripted model", async () => {
    const h = await mcpHarness();
    const offline = createOfflineDeps({ mcpUrl: MCP_URL, mcpFetch: h.fetch, demoToken: () => h.serviceToken() });
    const app = createAgentApp(offline);
    await expect((await app.request("/agent/health")).json()).resolves.toEqual({ ok: true, offline: true, model: null });
    const session = (await (await post(app, "/agent/session", { mode: "demo" })).json()) as SessionBody;
    expect(session.offline).toBe(true);
    const turn = (await (await post(app, "/agent/turn", { sessionId: session.sessionId, text: "play a story" })).json()) as TurnBody;
    expect(turn.speechUrl).toBeNull();
    expect(turn.play?.title).toBe("A lighthouse for Mateo");
    const transcript = await app.request("/agent/transcribe", { method: "POST", headers: { "content-type": "audio/webm" }, body: new Uint8Array([0]) });
    await expect(transcript.json()).resolves.toEqual({ text: "Alexa, play the story Grandpa sent" });
  });
});
