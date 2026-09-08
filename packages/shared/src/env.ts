import { z } from "zod";

export type EnvSource = Record<string, string | undefined>;

/**
 * Parses the declared keys out of `source` (defaults to `process.env`).
 *
 * Throws once at startup listing every invalid or missing key **name**. The message
 * never contains a value, so it is safe to let it reach logs.
 */
export function readEnv<T extends Record<string, z.ZodType>>(
  shape: T,
  source: EnvSource = process.env,
): z.infer<z.ZodObject<T>> {
  const picked: Record<string, string | undefined> = {};
  for (const key of Object.keys(shape)) picked[key] = source[key];
  const result = z.object(shape).safeParse(picked);
  if (result.success) return result.data;
  const keys = [...new Set(result.error.issues.map((issue) => String(issue.path[0] ?? "?")))];
  throw new Error(`Invalid environment: ${keys.join(", ")}`);
}
