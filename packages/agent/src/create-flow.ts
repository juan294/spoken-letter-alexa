import { type DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { type CreationRecord, creationRecordSchema } from "@spoken-letter-alexa/shared";

/** Filming can span days (staged demo plan D5). */
export const CREATION_TTL_SECONDS = 7 * 24 * 60 * 60;

export type StoredCreation = { record: CreationRecord; updatedAt: number };

/**
 * The cross-session copy of a device's creation record (plan D5, revised). The skill keeps the
 * live flow in its session; this copy lets a dropped session resume at take review (SS2).
 */
export interface CreationStore {
  get(deviceKey: string): Promise<StoredCreation | null>;
  put(deviceKey: string, record: CreationRecord): Promise<void>;
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

export class MemoryCreationStore implements CreationStore {
  private readonly records = new Map<string, StoredCreation & { expiresAt: number }>();
  private readonly now: () => number;

  constructor(options: { now?: () => number } = {}) {
    this.now = options.now ?? nowSeconds;
  }

  get(deviceKey: string): Promise<StoredCreation | null> {
    const stored = this.records.get(deviceKey);
    if (!stored || stored.expiresAt <= this.now()) return Promise.resolve(null);
    return Promise.resolve({ record: { ...stored.record }, updatedAt: stored.updatedAt });
  }

  put(deviceKey: string, record: CreationRecord): Promise<void> {
    const now = this.now();
    this.records.set(deviceKey, { record: { ...record }, updatedAt: now, expiresAt: now + CREATION_TTL_SECONDS });
    return Promise.resolve();
  }
}

/** One item per hashed device key in the demo-state table, `create_<deviceKey>`: GetItem and PutItem only. */
export class DynamoCreationStore implements CreationStore {
  constructor(private readonly options: { client: DynamoDBDocumentClient; tableName: string; now?: () => number }) {}

  private now(): number {
    return this.options.now?.() ?? nowSeconds();
  }

  async get(deviceKey: string): Promise<StoredCreation | null> {
    const result = await this.options.client.send(new GetCommand({
      TableName: this.options.tableName, Key: { deviceKey: `create_${deviceKey}` }, ConsistentRead: true,
    }));
    const item = result.Item;
    if (!item || typeof item.expiresAt !== "number" || item.expiresAt <= this.now() || typeof item.updatedAt !== "number") return null;
    // A record written by an older flow (another stage set) reads as none, so the flow starts fresh.
    const record = creationRecordSchema.safeParse(item.record);
    return record.success ? { record: record.data, updatedAt: item.updatedAt } : null;
  }

  async put(deviceKey: string, record: CreationRecord): Promise<void> {
    const now = this.now();
    await this.options.client.send(new PutCommand({
      TableName: this.options.tableName,
      Item: { deviceKey: `create_${deviceKey}`, record, updatedAt: now, expiresAt: now + CREATION_TTL_SECONDS },
    }));
  }
}
