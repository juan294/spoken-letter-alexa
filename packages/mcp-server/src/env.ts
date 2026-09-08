import path from "node:path";

import { readEnv } from "@spoken-letter-alexa/shared";
import { z } from "zod";

/** `<repo>/fixtures/stories.json`, independent of the process cwd (`pnpm -F` runs in the package). */
export const DEFAULT_FIXTURES_PATH = path.resolve(import.meta.dirname, "../../../fixtures/stories.json");

export const serverEnvShape = {
  /** Public origin and OAuth issuer. Defaults to `http://localhost:<PORT>`; see `readServerEnv`. */
  PUBLIC_BASE_URL: z.url().optional(),
  PORT: z.coerce.number().int().min(1).max(65535).default(4310),
  /** Optional static bearer for the Inspector and curl; JWTs are always accepted. */
  MCP_DEV_TOKEN: z.string().min(16).optional(),
  /** `fixtures` serves the Owner's recordings to every subject; `auto` routes real subjects to the bridge. */
  PROVIDER_MODE: z.enum(["fixtures", "auto"]).default("fixtures"),
  /** Absolute or cwd-relative path to the fixture catalog. */
  FIXTURES_PATH: z.string().default(DEFAULT_FIXTURES_PATH),
  /** Spoken Letter origin hosting `/link/alexa/<token>` and the bridge routes. */
  SPOKEN_LETTER_ORIGIN: z.url().default("http://localhost:3007"),
  /** Shared with the private Spoken Letter API. Generated at startup when absent (local only). */
  ALEXA_BRIDGE_SECRET: z.string().min(16).optional(),
  /** JSON array of static clients (see packages/oauth/src/clients.ts). Local dev clients when absent. */
  OAUTH_CLIENTS: z.string().optional(),
  OAUTH_STORE: z.enum(["memory", "dynamo"]).default("memory"),
  OAUTH_TABLE: z.string().default("sla-oauth"),
  JWT_SIGNER: z.enum(["local", "kms"]).default("local"),
  KMS_KEY_ID: z.string().optional(),
  AWS_REGION: z.string().default("us-east-1"),
  /** `1` mounts `/dev/start` and `/dev/callback`. Never set in production. */
  DEV_ROUTES: z.enum(["0", "1"]).default("0"),
  /** `1` serves 2025-era clients through per-session transports (Inspector contingency, single instance only). */
  MCP_LEGACY_SESSIONS: z.enum(["0", "1"]).default("0"),
};

export type ServerEnv = ReturnType<typeof readServerEnv>;

export function readServerEnv(source?: Record<string, string | undefined>) {
  const env = readEnv(serverEnvShape, source);
  return { ...env, PUBLIC_BASE_URL: env.PUBLIC_BASE_URL ?? `http://localhost:${env.PORT}` };
}
