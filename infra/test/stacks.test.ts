import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { beforeAll, describe, expect, test } from "vitest";

import { ApiStack } from "../lib/api-stack.ts";
import { CoreStack } from "../lib/core-stack.ts";
import { EdgeStack } from "../lib/edge-stack.ts";
import { GatewayStack } from "../lib/gateway-stack.ts";
import { ObservabilityStack } from "../lib/observability-stack.ts";
import { ASSETS_BUCKET_NAME, SimulatorStack } from "../lib/simulator-stack.ts";

const env = { account: "106403001709", region: "us-east-1" };
const CERT_ARN = "arn:aws:acm:us-east-1:106403001709:certificate/00000000-0000-4000-8000-000000000000";

type Templates = { core: Template; api: Template; simulator: Template; edge: Template; gateway: Template; observability: Template };
type Resource = { Type: string; Properties: Record<string, unknown> };

/** Typed view over `findResources`: the assertions library returns `any`. */
function resources(template: Template, type: string): Resource[] {
  return Object.values(template.findResources(type) as Record<string, Resource>);
}

type Statement = { Action: string | string[]; Resource: unknown; Effect?: string };
function statements(template: Template): Statement[] {
  return resources(template, "AWS::IAM::Policy").flatMap((policy) => (policy.Properties.PolicyDocument as { Statement: Statement[] }).Statement);
}

function synth(): Templates {
  const app = new App({ context: { "sla:certificateArn": CERT_ARN, "sla:alertEmail": "owner@example.com" } });
  const core = new CoreStack(app, "SpokenLetterAlexaCore", { env });
  const simulator = new SimulatorStack(app, "SpokenLetterAlexaSimulator", { env });
  const api = new ApiStack(app, "SpokenLetterAlexaApi", { env, core, assetsBucketName: ASSETS_BUCKET_NAME, bundle: false });
  const edge = new EdgeStack(app, "SpokenLetterAlexaEdge", {
    env,
    api,
    assetsBucketName: ASSETS_BUCKET_NAME,
    certificateArn: CERT_ARN,
    hostedZoneId: "Z066897727OCGC5BEA1V8",
    zoneName: "spokenletter.com",
    domainName: "alexa.spokenletter.com",
  });
  const gateway = new GatewayStack(app, "SpokenLetterAlexaGateway", { env, core, api, mcpEndpoint: "https://alexa.spokenletter.com/mcp" });
  const observability = new ObservabilityStack(app, "SpokenLetterAlexaObservability", { env, api, alertEmail: "owner@example.com" });
  return {
    core: Template.fromStack(core),
    api: Template.fromStack(api),
    simulator: Template.fromStack(simulator),
    edge: Template.fromStack(edge),
    gateway: Template.fromStack(gateway),
    observability: Template.fromStack(observability),
  };
}

