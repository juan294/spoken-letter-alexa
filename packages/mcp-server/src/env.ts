import path from "node:path";

import { readEnv } from "@spoken-letter-alexa/shared";
import { z } from "zod";

/** `<repo>/fixtures/stories.json`, independent of the process cwd (`pnpm -F` runs in the package). */
export const DEFAULT_FIXTURES_PATH = path.resolve(import.meta.dirname, "../../../fixtures/stories.json");

export const serverEnvShape = {
  /** Defaults to `http://localhost:<PORT>`; see `readServerEnv`. */
  PUBLIC_BASE_URL: z.url().optional(),
  PORT: z.coerce.number().int().min(1).max(65535).default(4310),
  /** Phase 1 static bearer for local development. Phase 2 replaces it with JWTs. */
  MCP_DEV_TOKEN: z.string().min(16).optional(),
  /** `fixtures` serves the Owner's recordings to every subject; `auto` (Phase 4) routes real subjects to the bridge. */
  PROVIDER_MODE: z.enum(["fixtures", "auto"]).default("fixtures"),
  /** Absolute or cwd-relative path to the fixture catalog. */
  FIXTURES_PATH: z.string().default(DEFAULT_FIXTURES_PATH),
};

export type ServerEnv = ReturnType<typeof readServerEnv>;

export function readServerEnv(source?: Record<string, string | undefined>) {
  const env = readEnv(serverEnvShape, source);
  return { ...env, PUBLIC_BASE_URL: env.PUBLIC_BASE_URL ?? `http://localhost:${env.PORT}` };
}
