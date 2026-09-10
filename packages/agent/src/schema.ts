import { z } from "zod";

/** What the agent hands the simulator: never prose to parse. */
export const playSchema = z.object({
  url: z.url().describe("The family recording's MP3 URL from get_family_story, untouched"),
  title: z.string().min(1).max(200),
  storyteller: z.string().min(1).max(80),
  durationSeconds: z.number().int().positive().nullable(),
  // Deliberately `string`, not `url`: artwork is decoration, and a model that mangles it
  // must not fail the whole turn's structured output and silence the story. Consumers
  // check it themselves (`packages/skill/src/audio.ts` requires https).
  artUrl: z
    .string()
    .nullish()
    .describe("The story's artUrl from get_family_story, untouched, or null when it has none"),
});

export const turnOutputSchema = z.object({
  say: z.string().min(1).max(400).describe("One or two short spoken sentences"),
  play: playSchema.nullable().describe("The story to play now, or null when nothing should play"),
});

export type Play = z.infer<typeof playSchema>;
export type TurnOutput = z.infer<typeof turnOutputSchema>;

export type ToolTrace = { name: string; ms: number; era: string; ok: boolean };

export const FALLBACK_SAY = "I can't reach Spoken Letter right now. Try again in a moment, or reconnect it in the Alexa app.";
