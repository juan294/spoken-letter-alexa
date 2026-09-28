import { describe, expect, test } from "vitest";

import { bootstrap } from "./bootstrap.ts";
import { readServerEnv } from "./env.ts";

const BASE = {
  PORT: "4310",
  FIXTURES_PATH: "/nonexistent/stories.json",
  AGENT_OFFLINE: "1",
};

describe("bootstrap", () => {
  test("local: generates the missing secrets once and mounts oauth, mcp, agent and dev routes", async () => {
    const env = readServerEnv({ ...BASE, DEV_ROUTES: "1" });
    const { app, generated, stories } = await bootstrap(env, { allowGenerated: true });
    expect(stories).toBe(0);
    expect(Object.keys(generated).sort()).toEqual(["bridgeSecret", "devToken", "m2mSecret"]);
    expect((await app.request("/healthz")).status).toBe(200);
    expect((await app.request("/.well-known/oauth-authorization-server")).status).toBe(200);
    expect((await app.request("/dev/start")).status).toBe(302);
    await expect((await app.request("/agent/health")).json()).resolves.toEqual({ ok: true, offline: true, model: null });

    // The generated m2m secret really opens the demo session, and the agent reaches /mcp in-process.
    const session = await app.request("/agent/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "demo" }),
    });
    expect(session.status).toBe(200);
    await expect(session.json()).resolves.toMatchObject({ mode: "demo", subject: "svc:alexa-m2m", offline: true });
  });

  test("production posture: nothing is generated and the dev routes are absent", async () => {
    const env = readServerEnv({ ...BASE, PUBLIC_BASE_URL: "https://alexa.spokenletter.com" });
    await expect(bootstrap(env, { allowGenerated: false })).rejects.toThrow(/ALEXA_BRIDGE_SECRET/);
    const withSecret = readServerEnv({ ...BASE, PUBLIC_BASE_URL: "https://alexa.spokenletter.com", ALEXA_BRIDGE_SECRET: "x".repeat(32) });
    await expect(bootstrap(withSecret, { allowGenerated: false })).rejects.toThrow(/OAUTH_CLIENTS/);
    const complete = readServerEnv({
      ...BASE,
      PUBLIC_BASE_URL: "https://alexa.spokenletter.com",
      ALEXA_BRIDGE_SECRET: "x".repeat(32),
      OAUTH_CLIENTS: JSON.stringify([{ clientId: "simulator", redirectUris: ["https://alexa.spokenletter.com/demo/callback"], grants: ["authorization_code"] }]),
      OAUTH_M2M_SECRET: "y".repeat(32),
    });
    await expect(bootstrap(complete, { allowGenerated: false })).rejects.toThrow(/ALEXA_SKILL_COMMAND_SECRET/);
    const withCommand = readServerEnv({
      ...BASE,
      PUBLIC_BASE_URL: "https://alexa.spokenletter.com",
      ALEXA_BRIDGE_SECRET: "x".repeat(32),
      OAUTH_CLIENTS: JSON.stringify([{ clientId: "simulator", redirectUris: ["https://alexa.spokenletter.com/demo/callback"], grants: ["authorization_code"] }]),
      OAUTH_M2M_SECRET: "y".repeat(32),
      ALEXA_SKILL_COMMAND_SECRET: "z".repeat(32),
    });
    const { app, generated } = await bootstrap(withCommand, { allowGenerated: false });
    expect(generated).toEqual({});
    expect((await app.request("/dev/start")).status).toBe(404);
    expect((await app.request("/healthz")).status).toBe(200);
  });

  test("local demo drafts use an in-memory store behind the skill credential", async () => {
    const secret = "local-skill-command-secret-0123456789";
    const env = readServerEnv({ ...BASE, ALEXA_SKILL_COMMAND_SECRET: secret });
    const { app } = await bootstrap(env, { allowGenerated: true });
    const latest = await app.request("/agent/demo/draft/latest", {
      method: "POST",
      headers: { "content-type": "application/json", "x-alexa-skill-secret": secret },
      body: JSON.stringify({ deviceUserId: "parent-device" }),
    });
    expect(latest.status).toBe(200);
    await expect(latest.json()).resolves.toEqual({ status: "none" });
  });

  test("loads validated fixture updates into the authenticated demo inbox", async () => {
    const secret = "local-skill-command-secret-0123456789";
    const env = readServerEnv({ AGENT_OFFLINE: "1", ALEXA_SKILL_COMMAND_SECRET: secret });
    const { app } = await bootstrap(env, { allowGenerated: true });
    const inbox = await app.request("/agent/demo/inbox", { method: "POST",
      headers: { "content-type": "application/json", "x-alexa-skill-secret": secret },
      body: JSON.stringify({ deviceUserId: "parent-device" }) });
    expect(inbox.status).toBe(200);
    await expect(inbox.json()).resolves.toMatchObject({ events: [{ type: "occasion" }, { type: "new_story" }] });
  });

  test("validates a legacy fixture playback URL when the public origin has a trailing slash", async () => {
    const secret = "local-skill-command-secret-0123456789";
    const env = readServerEnv({ AGENT_OFFLINE: "1", PUBLIC_BASE_URL: "https://alexa.spokenletter.com/", ALEXA_SKILL_COMMAND_SECRET: secret });
    const { app } = await bootstrap(env, { allowGenerated: true });
    const observedToken = Buffer.from(JSON.stringify({ id: "st_martina_the_mermaid", title: "Martina the music loving mermaid",
      storyteller: "Aunt Whitney", url: "https://alexa.spokenletter.com/fixtures/audio/st_martina_the_mermaid.mp3" })).toString("base64url");
    const response = await app.request("/agent/demo/playback-finished", { method: "POST",
      headers: { "content-type": "application/json", "x-alexa-skill-secret": secret },
      body: JSON.stringify({ deviceUserId: "parent-device", observedToken, eventId: "callback-1" }) });
    await expect(response.json()).resolves.toEqual({ status: "recorded" });
  });

  test("the bedrock model id and MCP url come from the environment", () => {
    const env = readServerEnv({ ...BASE, BEDROCK_MODEL_ID: "us.amazon.nova-lite-v1:0", MCP_URL: "https://gateway.example/mcp" });
    expect(env.BEDROCK_MODEL_ID).toBe("us.amazon.nova-lite-v1:0");
    expect(env.MCP_URL).toBe("https://gateway.example/mcp");
    expect(readServerEnv(BASE).MCP_URL).toBe("http://localhost:4310/mcp");
    expect(readServerEnv(BASE).DEMO_STATE_TABLE).toBe("sla-demo-state");
    expect(readServerEnv({ ...BASE, DEMO_STATE_TABLE: "custom-demo-state" }).DEMO_STATE_TABLE).toBe("custom-demo-state");
    expect(readServerEnv(BASE).DEMO_STATE_STORE).toBe("memory");
    expect(readServerEnv({ ...BASE, DEMO_STATE_STORE: "dynamo" }).DEMO_STATE_STORE).toBe("dynamo");
  });
});
