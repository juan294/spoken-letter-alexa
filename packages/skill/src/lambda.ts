// The skill Lambda entry (infra/lib/skill-stack.ts, bundled by infra/scripts/bundle-lambda.mjs).
// Alexa invokes it directly with the request envelope; there is no HTTP layer.
import { log } from "@spoken-letter-alexa/shared";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

import { createAgentClient } from "./agent-client.ts";
import { type AlexaRequestEnvelope, type AlexaResponseEnvelope, createHandler } from "./handler.ts";

/**
 * Alexa waits about 8 s for the skill; the whole agent round trip gets 7. The first real
 * device turn measured 5.7 s (two Bedrock calls plus one 39 ms tool call), so 6 s left
 * no margin for a slower model call.
 */
const AGENT_BUDGET_MS = 7_000;

const publicBaseUrl = process.env.PUBLIC_BASE_URL;
const skillId = process.env.SKILL_ID;
if (!publicBaseUrl) throw new Error("PUBLIC_BASE_URL is required");
if (!skillId) throw new Error("SKILL_ID is required: deploy the skill (pnpm -F skill deploy) and redeploy the stack with -c sla:skillId=<id>");
const commandArn = process.env.SECRETS_SKILL_COMMAND_ARN;
if (!commandArn) throw new Error("SECRETS_SKILL_COMMAND_ARN is required");
const command = await new SecretsManagerClient({ region: process.env.AWS_REGION ?? "us-east-1" }).send(new GetSecretValueCommand({ SecretId: commandArn }));
if (!command.SecretString) throw new Error("sla/skill-command has no value");

const recording = process.env.RECORD_UTTERANCES === "1";
if (recording) log.warn("raw_recording_disabled", { control: "RECORD_UTTERANCES" });

const logSay = process.env.LOG_SAY === "1";
if (logSay) log.warn("raw_recording_disabled", { control: "LOG_SAY" });

const skill = createHandler({
  skillId,
  agent: createAgentClient({ baseUrl: publicBaseUrl, timeoutMs: AGENT_BUDGET_MS, skillSecret: command.SecretString }),
  // Compatibility switches remain accepted, but raw recording is intentionally inert.
  logSay,
});

export const handler = (event: AlexaRequestEnvelope): Promise<AlexaResponseEnvelope> => skill(event);
