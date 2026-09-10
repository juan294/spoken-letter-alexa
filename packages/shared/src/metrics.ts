export type EmfUnit = "Milliseconds" | "Count";

export type EmfMetric = {
  name: string;
  value: number;
  unit: EmfUnit;
  /** Dimension sets this metric reports under; each entry is a list of dimension names sharing one field bag. `[]` means undimensioned. */
  dimensionSets: string[][];
};

/**
 * CloudWatch Embedded Metric Format envelope for one log line, merged into it so the same
 * line is both the structured log and the metric. `{}` when `namespace` is unset (metrics
 * off; the line stays a plain structured log). `dimensionValues` supplies the field for every
 * dimension name referenced in any metric's `dimensionSets`.
 */
export function emfEnvelope(namespace: string | undefined, dimensionValues: Record<string, string>, metrics: EmfMetric[]): Record<string, unknown> {
  if (!namespace) return {};
  return {
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: metrics.map((metric) => ({
        Namespace: namespace,
        Dimensions: metric.dimensionSets,
        Metrics: [{ Name: metric.name, Unit: metric.unit }],
      })),
    },
    ...dimensionValues,
    ...Object.fromEntries(metrics.map((metric) => [metric.name, metric.value])),
  };
}
