import { DecryptCommand, EncryptCommand, type KMSClient } from "@aws-sdk/client-kms";
import { type DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";

import { type SubscriptionRecord, type SubscriptionStore } from "./subscription-events.ts";

export class KmsUserIdCipher {
  constructor(private readonly options: { client: KMSClient; keyId: string }) {}

  async seal(userId: string, deviceKey: string): Promise<string> {
    const result = await this.options.client.send(new EncryptCommand({
      KeyId: this.options.keyId,
      Plaintext: Buffer.from(userId, "utf8"),
      EncryptionContext: { purpose: "sla-proactive-user-id", deviceKey },
    }));
    if (!result.CiphertextBlob) throw new Error("user id encryption returned no ciphertext");
    return Buffer.from(result.CiphertextBlob).toString("base64");
  }

  async open(ciphertext: string, deviceKey: string): Promise<string> {
    const result = await this.options.client.send(new DecryptCommand({
      CiphertextBlob: Buffer.from(ciphertext, "base64"),
      EncryptionContext: { purpose: "sla-proactive-user-id", deviceKey },
    }));
    if (!result.Plaintext) throw new Error("user id decryption returned no plaintext");
    return Buffer.from(result.Plaintext).toString("utf8");
  }
}

/** The row is keyed by a device hash. Opt-out replaces the row with a ciphertext-free tombstone. */
export class DynamoSubscriptionStore implements SubscriptionStore {
  constructor(private readonly options: { client: DynamoDBDocumentClient; tableName: string }) {}

  async putIfNewer(record: SubscriptionRecord): Promise<boolean> {
    try {
      await this.options.client.send(new PutCommand({
        TableName: this.options.tableName,
        Item: record,
        ConditionExpression: "attribute_not_exists(#order) OR #order < :order",
        ExpressionAttributeNames: { "#order": "order" },
        ExpressionAttributeValues: { ":order": record.order },
      }));
      return true;
    } catch (error) {
      if (error instanceof Error && error.name === "ConditionalCheckFailedException") return false;
      throw error;
    }
  }

  async subscribedCiphertext(deviceKey: string): Promise<string | null> {
    const result = await this.options.client.send(new GetCommand({
      TableName: this.options.tableName,
      Key: { deviceKey },
      ConsistentRead: true,
    }));
    const row = result.Item as SubscriptionRecord | undefined;
    if (!row?.subscribed || row.expiresAt <= Math.floor(Date.now() / 1000)) return null;
    return row.userIdCiphertext ?? null;
  }
}
