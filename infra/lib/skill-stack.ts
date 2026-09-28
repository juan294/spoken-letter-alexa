import path from "node:path";

import { Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as kms from "aws-cdk-lib/aws-kms";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import { type Construct } from "constructs";

import { bundledCode } from "./lambda-code.ts";
import { type CoreStack } from "./core-stack.ts";
import { METRIC_NAMESPACE } from "./observability-stack.ts";

const SKILL_FUNCTION_NAME = "sla-alexa-skill";
const NOTIFICATION_FUNCTION_NAME = "sla-alexa-notifications";
const NOTIFICATION_SENDER_FUNCTION_NAME = "sla-alexa-notification-send-dev";

export type SkillStackProps = StackProps & {
  core: CoreStack;
  /** The Alexa+ host; the skill's agent client calls `${publicBaseUrl}/agent/*`. */
  publicBaseUrl: string;
  /** Set once `pnpm -F skill deploy` has created the skill; gates the invoke permission. */
  skillId?: string;
  /** `false` in tests: the marker function instead of the built bundle. */
  bundle?: boolean;
  /** Recording mode (phase-9.md section 3): `-c sla:recordUtterances=1` for one session. */
  recordUtterances?: boolean;
  /** Phase 1 section 3: `-c sla:logSay=1` for the one recorded device session, then unset. */
  logSay?: boolean;
  /**
   * First registration only (`-c sla:skillPermissionOpen=1`): the Skill Management API
   * refuses to create a skill whose Lambda does not already allow
   * `alexa-appkit.amazon.com`, and the id it would lock to does not exist yet. The open
   * permission lets `ask deploy` create the skill; the next deploy with `sla:skillId`
   * replaces it with the locked one.
   */
  skillPermissionOpen?: boolean;
};

/**
 * Phase 9: the classic-skill front end for real-device footage. One small Lambda
 * (Node 24, arm64, 256 MB) bundled from `packages/skill/src/lambda.ts` answers the
 * Alexa custom-skill JSON envelope by calling the public agent endpoint, so the story
 * path, the tools and the child-safety filter are the same as on Alexa+. The role reads
 * only its command secret; every family resource stays behind the API. Until the
 * skill id is known nothing may invoke the function.
 */
export class SkillStack extends Stack {
  readonly fn: lambda.Function;
  readonly notificationsFn: lambda.Function;
  readonly notificationSenderFn: lambda.Function;

  constructor(scope: Construct, id: string, props: SkillStackProps) {
    super(scope, id, props);

    const logGroup = new logs.LogGroup(this, "SkillLogs", { logGroupName: "/aws/lambda/sla-alexa-skill", retention: logs.RetentionDays.ONE_MONTH });

    // Built by `pnpm -F infra build` next to the API bundle (infra/scripts/bundle-lambda.mjs).
    const bundle = bundledCode(path.resolve(import.meta.dirname, "../dist/skill"), props.bundle !== false);

    this.fn = new lambda.Function(this, "Skill", {
      // Fixed so skill-package/skill.json carries the endpoint ARN before the first deploy.
      functionName: SKILL_FUNCTION_NAME,
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      // Alexa waits 8 s for a skill response; the agent client gives up at 7 s and the
      // handler answers "still looking" (packages/skill/src/handler.ts).
      timeout: Duration.seconds(8),
      tracing: lambda.Tracing.ACTIVE,
      logGroup,
      environment: {
        NODE_OPTIONS: "--enable-source-maps",
        PUBLIC_BASE_URL: props.publicBaseUrl,
        SKILL_ID: props.skillId ?? "",
        // "1" for a recording session only: catch-all phrasings are logged for the
        // interaction-model training file, then the flag goes back to "0".
        RECORD_UTTERANCES: props.recordUtterances ? "1" : "0",
        LOG_SAY: props.logSay ? "1" : "0",
        EMF_NAMESPACE: METRIC_NAMESPACE,
        LOG_LEVEL: "info",
        SECRETS_SKILL_COMMAND_ARN: props.core.skillCommandSecret.secretArn,
      },
      handler: "index.handler",
      code: bundle.code,
    });

    this.fn.addToRolePolicy(new iam.PolicyStatement({
      actions: ["secretsmanager:GetSecretValue"],
      resources: [props.core.skillCommandSecret.secretArn],
    }));

    const subscriptions = new dynamodb.Table(this, "NotificationSubscriptions", {
      tableName: "sla-notification-subscriptions",
      partitionKey: { name: "deviceKey", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "expiresAt",
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const userIdKey = new kms.Key(this, "NotificationUserIdKey", {
      description: "Encrypts opted-in Alexa user IDs for the notification worker only",
      enableKeyRotation: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const notificationsBundle = bundledCode(path.resolve(import.meta.dirname, "../dist/notifications"), props.bundle !== false);
    const notificationsLogGroup = new logs.LogGroup(this, "NotificationLogs", {
      logGroupName: "/aws/lambda/sla-alexa-notifications",
      retention: logs.RetentionDays.ONE_MONTH,
    });
    this.notificationsFn = new lambda.Function(this, "NotificationWorker", {
      functionName: NOTIFICATION_FUNCTION_NAME,
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(10),
      tracing: lambda.Tracing.ACTIVE,
      logGroup: notificationsLogGroup,
      environment: {
        NODE_OPTIONS: "--enable-source-maps",
        SKILL_ID: props.skillId ?? "",
        SUBSCRIPTIONS_TABLE: subscriptions.tableName,
        USER_ID_KMS_KEY_ID: userIdKey.keyId,
        LOG_LEVEL: "info",
      },
      handler: "index.handler",
      code: notificationsBundle.code,
    });
    this.notificationsFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ["dynamodb:PutItem"],
      resources: [subscriptions.tableArn],
    }));
    this.notificationsFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ["kms:Encrypt"],
      resources: [userIdKey.keyArn],
    }));

    const senderLogs = new logs.LogGroup(this, "NotificationSenderLogs", {
      logGroupName: "/aws/lambda/sla-alexa-notification-send-dev",
      retention: logs.RetentionDays.ONE_MONTH,
    });
    this.notificationSenderFn = new lambda.Function(this, "NotificationSender", {
      functionName: NOTIFICATION_SENDER_FUNCTION_NAME,
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(20),
      tracing: lambda.Tracing.ACTIVE,
      logGroup: senderLogs,
      environment: {
        NODE_OPTIONS: "--enable-source-maps",
        SUBSCRIPTIONS_TABLE: subscriptions.tableName,
        USER_ID_KMS_KEY_ID: userIdKey.keyId,
        SKILL_CREDENTIALS_SECRET_ID: "sla/skill-credentials",
        FIXTURE_EVENTS_PATH: "/var/task/fixtures/events.json",
        LOG_LEVEL: "info",
      },
      handler: "index.sendHandler",
      code: notificationsBundle.code,
    });
    this.notificationSenderFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ["dynamodb:GetItem"],
      resources: [subscriptions.tableArn],
    }));
    this.notificationSenderFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ["kms:Decrypt"],
      resources: [userIdKey.keyArn],
    }));
    this.notificationSenderFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ["secretsmanager:GetSecretValue"],
      resources: [`arn:aws:secretsmanager:${this.region}:${this.account}:secret:sla/skill-credentials-*`],
    }));

    if (props.skillId) {
      this.fn.addPermission("AlexaInvoke", {
        principal: new iam.ServicePrincipal("alexa-appkit.amazon.com"),
        action: "lambda:InvokeFunction",
        eventSourceToken: props.skillId,
      });
      this.notificationsFn.addPermission("AlexaSubscriptionEvents", {
        principal: new iam.ServicePrincipal("alexa-appkit.amazon.com"),
        action: "lambda:InvokeFunction",
        eventSourceToken: props.skillId,
      });
    } else if (props.skillPermissionOpen) {
      this.fn.addPermission("AlexaInvokeBootstrap", {
        principal: new iam.ServicePrincipal("alexa-appkit.amazon.com"),
        action: "lambda:InvokeFunction",
      });
      this.notificationsFn.addPermission("AlexaSubscriptionEventsBootstrap", {
        principal: new iam.ServicePrincipal("alexa-appkit.amazon.com"),
        action: "lambda:InvokeFunction",
      });
    }
  }
}
