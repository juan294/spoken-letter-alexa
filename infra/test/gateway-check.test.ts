import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { checkGatewaySync, formatReport, type GatewayTarget, TOOL_PREFIX, type ToolSchemas, waitWhileSynchronizing } from "../lib/gateway-check.ts";

const PREFIX = TOOL_PREFIX;
const fixture = (name: string) => JSON.parse(readFileSync(path.join(import.meta.dirname, "fixtures", name), "utf8")) as ToolSchemas[];
// Read-only tools/list snapshots taken on 2026-10-19: the gateway's cached list (last synced
// 2026-09-09, before artUrl) and the deployed server's list.
const cachedTools = fixture("gateway-tools-2026-10-19.json");
const serverTools = fixture("server-tools-2026-10-19.json");
const syncedTools = serverTools.map((tool) => ({ ...tool, name: `${PREFIX}${tool.name}` }));

const ids = { gatewayId: "sla-alexa-usrtpg2rea", targetId: "BL0QFT4T2E" };
const ready: GatewayTarget = { ...ids, status: "READY", statusReasons: [] };
// The live status reason from research R§1.2 (request id kept).
const LIVE_REASON =
  "Please check the OAuth setup. Access denied when retrieving secret 'arn:aws:secretsmanager:us-east-1:106403001709:secret:bedrock-agentcore-identity!default/oauth2/sla-alexa-m2m-f64cc41a-qCwtqn'. User: arn:aws:sts::106403001709:assumed-role/SpokenLetterAlexaGateway-AWS679f53fac002430cb0da5b7-Z21NodDXlPNd/SpokenLetterAlexaGateway-AWS679f53fac002430cb0da5b-H1tWKwRTUlSS is not authorized to perform: secretsmanager:GetSecretValue (Service: AgentCredentialProvider, Status Code: 403, Request ID: 7ad7c3f0-b727-411e-b3f2-7ba19b2c0c2c)";

describe("checkGatewaySync", () => {
  test("READY with the server's schemas cached is ok", () => {
    const result = checkGatewaySync(ready, syncedTools, serverTools, PREFIX);
    expect(result).toEqual({ ok: true, failures: [] });
    expect(formatReport(result, ready)).not.toContain("FAIL");
  });

  test("S1: SYNCHRONIZE_UNSUCCESSFUL reports every status reason and the recovery command", () => {
    const target = { ...ids, status: "SYNCHRONIZE_UNSUCCESSFUL", statusReasons: [LIVE_REASON, "second reason"] };
    const result = checkGatewaySync(target, syncedTools, serverTools, PREFIX);
    expect(result.ok).toBe(false);
    const report = formatReport(result, target);
    expect(report).toContain("FAIL: target BL0QFT4T2E is SYNCHRONIZE_UNSUCCESSFUL");
    expect(report).toContain(LIVE_REASON);
    expect(report).toContain("second reason");
    expect(report).toContain(
      "aws bedrock-agentcore-control synchronize-gateway-targets --gateway-identifier sla-alexa-usrtpg2rea --target-id-list BL0QFT4T2E --profile archy --region us-east-1",
    );
    expect(report).toContain("pnpm -F infra verify:gateway");
  });

  test("S3: READY with the 2026-09-09 cached schema names the missing artUrl paths", () => {
    const result = checkGatewaySync(ready, cachedTools, serverTools, PREFIX);
    expect(result.ok).toBe(false);
    const getStory = result.failures.find((failure) => failure.startsWith(`${PREFIX}get_family_story:`));
    expect(getStory).toContain("outputSchema.properties.artUrl");
    expect(result.failures.find((failure) => failure.startsWith(`${PREFIX}list_family_stories:`))).toContain(
      "outputSchema.properties.stories.items.properties.artUrl",
    );
    expect(formatReport(result, ready)).toContain("synchronize-gateway-targets");
  });

  test("a property the gateway caches but the server no longer declares is reported as extra", () => {
    const olderServer = cachedTools.map((tool) => ({ ...tool, name: tool.name.slice(PREFIX.length) }));
    const result = checkGatewaySync(ready, syncedTools, olderServer, PREFIX);
    expect(result.failures.find((failure) => failure.startsWith(`${PREFIX}get_family_story:`))).toMatch(/extra.*outputSchema\.properties\.artUrl/);
  });

  test("a server tool without its prefixed gateway counterpart fails", () => {
    const result = checkGatewaySync(ready, syncedTools.filter((tool) => tool.name !== `${PREFIX}suggest_next_story`), serverTools, PREFIX);
    expect(result).toEqual({ ok: false, failures: [`${PREFIX}suggest_next_story: missing from the gateway's tool list`] });
  });

  test("a cached gateway tool the server no longer serves fails", () => {
    const result = checkGatewaySync(ready, syncedTools, serverTools.filter((tool) => tool.name !== "suggest_next_story"), PREFIX);
    expect(result).toEqual({ ok: false, failures: [`${PREFIX}suggest_next_story: cached by the gateway but no longer served by the server`] });
  });

  test("an empty server tool list fails instead of passing vacuously", () => {
    const result = checkGatewaySync(ready, syncedTools, [], PREFIX);
    expect(result.ok).toBe(false);
    expect(result.failures[0]).toBe("the server's tools/list returned no tools");
  });
});

describe("waitWhileSynchronizing", () => {
  /** A fake clock and a target that walks through `states`, then repeats the last one. */
  function poll(...states: string[]) {
    let now = 0;
    let calls = 0;
    const getTarget = () => Promise.resolve({ ...ids, status: states[Math.min(calls++, states.length - 1)], statusReasons: [] });
    const options = {
      timeoutMs: 120_000,
      intervalMs: 5_000,
      now: () => now,
      sleep: (ms: number) => {
        now += ms;
        return Promise.resolve();
      },
    };
    return { getTarget, options, calls: () => calls };
  }

  test("S2: stops at the bound and reports the target still SYNCHRONIZING", async () => {
    const { getTarget, options, calls } = poll("SYNCHRONIZING");
    const result = await waitWhileSynchronizing(getTarget, options);
    expect(result.target.status).toBe("SYNCHRONIZING");
    expect(result.waitedMs).toBe(120_000);
    expect(calls()).toBe(25);
    const report = formatReport(checkGatewaySync(result.target, syncedTools, serverTools, PREFIX), result.target, result.waitedMs);
    expect(report).toContain("still synchronizing after 120 s");
    expect(report).toContain("pnpm -F infra verify:gateway");
  });

  test.each([
    ["SYNCHRONIZING", "SYNCHRONIZING"],
    ["UPDATING", "CREATING"],
  ])("returns the first settled state after %s, %s", async (first, second) => {
    const { getTarget, options, calls } = poll(first, second, "READY");
    const result = await waitWhileSynchronizing(getTarget, options);
    expect(result).toEqual({ target: { ...ids, status: "READY", statusReasons: [] }, waitedMs: 10_000 });
    expect(calls()).toBe(3);
  });

  test("a timeout that is not a finite, non-negative number is rejected before polling", async () => {
    const { getTarget, options, calls } = poll("SYNCHRONIZING");
    await expect(waitWhileSynchronizing(getTarget, { ...options, timeoutMs: Number.NaN })).rejects.toThrow("finite");
    expect(calls()).toBe(0);
  });
});
