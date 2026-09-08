import { Duration, Stack, type StackProps } from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as actions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import { type Construct } from "constructs";

import { type ApiStack } from "./api-stack.ts";

export type ObservabilityStackProps = StackProps & {
  api: ApiStack;
  /** Owner address for the latency alarm. */
  alertEmail: string;
};

export const METRIC_NAMESPACE = "sla/mcp";
export const TOOL_NAMES = ["list_family_stories", "get_family_story", "suggest_next_story"] as const;

/**
 * The sub-500 ms proof: tool latency p50/p95/p99 by tool from the EMF metric that
 * `withLatencyMetric` emits, OAuth and Lambda error rates, and an alarm on p95 > 400 ms
 * over 5 minutes that emails the Owner.
 */
export class ObservabilityStack extends Stack {
  readonly dashboard: cloudwatch.Dashboard;
  readonly alarm: cloudwatch.Alarm;

  constructor(scope: Construct, id: string, props: ObservabilityStackProps) {
    super(scope, id, props);

    const latency = (statistic: string, tool?: string) =>
      new cloudwatch.Metric({
        namespace: METRIC_NAMESPACE,
        metricName: "ToolLatencyMs",
        statistic,
        period: Duration.minutes(5),
        ...(tool && { dimensionsMap: { Tool: tool } }),
        label: tool ? `${tool} ${statistic}` : `all ${statistic}`,
      });

    const topic = new sns.Topic(this, "Alerts", { topicName: "sla-alexa-alerts" });
    topic.addSubscription(new subscriptions.EmailSubscription(props.alertEmail));

    // The EMF metric has one dimension (Tool); the alarm uses a search expression across
    // tools so a single slow tool trips it.
    this.alarm = new cloudwatch.Alarm(this, "ToolLatencyP95", {
      alarmName: "sla-alexa-tool-latency-p95",
      alarmDescription: "MCP tool latency p95 above 400 ms over 5 minutes (Amazon requires the round trip under 500 ms)",
      metric: new cloudwatch.Metric({ namespace: METRIC_NAMESPACE, metricName: "ToolLatencyMs", statistic: "p95", period: Duration.minutes(5) }),
      threshold: 400,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    this.alarm.addAlarmAction(new actions.SnsAction(topic));

    this.dashboard = new cloudwatch.Dashboard(this, "Dashboard", { dashboardName: "sla-alexa" });
    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: "Tool latency p50 / p95 / p99 (ms)",
        width: 12,
        left: TOOL_NAMES.flatMap((tool) => [latency("p50", tool), latency("p95", tool), latency("p99", tool)]),
        leftAnnotations: [{ value: 400, label: "alarm", color: "#d13212" }],
      }),
      new cloudwatch.GraphWidget({
        title: "Lambda duration and errors",
        width: 12,
        left: [props.api.fn.metricDuration({ statistic: "p95", period: Duration.minutes(5) })],
        right: [props.api.fn.metricErrors({ period: Duration.minutes(5) }), props.api.fn.metricThrottles({ period: Duration.minutes(5) })],
      }),
    );
    this.dashboard.addWidgets(
      new cloudwatch.LogQueryWidget({
        title: "OAuth errors (last hour)",
        width: 12,
        logGroupNames: [props.api.logGroup.logGroupName],
        queryLines: [
          'filter event in ["oauth_code_reuse", "oauth_refresh_reuse", "oauth_unhandled", "bridge_error", "bridge_unreachable"]',
          "stats count() by event",
        ],
      }),
      new cloudwatch.LogQueryWidget({
        title: "Function URL 5xx and tool failures (last hour)",
        width: 12,
        logGroupNames: [props.api.logGroup.logGroupName],
        queryLines: ['filter level = "error" or event = "tool_failed" or event = "provider_unavailable"', "stats count() by event"],
      }),
      new cloudwatch.AlarmWidget({ title: "p95 alarm", alarm: this.alarm, width: 24 }),
    );
  }
}