describe("Phase 6 stacks", () => {
  let t: Templates;
  beforeAll(() => {
    t = synth();
  });

  test("every stack synthesizes", () => {
    for (const template of Object.values(t)) expect(Object.keys((template.toJSON() as { Resources?: object }).Resources ?? {}).length).toBeGreaterThan(0);
  });

  describe("ApiStack", () => {
    test("one arm64 Node 24 Lambda with 1024 MB, tracing, reserved concurrency and the function URL in RESPONSE_STREAM mode", () => {
      t.api.hasResourceProperties("AWS::Lambda::Function", {
        Architectures: ["arm64"],
        Runtime: "nodejs24.x",
        MemorySize: 1024,
        ReservedConcurrentExecutions: 20,
        TracingConfig: { Mode: "Active" },
        Environment: { Variables: Match.objectLike({ PROVIDER_MODE: "fixtures", EMF_NAMESPACE: "sla/mcp", DEV_ROUTES: "0", AGENT_OFFLINE: "0" }) },
      });
      t.api.hasResourceProperties("AWS::Lambda::Url", { InvokeMode: "RESPONSE_STREAM", AuthType: "AWS_IAM" });
    });

    test("the log group is explicit with 30-day retention", () => {
      t.api.hasResourceProperties("AWS::Logs::LogGroup", { LogGroupName: "/aws/lambda/sla-alexa-api", RetentionInDays: 30 });
    });

    test("secrets are read at cold start from Secrets Manager, not baked into the environment", () => {
      const [fn] = resources(t.api, "AWS::Lambda::Function");
      const variables = (fn?.Properties.Environment as { Variables: Record<string, unknown> }).Variables;
      expect(JSON.stringify(variables)).not.toMatch(/ALEXA_BRIDGE_SECRET|OAUTH_M2M_SECRET/);
      expect(variables.SECRETS_BRIDGE_ARN).toBeDefined();
      expect(variables.SECRETS_OAUTH_CLIENTS_ARN).toBeDefined();
    });

    test("IAM stays narrow: only Transcribe and Polly use Resource *", () => {
      const apiStatements = statements(t.api);
      for (const statement of apiStatements) {
        const actions = ([] as string[]).concat(statement.Action);
        const wildcard = JSON.stringify(statement.Resource) === '"*"';
        if (wildcard) expect(actions.every((action) => /^(transcribe|polly|xray):/.test(action))).toBe(true);
      }
      const actions = new Set(apiStatements.flatMap((statement) => ([] as string[]).concat(statement.Action)));
      for (const needed of ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream", "polly:SynthesizeSpeech", "transcribe:StartStreamTranscription", "kms:Sign", "kms:GetPublicKey", "secretsmanager:GetSecretValue", "s3:PutObject"]) {
        expect(actions.has(needed)).toBe(true);
      }
      expect([...actions].some((action) => action === "dynamodb:*")).toBe(false);
    });
  });

  describe("SimulatorStack", () => {
    test("a private bucket with OAC access only, a 1-hour lifecycle on polly/, and the SPA plus fixtures deployed", () => {
      t.simulator.hasResourceProperties("AWS::S3::Bucket", {
        PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true },
        LifecycleConfiguration: { Rules: Match.arrayWith([Match.objectLike({ Prefix: "polly/", ExpirationInDays: 1, Status: "Enabled" })]) },
      });
      expect(resources(t.simulator, "Custom::CDKBucketDeployment").length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("EdgeStack", () => {
    test("CloudFront: default behaviour to the function URL with no caching and the MCP headers forwarded; /demo/* and /fixtures/* and /polly/* to S3", () => {
      const distributions = resources(t.edge, "AWS::CloudFront::Distribution");
      expect(distributions).toHaveLength(1);
      const config = distributions[0]?.Properties.DistributionConfig as {
        Aliases: string[];
        DefaultCacheBehavior: { AllowedMethods: string[]; ViewerProtocolPolicy: string };
        CacheBehaviors: { PathPattern: string }[];
        ViewerCertificate: { AcmCertificateArn: string; MinimumProtocolVersion: string };
        WebACLId?: unknown;
      };
      expect(config.Aliases).toEqual(["alexa.spokenletter.com"]);
      expect(config.DefaultCacheBehavior.AllowedMethods).toEqual(expect.arrayContaining(["GET", "HEAD", "OPTIONS", "PUT", "PATCH", "POST", "DELETE"]));
      expect(config.DefaultCacheBehavior.ViewerProtocolPolicy).toBe("redirect-to-https");
      expect(config.CacheBehaviors.map((b) => b.PathPattern).sort()).toEqual(["/demo/*", "/fixtures/*", "/polly/*"]);
      expect(config.ViewerCertificate.AcmCertificateArn).toBe(CERT_ARN);
      expect(config.ViewerCertificate.MinimumProtocolVersion).toBe("TLSv1.2_2021");
      expect(config.WebACLId).toBeDefined();
      const policies = resources(t.edge, "AWS::CloudFront::OriginRequestPolicy");
      expect(policies).toHaveLength(1);
      const orp = policies[0]?.Properties.OriginRequestPolicyConfig as { HeadersConfig: { HeaderBehavior: string; Headers: string[] }; QueryStringsConfig: { QueryStringBehavior: string } };
      expect(orp.HeadersConfig.HeaderBehavior).toBe("whitelist");
      for (const header of ["X-Forwarded-Authorization", "MCP-Protocol-Version", "Mcp-Method", "Mcp-Name", "Mcp-Session-Id", "Accept", "Content-Type"]) {
        expect(orp.HeadersConfig.Headers).toContain(header);
      }
      expect(orp.HeadersConfig.Headers).not.toContain("Authorization");
      expect(orp.QueryStringsConfig.QueryStringBehavior).toBe("all");
      // The viewer's bearer survives the OAC signature through a viewer-request function.
      t.edge.hasResourceProperties("AWS::CloudFront::Function", {
        FunctionCode: Match.stringLikeRegexp("x-forwarded-authorization"),
        FunctionConfig: Match.objectLike({ Runtime: "cloudfront-js-2.0" }),
      });
      const defaultBehavior = config.DefaultCacheBehavior as { FunctionAssociations?: { EventType: string }[] };
      expect(defaultBehavior.FunctionAssociations?.map((a) => a.EventType)).toEqual(["viewer-request"]);
      t.edge.hasResourceProperties("AWS::CloudFront::ResponseHeadersPolicy", {
        ResponseHeadersPolicyConfig: Match.objectLike({
          SecurityHeadersConfig: Match.objectLike({
            StrictTransportSecurity: Match.objectLike({ AccessControlMaxAgeSec: 31536000, IncludeSubdomains: true }),
            ContentTypeOptions: { Override: true },
          }),
        }),
      });
    });

    test("a WAF rate rule of 300 requests per 5 minutes per IP scoped to /oauth/", () => {
      t.edge.hasResourceProperties("AWS::WAFv2::WebACL", {
        Scope: "CLOUDFRONT",
        Rules: Match.arrayWith([
          Match.objectLike({
            Statement: {
              RateBasedStatement: Match.objectLike({
                Limit: 300,
                AggregateKeyType: "IP",
                ScopeDownStatement: Match.objectLike({ ByteMatchStatement: Match.objectLike({ SearchString: "/oauth/", PositionalConstraint: "STARTS_WITH" }) }),
              }),
            },
          }),
        ]),
      });
    });

    test("the single assets bucket policy lives here: CloudFront OAC read plus a secure-transport deny", () => {
      expect(resources(t.simulator, "AWS::S3::BucketPolicy")).toHaveLength(0);
      t.edge.hasResourceProperties("AWS::S3::BucketPolicy", {
        Bucket: ASSETS_BUCKET_NAME,
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({ Sid: "AllowCloudFrontOAC", Principal: { Service: "cloudfront.amazonaws.com" }, Action: "s3:GetObject" }),
            Match.objectLike({ Sid: "DenyInsecureTransport", Effect: "Deny", Condition: { Bool: { "aws:SecureTransport": "false" } } }),
          ]),
        },
      });
    });

    test("Route53 A and AAAA aliases for alexa.spokenletter.com", () => {
      t.edge.hasResourceProperties("AWS::Route53::RecordSet", { Name: "alexa.spokenletter.com.", Type: "A", HostedZoneId: "Z066897727OCGC5BEA1V8" });
      t.edge.hasResourceProperties("AWS::Route53::RecordSet", { Name: "alexa.spokenletter.com.", Type: "AAAA" });
    });
  });

  describe("GatewayStack", () => {
    test("an AgentCore gateway with IAM inbound auth, an MCP server target on /mcp, and an OAuth client_credentials provider for alexa-m2m", () => {
      t.gateway.hasResourceProperties("AWS::BedrockAgentCore::Gateway", {
        ProtocolType: "MCP",
        AuthorizerType: "AWS_IAM",
      });
      t.gateway.hasResourceProperties("AWS::BedrockAgentCore::GatewayTarget", {
        TargetConfiguration: { Mcp: { McpServer: { Endpoint: "https://alexa.spokenletter.com/mcp" } } },
        CredentialProviderConfigurations: Match.arrayWith([
          Match.objectLike({
            CredentialProviderType: "OAUTH",
            CredentialProvider: { OauthCredentialProvider: Match.objectLike({ Scopes: ["mcp:service"] }) },
          }),
        ]),
      });
      t.gateway.hasResourceProperties("AWS::BedrockAgentCore::OAuth2CredentialProvider", {
        CredentialProviderVendor: "CustomOauth2",
        Name: "sla-alexa-m2m",
        Oauth2ProviderConfigInput: {
          CustomOauth2ProviderConfig: Match.objectLike({
            ClientId: "alexa-m2m",
            OauthDiscovery: {
              AuthorizationServerMetadata: Match.objectLike({ Issuer: "https://alexa.spokenletter.com", TokenEndpoint: "https://alexa.spokenletter.com/oauth/token" }),
            },
          }),
        },
      });
      // The client secret is resolved from Secrets Manager at deploy time, never inlined.
      const [provider] = resources(t.gateway, "AWS::BedrockAgentCore::OAuth2CredentialProvider");
      expect(JSON.stringify(provider?.Properties)).toContain("resolve:secretsmanager");
    });

    test("the API Lambda may invoke the gateway", () => {
      const actions = statements(t.api).flatMap((statement) => ([] as string[]).concat(statement.Action));
      expect(actions.some((action) => action.startsWith("bedrock-agentcore:InvokeGateway"))).toBe(true);
    });
  });

  describe("ObservabilityStack", () => {
    test("dashboard, p95 alarm on ToolLatencyMs > 400 over 5 minutes to an SNS email", () => {
      t.observability.hasResourceProperties("AWS::CloudWatch::Dashboard", { DashboardName: "sla-alexa" });
      t.observability.hasResourceProperties("AWS::CloudWatch::Alarm", {
        Namespace: "sla/mcp",
        MetricName: "ToolLatencyMs",
        ExtendedStatistic: "p95",
        Threshold: 400,
        Period: 300,
        ComparisonOperator: "GreaterThanThreshold",
      });
      t.observability.hasResourceProperties("AWS::SNS::Subscription", { Protocol: "email", Endpoint: "owner@example.com" });
    });
  });

  describe("CoreStack extension", () => {
    test("the static clients secret exists next to the bridge secret", () => {
      t.core.hasResourceProperties("AWS::SecretsManager::Secret", { Name: "sla/oauth-clients" });
    });
  });
});
