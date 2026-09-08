import { readEnv } from "@spoken-letter-alexa/shared";
import { z } from "zod";

export const serverEnvShape = {
  PUBLIC_BASE_URL: z.url().default("http://localhost:4310"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4310),
  /** Phase 1 static bearer for local development. Phase 2 replaces it with JWTs. */
  MCP_DEV_TOKEN: z.string().min(16).optional(),
  /** `fixtures` serves the Owner's recordings to every subject; `auto` (Phase 4) routes real subjects to the bridge. */
  PROVIDER_MODE: z.enum(["fixtures", "auto"]).default("fixtures"),
  /** Path to `fixtures/stories.json`, relative to the process cwd. */
  FIXTURES_PATH: z.string().default("fixtures/stories.json"),
};

export type ServerEnv = ReturnType<typeof readServerEnv>;

export function readServerEnv(source?: Record<string, string | undefined>) {
  return readEnv(serverEnvShape, source);
}
