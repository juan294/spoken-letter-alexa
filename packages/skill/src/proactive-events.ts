import { createHash } from "node:crypto";

const LWA_TOKEN_URL = "https://api.amazon.com/auth/o2/token";
export const DEVELOPMENT_PROACTIVE_EVENTS_URL = "https://api.amazonalexa.com/v1/proactiveEvents/stages/development";

type Fetch = typeof fetch;

/** Amazon controls the spoken template; fixture detail remains in the skill inbox. */
export function buildMessageAlert(input: { userId: string; eventId: string; occurredAt: Date }) {
  if (!input.userId || !input.eventId || !Number.isFinite(input.occurredAt.getTime())) throw new Error("valid user, event, and timestamp are required");
  return {
    timestamp: input.occurredAt.toISOString(),
    referenceId: createHash("sha256").update(input.eventId).digest("hex"),
    expiryTime: new Date(input.occurredAt.getTime() + 60 * 60 * 1_000).toISOString(),
    event: {
      name: "AMAZON.MessageAlert.Activated" as const,
      payload: { state: { status: "UNREAD" as const, freshness: "NEW" as const }, messageGroup: { creator: { name: "Spoken Letter" }, count: 1 } },
    },
    localizedAttributes: [{ locale: "en-US" as const }, { locale: "es-ES" as const }],
    relevantAudience: { type: "Unicast" as const, payload: { user: input.userId } },
  };
}

/** Credentials are supplied by the caller from a secret store, never from source. */
export async function getSkillProactiveToken(input: { clientId: string; clientSecret: string; fetch?: Fetch }): Promise<string> {
  if (!input.clientId || !input.clientSecret) throw new Error("skill credentials are required");
  const response = await (input.fetch ?? fetch)(LWA_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: input.clientId, client_secret: input.clientSecret, scope: "alexa::proactive_events" }).toString(),
  });
  if (!response.ok) throw new Error(`skill credential token request failed: ${response.status}`);
  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null || !("access_token" in body) || typeof body.access_token !== "string" || body.access_token.length === 0) {
    throw new Error("skill credential token response is invalid");
  }
  return body.access_token;
}

/** Explicit development-only operation. No runtime handler calls this without a separate send authorization. */
export async function sendOptedInDevelopmentAlert(input: {
  deviceKey: string;
  subscriptions: { subscribedCiphertext(deviceKey: string): Promise<string | null> };
  cipher: { open(ciphertext: string, deviceKey: string): Promise<string> };
  eventId: string;
  occurredAt: Date;
  credentials: () => Promise<{ clientId: string; clientSecret: string }>;
  fetch?: Fetch;
}): Promise<void> {
  const ciphertext = await input.subscriptions.subscribedCiphertext(input.deviceKey);
  if (!ciphertext) throw new Error("user is not subscribed to MessageAlert notifications");
  const userId = await input.cipher.open(ciphertext, input.deviceKey);
  const alert = buildMessageAlert({ userId, eventId: input.eventId, occurredAt: input.occurredAt });
  const credentials = await input.credentials();
  const token = await getSkillProactiveToken({ ...credentials, ...(input.fetch && { fetch: input.fetch }) });
  const response = await (input.fetch ?? fetch)(DEVELOPMENT_PROACTIVE_EVENTS_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(alert),
  });
  if (response.status !== 202) throw new Error(`Proactive Events development request failed: ${response.status}`);
}
