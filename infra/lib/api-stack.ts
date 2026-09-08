import { existsSync } from "node:fs";
import path from "node:path";

import { Duration, Stack, type StackProps } from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import { type Construct } from "constructs";

import { type CoreStack } from "./core-stack.ts";

export type ApiStackProps = StackProps & {
  core: CoreStack;
  /** The simulator bucket's fixed name (SimulatorStack); Polly replies are written under `polly/`. */
  assetsBucketName: string;
  /** `false` in tests: the marker function instead of the built bundle. */
  bundle?: boolean;
  publicBaseUrl?: string;
  spokenLetterOrigin?: string;
  /** The AgentCore Gateway MCP endpoint once it exists; `${publicBaseUrl}/mcp` until then. */
  mcpUrl?: string;
  bedrockModelId?: string;
};

export const DEFAULT_PUBLIC_BASE_URL = "https://alexa.spokenletter.com";
export const DEFAULT_BEDROCK_MODEL_ID = "us.anthropic.claude-haiku-4-5-20251001-v1:0";

/**
 * One Lambda (Node 24, arm64, 1024 MB) bundled from `packages/app/src/lambda-entry.ts`,
 * which mounts the MCP server, the OAuth server and the agent on one Hono app, behind a
 * function URL in RESPONSE_STREAM mode. The URL's auth type is NONE because an origin
 * access control would make Lambda reject every POST without a payload hash (D18); the
 * Lambda instead requires the `x-origin-verify` header CloudFront adds from
 * `sla/origin-verify`. Secrets are read at cold start from Secrets Manager; the
 * environment carries only ARNs.
 */
export class ApiStack extends Stack {
  readonly fn: lambda.Function;
  readonly url: lambda.FunctionUrl;
  readonly logGroup: logs.LogGroup;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);
    const publicBaseUrl = props.publicBaseUrl ?? DEFAULT_PUBLIC_BASE_URL;
    const modelId = props.bedrockModelId ?? DEFAULT_BEDROCK_MODEL_ID;

    this.logGroup = new logs.LogGroup(this, "ApiLogs", { logGroupName: "/aws/lambda/sla-alexa-api", retention: logs.RetentionDays.ONE_MONTH });

    const environment: Record<string, string> = {
      NODE_OPTIONS: "--enable-source-maps",
      PUBLIC_BASE_URL: publicBaseUrl,
      SPOKEN_LETTER_ORIGIN: props.spokenLetterOrigin ?? "https://spokenletter.com",
      PROVIDER_MODE: "fixtures",
      DEV_ROUTES: "0",
      AGENT_OFFLINE: "0",
      MCP_LEGACY_SESSIONS: "0",
      OAUTH_STORE: "dynamo",
      OAUTH_TABLE: props.core.oauthTable.tableName,
      JWT_SIGNER: "kms",
      KMS_KEY_ID: props.core.jwtKey.keyId,
      AGENT_SESSIONS_STORE: "dynamo",
      AGENT_SESSIONS_TABLE: props.core.agentSessionsTable.tableName,
      ASSETS_BUCKET: props.assetsBucketName,
      BEDROCK_MODEL_ID: modelId,
      MCP_URL: props.mcpUrl ?? `${publicBaseUrl}/mcp`,
      FIXTURES_PATH: "/var/task/fixtures/stories.json",
      EMF_NAMESPACE: "sla/mcp",
      SECRETS_BRIDGE_ARN: props.core.bridgeSecret.secretArn,
      SECRETS_OAUTH_CLIENTS_ARN: props.core.oauthClientsSecret.secretArn,
      SECRETS_ORIGIN_VERIFY_ARN: props.core.originVerifySecret.secretArn,
      LOG_LEVEL: "info",
    };

    // Built by `pnpm -F infra build` (infra/scripts/bundle-lambda.mjs): index.mjs, the
    // linux/arm64 ffmpeg-static binary and the fixture catalog. Tests use a marker
    // function; a real synth without the bundle fails instead of deploying the marker.
    const bundleDir = path.resolve(import.meta.dirname, "../dist/lambda");
    const useBundle = props.bundle !== false;
    if (useBundle && !existsSync(path.join(bundleDir, "index.mjs"))) {
      throw new Error(`${bundleDir}/index.mjs is missing: run pnpm build before cdk synth or deploy`);
    }
    this.fn = new lambda.Function(this, "Api", {
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 1024,
      timeout: Duration.seconds(60),
      reservedConcurrentExecutions: 20,
      tracing: lambda.Tracing.ACTIVE,
      logGroup: this.logGroup,
      environment,
      handler: "index.handler",
      code: useBundle ? lambda.Code.fromAsset(bundleDir) : lambda.Code.fromInline("export const handler = async () => ({ statusCode: 501 });"),
    });

    this.url = this.fn.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE, invokeMode: lambda.InvokeMode.RESPONSE_STREAM });

    // Exactly the plan's list (phase-6 section 1), written out rather than through the
    // grant helpers so nothing broader rides along.
    const tables = [props.core.oauthTable, props.core.agentSessionsTable];
    this.fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:Query"],
        resources: tables.flatMap((table) => [table.tableArn, `${table.tableArn}/index/*`]),
      }),
    );
    this.fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["secretsmanager:GetSecretValue"],
        resources: [props.core.bridgeSecret.secretArn, props.core.oauthClientsSecret.secretArn, props.core.originVerifySecret.secretArn],
      }),
    );
    this.fn.addToRolePolicy(new iam.PolicyStatement({ actions: ["kms:Sign", "kms:GetPublicKey"], resources: [props.core.jwtKey.keyArn] }));
    this.fn.addToRolePolicy(new iam.PolicyStatement({ actions: ["s3:PutObject"], resources: [`arn:aws:s3:::${props.assetsBucketName}/polly/*`] }));
    this.fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
        resources: [
          `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/${modelId}`,
          `arn:aws:bedrock:*::foundation-model/${modelId.replace(/^(us|eu|global)\./, "")}`,
        ],
      }),
    );
    // Transcribe streaming and Polly have no resource-level permissions.
    this.fn.addToRolePolicy(new iam.PolicyStatement({ actions: ["transcribe:StartStreamTranscription"], resources: ["*"] }));
    this.fn.addToRolePolicy(new iam.PolicyStatement({ actions: ["polly:SynthesizeSpeech"], resources: ["*"] }));
  }
}
