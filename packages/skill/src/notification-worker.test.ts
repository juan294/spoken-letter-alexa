import { DecryptCommand, KMSClient } from "@aws-sdk/client-kms";
import path from "node:path";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, describe, expect, test, vi } from "vitest";

const ddb = mockClient(DynamoDBDocumentClient);
const kms = mockClient(KMSClient);
const secrets = mockClient(SecretsManagerClient);
const DEVICE_KEY = `dev_${"a".repeat(32)}`;

describe("IAM-only development notification sender", () => {
  const fixturePath = path.resolve(import.meta.dirname, "../../../fixtures/events.json");
  afterEach(() => {
    ddb.reset(); kms.reset(); secrets.reset();
    vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules();
  });

  test("reads opt-in and credentials, then sends one generic development event", async () => {
    vi.stubEnv("SUBSCRIPTIONS_TABLE", "sla-notification-subscriptions");
    vi.stubEnv("USER_ID_KMS_KEY_ID", "key-123");
    vi.stubEnv("SKILL_CREDENTIALS_SECRET_ID", "sla/skill-credentials");
    vi.stubEnv("FIXTURE_EVENTS_PATH", fixturePath);
    ddb.on(GetCommand).resolves({ Item: { deviceKey: DEVICE_KEY, subscribed: true, userIdCiphertext: "AQID", expiresAt: Math.floor(Date.now() / 1000) + 3_600 } });
    kms.on(DecryptCommand).resolves({ Plaintext: Buffer.from("amzn1.ask.account.OWNER") });
    secrets.on(GetSecretValueCommand).resolves({ SecretString: JSON.stringify({ clientId: "client-id", clientSecret: "client-secret" }) });
    const fetchImpl = vi.fn<typeof fetch>((url) => Promise.resolve(new Response(url === "https://api.amazon.com/auth/o2/token" ? JSON.stringify({ access_token: "token", token_type: "bearer" }) : "", { status: url === "https://api.amazon.com/auth/o2/token" ? 200 : 202 })));
    vi.stubGlobal("fetch", fetchImpl);

    const { sendHandler } = await import("./notification-worker.ts");
    await expect(sendHandler({ kind: "send_development_message_alert", deviceKey: DEVICE_KEY, eventId: "fixture_new_mermaid_story", occurredAt: new Date().toISOString() })).resolves.toEqual({ status: "accepted" });
    expect(fetchImpl.mock.calls[1]?.[0]).toBe("https://api.amazonalexa.com/v1/proactiveEvents/stages/development");
    const body = JSON.parse(fetchImpl.mock.calls[1]?.[1]?.body as string) as { event: { payload: unknown }; relevantAudience: { payload: { user: string } } };
    expect(body.relevantAudience.payload.user).toBe("amzn1.ask.account.OWNER");
    expect(JSON.stringify(body.event.payload)).not.toContain("mermaid");
  });

  test("does not fetch credentials or call Amazon when subscription is absent", async () => {
    vi.stubEnv("SUBSCRIPTIONS_TABLE", "sla-notification-subscriptions");
    vi.stubEnv("USER_ID_KMS_KEY_ID", "key-123");
    vi.stubEnv("SKILL_CREDENTIALS_SECRET_ID", "sla/skill-credentials");
    vi.stubEnv("FIXTURE_EVENTS_PATH", fixturePath);
    ddb.on(GetCommand).resolves({ Item: { deviceKey: DEVICE_KEY, subscribed: false, expiresAt: Math.floor(Date.now() / 1000) + 3_600 } });
    const fetchImpl = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchImpl);

    const { sendHandler } = await import("./notification-worker.ts");
    await expect(sendHandler({ kind: "send_development_message_alert", deviceKey: DEVICE_KEY, eventId: "fixture_new_mermaid_story", occurredAt: new Date().toISOString() })).rejects.toThrow(/subscribed/i);
    expect(secrets.commandCalls(GetSecretValueCommand)).toHaveLength(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("rejects an unknown fixture event before LWA or Amazon calls", async () => {
    vi.stubEnv("SUBSCRIPTIONS_TABLE", "sla-notification-subscriptions");
    vi.stubEnv("USER_ID_KMS_KEY_ID", "key-123");
    vi.stubEnv("SKILL_CREDENTIALS_SECRET_ID", "sla/skill-credentials");
    vi.stubEnv("FIXTURE_EVENTS_PATH", fixturePath);
    const fetchImpl = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchImpl);

    const { sendHandler } = await import("./notification-worker.ts");
    await expect(sendHandler({ kind: "send_development_message_alert", deviceKey: DEVICE_KEY, eventId: "unknown", occurredAt: new Date().toISOString() })).rejects.toThrow(/fixture event/i);
    expect(secrets.commandCalls(GetSecretValueCommand)).toHaveLength(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
