// The skill Lambda entry (infra/lib/skill-stack.ts, bundled by infra/scripts/bundle-lambda.mjs).
// Alexa invokes it directly with the request envelope; there is no HTTP layer.
import { log } from "@spoken-letter-alexa/shared";

import { createAgentClient } from "./agent-client.ts";
import { type AlexaRequestEnvelope, type AlexaResponseEnvelope, createHandler } from "./handler.ts";

/** Alexa waits about 8 s for the skill; the whole agent round trip gets 6. */
const AGENT_BUDGET_MS = 6_000;

const publicBaseUrl = process.env.PUBLIC_BASE_URL;
const skillId = process.env.SKILL_ID;
if (!publicBaseUrl) throw new Error("PUBLIC_BASE_URL is required");
if (!skillId) throw new Error("SKILL_ID is required: deploy the skill (pnpm -F skill deploy) and redeploy the stack with -c sla:skillId=<id>");

const recording = process.env.RECORD_UTTERANCES === "1";
if (recording) log.warn("utterance_recording_on", { hint: "RECORD_UTTERANCES=1: catch-all phrasings are logged for pnpm -F skill record:pull" });

const skill = createHandler({
  skillId,
  agent: createAgentClient({ baseUrl: publicBaseUrl, timeoutMs: AGENT_BUDGET_MS }),
  recordUtterance: recording
    ? (utterance) => {
        log.info("utterance_recorded", utterance);
      }
    : undefined,
});

export const handler = (event: AlexaRequestEnvelope): Promise<AlexaResponseEnvelope> => skill(event);
