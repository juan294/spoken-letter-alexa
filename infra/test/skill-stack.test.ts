import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { beforeAll, describe, expect, test } from "vitest";

import { SkillStack } from "../lib/skill-stack.ts";

const env = { account: "106403001709", region: "us-east-1" };
const SKILL_ID = "amzn1.ask.skill.00000000-0000-4000-8000-000000000000";

describe("SkillStack", () => {
  let withId: Template;
  let withoutId: Template;

  beforeAll(() => {
    // One App per template: synthesizing twice from the same tree is refused by CDK.
    withId = Template.fromStack(new SkillStack(new App(), "SkillWithId", { env, publicBaseUrl: "https://alexa.spokenletter.com", skillId: SKILL_ID, bundle: false }));
    withoutId = Template.fromStack(new SkillStack(new App(), "SkillWithoutId", { env, publicBaseUrl: "https://alexa.spokenletter.com", bundle: false, recordUtterances: true }));
  });

  test("a small arm64 Node 24 Lambda pointed at the public host, with 30-day logs", () => {
    withId.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "sla-alexa-skill",
      Architectures: ["arm64"],
      Runtime: "nodejs24.x",
      MemorySize: 256,
      Environment: { Variables: Match.objectLike({ PUBLIC_BASE_URL: "https://alexa.spokenletter.com", SKILL_ID, RECORD_UTTERANCES: "0" }) },
    });
    withId.hasResourceProperties("AWS::Logs::LogGroup", { RetentionInDays: 30 });
    withoutId.hasResourceProperties("AWS::Lambda::Function", { Environment: { Variables: Match.objectLike({ SKILL_ID: "", RECORD_UTTERANCES: "1" }) } });
  });

  test("Alexa may invoke it only with the skill id as the event source token", () => {
    withId.hasResourceProperties("AWS::Lambda::Permission", {
      Action: "lambda:InvokeFunction",
      Principal: "alexa-appkit.amazon.com",
      EventSourceToken: SKILL_ID,
    });
    // Before the skill exists there is no permission at all: nothing can invoke the function.
    expect(Object.keys(withoutId.findResources("AWS::Lambda::Permission"))).toHaveLength(0);
  });

  test("the role carries nothing beyond logs and X-Ray", () => {
    const policies = Object.values(withId.findResources("AWS::IAM::Policy") as Record<string, { Properties: { PolicyDocument: { Statement: { Action: string | string[] }[] } } }>);
    const actions = policies.flatMap((policy) => policy.Properties.PolicyDocument.Statement.flatMap((statement) => ([] as string[]).concat(statement.Action)));
    for (const action of actions) expect(action).toMatch(/^(logs|xray):/);
  });
});
