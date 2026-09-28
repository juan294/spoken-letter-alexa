import { describe, expect, test } from "vitest";

import { applySubscriptionEvent, MemorySubscriptionStore } from "./subscription-events.ts";

const SKILL_ID = "amzn1.ask.skill.00000000-0000-4000-8000-000000000000";
const USER_ID = "amzn1.ask.account.OWNER";

function event(timestamp: string, requestId: string, subscriptions: string[]) {
  return {
    version: "1.0",
    context: { System: { application: { applicationId: SKILL_ID }, user: { userId: USER_ID } } },
    request: { type: "AlexaSkillEvent.ProactiveSubscriptionChanged", requestId, timestamp,
      body: { subscriptions: subscriptions.map((eventName) => ({ eventName })) } },
  };
}

describe("subscription events", () => {
  test("stores only encrypted user identity after MessageAlert opt-in", async () => {
    const store = new MemorySubscriptionStore();
    const sealed: string[] = [];
    const applied = await applySubscriptionEvent(event("2026-09-28T12:00:00Z", "one", ["AMAZON.MessageAlert.Activated"]), {
      skillId: SKILL_ID, store, sealUserId: (userId) => { sealed.push(userId); return Promise.resolve("encrypted-user-id"); },
    });
    expect(applied).toBe("applied");
    expect(sealed).toEqual([USER_ID]);
    const rows = store.snapshot();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ subscribed: true, userIdCiphertext: "encrypted-user-id" });
    expect(JSON.stringify(rows)).not.toContain(USER_ID);
  });

  test("unsubscribe erases ciphertext; duplicate and older opt-in cannot restore it", async () => {
    const store = new MemorySubscriptionStore();
    const options = { skillId: SKILL_ID, store, sealUserId: () => Promise.resolve("encrypted-user-id") };
    await applySubscriptionEvent(event("2026-09-28T12:00:00Z", "one", ["AMAZON.MessageAlert.Activated"]), options);
    expect(await applySubscriptionEvent(event("2026-09-28T13:00:00Z", "two", []), options)).toBe("applied");
    expect(store.snapshot()[0]).toMatchObject({ subscribed: false });
    expect(store.snapshot()[0]).not.toHaveProperty("userIdCiphertext");
    expect(await applySubscriptionEvent(event("2026-09-28T12:00:00Z", "one", ["AMAZON.MessageAlert.Activated"]), options)).toBe("stale");
    expect(await applySubscriptionEvent(event("2026-09-28T13:00:00Z", "two", []), options)).toBe("stale");
    expect(store.snapshot()[0]).not.toHaveProperty("userIdCiphertext");
  });

  test("rejects a different skill and malformed timestamps before writing", async () => {
    const store = new MemorySubscriptionStore();
    const options = { skillId: SKILL_ID, store, sealUserId: () => Promise.resolve("encrypted-user-id") };
    const wrong = event("2026-09-28T12:00:00Z", "one", ["AMAZON.MessageAlert.Activated"]);
    wrong.context.System.application.applicationId = "another-skill";
    await expect(applySubscriptionEvent(wrong, options)).rejects.toThrow(/skill/i);
    await expect(applySubscriptionEvent(event("not-a-date", "one", []), options)).rejects.toThrow(/timestamp/i);
    expect(store.snapshot()).toEqual([]);
  });
});
