import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  type DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { randomToken, sha256Hex } from "@spoken-letter-alexa/shared";

import {
  CODE_TTL_SECONDS,
  type ConsumeCodeResult,
  type OAuthStore,
  type PendingAuth,
  type RefreshRecord,
  type RotateResult,
} from "./types.ts";

/**
 * Single-table layout on `sla-oauth` (CoreStack): `pk`/`sk`, TTL on `expiresAt`, GSIs
 * `byFamily` (familyId) and `bySubject` (subject) over refresh-token items.
 *
 * | pk | sk | item |
 * | --- | --- | --- |
 * | `AUTH#<id>` | `AUTH` | PendingAuth |
 * | `LINK#<sha256 token>` | `LINK` | `{ authId }` |
 * | `CODE#<sha256 code>` | `CODE` | `{ authId }` (deleted on use) |
 * | `USEDCODE#<sha256 code>` | `CODE` | `{ authId }` tombstone so reuse can revoke the family |
 * | `RT#<sha256 token>` | `RT` | RefreshRecord plus `rotatedAt` / `revokedAt` |
 */
export class DynamoStore implements OAuthStore {
  private readonly client: DynamoDBDocumentClient;
  private readonly table: string;
  private readonly now: () => number;

  constructor(options: { client: DynamoDBDocumentClient; tableName: string; now?: () => number }) {
    this.client = options.client;
    this.table = options.tableName;
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
  }

  async putPendingAuth(auth: PendingAuth): Promise<void> {
    await this.client.send(new PutCommand({ TableName: this.table, Item: { pk: `AUTH#${auth.id}`, sk: "AUTH", ...auth } }));
    await this.client.send(
      new PutCommand({
        TableName: this.table,
        Item: { pk: `LINK#${auth.linkTokenHash}`, sk: "LINK", authId: auth.id, expiresAt: auth.expiresAt },
      }),
    );
  }

  async getPendingAuth(id: string): Promise<PendingAuth | null> {
    const result = await this.client.send(new GetCommand({ TableName: this.table, Key: { pk: `AUTH#${id}`, sk: "AUTH" } }));
    return result.Item ? toPendingAuth(result.Item) : null;
  }

