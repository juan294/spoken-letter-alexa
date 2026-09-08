import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { beforeAll, describe, test } from "vitest";

import { LegacyStack } from "../lib/legacy-stack.ts";

describe("LegacyStack", () => {
  let template: Template;

  beforeAll(() => {
    const app = new App();
    const stack = new LegacyStack(app, "SpokenLetterAlexaLegacy", {
      env: { account: "106403001709", region: "us-east-1" },
      image: "public.ecr.aws/docker/library/node:24-alpine",
    });
    template = Template.fromStack(stack);
  });

  test("runs exactly one Fargate task", () => {
    template.resourceCountIs("AWS::ECS::Service", 1);
    template.hasResourceProperties("AWS::ECS::Service", {
      DesiredCount: 1,
      LaunchType: "FARGATE",
    });
  });

  test("the single container carries MCP_LEGACY_SESSIONS=1 and listens on 4310", () => {
    template.hasResourceProperties("AWS::ECS::TaskDefinition", {
      RequiresCompatibilities: ["FARGATE"],
      ContainerDefinitions: [
        Match.objectLike({
          Image: "public.ecr.aws/docker/library/node:24-alpine",
          Environment: Match.arrayWith([{ Name: "MCP_LEGACY_SESSIONS", Value: "1" }]),
          PortMappings: [Match.objectLike({ ContainerPort: 4310 })],
        }),
      ],
    });
  });

  test("the service sits behind an internet-facing application load balancer", () => {
    template.hasResourceProperties("AWS::ElasticLoadBalancingV2::LoadBalancer", {
      Type: "application",
      Scheme: "internet-facing",
    });
    template.hasResourceProperties("AWS::ElasticLoadBalancingV2::TargetGroup", {
      HealthCheckPath: "/healthz",
    });
  });
});
