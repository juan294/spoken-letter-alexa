import { afterEach, describe, expect, test, vi } from "vitest";

import { withLatencyMetric } from "./metrics.ts";

describe("withLatencyMetric", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  test("emits the EMF envelope with a per-tool series and a dimension-less roll-up for the alarm", async () => {
    vi.stubEnv("EMF_NAMESPACE", "sla/mcp");
    vi.stubEnv("LOG_LEVEL", "info");
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await withLatencyMetric("list_family_stories", () => Promise.resolve("ok"));
    const line = JSON.parse(String(write.mock.calls[0]?.[0])) as {
      event: string;
      tool: string;
      Tool: string;
      ToolLatencyMs: number;
      _aws: { CloudWatchMetrics: { Namespace: string; Dimensions: string[][]; Metrics: { Name: string; Unit: string }[] }[] };
    };
    expect(line.event).toBe("tool_latency");
    expect(line.Tool).toBe("list_family_stories");
    expect(typeof line.ToolLatencyMs).toBe("number");
    const [metric] = line._aws.CloudWatchMetrics;
    expect(metric?.Namespace).toBe("sla/mcp");
    // Two dimension sets: by tool (dashboard) and none (the p95 alarm reads the roll-up).
    expect(metric?.Dimensions).toEqual([["Tool"], []]);
    expect(metric?.Metrics).toEqual([{ Name: "ToolLatencyMs", Unit: "Milliseconds" }]);
  });

  test("without EMF_NAMESPACE the line is a plain structured log", async () => {
    vi.stubEnv("LOG_LEVEL", "info");
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await withLatencyMetric("get_family_story", () => Promise.resolve(1));
    const line = JSON.parse(String(write.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(line._aws).toBeUndefined();
    expect(line.outcome).toBe("ok");
  });
});
