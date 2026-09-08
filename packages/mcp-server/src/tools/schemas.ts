import { z } from "zod";

export const storySummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  storyteller: z.string(),
  durationSeconds: z.number().int().positive().optional(),
  deliveredAt: z.string(),
});

export const storyAudioSchema = z.object({
  url: z.string(),
  expiresAt: z.string(),
  contentType: z.literal("audio/mpeg"),
});

export const storyWithAudioSchema = storySummarySchema.extend({ audio: storyAudioSchema });

export const listInputSchema = z.object({
  limit: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe("How many stories to return, newest first (default 10)"),
});

export const listOutputSchema = z.object({ stories: z.array(storySummarySchema) });

export const getInputSchema = z.object({
  storyId: z.string().min(1).max(64).describe("Story id from list_family_stories"),
});

export const suggestInputSchema = z.object({});

export const suggestOutputSchema = z.object({
  story: storySummarySchema.nullable(),
  reason: z.string(),
});

/** Tool failure classes the plan's tool table names. */
export type ToolErrorCode = "unauthenticated" | "provider_unavailable" | "story_not_found" | "audio_unavailable";

export class ToolFailure extends Error {
  override readonly name = "ToolFailure";
  constructor(
    readonly code: ToolErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** Formats a duration for a spoken summary: "3 minutes", "1 minute", "45 seconds". */
export function spokenDuration(seconds: number | undefined): string | null {
  if (seconds === undefined) return null;
  if (seconds < 60) return `${seconds} seconds`;
  const minutes = Math.round(seconds / 60);
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}
