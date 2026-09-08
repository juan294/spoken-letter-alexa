import { type DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { randomToken } from "@spoken-letter-alexa/shared";
import { type MessageData } from "@strands-agents/sdk";

export const SESSION_TTL_SECONDS = 2 * 60 * 60;

export type AgentSession = {
  id: string;
  mode: "demo" | "linked";
  /** Display only: `svc:<clientId>` for demo, the Spoken Letter uid for linked. */
  subject: string;
  /** Held in memory or in the session table with a 2-hour TTL; never logged. */
  accessToken: string;
  history: MessageData[];
  createdAt: number;
  expiresAt: number;
};

export interface SessionStore {
  put(session: AgentSession): Promise<void>;
  get(id: string): Promise<AgentSession | null>;
}

export function newSession(
  input: { mode: AgentSession["mode"]; subject: string; accessToken: string },
  now: () => number = () => Math.floor(Date.now() / 1000),
): AgentSession {
  const createdAt = now();
  return { id: randomToken(24), ...input, history: [], createdAt, expiresAt: createdAt + SESSION_TTL_SECONDS };
}

export class MemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, AgentSession>();
  private readonly now: () => number;

  constructor(options: { now?: () => number } = {}) {
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
  }

  put(session: AgentSession): Promise<void> {
    this.sessions.set(session.id, session);
    return Promise.resolve();
  }

  get(id: string): Promise<AgentSession | null> {
    const session = this.sessions.get(id);
    if (!session) return Promise.resolve(null);
    if (session.expiresAt <= this.now()) {
      this.sessions.delete(id);
      return Promise.resolve(null);
    }
    return Promise.resolve(session);
  }
}

/** `sla-agent-sessions` (Phase 6 CoreStack): pk `sessionId`, TTL attribute `expiresAt`. */
export class DynamoSessionStore implements SessionStore {
  private readonly client: DynamoDBDocumentClient;
  private readonly table: string;
  private readonly now: () => number;

  constructor(options: { client: DynamoDBDocumentClient; tableName: string; now?: () => number }) {
    this.client = options.client;
    this.table = options.tableName;
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
  }

  async put(session: AgentSession): Promise<void> {
    await this.client.send(new PutCommand({ TableName: this.table, Item: { sessionId: session.id, ...session } }));
  }

  async get(id: string): Promise<AgentSession | null> {
    const result = await this.client.send(new GetCommand({ TableName: this.table, Key: { sessionId: id } }));
    const item = result.Item;
    if (!item || typeof item.expiresAt !== "number" || item.expiresAt <= this.now()) return null;
    return {
      id: String(item.id ?? item.sessionId),
      mode: item.mode === "linked" ? "linked" : "demo",
      subject: String(item.subject),
      accessToken: String(item.accessToken),
      history: Array.isArray(item.history) ? (item.history as MessageData[]) : [],
      createdAt: Number(item.createdAt),
      expiresAt: item.expiresAt,
    };
  }
}
