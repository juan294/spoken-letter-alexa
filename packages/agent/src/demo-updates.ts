import { readFile } from "node:fs/promises";

import { type DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { randomToken, sha256Hex } from "@spoken-letter-alexa/shared";
import { z } from "zod";

import { canonicalTheme, type DraftTheme } from "./demo-drafts.ts";

export const DEMO_UPDATE_TTL_SECONDS = 7 * 24 * 60 * 60;
const UPDATE_LIMIT = 20;
const NEW_STORY_DETAIL = "A new demo story is ready.";
const OCCASION_DETAIL = "A family birthday is coming up. You can prepare a demo story draft.";
export type DemoStory = { id: string; title: string; storyteller: string; deliveredAt: string; audioUrl: string };

const seedEventSchema = z.discriminatedUnion("type", [
  z.strictObject({ eventId: z.string().min(1).max(80), type: z.literal("new_story"), occurredAt: z.iso.datetime(),
    storyId: z.string().min(1).max(64), detail: z.string().min(1).max(160) }),
  z.strictObject({ eventId: z.string().min(1).max(80), type: z.literal("occasion"), occurredAt: z.iso.datetime(),
    detail: z.string().min(1).max(160) }),
]);
export type FixtureEvent = z.infer<typeof seedEventSchema>;
export type DemoEvent = { eventId: string; type: "new_story" | "occasion" | "reaction_update" | "wish_update";
  occurredAt: string; detail: string; storyId?: string };

export function parseFixtureEvents(input: unknown, stories: Pick<DemoStory, "id">[]): FixtureEvent[] {
  const parsed = z.strictObject({ events: z.array(seedEventSchema).max(20) }).parse(input);
  const ids = new Set(stories.map((story) => story.id));
  const eventIds = new Set<string>();
  for (const event of parsed.events) {
    if (eventIds.has(event.eventId)) throw new Error(`duplicate fixture event ${event.eventId}`);
    eventIds.add(event.eventId);
    if (event.type === "new_story" && !ids.has(event.storyId)) throw new Error(`fixture event references unknown story ${event.storyId}`);
    if (event.detail !== (event.type === "new_story" ? NEW_STORY_DETAIL : OCCASION_DETAIL)) {
      throw new Error("fixture event detail must use the approved generic wording");
    }
  }
  return parsed.events;
}

export async function loadFixtureEvents(path: string, stories: Pick<DemoStory, "id">[]): Promise<FixtureEvent[]> {
  return parseFixtureEvents(JSON.parse(await readFile(path, "utf8")), stories);
}

type Completion = { storyId: string; eventDigest: string; completedAt: number; promptedAt: number | null; handledAt: number | null };
type Reaction = { reactionId: string; storyId: string; storyteller: string; choice: "like" | "love"; requestDigest: string; createdAt: number };
type Dismissal = { storyId: string; requestDigest: string; createdAt: number };
type Wish = { wishId: string; topic: DraftTheme; storyteller: string | null; requestDigest: string; createdAt: number };
type StoredEvent = DemoEvent & { readAt: number | null; dismissed: boolean };

export type DemoUpdateState = {
  completions: Completion[];
  reactions: Reaction[];
  dismissals: Dismissal[];
  wishes: Wish[];
  events: StoredEvent[];
  version: number;
  expiresAt: number;
};

export interface DemoUpdateStore {
  get(deviceKey: string): Promise<DemoUpdateState | null>;
  compareAndSet(deviceKey: string, expectedVersion: number | null, next: DemoUpdateState): Promise<boolean>;
}

export class MemoryDemoUpdateStore implements DemoUpdateStore {
  private readonly records = new Map<string, DemoUpdateState>();
  private readonly now: () => number;

  constructor(options: { now?: () => number } = {}) {
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
  }

  get(deviceKey: string): Promise<DemoUpdateState | null> {
    const record = this.records.get(`updates_${deviceKey}`);
    if (!record || record.expiresAt <= this.now()) return Promise.resolve(null);
    return Promise.resolve(structuredClone(record));
  }

  compareAndSet(deviceKey: string, expectedVersion: number | null, next: DemoUpdateState): Promise<boolean> {
    const key = `updates_${deviceKey}`;
    const current = this.records.get(key);
    const liveVersion = current && current.expiresAt > this.now() ? current.version : null;
    if (liveVersion !== expectedVersion) return Promise.resolve(false);
    this.records.set(key, structuredClone(next));
    return Promise.resolve(true);
  }
}

/** Uses the draft table with a distinct `updates_` key prefix and conditional writes. */
export class DynamoDemoUpdateStore implements DemoUpdateStore {
  constructor(private readonly options: { client: DynamoDBDocumentClient; tableName: string; now?: () => number }) {}

  async get(deviceKey: string): Promise<DemoUpdateState | null> {
    const result = await this.options.client.send(new GetCommand({ TableName: this.options.tableName,
      Key: { deviceKey: `updates_${deviceKey}` }, ConsistentRead: true }));
    const item = result.Item;
    const now = this.options.now?.() ?? Math.floor(Date.now() / 1000);
    if (!item || typeof item.expiresAt !== "number" || item.expiresAt <= now) return null;
    return item as DemoUpdateState;
  }

  async compareAndSet(deviceKey: string, expectedVersion: number | null, next: DemoUpdateState): Promise<boolean> {
    try {
      await this.options.client.send(new PutCommand({ TableName: this.options.tableName,
        Item: { deviceKey: `updates_${deviceKey}`, ...next },
        ConditionExpression: expectedVersion === null ? "attribute_not_exists(deviceKey) OR expiresAt <= :now" : "#version = :version",
        ...(expectedVersion === null
          ? { ExpressionAttributeValues: { ":now": this.options.now?.() ?? Math.floor(Date.now() / 1000) } }
          : { ExpressionAttributeNames: { "#version": "version" }, ExpressionAttributeValues: { ":version": expectedVersion } }),
      }));
      return true;
    } catch (error) {
      if (error instanceof Error && error.name === "ConditionalCheckFailedException") return false;
      throw error;
    }
  }
}

export class DemoUpdateError extends Error {
  constructor(readonly code: "update_unavailable" | "no_pending_reaction" | "unsupported_topic" |
    "confirmation_required" | "unknown_storyteller" | "ambiguous_storyteller" | "event_not_found" | "update_limit_reached") {
    super(code);
  }
}

type ReactionResult = { status: "saved"; reactionId: string; storyId: string; choice: "like" | "love" } | { status: "dismissed" };
type WishResult = { status: "saved"; wishId: string; topic: DraftTheme; storyteller?: string };
type NextResult = { pendingReaction?: { storyId: string; title: string; storyteller: string }; event?: DemoEvent };

function publicEvent(event: StoredEvent, stories: Map<string, DemoStory>): DemoEvent {
  const { eventId, type, occurredAt, detail } = event;
  const story = event.storyId ? stories.get(event.storyId) : undefined;
  return { eventId, type, occurredAt,
    detail: story ? `${detail} "${story.title}" by ${story.storyteller}.` : detail,
    ...(story && { storyId: story.id }) };
}

export class DemoUpdateController {
  private readonly now: () => number;
  private readonly stories = new Map<string, DemoStory>();

  constructor(private readonly options: { store: DemoUpdateStore; stories: DemoStory[]; seed: FixtureEvent[]; now?: () => number }) {
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
    for (const story of options.stories) this.stories.set(story.id, story);
  }

  private initial(): DemoUpdateState {
    return { completions: [], reactions: [], dismissals: [], wishes: [],
      events: this.options.seed.map((event) => ({ eventId: event.eventId, type: event.type, occurredAt: event.occurredAt,
        detail: event.detail, ...(event.type === "new_story" && { storyId: event.storyId }), readAt: null, dismissed: false })),
      version: 0, expiresAt: this.now() + DEMO_UPDATE_TTL_SECONDS };
  }

  private async state(deviceKey: string): Promise<{ stored: DemoUpdateState | null; state: DemoUpdateState }> {
    try {
      const stored = await this.options.store.get(deviceKey);
      return { stored, state: stored ?? this.initial() };
    } catch {
      throw new DemoUpdateError("update_unavailable");
    }
  }

  private async write(deviceKey: string, stored: DemoUpdateState | null, next: DemoUpdateState): Promise<boolean> {
    try {
      return await this.options.store.compareAndSet(deviceKey, stored?.version ?? null, { ...next, version: (stored?.version ?? 0) + 1 });
    } catch {
      throw new DemoUpdateError("update_unavailable");
    }
  }

  async recordFinished(deviceKey: string, storyId: string, eventId: string): Promise<{ status: "recorded" | "duplicate" | "ignored" }> {
    if (!this.stories.has(storyId)) return { status: "ignored" };
    const eventDigest = sha256Hex(eventId);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const { stored, state } = await this.state(deviceKey);
      if (state.completions.some((item) => item.storyId === storyId || item.eventDigest === eventDigest)) return { status: "duplicate" };
      if (state.completions.length >= UPDATE_LIMIT) throw new DemoUpdateError("update_limit_reached");
      const next = { ...state, completions: [...state.completions, { storyId, eventDigest, completedAt: this.now(), promptedAt: null, handledAt: null }] };
      if (await this.write(deviceKey, stored, next)) return { status: "recorded" };
    }
    throw new DemoUpdateError("update_unavailable");
  }

  /** Legacy direct-play tokens carry a Play payload; only exact delivered fixture audio is accepted. */
  async recordLegacyFinished(deviceKey: string, token: string, eventId: string): Promise<{ status: "recorded" | "duplicate" | "ignored" }> {
    if (token.startsWith("pl_")) return { status: "ignored" };
    let decoded: unknown;
    try {
      if (Buffer.from(token, "base64url").toString("base64url") !== token) return { status: "ignored" };
      decoded = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
    } catch {
      return { status: "ignored" };
    }
    const parsed = z.object({ id: z.string(), url: z.url(), title: z.string(), storyteller: z.string() }).safeParse(decoded);
    if (!parsed.success) return { status: "ignored" };
    const story = this.stories.get(parsed.data.id);
    if (!story) return { status: "ignored" };
    if (parsed.data.url !== story.audioUrl || parsed.data.title !== story.title || parsed.data.storyteller !== story.storyteller) {
      return { status: "ignored" };
    }
    return this.recordFinished(deviceKey, story.id, eventId);
  }

  async next(deviceKey: string): Promise<NextResult> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const { stored, state } = await this.state(deviceKey);
      const active = state.completions.some((item) => item.promptedAt !== null && item.handledAt === null);
      const pending = active ? undefined : state.completions.find((item) => item.promptedAt === null && item.handledAt === null);
      if (pending) {
        const story = this.stories.get(pending.storyId);
        if (!story) throw new DemoUpdateError("update_unavailable");
        const next = { ...state, completions: state.completions.map((item) => item === pending ? { ...item, promptedAt: this.now() } : item) };
        if (await this.write(deviceKey, stored, next)) return { pendingReaction: { storyId: story.id, title: story.title, storyteller: story.storyteller } };
        continue;
      }
      const event = state.events.filter((item) => item.readAt === null).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0];
      return event ? { event: publicEvent(event, this.stories) } : {};
    }
    throw new DemoUpdateError("update_unavailable");
  }

  async react(deviceKey: string, requestId: string, choice: "like" | "love" | "dismiss"): Promise<ReactionResult> {
    const requestDigest = sha256Hex(requestId);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const { stored, state } = await this.state(deviceKey);
      const prior = state.reactions.find((item) => item.requestDigest === requestDigest);
      if (prior) return { status: "saved", reactionId: prior.reactionId, storyId: prior.storyId, choice: prior.choice };
      if (state.dismissals.some((item) => item.requestDigest === requestDigest)) return { status: "dismissed" };
      const pending = state.completions.find((item) => item.promptedAt !== null && item.handledAt === null);
      if (!pending) throw new DemoUpdateError("no_pending_reaction");
      const completed = state.completions.map((item) => item === pending ? { ...item, handledAt: this.now() } : item);
      if (choice === "dismiss") {
        const next = { ...state, completions: completed, dismissals: [...state.dismissals, { storyId: pending.storyId, requestDigest, createdAt: this.now() }] };
        if (await this.write(deviceKey, stored, next)) return { status: "dismissed" };
      } else {
        const story = this.stories.get(pending.storyId);
        if (!story) throw new DemoUpdateError("update_unavailable");
        const reactionId = randomToken(12);
        const reaction: Reaction = { reactionId, storyId: pending.storyId, storyteller: story.storyteller, choice, requestDigest, createdAt: this.now() };
        const event: StoredEvent = { eventId: `reaction_${reactionId}`, type: "reaction_update", occurredAt: new Date(this.now() * 1000).toISOString(),
          detail: "Your demo reaction was saved.", readAt: null, dismissed: false };
        const next = { ...state, completions: completed, reactions: [...state.reactions, reaction], events: [...state.events, event] };
        if (await this.write(deviceKey, stored, next)) return { status: "saved", reactionId, storyId: reaction.storyId, choice };
      }
    }
    throw new DemoUpdateError("update_unavailable");
  }

  async wish(deviceKey: string, requestId: string, speechTopic: string, storytellerQuery: string | undefined, confirmed: boolean): Promise<WishResult> {
    if (!confirmed) throw new DemoUpdateError("confirmation_required");
    const requestDigest = sha256Hex(requestId);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const { stored, state } = await this.state(deviceKey);
      const prior = state.wishes.find((item) => item.requestDigest === requestDigest);
      if (prior) return { status: "saved", wishId: prior.wishId, topic: prior.topic, ...(prior.storyteller && { storyteller: prior.storyteller }) };
      if (state.wishes.length >= UPDATE_LIMIT) throw new DemoUpdateError("update_limit_reached");
      const topic = canonicalTheme(speechTopic);
      if (!topic) throw new DemoUpdateError("unsupported_topic");
      let storyteller: string | null = null;
      if (storytellerQuery) {
        const candidates = [...new Set([...this.stories.values()].map((story) => story.storyteller))];
        const normalize = (value: string) => value.trim().toLocaleLowerCase("en-US");
        const exact = candidates.filter((candidate) => normalize(candidate) === normalize(storytellerQuery));
        const matches = exact.length > 0 ? exact : candidates.filter((candidate) => normalize(candidate).includes(normalize(storytellerQuery)));
        if (matches.length === 0) throw new DemoUpdateError("unknown_storyteller");
        if (matches.length > 1) throw new DemoUpdateError("ambiguous_storyteller");
        storyteller = matches[0] ?? null;
      }
      const wishId = randomToken(12);
      const wish: Wish = { wishId, topic, storyteller, requestDigest, createdAt: this.now() };
      const event: StoredEvent = { eventId: `wish_${wishId}`, type: "wish_update", occurredAt: new Date(this.now() * 1000).toISOString(),
        detail: `Your demo wish about ${topic} is in the fixture inbox.`, readAt: null, dismissed: false };
      const next = { ...state, wishes: [...state.wishes, wish], events: [...state.events, event] };
      if (await this.write(deviceKey, stored, next)) return { status: "saved", wishId, topic, ...(storyteller && { storyteller }) };
    }
    throw new DemoUpdateError("update_unavailable");
  }

  async inbox(deviceKey: string): Promise<{ events: DemoEvent[] }> {
    const { state } = await this.state(deviceKey);
    return { events: state.events.filter((item) => item.readAt === null).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
      .map((event) => publicEvent(event, this.stories)) };
  }

  async markEvent(deviceKey: string, eventId: string, action: "read" | "dismiss"): Promise<{ status: "read" | "dismissed" }> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const { stored, state } = await this.state(deviceKey);
      const event = state.events.find((item) => item.eventId === eventId);
      if (!event) throw new DemoUpdateError("event_not_found");
      if (event.readAt !== null) return { status: event.dismissed ? "dismissed" : "read" };
      const next = { ...state, events: state.events.map((item) => item === event ? { ...item, readAt: this.now(), dismissed: action === "dismiss" } : item) };
      if (await this.write(deviceKey, stored, next)) return { status: action === "dismiss" ? "dismissed" : "read" };
    }
    throw new DemoUpdateError("update_unavailable");
  }
}
