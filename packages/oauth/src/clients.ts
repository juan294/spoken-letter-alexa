import { constantTimeEqual, sha256Hex } from "@spoken-letter-alexa/shared";
import { z } from "zod";

export const GRANTS = ["authorization_code", "refresh_token", "client_credentials"] as const;
export type Grant = (typeof GRANTS)[number];

const clientSchema = z.object({
  clientId: z.string().min(1).max(64),
  /** sha256 hex of the secret. Absent for public clients (PKCE only). */
  clientSecretHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  redirectUris: z.array(z.url()).default([]),
  grants: z.array(z.enum(GRANTS)).min(1),
  /** Fixed scope for client_credentials clients. */
  scope: z.string().optional(),
});

export type StaticClient = z.infer<typeof clientSchema>;

/** Parses the `OAUTH_CLIENTS` JSON document. Static clients never live in the store. */
export function parseClients(json: string): StaticClient[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error("OAUTH_CLIENTS is not valid JSON");
  }
  const result = z.array(clientSchema).safeParse(raw);
  if (!result.success) {
    const paths = result.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`OAUTH_CLIENTS is invalid at ${paths}`);
  }
  return result.data;
}

export function findClient(clients: StaticClient[], clientId: string): StaticClient | null {
  return clients.find((client) => client.clientId === clientId) ?? null;
}

/**
 * Confidential clients must present their secret; public clients must not. Secrets are
 * compared as sha256 digests in constant time.
 */
export function authenticateClient(
  clients: StaticClient[],
  clientId: string,
  secret: string | undefined,
): StaticClient | null {
  const client = findClient(clients, clientId);
  if (!client) return null;
  if (client.clientSecretHash) {
    if (secret === undefined || !constantTimeEqual(sha256Hex(secret), client.clientSecretHash)) return null;
    return client;
  }
  return secret === undefined ? client : null;
}
