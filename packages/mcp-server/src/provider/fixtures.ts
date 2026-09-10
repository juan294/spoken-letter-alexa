import { readFile } from "node:fs/promises";

import { z } from "zod";

import { type AccountProvider, type StorySummary, type StoryWithAudio } from "./types.ts";

const fixtureStorySchema = z
  .object({
    id: z.string().regex(/^[a-z0-9_-]{1,64}$/),
    title: z.string().min(1).max(200),
    storyteller: z.string().min(1).max(80),
    durationSeconds: z.number().int().positive().optional(),
    deliveredAt: z.iso.datetime(),
    /** File name under `fixtures/audio/`; always `<id>.mp3`. */
    file: z.string().regex(/^[a-z0-9_-]+\.mp3$/),
    /** File name under `fixtures/art/`; always `<id>.png`. Absent when the story has no artwork. */
    art: z
      .string()
      .regex(/^[a-z0-9_-]+\.png$/)
      .optional(),
  })
  .refine((story) => story.file === `${story.id}.mp3`, { path: ["file"], message: "file must be <id>.mp3" })
  .refine((story) => story.art === undefined || story.art === `${story.id}.png`, {
    path: ["art"],
    message: "art must be <id>.png",
  });

const fixtureCatalogSchema = z.object({ stories: z.array(fixtureStorySchema) });

export type FixtureStory = z.infer<typeof fixtureStorySchema>;

export const AUDIO_TTL_MS = 60 * 60 * 1000;

/** Parses `fixtures/stories.json`. Unknown keys are dropped; a bad shape throws with its path. */
export function parseFixtureCatalog(input: unknown): FixtureStory[] {
  const result = fixtureCatalogSchema.safeParse(input);
  if (!result.success) {
    const paths = result.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`fixtures/stories.json is invalid at ${paths}`);
  }
  return result.data.stories;
}

export async function loadFixtureCatalog(path: string): Promise<FixtureStory[]> {
  return parseFixtureCatalog(JSON.parse(await readFile(path, "utf8")));
}

/**
 * Serves the Owner's own recorded stories (author's voice) for the `demo` subject and
 * for judges. Audio URLs point at `${publicBaseUrl}/fixtures/audio/<file>` and artwork at
 * `${publicBaseUrl}/fixtures/art/<art>`: served by the local Hono app in development and
 * by S3 behind CloudFront once deployed.
 */
export class FixtureProvider implements AccountProvider {
  private readonly stories: FixtureStory[];
  private readonly publicBaseUrl: string;

  constructor(options: { stories: FixtureStory[]; publicBaseUrl: string }) {
    this.stories = [...options.stories].sort((a, b) => Date.parse(b.deliveredAt) - Date.parse(a.deliveredAt));
    this.publicBaseUrl = options.publicBaseUrl.replace(/\/$/, "");
  }

  private toSummary(story: FixtureStory): StorySummary {
    return {
      id: story.id,
      title: story.title,
      storyteller: story.storyteller,
      durationSeconds: story.durationSeconds,
      deliveredAt: story.deliveredAt,
      // Absent, not undefined: a story with no artwork carries no `artUrl` key at all.
      ...(story.art !== undefined && { artUrl: `${this.publicBaseUrl}/fixtures/art/${story.art}` }),
    };
  }

  listDeliveredStories(_subject: string, limit: number): Promise<StorySummary[]> {
    return Promise.resolve(this.stories.slice(0, limit).map((story) => this.toSummary(story)));
  }

  getStory(_subject: string, storyId: string): Promise<StoryWithAudio | null> {
    const story = this.stories.find((entry) => entry.id === storyId);
    if (!story) return Promise.resolve(null);
    return Promise.resolve({
      ...this.toSummary(story),
      audio: {
        url: `${this.publicBaseUrl}/fixtures/audio/${story.file}`,
        expiresAt: new Date(Date.now() + AUDIO_TTL_MS).toISOString(),
        contentType: "audio/mpeg",
      },
    });
  }
}
