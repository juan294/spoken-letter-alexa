import { z } from "zod";

/**
 * The four mixes of one take (staged demo plan D3, D7): as read, with effects, with music,
 * with both. Each is an MP3 in `fixtures/takes/` in the SSML audio format.
 */
export const TAKE_VARIANTS = ["plain", "effects", "music", "both"] as const;
export type TakeVariant = (typeof TAKE_VARIANTS)[number];

/** A file name inside `fixtures/takes/`: no path, lowercase, `.mp3`. */
const takeFile = z.string().regex(/^[a-z0-9_-]+\.mp3$/);

const takesManifestSchema = z.strictObject({
  takes: z.array(z.strictObject({
    /** The script as written, shown on the teleprompter; matched after `normalizeScript`. */
    script: z.string().trim().min(1),
    files: z.strictObject({ plain: takeFile, effects: takeFile, music: takeFile, both: takeFile }),
  })),
});

export type TakesManifest = z.infer<typeof takesManifestSchema>;
export type Take = TakesManifest["takes"][number];

/** Script text for matching: lowercase, letters and digits only, single spaces. */
export function normalizeScript(text: string): string {
  return text.toLowerCase().replace(/['’]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** Parses `fixtures/takes/manifest.json`. A bad shape or a repeated script throws. */
export function parseTakesManifest(input: unknown): TakesManifest {
  const result = takesManifestSchema.safeParse(input);
  if (!result.success) {
    const paths = result.error.issues.map((issue) => issue.path.join(".") || "(root)").join(", ");
    throw new Error(`fixtures/takes/manifest.json is invalid at ${paths}`);
  }
  const scripts = new Set<string>();
  for (const take of result.data.takes) {
    const key = normalizeScript(take.script);
    if (scripts.has(key)) throw new Error(`fixtures/takes/manifest.json has two takes for the script "${take.script}"`);
    scripts.add(key);
  }
  return result.data;
}

export function findTake(manifest: TakesManifest, script: string): Take | undefined {
  const key = normalizeScript(script);
  return manifest.takes.find((take) => normalizeScript(take.script) === key);
}
