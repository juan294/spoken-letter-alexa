// Calls each tool 50 times through the handler with the fixture provider and asserts
// p95 < 250 ms and p99 < 400 ms (headroom under Amazon's 500 ms round trip; network
// is measured in Phase 6). The distribution is printed for the friction log.
import { describe, expect, test } from "vitest";

import { legacyCall, testApp } from "./test-support.ts";

const ROUNDS = 50;
const CALLS = [
  { name: "list_family_stories", arguments: { limit: 5 } },
  { name: "get_family_story", arguments: { storyId: "st_owl" } },
  { name: "suggest_next_story", arguments: {} },
] as const;

function percentile(sorted: number[], p: number): number {
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

describe("tool latency with the fixture provider", () => {
  const app = testApp();

  test.each(CALLS)("$name: p95 < 250 ms and p99 < 400 ms over 50 calls", async (call) => {
    // Warm the module graph once so the first cold import is not counted.
    await legacyCall(app, "tools/call", { name: call.name, arguments: call.arguments });
    const samples: number[] = [];
    for (let i = 0; i < ROUNDS; i += 1) {
      const started = performance.now();
      const message = await legacyCall(app, "tools/call", { name: call.name, arguments: call.arguments }, 100 + i);
      samples.push(performance.now() - started);
      expect(message.error).toBeUndefined();
    }
    const sorted = [...samples].sort((a, b) => a - b);
    const p50 = percentile(sorted, 50);
    const p95 = percentile(sorted, 95);
    const p99 = percentile(sorted, 99);
    console.log(
      `latency ${call.name}: p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms p99=${p99.toFixed(1)}ms max=${sorted.at(-1)?.toFixed(1)}ms n=${ROUNDS}`,
    );
    expect(p95).toBeLessThan(250);
    expect(p99).toBeLessThan(400);
  });
});
