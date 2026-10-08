import { type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { describe, expect, test } from "vitest";

import { CREATION_TTL_SECONDS, type CreationStore, DynamoCreationStore, MemoryCreationStore } from "./create-flow.ts";
import { MemoryPlaylistStore } from "./playlist.ts";
import { createAgentApp } from "./routes.ts";
import { ScriptedModel } from "./scripted-model.ts";
import { deviceSessionId, MemorySessionStore } from "./sessions.ts";

/** A DynamoDB stand-in that keeps items by key and records each command's name and input. */
function fakeDynamo() {
  const items = new Map<string, Record<string, unknown>>();
  const commands: { name: string; input: Record<string, unknown> }[] = [];
  const client = {
    send(command: { constructor: { name: string }; input: Record<string, unknown> }) {
      commands.push({ name: command.constructor.name, input: command.input });
      const key = (command.input.Key as { deviceKey?: string } | undefined)?.deviceKey;
      if (command.constructor.name === "GetCommand") return Promise.resolve({ Item: key ? items.get(key) : undefined });
      const item = command.input.Item as Record<string, unknown> & { deviceKey: string };
      items.set(item.deviceKey, item);
      return Promise.resolve({});
    },
  } as unknown as DynamoDBDocumentClient;
  return { client, items, commands };
}

describe.each<[string, () => { store: CreationStore; clock: { now: number } }]>([
  ["MemoryCreationStore", () => { const clock = { now: 1_000 }; return { store: new MemoryCreationStore({ now: () => clock.now }), clock }; }],
  ["DynamoCreationStore", () => { const clock = { now: 1_000 }; return { store: new DynamoCreationStore({ client: fakeDynamo().client, tableName: "t", now: () => clock.now }), clock }; }],
])("%s (C12)", (_name, make) => {
  test("keeps one record per device, stamped, for seven days", async () => {
    const { store, clock } = make();
    expect(await store.get("device")).toBeNull();
    await store.put("device", { stage: "listener" });
    await store.put("device", { stage: "review", listenerId: "samuel" });
    expect(await store.get("device")).toEqual({ record: { stage: "review", listenerId: "samuel" }, updatedAt: 1_000 });
    expect(await store.get("other")).toBeNull();
    clock.now += CREATION_TTL_SECONDS;
    expect(await store.get("device")).toBeNull();
  });
});

test("the DynamoDB store uses only GetItem and PutItem, under create_<deviceKey>, with a TTL", async () => {
  const dynamo = fakeDynamo();
  const store = new DynamoCreationStore({ client: dynamo.client, tableName: "sla-demo-state", now: () => 50 });
  await store.put("abc", { stage: "title", listenerId: "samuel" });
  await store.get("abc");
  expect(dynamo.commands.map((command) => command.name)).toEqual(["PutCommand", "GetCommand"]);
  expect(dynamo.items.get("create_abc")).toEqual({ deviceKey: "create_abc", record: { stage: "title", listenerId: "samuel" }, updatedAt: 50, expiresAt: 50 + 7 * 24 * 60 * 60 });
  expect(dynamo.commands[1]?.input).toMatchObject({ TableName: "sla-demo-state", Key: { deviceKey: "create_abc" }, ConsistentRead: true });
});

test("a stored item that no longer parses reads as no record", async () => {
  const dynamo = fakeDynamo();
  dynamo.items.set("create_abc", { deviceKey: "create_abc", record: { stage: "script" }, updatedAt: 1, expiresAt: 9e9 });
  expect(await new DynamoCreationStore({ client: dynamo.client, tableName: "t", now: () => 2 }).get("abc")).toBeNull();
});

function appWithCreations(store: CreationStore | null = new MemoryCreationStore({ now: () => 77 })) {
  const app = createAgentApp({
    model: new ScriptedModel(), modelId: null, mcpUrl: "http://localhost:4310/mcp", sessions: new MemorySessionStore(),
    speech: { synthesize: () => Promise.resolve(null) }, transcribe: () => Promise.resolve(""),
    demoToken: () => Promise.resolve("unused"), offline: true,
    playlist: { store: new MemoryPlaylistStore(), secret: "test-skill-secret" },
    ...(store && { creations: { store } }),
  });
  const post = (path: string, body: unknown, secret = "test-skill-secret") => app.request(path, {
    method: "POST", headers: { "content-type": "application/json", "x-alexa-skill-secret": secret }, body: JSON.stringify(body),
  });
  return { post };
}

describe("creation routes", () => {
  const device = "amzn1.ask.account.OWNER";

  test("authenticate first, then save and read back the record under the hashed device key", async () => {
    const store = new MemoryCreationStore({ now: () => 77 });
    const { post } = appWithCreations(store);
    expect((await post("/agent/demo/create/save", { deviceUserId: device, record: { stage: "listener" } }, "wrong")).status).toBe(401);
    expect((await post("/agent/demo/create/current", { deviceUserId: device }, "wrong")).status).toBe(401);
    await expect((await post("/agent/demo/create/current", { deviceUserId: device })).json()).resolves.toEqual({ status: "none" });
    const saved = await post("/agent/demo/create/save", { deviceUserId: device, record: { stage: "review", listenerId: "samuel" } });
    await expect(saved.json()).resolves.toEqual({ status: "saved" });
    await expect((await post("/agent/demo/create/current", { deviceUserId: device })).json())
      .resolves.toEqual({ status: "found", record: { stage: "review", listenerId: "samuel" }, updatedAt: 77 });
    expect(await store.get(device)).toBeNull();
    expect((await store.get(deviceSessionId(device)))?.record.stage).toBe("review");
  });

  test("refuses a record with free text or an unknown stage", async () => {
    const { post } = appWithCreations();
    for (const record of [{ stage: "conversation", answer: "a dragon named Mateo" }, { stage: "script" }, { stage: "title", title: "x".repeat(61) }]) {
      const response = await post("/agent/demo/create/save", { deviceUserId: device, record });
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ error: "invalid_request" });
    }
  });

  test("without a store the routes answer 503 create_unavailable", async () => {
    const { post } = appWithCreations(null);
    const response = await post("/agent/demo/create/current", { deviceUserId: device });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: "create_unavailable" });
  });

  test("a failing store answers 503 create_unavailable", async () => {
    const failing: CreationStore = { get: () => Promise.reject(new Error("throttled")), put: () => Promise.reject(new Error("throttled")) };
    const { post } = appWithCreations(failing);
    for (const [path, body] of [["/agent/demo/create/current", { deviceUserId: device }], ["/agent/demo/create/save", { deviceUserId: device, record: { stage: "listener" } }]] as const) {
      const response = await post(path, body);
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({ error: "create_unavailable" });
    }
  });
});
