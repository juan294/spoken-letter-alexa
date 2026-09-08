import { ConditionalCheckFailedException, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { sha256Hex } from "@spoken-letter-alexa/shared";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, test } from "vitest";

import { DynamoStore } from "./dynamo.ts";

const ddb = mockClient(DynamoDBDocumentClient);

function conditionalFailure() {
  return new ConditionalCheckFailedException({ message: "condition failed", $metadata: {} });
}

describe("DynamoStore", () => {
  let store: DynamoStore;

  beforeEach(() => {
    ddb.reset();
    store = new DynamoStore({
      client: DynamoDBDocumentClient.from(new DynamoDBClient({ region: "us-east-1" })),
      tableName: "sla-oauth",
      now: () => 1_100,
    });
  });

  test("putPendingAuth writes AUTH# pk with the TTL attribute and a link-token index item", async () => {
    ddb.on(PutCommand).resolves({});
    await store.putPendingAuth({
      id: "auth_1",
      clientId: "simulator",
      redirectUri: "http://localhost:5173/demo/callback",
      codeChallenge: "c",
      codeChallengeMethod: "S256",
      state: "s",
      scope: "mcp:tools",
      status: "pending",
      linkTokenHash: "lt_hash",
      createdAt: 1_000,
      expiresAt: 1_900,
    });
    const puts = ddb.commandCalls(PutCommand).map((call) => call.args[0].input);
    expect(puts).toHaveLength(2);
    expect(puts[0]).toMatchObject({ TableName: "sla-oauth", Item: { pk: "AUTH#auth_1", sk: "AUTH", expiresAt: 1_900, status: "pending" } });
    expect(puts[1]).toMatchObject({ Item: { pk: "LINK#lt_hash", sk: "LINK", authId: "auth_1", expiresAt: 1_900 } });
  });

  test("leaseLinkToken flips pending to linked conditionally and returns null when the condition fails", async () => {
    ddb.on(GetCommand, { Key: { pk: "LINK#lt_hash", sk: "LINK" } }).resolves({ Item: { authId: "auth_1", expiresAt: 1_900 } });
    ddb.on(UpdateCommand).resolves({
      Attributes: { pk: "AUTH#auth_1", sk: "AUTH", id: "auth_1", status: "linked", clientId: "simulator", expiresAt: 1_900 },
    });
    const leased = await store.leaseLinkToken("lt_hash");
    expect(leased).toMatchObject({ id: "auth_1", status: "linked" });
    const update = ddb.commandCalls(UpdateCommand)[0]!.args[0].input;
    expect(update.ConditionExpression).toMatch(/#status = :pending/);
    expect(update.ConditionExpression).toMatch(/expiresAt > :now/);
    expect(update.ExpressionAttributeValues).toMatchObject({ ":pending": "pending", ":linked": "linked", ":now": 1_100 });

    ddb.on(UpdateCommand).rejects(conditionalFailure());
    await expect(store.leaseLinkToken("lt_hash")).resolves.toBeNull();
    ddb.on(GetCommand).resolves({});
    await expect(store.leaseLinkToken("unknown")).resolves.toBeNull();
  });

  test("consumeCode deletes conditionally; a second use reports reuse with the family", async () => {
    ddb.on(GetCommand, { Key: { pk: "AUTH#auth_1", sk: "AUTH" } }).resolves({
      Item: { id: "auth_1", status: "issued", subject: "uid_1", clientId: "simulator", expiresAt: 1_900 },
    });
    ddb.on(DeleteCommand).resolvesOnce({ Attributes: { authId: "auth_1", expiresAt: 1_400 } });
    const first = await store.consumeCode("code_hash");
    expect(first).toMatchObject({ status: "ok", auth: { id: "auth_1", subject: "uid_1" } });
    const del = ddb.commandCalls(DeleteCommand)[0]!.args[0].input;
    expect(del).toMatchObject({ Key: { pk: "CODE#code_hash", sk: "CODE" }, ReturnValues: "ALL_OLD" });

    // Second use: the code item is gone but the tombstone knows the family.
    ddb.on(DeleteCommand).resolves({});
    ddb.on(GetCommand, { Key: { pk: "USEDCODE#code_hash", sk: "CODE" } }).resolves({ Item: { authId: "auth_1", expiresAt: 1_400 } });
    await expect(store.consumeCode("code_hash")).resolves.toEqual({ status: "reused", familyId: "auth_1" });

    ddb.on(GetCommand, { Key: { pk: "USEDCODE#other", sk: "CODE" } }).resolves({});
    await expect(store.consumeCode("other")).resolves.toEqual({ status: "missing" });
  });

  test("rotateRefreshToken uses a conditional update and reports reuse of a rotated token", async () => {
    ddb.on(UpdateCommand).resolvesOnce({
      Attributes: { hash: "rt1", subject: "uid_1", scope: "mcp:tools", clientId: "simulator", familyId: "auth_1", expiresAt: 9_000 },
    });
    const ok = await store.rotateRefreshToken("rt1");
    expect(ok).toMatchObject({ status: "ok", record: { hash: "rt1", familyId: "auth_1" } });
    const update = ddb.commandCalls(UpdateCommand)[0]!.args[0].input;
    expect(update.ConditionExpression).toMatch(/attribute_not_exists\(rotatedAt\)/);
    expect(update.ConditionExpression).toMatch(/attribute_not_exists\(revokedAt\)/);

    ddb.on(UpdateCommand).rejects(conditionalFailure());
    ddb.on(GetCommand, { Key: { pk: "RT#rt1", sk: "RT" } }).resolves({ Item: { hash: "rt1", familyId: "auth_1", rotatedAt: 1_050, expiresAt: 9_000 } });
    await expect(store.rotateRefreshToken("rt1")).resolves.toEqual({ status: "reused", familyId: "auth_1" });

    ddb.on(GetCommand, { Key: { pk: "RT#gone", sk: "RT" } }).resolves({});
    await expect(store.rotateRefreshToken("gone")).resolves.toEqual({ status: "missing" });
  });

  test("issueCode flips linked to issued conditionally, extends the TTL, then writes the code", async () => {
    ddb.on(UpdateCommand).resolvesOnce({});
    ddb.on(PutCommand).resolves({});
    const code = await store.issueCode("auth_1");
    expect(code).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    const update = ddb.commandCalls(UpdateCommand)[0]!.args[0].input;
    expect(update).toMatchObject({ Key: { pk: "AUTH#auth_1", sk: "AUTH" } });
    expect(update.ConditionExpression).toMatch(/#status = :linked/);
    expect(update.ExpressionAttributeValues).toMatchObject({ ":linked": "linked", ":issued": "issued", ":exp": 1_100 + 300 + 60 });
    const put = ddb.commandCalls(PutCommand)[0]!.args[0].input;
    expect(put).toMatchObject({ Item: { pk: `CODE#${sha256Hex(code!)}`, sk: "CODE", authId: "auth_1", expiresAt: 1_400 } });
    ddb.on(UpdateCommand).rejects(conditionalFailure());
    await expect(store.issueCode("auth_1")).resolves.toBeNull();
    expect(ddb.commandCalls(PutCommand)).toHaveLength(1);
  });

  test("consumeCode treats an expired code as missing and stamps the tombstone with the code's expiry", async () => {
    ddb
      .on(DeleteCommand)
      .resolvesOnce({ Attributes: { authId: "auth_1", expiresAt: 1_000 } })
      .resolvesOnce({ Attributes: { authId: "auth_1", expiresAt: 1_400 } });
    await expect(store.consumeCode("stale")).resolves.toEqual({ status: "missing" });
    ddb.on(GetCommand, { Key: { pk: "AUTH#auth_1", sk: "AUTH" } }).resolves({ Item: { id: "auth_1", status: "issued", subject: "uid_1", clientId: "simulator", expiresAt: 1_460 } });
    ddb.on(PutCommand).resolves({});
    await store.consumeCode("fresh");
    expect(ddb.commandCalls(PutCommand)[0]!.args[0].input).toMatchObject({ Item: { pk: "USEDCODE#fresh", expiresAt: 1_400 } });
  });

  test("bindSubject, putRefreshToken, peekRefreshToken and revokeRefreshToken send the expected commands", async () => {
    ddb.on(UpdateCommand).resolves({});
    ddb.on(PutCommand).resolves({});
    await store.bindSubject("auth_1", "uid_1");
    expect(ddb.commandCalls(UpdateCommand)[0]!.args[0].input).toMatchObject({
      Key: { pk: "AUTH#auth_1", sk: "AUTH" },
      ExpressionAttributeValues: { ":subject": "uid_1" },
    });
    await store.putRefreshToken({ hash: "rt1", subject: "uid_1", scope: "mcp:tools", clientId: "simulator", familyId: "auth_1", expiresAt: 9_000 });
    expect(ddb.commandCalls(PutCommand)[0]!.args[0].input).toMatchObject({
      Item: { pk: "RT#rt1", sk: "RT", subject: "uid_1", familyId: "auth_1", expiresAt: 9_000 },
    });
    ddb.on(GetCommand, { Key: { pk: "RT#rt1", sk: "RT" } }).resolves({
      Item: { hash: "rt1", subject: "uid_1", scope: "mcp:tools", clientId: "simulator", familyId: "auth_1", expiresAt: 9_000, rotatedAt: 1_050 },
    });
    await expect(store.peekRefreshToken("rt1")).resolves.toMatchObject({ hash: "rt1", clientId: "simulator" });
    ddb.on(GetCommand, { Key: { pk: "RT#none", sk: "RT" } }).resolves({});
    await expect(store.peekRefreshToken("none")).resolves.toBeNull();
    await store.revokeRefreshToken("rt1");
    const revoke = ddb.commandCalls(UpdateCommand).at(-1)!.args[0].input;
    expect(revoke).toMatchObject({ Key: { pk: "RT#rt1", sk: "RT" }, ConditionExpression: "attribute_exists(pk)" });
    ddb.on(UpdateCommand).rejects(conditionalFailure());
    await expect(store.revokeRefreshToken("gone")).resolves.toBeUndefined();
  });

  test("rotateRefreshToken reports missing for revoked or expired records after a failed condition", async () => {
    ddb.on(UpdateCommand).rejects(conditionalFailure());
    ddb.on(GetCommand, { Key: { pk: "RT#revoked", sk: "RT" } }).resolves({ Item: { familyId: "f", rotatedAt: 1, revokedAt: 2, expiresAt: 9_000 } });
    await expect(store.rotateRefreshToken("revoked")).resolves.toEqual({ status: "missing" });
    ddb.on(GetCommand, { Key: { pk: "RT#expired", sk: "RT" } }).resolves({ Item: { familyId: "f", rotatedAt: 1, expiresAt: 1_000 } });
    await expect(store.rotateRefreshToken("expired")).resolves.toEqual({ status: "missing" });
  });

  test("revokeFamily and revokeSubject query the GSI and mark every token revoked", async () => {
    ddb.on(QueryCommand).resolves({ Items: [{ pk: "RT#a", sk: "RT" }, { pk: "RT#b", sk: "RT" }] });
    ddb.on(UpdateCommand).resolves({});
    await store.revokeFamily("auth_1");
    await store.revokeSubject("uid_1");
    const queries = ddb.commandCalls(QueryCommand).map((call) => call.args[0].input);
    expect(queries[0]).toMatchObject({ IndexName: "byFamily", ExpressionAttributeValues: { ":family": "auth_1" } });
    expect(queries[1]).toMatchObject({ IndexName: "bySubject", ExpressionAttributeValues: { ":subject": "uid_1" } });
    expect(ddb.commandCalls(UpdateCommand)).toHaveLength(4);
  });
});
