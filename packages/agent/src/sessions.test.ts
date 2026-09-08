import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, test } from "vitest";

import { DynamoSessionStore, MemorySessionStore, newSession, SESSION_TTL_SECONDS } from "./sessions.ts";

const ddb = mockClient(DynamoDBDocumentClient);

describe("newSession", () => {
  test("mints an id, keeps the token in memory only and sets the TTL", () => {
    const session = newSession({ mode: "demo", subject: "svc:alexa-m2m", accessToken: "tok" }, () => 1_000);
    expect(session.id).toMatch(/^[A-Za-z0-9_-]{22,}$/);
    expect(session).toMatchObject({ mode: "demo", subject: "svc:alexa-m2m", accessToken: "tok", history: [], createdAt: 1_000 });
    expect(session.expiresAt).toBe(1_000 + SESSION_TTL_SECONDS);
  });
});

describe("MemorySessionStore", () => {
  test("stores, reads and expires sessions", async () => {
    let now = 1_000;
    const store = new MemorySessionStore({ now: () => now });
    const session = newSession({ mode: "demo", subject: "demo", accessToken: "t" }, () => now);
    await store.put(session);
    await expect(store.get(session.id)).resolves.toEqual(session);
    await expect(store.get("nope")).resolves.toBeNull();
    now += SESSION_TTL_SECONDS + 1;
    await expect(store.get(session.id)).resolves.toBeNull();
  });
});

describe("DynamoSessionStore", () => {
  beforeEach(() => {
    ddb.reset();
  });

  test("writes the session keyed by sessionId with the TTL attribute and reads it back", async () => {
    const store = new DynamoSessionStore({
      client: DynamoDBDocumentClient.from(new DynamoDBClient({ region: "us-east-1" })),
      tableName: "sla-agent-sessions",
      now: () => 1_000,
    });
    const session = newSession({ mode: "linked", subject: "uid_1", accessToken: "jwt" }, () => 1_000);
    ddb.on(PutCommand).resolves({});
    await store.put(session);
    expect(ddb.commandCalls(PutCommand)[0]!.args[0].input).toMatchObject({
      TableName: "sla-agent-sessions",
      Item: { sessionId: session.id, mode: "linked", subject: "uid_1", expiresAt: session.expiresAt },
    });
    ddb.on(GetCommand, { Key: { sessionId: session.id } }).resolves({ Item: { sessionId: session.id, ...session } });
    await expect(store.get(session.id)).resolves.toMatchObject({ id: session.id, subject: "uid_1" });
    ddb.on(GetCommand, { Key: { sessionId: "expired" } }).resolves({ Item: { sessionId: "expired", ...session, expiresAt: 999 } });
    await expect(store.get("expired")).resolves.toBeNull();
    ddb.on(GetCommand, { Key: { sessionId: "none" } }).resolves({});
    await expect(store.get("none")).resolves.toBeNull();
  });
});
