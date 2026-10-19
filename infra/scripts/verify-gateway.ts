// `pnpm -F infra verify:gateway` (after every deploy): reads the AgentCore Gateway target
// status and compares the gateway's cached tool schemas with the deployed server's.
// CloudFormation reports the sync custom resource complete before the synchronization
// finishes, so this is the only place a failed sync shows up. Read-only.
//
//   AWS_PROFILE=archy pnpm -F infra verify:gateway        # VERIFY_TIMEOUT_S=120 by default
//
// Exit 1 on a non-READY target, a schema difference, or a target still synchronizing at the
// bound. The m2m secret is read from `sla/oauth-clients` and never printed.
import {
  BedrockAgentCoreControlClient,
  GetGatewayCommand,
  GetGatewayTargetCommand,
  paginateListGateways,
  paginateListGatewayTargets,
} from "@aws-sdk/client-bedrock-agentcore-control";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { createSigV4Fetch } from "@spoken-letter-alexa/agent/sigv4-fetch";

import {
  checkGatewaySync,
  formatReport,
  GATEWAY_NAME,
  type GatewayTarget,
  TARGET_NAME,
  TOOL_PREFIX,
  type ToolSchemas,
  waitWhileSynchronizing,
} from "../lib/gateway-check.ts";

const region = process.env.AWS_REGION ?? "us-east-1";
const base = (process.env.BASE_URL ?? "https://alexa.spokenletter.com").replace(/\/$/, "");
// An invalid value is rejected by waitWhileSynchronizing before the first poll.
const timeoutMs = Number(process.env.VERIFY_TIMEOUT_S ?? 120) * 1000;
const profile = process.env.AWS_PROFILE ?? "archy";
const control = new BedrockAgentCoreControlClient({ region, profile });
// The client's resolved credential chain also signs the gateway calls and reads the secret.
const credentials = control.config.credentials;

async function find<T extends { name?: string | undefined }>(pages: AsyncIterable<{ items?: T[] | undefined }>, name: string): Promise<T> {
  for await (const page of pages) {
    const match = page.items?.find((item) => item.name === name);
    if (match) return match;
  }
  throw new Error(`no ${name} found`);
}

/** `tools/list` over JSON-RPC, following `nextCursor`; the server answers with SSE frames. */
async function listTools(url: string, fetcher: typeof fetch, headers: Record<string, string>): Promise<ToolSchemas[]> {
  const tools: ToolSchemas[] = [];
  let cursor: string | undefined;
  do {
    const response = await fetcher(url, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: cursor ? { cursor } : {} }),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`tools/list on ${url} answered ${response.status}: ${text}`);
    // The response is the frame answering id 1; an SSE stream may carry notifications first.
    const frames = text.includes("data:") ? text.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5)) : [text];
    const body = frames.map((frame) => JSON.parse(frame) as { id?: unknown; result?: { tools: ToolSchemas[]; nextCursor?: string }; error?: unknown }).find((message) => message.id === 1);
    if (!body) throw new Error(`tools/list on ${url} returned no response to the request`);
    if (!body.result) throw new Error(`tools/list on ${url} failed: ${JSON.stringify(body.error)}`);
    tools.push(...body.result.tools);
    cursor = body.result.nextCursor;
  } while (cursor);
  return tools;
}

async function serverToken(): Promise<string> {
  const secrets = new SecretsManagerClient({ region, credentials });
  const raw = (await secrets.send(new GetSecretValueCommand({ SecretId: "sla/oauth-clients" }))).SecretString ?? "{}";
  let document: { m2mSecret?: string };
  try {
    document = JSON.parse(raw) as { m2mSecret?: string };
  } catch {
    // A JSON.parse error message quotes part of its input, which is the secret here.
    throw new Error("sla/oauth-clients is not valid JSON");
  }
  if (!document.m2mSecret) throw new Error("sla/oauth-clients has no m2mSecret");
  const response = await fetch(`${base}/oauth/token`, {
    method: "POST",
    headers: { authorization: `Basic ${Buffer.from(`alexa-m2m:${document.m2mSecret}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!response.ok) throw new Error(`client_credentials token request answered ${response.status}: ${await response.text()}`);
  return ((await response.json()) as { access_token: string }).access_token;
}

async function main(): Promise<boolean> {
  const gatewayId = (await find(paginateListGateways({ client: control }, {}), GATEWAY_NAME)).gatewayId!;
  const targetId = (await find(paginateListGatewayTargets({ client: control }, { gatewayIdentifier: gatewayId }), TARGET_NAME)).targetId!;

  const { target, waitedMs } = await waitWhileSynchronizing(
    async (): Promise<GatewayTarget> => {
      const output = await control.send(new GetGatewayTargetCommand({ gatewayIdentifier: gatewayId, targetId }));
      return { gatewayId, targetId, status: output.status, statusReasons: output.statusReasons, lastSynchronizedAt: output.lastSynchronizedAt };
    },
    { timeoutMs, intervalMs: 5_000, now: () => Date.now(), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) },
  );
  console.log(`gateway ${gatewayId} target ${targetId}: ${target.status ?? "UNKNOWN"}, lastSynchronizedAt ${target.lastSynchronizedAt?.toISOString() ?? "never"}`);

  const { gatewayUrl } = await control.send(new GetGatewayCommand({ gatewayIdentifier: gatewayId }));
  if (!gatewayUrl) throw new Error(`gateway ${gatewayId} reports no gatewayUrl`);
  const [gatewayTools, serverTools] = await Promise.all([
    listTools(gatewayUrl, createSigV4Fetch({ region, credentials }), {}),
    serverToken().then((token) => listTools(`${base}/mcp`, fetch, { authorization: `Bearer ${token}` })),
  ]);

  const result = checkGatewaySync(target, gatewayTools, serverTools, TOOL_PREFIX);
  console.log(formatReport(result, target, waitedMs, { profile, region }));
  return result.ok;
}

try {
  if (!(await main())) process.exitCode = 1;
} catch (error) {
  console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
