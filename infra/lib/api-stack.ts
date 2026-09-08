import { existsSync } from "node:fs";
import path from "node:path";

import { Annotations, Duration, Stack, type StackProps } from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
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
  /** Set by GatewayStack after the gateway exists; `${publicBaseUrl}/mcp` until then. */
  mcpUrl?: string;
  bedrockModelId?: string;
};

export const DEFAULT_PUBLIC_BASE_URL = "https://alexa.spokenletter.com";
export const DEFAULT_BEDROCK_MODEL_ID = "us.anthropic.claude-haiku-4-5-20251001-v1:0";

/**
 * One Lambda (Node 24, arm64, 1024 MB) bundled from `packages/app/src/lambda-entry.ts`, which
 * mounts the MCP server, the OAuth server and the agent on one Hono app, behind a
 * function URL in RESPONSE_STREAM mode with IAM auth (CloudFront signs with an OAC).
 * Secrets are read at cold start from Secrets Manager; the environment carries only ARNs.
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
      LOG_LEVEL: "info",
    };

    const common = {
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 1024,
      timeout: Duration.seconds(60),
      reservedConcurrentExecutions: 20,
      tracing: lambda.Tracing.ACTIVE,
      logGroup: this.logGroup,
      environment,
    };

    // Built by `pnpm -F infra build` (infra/scripts/bundle-lambda.mjs): index.mjs, the
    // linux/arm64 ffmpeg-static binary and the fixture catalog. Tests and a synth without
    // a build use a marker function so the template still validates.
    const bundleDir = path.resolve(import.meta.dirname, "../dist/lambda");
    const useBundle = props.bundle !== false && existsSync(path.join(bundleDir, "index.mjs"));
    if (props.bundle !== false && !useBundle) {
      Annotations.of(this).addWarningV2("sla:lambda-bundle-missing", `${bundleDir} is missing; run pnpm build before deploying`);
    }
    this.fn = new lambda.Function(this, "Api", {
      ...common,
      handler: "index.handler",
      code: useBundle ? lambda.Code.fromAsset(bundleDir) : lambda.Code.fromInline("export const handler = async () => ({ statusCode: 501 });"),
    });

    this.url = this.fn.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.AWS_IAM, invokeMode: lambda.InvokeMode.RESPONSE_STREAM });

    // Least privilege: exactly what packages/app touches at runtime.
    props.core.oauthTable.grantReadWriteData(this.fn);
    props.core.agentSessionsTable.grantReadWriteData(this.fn);
    props.core.bridgeSecret.grantRead(this.fn);
    props.core.oauthClientsSecret.grantRead(this.fn);
    props.core.jwtKey.grant(this.fn, "kms:Sign", "kms:GetPublicKey");
    // By name, not by construct: a reference would cycle Api -> Simulator -> Edge -> Api.
    s3.Bucket.fromBucketName(this, "Assets", props.assetsBucketName).grantPut(this.fn, "polly/*");
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
