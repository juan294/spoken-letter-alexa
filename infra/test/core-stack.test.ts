import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { beforeAll, describe, test } from "vitest";

import { CoreStack } from "../lib/core-stack.ts";

describe("CoreStack", () => {
  let template: Template;

  beforeAll(() => {
    const app = new App();
    const stack = new CoreStack(app, "SpokenLetterAlexaCore", {
      env: { account: "106403001709", region: "us-east-1" },
    });
    template = Template.fromStack(stack);
  });

  test("creates the on-demand sla-oauth table keyed by pk/sk with TTL on expiresAt", () => {
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      TableName: "sla-oauth",
      BillingMode: "PAY_PER_REQUEST",
      KeySchema: [
        { AttributeName: "pk", KeyType: "HASH" },
        { AttributeName: "sk", KeyType: "RANGE" },
      ],
      TimeToLiveSpecification: { AttributeName: "expiresAt", Enabled: true },
      GlobalSecondaryIndexes: [
        Match.objectLike({ IndexName: "byFamily", KeySchema: [{ AttributeName: "familyId", KeyType: "HASH" }] }),
        Match.objectLike({ IndexName: "bySubject", KeySchema: [{ AttributeName: "subject", KeyType: "HASH" }] }),
      ],
    });
  });

  test("creates the on-demand sla-agent-sessions table keyed by sessionId with TTL", () => {
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      TableName: "sla-agent-sessions",
      BillingMode: "PAY_PER_REQUEST",
      KeySchema: [{ AttributeName: "sessionId", KeyType: "HASH" }],
      TimeToLiveSpecification: { AttributeName: "expiresAt", Enabled: true },
    });
  });

  test("creates an RSA 2048 KMS key for JWT signing with an alias", () => {
    template.hasResourceProperties("AWS::KMS::Key", {
      KeySpec: "RSA_2048",
      KeyUsage: "SIGN_VERIFY",
      Description: Match.stringLikeRegexp("JWT"),
    });
    template.hasResourceProperties("AWS::KMS::Alias", { AliasName: "alias/sla-jwt" });
  });

  test("creates the sla/bridge secret with a generated placeholder value", () => {
    template.hasResourceProperties("AWS::SecretsManager::Secret", {
      Name: "sla/bridge",
      Description: Match.stringLikeRegexp("Phase 4"),
      GenerateSecretString: { ExcludePunctuation: true, PasswordLength: 48 },
    });
  });

  test("keeps the OAuth table and signing key on stack deletion", () => {
    template.hasResource("AWS::DynamoDB::Table", { Properties: { TableName: "sla-oauth" }, DeletionPolicy: "Retain" });
    template.hasResource("AWS::KMS::Key", { DeletionPolicy: "Retain" });
  });
});
