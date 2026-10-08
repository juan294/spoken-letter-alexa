import { type DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { randomToken, sha256Hex, type SkillLocale } from "@spoken-letter-alexa/shared";

import { AGENT_MESSAGES, type PlaylistMessages } from "./messages.ts";
import { type Play } from "./schema.ts";

export const PLAYLIST_TTL_SECONDS = 2 * 60 * 60;
export const PLAYLIST_LIMIT = 20;

export type PlaylistStory = { id: string; title: string; storyteller: string; deliveredAt: string };
export type FreshPlaylistAudio = Play & { expiresAt: number };
export type PlaylistCatalog = {
  list(): Promise<PlaylistStory[]>;
  get(id: string): Promise<FreshPlaylistAudio | null>;
};

export type PlaylistState = {
  ids: string[];
  index: number;
  generation: number;
  currentTokenDigest: string;
  lastEventIdDigest: string | null;
  lastFinishedTokenDigest: string | null;
  pendingFinishedTokenDigest: string | null;
  mode: "shuffle" | "newest" | "title";
  completed: boolean;
  version: number;
  expiresAt: number;
};

export interface PlaylistStore {
  get(deviceKey: string): Promise<PlaylistState | null>;
  compareAndSet(deviceKey: string, expectedVersion: number | null, next: PlaylistState): Promise<boolean>;
}

export class MemoryPlaylistStore implements PlaylistStore {
  private readonly records = new Map<string, PlaylistState>();
  private readonly now: () => number;

  constructor(options: { now?: () => number } = {}) {
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
  }

  get(deviceKey: string): Promise<PlaylistState | null> {
    const record = this.records.get(deviceKey);
    if (!record || record.expiresAt <= this.now()) return Promise.resolve(null);
    return Promise.resolve({ ...record, ids: [...record.ids] });
  }

  compareAndSet(deviceKey: string, expectedVersion: number | null, next: PlaylistState): Promise<boolean> {
    const current = this.records.get(deviceKey);
    const liveVersion = current && current.expiresAt > this.now() ? current.version : null;
    if (liveVersion !== expectedVersion) return Promise.resolve(false);
    this.records.set(deviceKey, { ...next, ids: [...next.ids] });
    return Promise.resolve(true);
  }
}

/** Uses the existing agent session table's `sessionId` key and Dynamo conditional writes. */
export class DynamoPlaylistStore implements PlaylistStore {
  constructor(private readonly options: { client: DynamoDBDocumentClient; tableName: string; now?: () => number }) {}

  private key(deviceKey: string): string {
    return `playlist_${deviceKey}`;
  }

  async get(deviceKey: string): Promise<PlaylistState | null> {
    const result = await this.options.client.send(new GetCommand({ TableName: this.options.tableName,
      Key: { sessionId: this.key(deviceKey) }, ConsistentRead: true }));
    const item = result.Item;
    const now = this.options.now?.() ?? Math.floor(Date.now() / 1000);
    if (!item || typeof item.expiresAt !== "number" || item.expiresAt <= now) return null;
    return item as PlaylistState;
  }

  async compareAndSet(deviceKey: string, expectedVersion: number | null, next: PlaylistState): Promise<boolean> {
    try {
      await this.options.client.send(new PutCommand({
        TableName: this.options.tableName,
        Item: { sessionId: this.key(deviceKey), ...next },
        ConditionExpression: expectedVersion === null ? "attribute_not_exists(sessionId) OR expiresAt <= :now" : "#version = :version",
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

export type PlaylistCommand =
  | { command: "start"; order?: "shuffle" | "newest" | undefined; storyteller?: string | undefined }
  | { command: "title"; title: string; storyteller?: string | undefined }
  | { command: "next" | "previous" | "restart" | "reset"; observedToken?: string | undefined }
  | { command: "resume"; observedToken: string; offsetInMilliseconds: number }
  | { command: "nearlyFinished" | "finished"; observedToken: string; eventId: string };

export type PlaylistResult = {
  action: "play" | "none";
  say: string | null;
  play?: Play;
  token?: string;
  playBehavior?: "REPLACE_ALL" | "ENQUEUE";
  expectedPreviousToken?: string;
  offsetInMilliseconds?: number;
  /** Only a `next` outside a playlist may use the conversational suggestion path. */
  fallbackToSuggestion?: boolean;
};

const none = (say: string | null): PlaylistResult => ({ action: "none", say });
/** Case- and accent-insensitive, so "tio manuel" heard without its accent still matches "Tío Manuel". */
const normalize = (value: string): string => value.trim().normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("en-US");

function tokenFor(generation: number, position: number): string {
  return `pl_${generation}_${position}_${randomToken(24)}`;
}

export class PlaylistController {
  private readonly now: () => number;
  private readonly random: () => number;

  constructor(private readonly options: { store: PlaylistStore; catalog: PlaylistCatalog; now?: () => number; random?: () => number }) {
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
    this.random = options.random ?? Math.random;
  }

  private async fresh(id: string): Promise<{ play: Play; expiresAt: number } | null> {
    const audio = await this.options.catalog.get(id);
    if (!audio || !Number.isFinite(audio.expiresAt) || audio.expiresAt <= this.now() + 30) return null;
    const { expiresAt, ...play } = audio;
    return { play, expiresAt };
  }

  private shuffled(items: PlaylistStory[]): PlaylistStory[] {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const other = Math.floor(this.random() * (index + 1));
      const left = result[index];
      const right = result[other];
      if (left && right) [result[index], result[other]] = [right, left];
    }
    return result;
  }

  async command(deviceKey: string, command: PlaylistCommand, locale: SkillLocale = "en-US"): Promise<PlaylistResult> {
    const m = AGENT_MESSAGES[locale].playlist;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const state = await this.options.store.get(deviceKey);
      const prepared = await this.prepare(state, command, m);
      if (!prepared.next) return prepared.result;
      if (await this.options.store.compareAndSet(deviceKey, state?.version ?? null, prepared.next)) return prepared.result;
    }
    return none(m.playbackChanged);
  }

  private async prepare(state: PlaylistState | null, command: PlaylistCommand, m: PlaylistMessages): Promise<{ result: PlaylistResult; next?: PlaylistState }> {
    if (command.command === "start" || command.command === "title") {
      const catalog = (await this.options.catalog.list()).slice(0, PLAYLIST_LIMIT);
      let available = catalog;
      if (available.length === 0) return { result: none(m.noStoriesYet) };
      if (command.command === "title") {
        available = available.filter((story) => normalize(story.title).includes(normalize(command.title)));
        const storyteller = command.storyteller;
        if (storyteller) {
          const byStoryteller = catalog.filter((story) => normalize(story.storyteller).includes(normalize(storyteller)));
          available = available.filter((story) => byStoryteller.includes(story));
          // A misheard title ("el trasgo") still plays when the named storyteller has only one story.
          if (available.length === 0 && byStoryteller.length === 1) available = byStoryteller;
        }
        if (available.length === 0) return { result: none(catalog.length === PLAYLIST_LIMIT
          ? m.onlyFirst(PLAYLIST_LIMIT, catalog[0]?.title)
          : m.titleNotFound(catalog[0]?.title)) };
        if (available.length > 1) return { result: none(m.whichTitle(command.title, available)) };
      } else {
        const storyteller = command.storyteller;
        if (storyteller) {
          const exact = available.filter((story) => normalize(story.storyteller) === normalize(storyteller));
          available = exact.length > 0 ? exact : available.filter((story) => normalize(story.storyteller).includes(normalize(storyteller)));
          const names = [...new Set(available.map((story) => story.storyteller))];
          if (names.length > 1) return { result: none(m.whichStoryteller(names)) };
        }
        if (available.length === 0) return { result: none(m.noStoryByStoryteller) };
        available = command.order === "newest"
          ? [...available].sort((a, b) => Date.parse(b.deliveredAt) - Date.parse(a.deliveredAt))
          : this.shuffled(available);
        if (command.order !== "newest" && available.length > 1 && available[0]?.id === state?.ids[0]) {
          const first = available[0];
          const second = available[1];
          if (first && second) [available[0], available[1]] = [second, first];
        }
      }
      const first = available[0];
      if (!first) return { result: none(m.noStoriesYet) };
      const audio = await this.fresh(first.id);
      if (!audio) return { result: none(m.recordingUnavailable) };
      const generation = (state?.generation ?? 0) + 1;
      const token = tokenFor(generation, 0);
      return {
        result: { action: "play", say: m.playingBy(first.title, first.storyteller), play: audio.play, token, playBehavior: "REPLACE_ALL" },
        next: { ids: available.map((story) => story.id), index: 0, generation, currentTokenDigest: sha256Hex(token), lastEventIdDigest: null,
          lastFinishedTokenDigest: null, pendingFinishedTokenDigest: null, mode: command.command === "title" ? "title" : command.order ?? "shuffle", completed: false,
          version: (state?.version ?? 0) + 1, expiresAt: this.now() + PLAYLIST_TTL_SECONDS },
      };
    }

    if (!state) return { result: command.command === "next" ? { ...none(null), fallbackToSuggestion: true }
      : none(command.command === "nearlyFinished" || command.command === "finished"
        ? null : command.command === "previous" ? m.noEarlier : m.playFirst) };
    if (command.command === "resume") {
      if (sha256Hex(command.observedToken) !== state.currentTokenDigest) return { result: none(null) };
      const id = state.ids[state.index];
      if (!id) return { result: none(m.playFirst) };
      const audio = await this.fresh(id);
      if (!audio) return { result: none(m.recordingUnavailable) };
      const generation = state.generation + 1;
      const token = tokenFor(generation, state.index);
      return { result: { action: "play", say: null, play: audio.play, token, playBehavior: "REPLACE_ALL",
        offsetInMilliseconds: command.offsetInMilliseconds },
        next: { ...state, generation, currentTokenDigest: sha256Hex(token), pendingFinishedTokenDigest: null,
          version: state.version + 1, expiresAt: this.now() + PLAYLIST_TTL_SECONDS } };
    }
    if (command.command === "nearlyFinished" || command.command === "finished") {
      const observedDigest = sha256Hex(command.observedToken);
      if (sha256Hex(command.eventId) === state.lastEventIdDigest) return { result: none(null) };
      if (command.command === "finished") {
        if (observedDigest === state.lastFinishedTokenDigest ||
          (observedDigest !== state.currentTokenDigest && observedDigest !== state.pendingFinishedTokenDigest)) return { result: none(null) };
        return { result: none(null), next: { ...state, lastEventIdDigest: sha256Hex(command.eventId), lastFinishedTokenDigest: observedDigest,
          pendingFinishedTokenDigest: observedDigest === state.pendingFinishedTokenDigest ? null : state.pendingFinishedTokenDigest,
          completed: observedDigest === state.currentTokenDigest && state.index === state.ids.length - 1,
          version: state.version + 1 } };
      }
      if (observedDigest !== state.currentTokenDigest) return { result: none(null) };
    }

    if (command.command === "next" || command.command === "previous" || command.command === "restart" || command.command === "reset") {
      const observedDigest = command.observedToken ? sha256Hex(command.observedToken) : null;
      if (observedDigest && observedDigest !== state.currentTokenDigest &&
        !(command.command === "next" && observedDigest === state.pendingFinishedTokenDigest)) return { result: none(null) };
    }

    let index = state.index;
    if (command.command === "previous") index -= 1;
    else if (command.command === "nearlyFinished" || (command.command === "next" &&
      (!command.observedToken || sha256Hex(command.observedToken) !== state.pendingFinishedTokenDigest))) index += 1;
    else if (command.command === "reset") index = 0;
    if (index < 0) return { result: none(m.firstInPlaylist) };
    if (index >= state.ids.length) {
      return { result: none(command.command === "nearlyFinished" ? null : m.lastInPlaylist),
        next: { ...state, completed: true, lastEventIdDigest: command.command === "nearlyFinished" ? sha256Hex(command.eventId) : state.lastEventIdDigest,
          version: state.version + 1 } };
    }
    const id = state.ids[index];
    if (!id) return { result: none(m.storyUnavailable) };
    const audio = await this.fresh(id);
    if (!audio) return { result: none(command.command === "nearlyFinished" ? null : m.recordingUnavailable) };
    const generation = state.generation + 1;
    const token = tokenFor(generation, index);
    const enqueue = command.command === "nearlyFinished";
    return {
      result: { action: "play", say: enqueue ? null : m.playing(audio.play.title), play: audio.play, token,
        playBehavior: enqueue ? "ENQUEUE" : "REPLACE_ALL", ...(enqueue && { expectedPreviousToken: command.observedToken }) },
      next: { ...state, index, generation, currentTokenDigest: sha256Hex(token), completed: false,
        pendingFinishedTokenDigest: enqueue ? state.currentTokenDigest : null,
        lastEventIdDigest: enqueue ? sha256Hex(command.eventId) : null, version: state.version + 1, expiresAt: this.now() + PLAYLIST_TTL_SECONDS },
    };
  }
}
