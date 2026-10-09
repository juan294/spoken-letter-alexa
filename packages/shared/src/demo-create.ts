import { z } from "zod";

import { TAKE_VARIANTS } from "./takes.ts";
import { foldName } from "./text.ts";

/**
 * `fixtures/demo-create.json`: everything the staged create flow says that is not generic copy
 * (staged demo plan, revision for Jordan's script). The listener's first name is the Owner's
 * exception to D9 and ADR 0013 for this demo; nothing else about a real family is stored.
 */
const packSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/).max(40),
  name: z.string().trim().min(1).max(40),
  credits: z.int().min(1),
  /** Spoken as written ("19.99"); the currency word is the purchase's. */
  price: z.string().regex(/^\d{1,4}(?:\.\d{2})?$/),
  /** Other spoken forms ("founding family"), for the `PackName` slot type and `findPack`. */
  synonyms: z.array(z.string().trim().min(1).max(40)).default([]),
});

const demoCreateSchema = z.strictObject({
  /**
   * The account's story credit balance; one is used per story. Zero plays Jordan's purchase scene
   * (script lines 9-15) from `purchase`; more skips it, which is her fallback.
   */
  credits: z.int().min(0),
  /** The staged purchase: nothing is charged, and no store or entitlement is touched. */
  purchase: z.strictObject({
    currency: z.string().trim().min(1).max(20),
    packs: z.array(packSchema).min(1).max(5),
  }).optional(),
  listeners: z.array(z.strictObject({
    id: z.string().regex(/^[a-z0-9-]+$/),
    name: z.string().trim().min(1).max(40),
    /** Other spoken forms of the name ("Sam"), for the `ListenerName` slot type. */
    synonyms: z.array(z.string().trim().min(1).max(40)).default([]),
    /** A saved wish: "There's a saved wish for <name>: <phrase>. … a story about <topic>?" */
    wish: z.strictObject({ phrase: z.string().trim().min(1).max(80), topic: z.string().trim().min(1).max(40) }).optional(),
  })).min(1),
  story: z.strictObject({
    /** Alexa's fixed replies to the first and second conversation answers; the third gets the generic hand-over. */
    replies: z.array(z.string().trim().min(1).max(200)).length(2),
    /** The title the adult gives the story, for the `StoryTitle` slot type. */
    title: z.string().trim().min(1).max(60),
    /** The script shown on screen, paragraphs separated by a blank line. A take must match it. */
    script: z.string().trim().min(1),
  }),
});

export type DemoCreate = z.infer<typeof demoCreateSchema>;
export type DemoListener = DemoCreate["listeners"][number];
export type DemoPack = z.infer<typeof packSchema>;

/** Parses `fixtures/demo-create.json`. A bad shape, a repeated id, or a name heard two ways throws. */
export function parseDemoCreate(input: unknown): DemoCreate {
  const result = demoCreateSchema
    .refine((demo) => demo.credits > 0 || demo.purchase !== undefined, { path: ["purchase"], message: "zero credits needs packs to buy" })
    .safeParse(input);
  if (!result.success) {
    const paths = result.error.issues.map((issue) => issue.path.join(".") || "(root)").join(", ");
    throw new Error(`fixtures/demo-create.json is invalid at ${paths}`);
  }
  const ids = new Set<string>();
  const spoken = new Set<string>();
  for (const listener of result.data.listeners) {
    if (ids.has(listener.id)) throw new Error(`fixtures/demo-create.json repeats the listener id "${listener.id}"`);
    ids.add(listener.id);
    for (const name of [listener.name, ...listener.synonyms]) {
      const key = foldName(name);
      if (spoken.has(key)) throw new Error(`fixtures/demo-create.json names two listeners "${name}"`);
      spoken.add(key);
    }
  }
  const packIds = new Set<string>();
  const packNames = new Set<string>();
  for (const pack of result.data.purchase?.packs ?? []) {
    if (packIds.has(pack.id)) throw new Error(`fixtures/demo-create.json repeats the pack id "${pack.id}"`);
    packIds.add(pack.id);
    for (const name of [pack.name, ...pack.synonyms]) {
      const key = foldName(name);
      if (packNames.has(key)) throw new Error(`fixtures/demo-create.json names two packs "${name}"`);
      packNames.add(key);
    }
  }
  return result.data;
}

/**
 * The pack a spoken reply names: any pack name or synonym inside the words, longest form first,
 * so "the Founding family pack" is never heard as "Family story pack".
 */
export function findPack(demo: DemoCreate, spoken: string): DemoPack | undefined {
  // Words only, on both sides, so punctuation in speech or in a name ("Founder's pack") never blocks a match.
  const words = (text: string) => ` ${foldName(text).replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
  const heard = words(spoken);
  const forms = (demo.purchase?.packs ?? [])
    .flatMap((pack) => [pack.name, ...pack.synonyms].map((form) => ({ pack, form: words(form) })))
    .sort((a, b) => b.form.length - a.form.length);
  return forms.find(({ form }) => heard.includes(form))?.pack;
}

/** The listener a spoken or resolved name means, ignoring case and accents. */
export function findListener(demo: DemoCreate, name: string): DemoListener | undefined {
  const key = foldName(name);
  return demo.listeners.find((listener) => [listener.name, ...listener.synonyms].some((form) => foldName(form) === key));
}

/**
 * The create flow's stages, in order. `sent` and `stopped` are stored only: the session ends,
 * and neither resumes.
 * Kept here because the skill's session attributes and the agent's record share it.
 */
export const CREATE_STAGES = ["credits", "pack", "purchase", "listener", "wish", "conversation", "recording", "review", "title", "sound", "finish", "sent", "stopped"] as const;
export type CreateStage = (typeof CREATE_STAGES)[number];
export const isCreateStage = (value: unknown): value is CreateStage => (CREATE_STAGES as readonly unknown[]).includes(value);

/** The conversation's three answers: 0 before the first, 3 never stored (the third moves to `recording`). */
export const CONVERSATION_ANSWERS = 3;

/**
 * The creation record (plan D5, revised): codes and counts, plus the title the adult chose. No
 * answer text is stored; the fixed replies come from the fixture.
 */
export const creationRecordSchema = z.strictObject({
  stage: z.enum(CREATE_STAGES),
  listenerId: z.string().regex(/^[a-z0-9-]+$/).max(40).optional(),
  answers: z.int().min(0).max(CONVERSATION_ANSWERS - 1).optional(),
  title: z.string().trim().min(1).max(60).optional(),
  sound: z.enum(TAKE_VARIANTS).optional(),
  /** In `purchase`: the pack waiting for confirmation, by id. */
  packId: z.string().regex(/^[a-z0-9-]+$/).max(40).optional(),
  /** In `recording`: the adult said "record", so a dropped session resumes at review (SS2). */
  reading: z.literal(true).optional(),
});
export type CreationRecord = z.infer<typeof creationRecordSchema>;
