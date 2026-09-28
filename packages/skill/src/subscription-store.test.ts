import { EncryptCommand, KMSClient } from "@aws-sdk/client-kms";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, test } from "vitest";

import { DynamoSubscriptionStore, KmsUserIdCipher } from "./subscription-store.ts";

const kms = mockClient(KMSClient);
const ddb = mockClient(DynamoDBDocumentClient);

describe("notification worker storage", () => {
  beforeEach(() => { kms.reset(); ddb.reset(); });

  test("KMS seals the raw user ID under a device-bound encryption context", async () => {
    kms.on(EncryptCommand).resolves({ CiphertextBlob: Uint8Array.from([1, 2, 3]) });
    const cipher = new KmsUserIdCipher({ client: new KMSClient({ region: "us-east-1" }), keyId: "alias/test" });
    await expect(cipher.seal("amzn1.ask.account.OWNER", "dev_hash")).resolves.toBe("AQID");
    expect(kms.commandCalls(EncryptCommand)[0]?.args[0].input).toMatchObject({
      KeyId: "alias/test",
      EncryptionContext: { purpose: "sla-proactive-user-id", deviceKey: "dev_hash" },
    });
  });

  test("Dynamo write uses a conditional order and omits ciphertext on unsubscribe", async () => {
    ddb.on(PutCommand).resolves({});
    const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: "us-east-1" }));
    const store = new DynamoSubscriptionStore({ client, tableName: "sla-notification-subscriptions" });
    const base = { deviceKey: "dev_hash", order: "2026-09-28T12:00:00.000Z~digest", expiresAt: 1_800_000_000 };
    await expect(store.putIfNewer({ ...base, subscribed: true, userIdCiphertext: "AQID" })).resolves.toBe(true);
    await expect(store.putIfNewer({ ...base, order: "2026-09-28T13:00:00.000Z~digest", subscribed: false })).resolves.toBe(true);
    const calls = ddb.commandCalls(PutCommand).map((call) => call.args[0].input);
    expect(calls[0]?.ConditionExpression).toMatch(/#order < :order/);
    expect(calls[0]?.Item).toMatchObject({ deviceKey: "dev_hash", userIdCiphertext: "AQID" });
    expect(calls[1]?.Item).not.toHaveProperty("userIdCiphertext");
    expect(JSON.stringify(calls)).not.toContain("amzn1.ask.account.OWNER");
  });
});
