import { existsSync } from "node:fs";
import path from "node:path";

import { Duration, Stack, type StackProps } from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import { type Construct } from "constructs";

export const SKILL_FUNCTION_NAME = "sla-alexa-skill";

export type SkillStackProps = StackProps & {
  /** The Alexa+ host; the skill's agent client calls `${publicBaseUrl}/agent/*`. */
  publicBaseUrl: string;
  /** Set once `pnpm -F skill deploy` has created the skill; gates the invoke permission. */
  skillId?: string;
  /** `false` in tests: the marker function instead of the built bundle. */
  bundle?: boolean;
  /** Recording mode (phase-9.md section 3): `-c sla:recordUtterances=1` for one session. */
  recordUtterances?: boolean;
};

/**
 * Phase 9: the classic-skill front end for real-device footage. One small Lambda
 * (Node 24, arm64, 256 MB) bundled from `packages/skill/src/lambda.ts` answers the
 * Alexa custom-skill JSON envelope by calling the public agent endpoint, so the story
 * path, the tools and the child-safety filter are the same as on Alexa+. The role holds
 * nothing beyond logs and X-Ray: every family resource stays behind the API. Until the
 * skill id is known nothing may invoke the function.
 */
export class SkillStack extends Stack {
  readonly fn: lambda.Function;

  constructor(scope: Construct, id: string, props: SkillStackProps) {
    super(scope, id, props);

    const logGroup = new logs.LogGroup(this, "SkillLogs", { logGroupName: "/aws/lambda/sla-alexa-skill", retention: logs.RetentionDays.ONE_MONTH });

    // Built by `pnpm -F infra build` next to the API bundle (infra/scripts/bundle-lambda.mjs).
    const bundleDir = path.resolve(import.meta.dirname, "../dist/skill");
    const useBundle = props.bundle !== false;
    if (useBundle && !existsSync(path.join(bundleDir, "index.mjs"))) {
      throw new Error(`${bundleDir}/index.mjs is missing: run pnpm build before cdk synth or deploy`);
    }

    this.fn = new lambda.Function(this, "Skill", {
      // Fixed so skill-package/skill.json carries the endpoint ARN before the first deploy.
      functionName: SKILL_FUNCTION_NAME,
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      // Alexa waits 8 s for a skill response; the agent client gives up at 6 s and the
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
        LOG_LEVEL: "info",
      },
      handler: "index.handler",
      code: useBundle ? lambda.Code.fromAsset(bundleDir) : lambda.Code.fromInline("export const handler = async () => ({ statusCode: 501 });"),
    });

    if (props.skillId) {
      this.fn.addPermission("AlexaInvoke", {
        principal: new iam.ServicePrincipal("alexa-appkit.amazon.com"),
        action: "lambda:InvokeFunction",
        eventSourceToken: props.skillId,
      });
    }
  }
}
