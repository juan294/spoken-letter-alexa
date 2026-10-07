import { type DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { type DemoTopic, randomToken, sha256Hex, type SkillLocale } from "@spoken-letter-alexa/shared";
import { Agent, type Model } from "@strands-agents/sdk";
import { z } from "zod";

import { AGENT_MESSAGES } from "./messages.ts";

export const DEMO_DRAFT_TTL_SECONDS = 2 * 60 * 60;
export const DEMO_DRAFT_LIMIT = 10;

export type DraftTheme = DemoTopic;

const choicesSchema = z.object({
  place: z.enum(["quiet shore", "forest path", "starry sky", "cozy room", "sunny meadow"]),
  challenge: z.enum(["small mystery", "lost map", "surprising sound", "unexpected journey"]),
  ending: z.enum(["kindness", "courage", "teamwork", "a restful return"]),
});
export type DraftChoices = z.infer<typeof choicesSchema>;
export type DraftGenerator = (theme: DraftTheme) => Promise<DraftChoices>;

export type DemoDraftReceipt = {
  status: "saved";
  draftId: string;
  theme: DraftTheme;
  outline: string;
};

type StoredReceipt = DemoDraftReceipt & { requestDigest: string; createdAt: number };
export type DemoDraftState = { receipts: StoredReceipt[]; version: number; expiresAt: number };

export interface DemoDraftStore {
  get(deviceKey: string): Promise<DemoDraftState | null>;
  compareAndSet(deviceKey: string, expectedVersion: number | null, next: DemoDraftState): Promise<boolean>;
}

export class MemoryDemoDraftStore implements DemoDraftStore {
  private readonly records = new Map<string, DemoDraftState>();
  private readonly now: () => number;

  constructor(options: { now?: () => number } = {}) {
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
  }

  get(deviceKey: string): Promise<DemoDraftState | null> {
    const record = this.records.get(deviceKey);
    if (!record || record.expiresAt <= this.now()) return Promise.resolve(null);
    return Promise.resolve({ ...record, receipts: record.receipts.map((receipt) => ({ ...receipt })) });
  }

  compareAndSet(deviceKey: string, expectedVersion: number | null, next: DemoDraftState): Promise<boolean> {
    const current = this.records.get(deviceKey);
    const liveVersion = current && current.expiresAt > this.now() ? current.version : null;
    if (liveVersion !== expectedVersion) return Promise.resolve(false);
    this.records.set(deviceKey, { ...next, receipts: next.receipts.map((receipt) => ({ ...receipt })) });
    return Promise.resolve(true);
  }
}

/** One bounded item per hashed device key, in the dedicated demo-state table. */
export class DynamoDemoDraftStore implements DemoDraftStore {
  constructor(private readonly options: { client: DynamoDBDocumentClient; tableName: string; now?: () => number }) {}

  async get(deviceKey: string): Promise<DemoDraftState | null> {
    const result = await this.options.client.send(new GetCommand({
      TableName: this.options.tableName, Key: { deviceKey }, ConsistentRead: true,
    }));
    const item = result.Item;
    const now = this.options.now?.() ?? Math.floor(Date.now() / 1000);
    if (!item || typeof item.expiresAt !== "number" || item.expiresAt <= now) return null;
    return item as DemoDraftState;
  }

  async compareAndSet(deviceKey: string, expectedVersion: number | null, next: DemoDraftState): Promise<boolean> {
    try {
      await this.options.client.send(new PutCommand({
        TableName: this.options.tableName,
        Item: { deviceKey, ...next },
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

export class DemoDraftError extends Error {
  constructor(readonly code: "unsupported_theme" | "draft_unavailable" | "draft_limit_reached") {
    super(code);
  }
}

/**
 * A Spanish word pattern. JavaScript's `\b` treats accented letters as non-word characters, so
 * the boundary is spelled out with Unicode letter classes.
 */
const spanishWords = (alternatives: string): RegExp => new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives})(?![\\p{L}\\p{N}])`, "u");

/** English and Spanish words for each theme; the first matching theme wins. */
const THEME_PATTERNS: [DraftTheme, RegExp][] = [
  ["bedtime", /\b(bedtime|bed time|sleep|sleepy|goodnight)\b/u],
  ["bedtime", spanishWords("dormir|buenas noches")],
  ["space", /\b(space|stars?|rockets?|planets?|moon)\b/u],
  ["space", spanishWords("espacio|estrellas?|cohetes?|planetas?|luna")],
  ["mermaids", /\b(mermaids?|merpeople)\b/u],
  ["mermaids", spanishWords("sirenas?")],
  ["ocean", /\b(ocean|sea|beach|waves?)\b/u],
  ["ocean", spanishWords("océanos?|oceanos?|mar|mares|playas?|olas?")],
  ["forest", /\b(forest|woods?|trees?)\b/u],
  ["forest", spanishWords("bosques?|árbol|árboles|arbol|arboles")],
  ["animals", /\b(animals?|cats?|dogs?|birds?)\b/u],
  ["animals", spanishWords("animal|animales|gat[oa]s?|perr[oa]s?|pájaros?|pajaros?")],
  ["friendship", /\b(friendship|friends?)\b/u],
  ["friendship", spanishWords("amistad|amig[oa]s?")],
];

/** Speech is used only to choose a controlled topic; no part of it reaches the model or store. */
export function canonicalTheme(speech: string): DraftTheme | null {
  // Plain NFKC lowercase is locale-neutral for English and Spanish (plan, phase-3.md step 4).
  const words = speech.normalize("NFKC").toLowerCase();
  return THEME_PATTERNS.find(([, pattern]) => pattern.test(words))?.[0] ?? null;
}

/** Bedrock chooses safe outline components; the renderer alone creates persisted prose. */
export function createModelDraftGenerator(model: Model): DraftGenerator {
  return async (theme) => {
    const agent = new Agent({
      model,
      tools: [],
      structuredOutputSchema: choicesSchema,
      systemPrompt: "Choose a short, gentle story outline. Select only the allowed place, challenge, and ending values. Do not include a person's name, a recipient, delivery, or payment.",
      printer: false,
    });
    const result = await agent.invoke(`Theme: ${theme}. Choose three outline components.`);
    return choicesSchema.parse(result.structuredOutput);
  };
}

function outlineFor(theme: DraftTheme, choices: DraftChoices, locale: SkillLocale): string {
  return AGENT_MESSAGES[locale].drafts.outline(theme, choices.place, choices.challenge, choices.ending);
}

function publicReceipt(stored: StoredReceipt): DemoDraftReceipt {
  return { status: "saved", draftId: stored.draftId, theme: stored.theme, outline: stored.outline };
}

export class DemoDraftController {
  private readonly now: () => number;

  constructor(private readonly options: { store: DemoDraftStore; generator: DraftGenerator; now?: () => number }) {
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
  }

  async latest(deviceKey: string): Promise<DemoDraftReceipt | null> {
    try {
      const state = await this.options.store.get(deviceKey);
      const latest = state?.receipts.at(-1);
      return latest ? publicReceipt(latest) : null;
    } catch {
      throw new DemoDraftError("draft_unavailable");
    }
  }

  /** The outline is rendered once, in the request locale, and stored as text (plan D7). */
  async save(deviceKey: string, requestId: string, speechTheme: string, locale: SkillLocale = "en-US"): Promise<DemoDraftReceipt> {
    const requestDigest = sha256Hex(requestId);
    let prepared: { theme: DraftTheme; outline: string; draftId: string } | null = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      let state: DemoDraftState | null;
      try {
        state = await this.options.store.get(deviceKey);
      } catch {
        throw new DemoDraftError("draft_unavailable");
      }
      const prior = state?.receipts.find((receipt) => receipt.requestDigest === requestDigest);
      if (prior) return publicReceipt(prior);
      if ((state?.receipts.length ?? 0) >= DEMO_DRAFT_LIMIT) throw new DemoDraftError("draft_limit_reached");
      if (!prepared) {
        const theme = canonicalTheme(speechTheme);
        if (!theme) throw new DemoDraftError("unsupported_theme");
        try {
          const choices = choicesSchema.parse(await this.options.generator(theme));
          prepared = { theme, outline: outlineFor(theme, choices, locale), draftId: randomToken(12) };
        } catch {
          throw new DemoDraftError("draft_unavailable");
        }
      }
      const receipt: StoredReceipt = { status: "saved", ...prepared, requestDigest, createdAt: this.now() };
      const next: DemoDraftState = { receipts: [...(state?.receipts ?? []), receipt], version: (state?.version ?? 0) + 1,
        expiresAt: state?.expiresAt ?? this.now() + DEMO_DRAFT_TTL_SECONDS };
      try {
        if (await this.options.store.compareAndSet(deviceKey, state?.version ?? null, next)) return publicReceipt(receipt);
      } catch {
        throw new DemoDraftError("draft_unavailable");
      }
    }
    throw new DemoDraftError("draft_unavailable");
  }
}
