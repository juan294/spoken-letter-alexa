import { describe, expect, test } from "vitest";

import { emfEnvelope } from "./metrics.ts";

describe("emfEnvelope", () => {
  test("returns an empty object when no namespace is given", () => {
    expect(emfEnvelope(undefined, { Tool: "get_family_story" }, [{ name: "ToolLatencyMs", value: 12, unit: "Milliseconds", dimensionSets: [["Tool"], []] }])).toEqual({});
  });

  test("builds one CloudWatchMetrics entry per metric, each with its own dimension sets", () => {
    const envelope = emfEnvelope("sla/mcp", { Intent: "PlayStoryIntent" }, [
      { name: "SkillTurnMs", value: 3216, unit: "Milliseconds", dimensionSets: [["Intent"], []] },
      { name: "DeadEndPlay", value: 0, unit: "Count", dimensionSets: [[]] },
    ]) as { _aws: { Timestamp: number; CloudWatchMetrics: { Namespace: string; Dimensions: string[][]; Metrics: { Name: string; Unit: string }[] }[] }; Intent: string; SkillTurnMs: number; DeadEndPlay: number };
    expect(envelope.Intent).toBe("PlayStoryIntent");
    expect(envelope.SkillTurnMs).toBe(3216);
    expect(envelope.DeadEndPlay).toBe(0);
    expect(envelope._aws.CloudWatchMetrics).toEqual([
      { Namespace: "sla/mcp", Dimensions: [["Intent"], []], Metrics: [{ Name: "SkillTurnMs", Unit: "Milliseconds" }] },
      { Namespace: "sla/mcp", Dimensions: [[]], Metrics: [{ Name: "DeadEndPlay", Unit: "Count" }] },
    ]);
    expect(typeof envelope._aws.Timestamp).toBe("number");
  });
});
