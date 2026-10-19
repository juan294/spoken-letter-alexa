/**
 * Post-deploy check of the AgentCore Gateway target (`pnpm -F infra verify:gateway`).
 * CloudFormation reports the sync custom resource complete while the synchronization is
 * still running, so only the target status and the cached tool schemas show the outcome.
 * Pure logic: `infra/scripts/verify-gateway.ts` does the I/O.
 */

/** Names shared by `GatewayStack` and the check, so a rename cannot break the lookup. */
export const GATEWAY_NAME = "sla-alexa";
export const TARGET_NAME = "spoken-letter";
/** The gateway prefixes each target tool with `<target name>___`. */
export const TOOL_PREFIX = `${TARGET_NAME}___`;

export type GatewayTarget = {
  gatewayId: string;
  targetId: string;
  status?: string | undefined;
  statusReasons?: string[] | undefined;
  lastSynchronizedAt?: Date | undefined;
};
export type ToolSchemas = { name: string; inputSchema?: unknown; outputSchema?: unknown };
export type SyncCheck = { ok: boolean; failures: string[] };
export type AwsScope = { profile: string; region: string };

const RERUN = "pnpm -F infra verify:gateway";
const IN_PROGRESS = new Set(["SYNCHRONIZING", "CREATING", "UPDATING"]);
const inProgress = (target: GatewayTarget) => IN_PROGRESS.has(target.status ?? "");

/** Every property and required-name path of a JSON schema, at every object level. */
function schemaPaths(schema: unknown, at: string, into = new Set<string>()): Set<string> {
  if (typeof schema !== "object" || schema === null) return into;
  const node = schema as Record<string, unknown>;
  for (const [key, value] of Object.entries((node.properties ?? {}) as Record<string, unknown>)) {
    into.add(`${at}.properties.${key}`);
    schemaPaths(value, `${at}.properties.${key}`, into);
  }
  if (Array.isArray(node.required)) for (const name of node.required) into.add(`${at}.required.${String(name)}`);
  schemaPaths(node.items, `${at}.items`, into);
  for (const combinator of ["anyOf", "oneOf", "allOf"]) {
    const branches = node[combinator];
    if (Array.isArray(branches)) branches.forEach((branch, index) => schemaPaths(branch, `${at}.${combinator}[${index}]`, into));
  }
  return into;
}

function paths(tool: ToolSchemas): Set<string> {
  return schemaPaths(tool.outputSchema, "outputSchema", schemaPaths(tool.inputSchema, "inputSchema"));
}

/** Compares the gateway's cached tool list with the server's, and requires a READY target. */
export function checkGatewaySync(target: GatewayTarget, gatewayTools: ToolSchemas[], serverTools: ToolSchemas[], prefix: string): SyncCheck {
  const failures: string[] = [];
  if (target.status !== "READY") failures.push(`target ${target.targetId} is ${target.status ?? "UNKNOWN"}`);
  if (serverTools.length === 0) failures.push("the server's tools/list returned no tools");
  const cachedByName = new Map(gatewayTools.map((tool) => [tool.name, tool]));
  const served = new Set(serverTools.map((tool) => `${prefix}${tool.name}`));
  for (const tool of serverTools) {
    const name = `${prefix}${tool.name}`;
    const cached = cachedByName.get(name);
    if (!cached) {
      failures.push(`${name}: missing from the gateway's tool list`);
      continue;
    }
    const expected = paths(tool);
    const actual = paths(cached);
    const missing = [...expected].filter((item) => !actual.has(item));
    const extra = [...actual].filter((item) => !expected.has(item));
    if (missing.length === 0 && extra.length === 0) continue;
    failures.push(
      `${name}: the gateway's cached schema differs from the server's` +
        (missing.length > 0 ? `; missing ${missing.join(", ")}` : "") +
        (extra.length > 0 ? `; extra ${extra.join(", ")}` : ""),
    );
  }
  for (const name of cachedByName.keys()) {
    if (name.startsWith(prefix) && !served.has(name)) failures.push(`${name}: cached by the gateway but no longer served by the server`);
  }
  return { ok: failures.length === 0, failures };
}

/** The deployer-facing text: each failure, the status reasons, and the recovery step. */
export function formatReport(result: SyncCheck, target: GatewayTarget, waitedMs = 0, scope: AwsScope = { profile: "archy", region: "us-east-1" }): string {
  if (result.ok) return `ok: target ${target.targetId} is READY and the cached tool schemas match the server`;
  const lines = result.failures.map((failure) => `FAIL: ${failure}`);
  for (const reason of target.statusReasons ?? []) lines.push(`  reason: ${reason}`);
  if (inProgress(target)) {
    lines.push(`  still ${(target.status ?? "").toLowerCase()} after ${Math.round(waitedMs / 1000)} s; rerun: ${RERUN}`);
  } else {
    lines.push(
      `  recover: aws bedrock-agentcore-control synchronize-gateway-targets --gateway-identifier ${target.gatewayId} --target-id-list ${target.targetId} --profile ${scope.profile} --region ${scope.region}`,
      `  then ${RERUN}`,
    );
  }
  return lines.join("\n");
}

/** Polls the target while it is synchronizing (or still being created or updated), up to `timeoutMs`. */
export async function waitWhileSynchronizing(
  getTarget: () => Promise<GatewayTarget>,
  options: { timeoutMs: number; intervalMs: number; now: () => number; sleep: (ms: number) => Promise<void> },
): Promise<{ target: GatewayTarget; waitedMs: number }> {
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 0) throw new Error(`timeout must be a finite, non-negative number of ms, got ${options.timeoutMs}`);
  const started = options.now();
  for (;;) {
    const target = await getTarget();
    const waitedMs = options.now() - started;
    if (!inProgress(target) || waitedMs >= options.timeoutMs) return { target, waitedMs };
    await options.sleep(Math.min(options.intervalMs, options.timeoutMs - waitedMs));
  }
}