  async leaseLinkToken(tokenHash: string): Promise<PendingAuth | null> {
    const link = await this.client.send(new GetCommand({ TableName: this.table, Key: { pk: `LINK#${tokenHash}`, sk: "LINK" } }));
    const authId: unknown = link.Item?.authId;
    if (typeof authId !== "string") return null;
    try {
      const updated = await this.client.send(
        new UpdateCommand({
          TableName: this.table,
          Key: { pk: `AUTH#${authId}`, sk: "AUTH" },
          ConditionExpression: "#status = :pending AND expiresAt > :now",
          UpdateExpression: "SET #status = :linked",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: { ":pending": "pending", ":linked": "linked", ":now": this.now() },
          ReturnValues: "ALL_NEW",
        }),
      );
      return updated.Attributes ? toPendingAuth(updated.Attributes) : null;
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) return null;
      throw error;
    }
  }

  async bindSubject(authId: string, subject: string): Promise<void> {
    await this.client.send(
      new UpdateCommand({
        TableName: this.table,
        Key: { pk: `AUTH#${authId}`, sk: "AUTH" },
        UpdateExpression: "SET #subject = :subject",
        ExpressionAttributeNames: { "#subject": "subject" },
        ExpressionAttributeValues: { ":subject": subject },
      }),
    );
  }

  async issueCode(authId: string): Promise<string | null> {
    const codeExpiresAt = this.now() + CODE_TTL_SECONDS;
    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.table,
          Key: { pk: `AUTH#${authId}`, sk: "AUTH" },
          ConditionExpression: "#status = :linked AND expiresAt > :now",
          UpdateExpression: "SET #status = :issued, expiresAt = :exp",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: { ":linked": "linked", ":issued": "issued", ":now": this.now(), ":exp": codeExpiresAt + 60 },
        }),
      );
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) return null;
      throw error;
    }
    const code = randomToken(32);
    await this.client.send(
      new PutCommand({
        TableName: this.table,
        Item: { pk: `CODE#${sha256Hex(code)}`, sk: "CODE", authId, expiresAt: codeExpiresAt },
      }),
    );
    return code;
  }

  async consumeCode(codeHash: string): Promise<ConsumeCodeResult> {
    const deleted = await this.client.send(
      new DeleteCommand({ TableName: this.table, Key: { pk: `CODE#${codeHash}`, sk: "CODE" }, ReturnValues: "ALL_OLD" }),
    );
    const old = deleted.Attributes;
    if (old && typeof old.authId === "string") {
      if (typeof old.expiresAt !== "number" || old.expiresAt <= this.now()) return { status: "missing" };
      const auth = await this.getPendingAuth(old.authId);
      if (!auth) return { status: "missing" };
      await this.client.send(
        new PutCommand({
          TableName: this.table,
          Item: { pk: `USEDCODE#${codeHash}`, sk: "CODE", authId: old.authId, expiresAt: old.expiresAt },
        }),
      );
      return { status: "ok", auth };
    }
    const tombstone = await this.client.send(
      new GetCommand({ TableName: this.table, Key: { pk: `USEDCODE#${codeHash}`, sk: "CODE" } }),
    );
    const familyId: unknown = tombstone.Item?.authId;
    return typeof familyId === "string" ? { status: "reused", familyId } : { status: "missing" };
  }

  async putRefreshToken(record: RefreshRecord): Promise<void> {
    await this.client.send(new PutCommand({ TableName: this.table, Item: { pk: `RT#${record.hash}`, sk: "RT", ...record } }));
  }

  async peekRefreshToken(hash: string): Promise<RefreshRecord | null> {
    const result = await this.client.send(new GetCommand({ TableName: this.table, Key: { pk: `RT#${hash}`, sk: "RT" } }));
    return result.Item ? toRefreshRecord(result.Item) : null;
  }

  async rotateRefreshToken(hash: string): Promise<RotateResult> {
    try {
      const updated = await this.client.send(
        new UpdateCommand({
          TableName: this.table,
          Key: { pk: `RT#${hash}`, sk: "RT" },
          ConditionExpression:
            "attribute_exists(pk) AND attribute_not_exists(rotatedAt) AND attribute_not_exists(revokedAt) AND expiresAt > :now",
          UpdateExpression: "SET rotatedAt = :now",
          ExpressionAttributeValues: { ":now": this.now() },
          ReturnValues: "ALL_NEW",
        }),
      );
      return updated.Attributes ? { status: "ok", record: toRefreshRecord(updated.Attributes) } : { status: "missing" };
    } catch (error) {
      if (!(error instanceof ConditionalCheckFailedException)) throw error;
    }
    const existing = await this.client.send(new GetCommand({ TableName: this.table, Key: { pk: `RT#${hash}`, sk: "RT" } }));
    const item = existing.Item;
    if (
      item &&
      typeof item.familyId === "string" &&
      item.rotatedAt !== undefined &&
      item.revokedAt === undefined &&
      typeof item.expiresAt === "number" &&
      item.expiresAt > this.now()
    ) {
      return { status: "reused", familyId: item.familyId };
    }
    return { status: "missing" };
  }

  async revokeRefreshToken(hash: string): Promise<void> {
    await this.markRevoked(`RT#${hash}`);
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.revokeWhere("byFamily", "familyId", ":family", familyId);
  }

  async revokeSubject(subject: string): Promise<void> {
    await this.revokeWhere("bySubject", "subject", ":subject", subject);
  }

  private async revokeWhere(index: string, attribute: string, placeholder: string, value: string): Promise<void> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.table,
        IndexName: index,
        KeyConditionExpression: `#attr = ${placeholder}`,
        ExpressionAttributeNames: { "#attr": attribute },
        ExpressionAttributeValues: { [placeholder]: value },
        ProjectionExpression: "pk, sk",
      }),
    );
    for (const item of result.Items ?? []) {
      if (typeof item.pk === "string") await this.markRevoked(item.pk);
    }
  }

  private async markRevoked(pk: string): Promise<void> {
    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.table,
          Key: { pk, sk: "RT" },
          ConditionExpression: "attribute_exists(pk)",
          UpdateExpression: "SET revokedAt = :now",
          ExpressionAttributeValues: { ":now": this.now() },
        }),
      );
    } catch (error) {
      if (!(error instanceof ConditionalCheckFailedException)) throw error;
    }
  }
}

function toPendingAuth(item: Record<string, unknown>): PendingAuth {
  return {
    id: String(item.id),
    clientId: String(item.clientId),
    redirectUri: String(item.redirectUri),
    codeChallenge: String(item.codeChallenge),
    codeChallengeMethod: "S256",
    state: String(item.state),
    scope: String(item.scope),
    status: item.status as PendingAuth["status"],
    subject: typeof item.subject === "string" ? item.subject : undefined,
    linkTokenHash: String(item.linkTokenHash),
    createdAt: Number(item.createdAt),
    expiresAt: Number(item.expiresAt),
  };
}

function toRefreshRecord(item: Record<string, unknown>): RefreshRecord {
  return {
    hash: String(item.hash),
    subject: String(item.subject),
    scope: String(item.scope),
    clientId: String(item.clientId),
    familyId: String(item.familyId),
    expiresAt: Number(item.expiresAt),
    rotatedFrom: typeof item.rotatedFrom === "string" ? item.rotatedFrom : undefined,
  };
}
