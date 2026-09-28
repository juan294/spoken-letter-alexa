// The manifest sends subscription changes directly here. This Lambda is the only runtime
// with permission to encrypt, store, and decrypt Alexa's raw per-skill user ID.
import { readFile } from "node:fs/promises";

import { KMSClient } from "@aws-sdk/client-kms";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { log } from "@spoken-letter-alexa/shared";
import { z } from "zod";

import { sendOptedInDevelopmentAlert } from "./proactive-events.ts";
import { applySubscriptionEvent } from "./subscription-events.ts";
import { DynamoSubscriptionStore, KmsUserIdCipher } from "./subscription-store.ts";

const skillId = process.env.SKILL_ID;
const tableName = process.env.SUBSCRIPTIONS_TABLE;
const keyId = process.env.USER_ID_KMS_KEY_ID;
const credentialsSecretId = process.env.SKILL_CREDENTIALS_SECRET_ID;
const fixtureEventsPath = process.env.FIXTURE_EVENTS_PATH;

function resources() {
  if (!tableName || !keyId) throw new Error("notification worker configuration is incomplete");
  const region = process.env.AWS_REGION ?? "us-east-1";
  return {
    region,
    store: new DynamoSubscriptionStore({ client: DynamoDBDocumentClient.from(new DynamoDBClient({ region })), tableName }),
    cipher: new KmsUserIdCipher({ client: new KMSClient({ region }), keyId }),
  };
}

export async function handler(event: unknown): Promise<void> {
  if (!skillId) throw new Error("notification worker skill id is missing");
  const { store, cipher } = resources();
  const result = await applySubscriptionEvent(event, { skillId, store, sealUserId: (userId, deviceKey) => cipher.seal(userId, deviceKey) });
  log.info("proactive_subscription_change", { result });
}

const sendRequestSchema = z.object({
  kind: z.literal("send_development_message_alert"),
  deviceKey: z.string().regex(/^dev_[a-f0-9]{32}$/u),
  eventId: z.string().min(1).max(256),
  occurredAt: z.iso.datetime(),
}).strict();
const credentialsSchema = z.object({ clientId: z.string().min(1), clientSecret: z.string().min(1) });
const fixtureEventsSchema = z.object({ events: z.array(z.object({ eventId: z.string().min(1) })).max(20) });

/** IAM-only Lambda entry. It has no Alexa invoke grant and no production endpoint. */
export async function sendHandler(input: unknown): Promise<{ status: "accepted" }> {
  const request = sendRequestSchema.parse(input);
  const occurredAt = new Date(request.occurredAt);
  if (Math.abs(Date.now() - occurredAt.getTime()) > 5 * 60 * 1_000) throw new Error("development notification timestamp must be current");
  if (!fixtureEventsPath) throw new Error("FIXTURE_EVENTS_PATH is required");
  const fixtures = fixtureEventsSchema.parse(JSON.parse(await readFile(fixtureEventsPath, "utf8")) as unknown);
  if (!fixtures.events.some((event) => event.eventId === request.eventId)) throw new Error("unknown fixture event");
  if (!credentialsSecretId) throw new Error("SKILL_CREDENTIALS_SECRET_ID is required");
  const { region, store, cipher } = resources();
  await sendOptedInDevelopmentAlert({
    deviceKey: request.deviceKey,
    subscriptions: store,
    cipher,
    eventId: request.eventId,
    occurredAt,
    credentials: async () => {
      const result = await new SecretsManagerClient({ region }).send(new GetSecretValueCommand({ SecretId: credentialsSecretId }));
      if (!result.SecretString) throw new Error("skill credentials secret has no value");
      return credentialsSchema.parse(JSON.parse(result.SecretString) as unknown);
    },
  });
  log.info("development_notification_accepted");
  return { status: "accepted" };
}
