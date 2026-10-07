import { describe, expect, test, vi } from "vitest";

import { buildMessageAlert, getSkillProactiveToken, sendOptedInDevelopmentAlert } from "./proactive-events.ts";

const USER_ID = "amzn1.ask.account.OWNER";

describe("Proactive Events development adapter", () => {
  test("builds the fixed MessageAlert schema with a stable reference and no personal text", () => {
    const input = { userId: USER_ID, eventId: "fixture-story-1", occurredAt: new Date("2026-09-28T12:00:00Z") };
    const first = buildMessageAlert(input);
    expect(first).toEqual({
      timestamp: "2026-09-28T12:00:00.000Z",
      referenceId: first.referenceId,
      expiryTime: "2026-09-28T13:00:00.000Z",
      event: { name: "AMAZON.MessageAlert.Activated", payload: { state: { status: "UNREAD", freshness: "NEW" }, messageGroup: { creator: { name: "Spoken Letter" }, count: 1 } } },
      localizedAttributes: [{ locale: "en-US" }, { locale: "es-ES" }],
      relevantAudience: { type: "Unicast", payload: { user: USER_ID } },
    });
    expect(first.referenceId).toMatch(/^[a-f0-9]{64}$/);
    expect(buildMessageAlert(input).referenceId).toBe(first.referenceId);
    expect(JSON.stringify(first.event)).not.toMatch(/fixture-story|child|birthday|wish/i);
  });

  test("gets a skill credential token with only the proactive-events scope", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify({ access_token: "token", token_type: "bearer" }), { status: 200 })));
    await expect(getSkillProactiveToken({ clientId: "client", clientSecret: "secret", fetch: fetchImpl })).resolves.toBe("token");
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe("https://api.amazon.com/auth/o2/token");
    expect(new URLSearchParams(init?.body as string).get("scope")).toBe("alexa::proactive_events");
  });

  test("sends only to the NA development endpoint after opt-in and reports denial", async () => {
    const fetchImpl = vi.fn<typeof fetch>((url) => Promise.resolve(new Response(url === "https://api.amazon.com/auth/o2/token" ? JSON.stringify({ access_token: "token", token_type: "bearer" }) : "", { status: url === "https://api.amazon.com/auth/o2/token" ? 200 : 403 })));
    const subscriptions = { subscribedCiphertext: vi.fn(() => Promise.resolve<string | null>(null)) };
    const cipher = { open: vi.fn(() => Promise.resolve(USER_ID)) };
    const credentials = vi.fn(() => Promise.resolve({ clientId: "client", clientSecret: "secret" }));
    const args = { deviceKey: "dev_hash", eventId: "fixture-event", occurredAt: new Date("2026-09-28T12:00:00Z"), credentials, fetch: fetchImpl, subscriptions, cipher };
    await expect(sendOptedInDevelopmentAlert(args)).rejects.toThrow(/subscribed/i);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(credentials).not.toHaveBeenCalled();
    subscriptions.subscribedCiphertext.mockResolvedValue("encrypted-user-id");
    await expect(sendOptedInDevelopmentAlert(args)).rejects.toThrow(/403/);
    expect(cipher.open).toHaveBeenCalledWith("encrypted-user-id", "dev_hash");
    expect(fetchImpl.mock.calls[1]?.[0]).toBe("https://api.amazonalexa.com/v1/proactiveEvents/stages/development");
    expect(fetchImpl.mock.calls[1]?.[1]?.headers).toMatchObject({ authorization: "Bearer token" });
  });
});
