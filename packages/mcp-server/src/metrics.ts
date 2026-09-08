import { log } from "@spoken-letter-alexa/shared";

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
    log.info("tool_latency", { tool, ms, outcome, ...emfEnvelope(tool, ms) });
  }
}

function emfEnvelope(tool: string, ms: number): Record<string, unknown> {
  const namespace = process.env.EMF_NAMESPACE;
  if (!namespace) return {};
  return {
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [
        { Namespace: namespace, Dimensions: [["Tool"]], Metrics: [{ Name: "ToolLatencyMs", Unit: "Milliseconds" }] },
      ],
    },
    Tool: tool,
    ToolLatencyMs: ms,
  };
}
