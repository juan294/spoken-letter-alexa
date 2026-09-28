import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { beforeAll, describe, expect, test } from "vitest";

import { SkillStack } from "../lib/skill-stack.ts";
import { CoreStack } from "../lib/core-stack.ts";

const env = { account: "106403001709", region: "us-east-1" };
const SKILL_ID = "amzn1.ask.skill.00000000-0000-4000-8000-000000000000";

describe("SkillStack", () => {
  let withId: Template;
  let withoutId: Template;

  beforeAll(() => {
    // One App per template: synthesizing twice from the same tree is refused by CDK.
    const withIdApp = new App();
    const withoutIdApp = new App();
    withId = Template.fromStack(new SkillStack(withIdApp, "SkillWithId", { env, core: new CoreStack(withIdApp, "CoreWithId", { env }), publicBaseUrl: "https://alexa.spokenletter.com", skillId: SKILL_ID, bundle: false }));
    withoutId = Template.fromStack(new SkillStack(withoutIdApp, "SkillWithoutId", { env, core: new CoreStack(withoutIdApp, "CoreWithoutId", { env }), publicBaseUrl: "https://alexa.spokenletter.com", bundle: false, recordUtterances: true }));
  });

  test("a small arm64 Node 24 Lambda pointed at the public host, with 30-day logs", () => {
    withId.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "sla-alexa-skill",
      Architectures: ["arm64"],
      Runtime: "nodejs24.x",
      MemorySize: 256,
      Environment: { Variables: Match.objectLike({ PUBLIC_BASE_URL: "https://alexa.spokenletter.com", SKILL_ID, RECORD_UTTERANCES: "0", LOG_SAY: "0", EMF_NAMESPACE: "sla/mcp" }) },
    });
    withId.hasResourceProperties("AWS::Logs::LogGroup", { RetentionInDays: 30 });
    withoutId.hasResourceProperties("AWS::Lambda::Function", { Environment: { Variables: Match.objectLike({ SKILL_ID: "", RECORD_UTTERANCES: "1" }) } });
  });

  test("phase-1.md: EMF_NAMESPACE is set for skill_turn metrics; LOG_SAY follows sla:logSay", () => {
    const app = new App();
    const withLogSay = Template.fromStack(new SkillStack(app, "SkillWithLogSay", { env, core: new CoreStack(app, "CoreWithLogSay", { env }), publicBaseUrl: "https://alexa.spokenletter.com", bundle: false, logSay: true }));
    withLogSay.hasResourceProperties("AWS::Lambda::Function", { Environment: { Variables: Match.objectLike({ LOG_SAY: "1", EMF_NAMESPACE: "sla/mcp" }) } });
  });

  test("Alexa may invoke it only with the skill id as the event source token", () => {
    withId.hasResourceProperties("AWS::Lambda::Permission", {
      Action: "lambda:InvokeFunction",
      Principal: "alexa-appkit.amazon.com",
      EventSourceToken: SKILL_ID,
    });
    // Before the skill exists there is no permission at all: nothing can invoke the function.
    expect(Object.keys(withoutId.findResources("AWS::Lambda::Permission"))).toHaveLength(0);
    // The first registration needs an open trigger permission, replaced once the id is known.
    const app = new App();
    const bootstrap = Template.fromStack(new SkillStack(app, "SkillBootstrap", { env, core: new CoreStack(app, "CoreBootstrap", { env }), publicBaseUrl: "https://alexa.spokenletter.com", bundle: false, skillPermissionOpen: true }));
    bootstrap.hasResourceProperties("AWS::Lambda::Permission", { Principal: "alexa-appkit.amazon.com", EventSourceToken: Match.absent() });
  });

  test("the skill reads only its command secret at cold start", () => {
    const [fn] = Object.values(withId.findResources("AWS::Lambda::Function") as Record<string, { Properties: { Environment: { Variables: Record<string, unknown> } } }>);
    expect(fn?.Properties.Environment.Variables.SECRETS_SKILL_COMMAND_ARN).toBeDefined();
    expect(fn?.Properties.Environment.Variables.ALEXA_SKILL_COMMAND_SECRET).toBeUndefined();
    const policies = Object.values(withId.findResources("AWS::IAM::Policy") as Record<string, { Properties: { PolicyDocument: { Statement: { Action: string | string[]; Resource: unknown }[] } } }>);
    const statements = policies.flatMap((policy) => policy.Properties.PolicyDocument.Statement);
    const actions = statements.flatMap((statement) => ([] as string[]).concat(statement.Action));
    for (const action of actions) expect(action).toMatch(/^(logs|xray):|^secretsmanager:GetSecretValue$/);
    expect(actions.filter((action) => action === "secretsmanager:GetSecretValue")).toHaveLength(1);
    const [read] = statements.filter((statement) => ([] as string[]).concat(statement.Action).includes("secretsmanager:GetSecretValue"));
    expect(read?.Resource).toEqual(fn?.Properties.Environment.Variables.SECRETS_SKILL_COMMAND_ARN);
  });
});
