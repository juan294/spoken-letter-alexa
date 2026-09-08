import { Stack, type StackProps } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as patterns from "aws-cdk-lib/aws-ecs-patterns";
import { type Construct } from "constructs";

export type LegacyStackProps = StackProps & {
  /**
   * Container image reference for the MCP server (registry path, e.g. an ECR image built
   * from `packages/mcp-server`). No default: there is no published image yet, and this
   * stack is written but not deployed (Phase 7, section 2).
   */
  image: string;
};

/**
 * Session-id contingency deployment: a single Fargate task running the MCP server with
 * `MCP_LEGACY_SESSIONS=1` behind an application load balancer. One task only, because
 * legacy sessions live in process memory (`packages/mcp-server/src/legacy-sessions.ts`).
 * Not in `bin/app.ts`; `amazon/inspector.md` says when to add it.
 */
export class LegacyStack extends Stack {
  readonly service: patterns.ApplicationLoadBalancedFargateService;

  constructor(scope: Construct, id: string, props: LegacyStackProps) {
    super(scope, id, props);

    // aws-cdk-lib 2.268.0 declares `IVpc`/`ICluster` optional members without `undefined`,
    // so the concrete classes fail assignability under `exactOptionalPropertyTypes`.
    const vpc = new ec2.Vpc(this, "Vpc", { maxAzs: 2, natGateways: 0 }) as ec2.IVpc;
    const cluster = new ecs.Cluster(this, "Cluster", { vpc, clusterName: "sla-legacy" }) as ecs.ICluster;

    this.service = new patterns.ApplicationLoadBalancedFargateService(this, "Service", {
      cluster,
      desiredCount: 1,
      cpu: 256,
      memoryLimitMiB: 512,
      assignPublicIp: true,
      publicLoadBalancer: true,
      taskImageOptions: {
        image: ecs.ContainerImage.fromRegistry(props.image),
        containerPort: 4310,
        environment: {
          MCP_LEGACY_SESSIONS: "1",
          PORT: "4310",
          PROVIDER_MODE: "fixtures",
        },
      },
    });
    this.service.targetGroup.configureHealthCheck({ path: "/healthz" });
  }
}
