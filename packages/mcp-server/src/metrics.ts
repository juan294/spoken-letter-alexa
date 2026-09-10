import { emfEnvelope, log } from "@spoken-letter-alexa/shared";

/**
 * Times one tool run and emits a `tool_latency` JSON line. When `EMF_NAMESPACE` is set
 * (Phase 6, Lambda) the line carries the CloudWatch Embedded Metric Format header so the
 * same log line becomes the `ToolLatencyMs` metric by tool name; locally it is a plain
 * structured log line.
 */
export async function withLatencyMetric<T>(tool: string, run: () => Promise<T>): Promise<T> {
  const started = performance.now();
  let outcome: "ok" | "error" = "ok";
  try {
    return await run();
  } catch (error) {
    outcome = "error";
    throw error;
  } finally {
    const ms = Math.round((performance.now() - started) * 100) / 100;
    // By tool for the dashboard, and without dimensions for the p95 alarm.
    const envelope = emfEnvelope(process.env.EMF_NAMESPACE, { Tool: tool }, [{ name: "ToolLatencyMs", value: ms, unit: "Milliseconds", dimensionSets: [["Tool"], []] }]);
    log.info("tool_latency", { tool, ms, outcome, ...envelope });
  }
}
