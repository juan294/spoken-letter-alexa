import { createHash } from "node:crypto";

import { z } from "zod";

const EVENT_NAME = "AMAZON.MessageAlert.Activated";
const SUBSCRIPTION_TTL_SECONDS = 30 * 24 * 60 * 60;

const envelopeSchema = z.object({
  context: z.object({ System: z.object({
    application: z.object({ applicationId: z.string().min(1) }),
    user: z.object({ userId: z.string().min(1).max(512) }),
  }) }),
  request: z.object({
    type: z.literal("AlexaSkillEvent.ProactiveSubscriptionChanged"),
    requestId: z.string().min(1).max(512),
    timestamp: z.string(),
    body: z.object({ subscriptions: z.array(z.object({ eventName: z.string() })) }),
  }),
});

export type SubscriptionRecord = {
  deviceKey: string;
  order: string;
  subscribed: boolean;
  userIdCiphertext?: string;
  expiresAt: number;
};

export interface SubscriptionStore {
  putIfNewer(record: SubscriptionRecord): Promise<boolean>;
}

export class MemorySubscriptionStore implements SubscriptionStore {
  private readonly rows = new Map<string, SubscriptionRecord>();

  putIfNewer(record: SubscriptionRecord): Promise<boolean> {
    const prior = this.rows.get(record.deviceKey);
    if (prior && prior.order >= record.order) return Promise.resolve(false);
    this.rows.set(record.deviceKey, { ...record });
    return Promise.resolve(true);
  }

  snapshot(): SubscriptionRecord[] {
    return [...this.rows.values()].map((row) => ({ ...row }));
  }
}

/** Never writes the raw Alexa user ID; callers seal it before a subscribed state is stored. */
export async function applySubscriptionEvent(
  input: unknown,
  deps: { skillId: string; store: SubscriptionStore; sealUserId: (userId: string, deviceKey: string) => Promise<string> },
): Promise<"applied" | "stale"> {
  const envelope = envelopeSchema.parse(input);
  if (envelope.context.System.application.applicationId !== deps.skillId) throw new Error("skill id mismatch");
  const changedAt = Date.parse(envelope.request.timestamp);
  if (!Number.isFinite(changedAt) || !/^\d{4}-\d{2}-\d{2}T/u.test(envelope.request.timestamp)) throw new Error("invalid subscription timestamp");
  const userId = envelope.context.System.user.userId;
  const deviceKey = `dev_${createHash("sha256").update(`device:${userId}`).digest("hex").slice(0, 32)}`;
  const subscribed = envelope.request.body.subscriptions.some((entry) => entry.eventName === EVENT_NAME);
  const order = `${new Date(changedAt).toISOString()}~${createHash("sha256").update(envelope.request.requestId).digest("hex")}`;
  const record: SubscriptionRecord = {
    deviceKey,
    order,
    subscribed,
    expiresAt: Math.floor(changedAt / 1_000) + SUBSCRIPTION_TTL_SECONDS,
    ...(subscribed && { userIdCiphertext: await deps.sealUserId(userId, deviceKey) }),
  };
  return await deps.store.putIfNewer(record) ? "applied" : "stale";
}
