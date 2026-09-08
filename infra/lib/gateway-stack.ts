import { CfnOutput, SecretValue, Stack, type StackProps } from "aws-cdk-lib";
import * as agentcore from "aws-cdk-lib/aws-bedrockagentcore";
import * as iam from "aws-cdk-lib/aws-iam";
import * as cr from "aws-cdk-lib/custom-resources";
import { type Construct } from "constructs";

import { type ApiStack } from "./api-stack.ts";
import { type CoreStack } from "./core-stack.ts";

export type GatewayStackProps = StackProps & {
  core: CoreStack;
  api: ApiStack;
  /** The public MCP endpoint the gateway targets. */
  mcpEndpoint: string;
  issuer?: string;
  /** Secrets Manager version id of `sla/oauth-clients` after `seed:secrets --rotate-m2m`. */
  m2mSecretVersionId?: string;
};

/**
 * Amazon Bedrock AgentCore Gateway with the public MCP server as its target. Outbound
 * auth is client_credentials through an AgentCore Identity OAuth2 credential provider
 * bound to the `alexa-m2m` static client (secret from `sla/oauth-clients`, so this stack
 * deploys only after `seed:secrets`); inbound auth is IAM for the agent Lambda, which
 * signs with SigV4 when `MCP_URL` is the gateway. The target is created after the edge
 * exists (bin/app.ts orders the stacks) and re-synchronized by a custom resource whenever
 * the API bundle changes. After `seed:secrets --rotate-m2m`, pass the printed version as
 * `-c sla:m2mSecretVersion=...` so the credential provider re-resolves the secret.
 */
export class GatewayStack extends Stack {
  readonly gateway: agentcore.Gateway;
  readonly target: agentcore.GatewayTarget;

  constructor(scope: Construct, id: string, props: GatewayStackProps) {
    super(scope, id, props);
    const issuer = props.issuer ?? new URL(props.mcpEndpoint).origin;

    const provider = agentcore.OAuth2CredentialProvider.usingCustom(this, "M2mProvider", {
      oAuth2CredentialProviderName: "sla-alexa-m2m",
      clientId: "alexa-m2m",
      // Unversioned dynamic references are resolved only when the resource changes, so a
      // rotation must name the new version to reach the provider (F6-18).
      clientSecret: SecretValue.secretsManager(props.core.oauthClientsSecret.secretArn, {
        jsonField: "m2mSecret",
        ...(props.m2mSecretVersionId && { versionId: props.m2mSecretVersionId }),
      }),
      authorizationServerMetadata: {
        issuer,
        authorizationEndpoint: `${issuer}/oauth/authorize`,
        tokenEndpoint: `${issuer}/oauth/token`,
        responseTypes: ["code"],
      },
    });

    this.gateway = new agentcore.Gateway(this, "Gateway", {
      gatewayName: "sla-alexa",
      description: "Spoken Letter for Alexa+ MCP server target",
      protocolConfiguration: agentcore.GatewayProtocol.mcp({
        instructions: "Read-only tools over the stories a parent has already delivered in Spoken Letter.",
      }),
      authorizerConfiguration: agentcore.GatewayAuthorizer.usingAwsIam(),
      exceptionLevel: agentcore.GatewayExceptionLevel.DEBUG,
    });

    this.target = agentcore.GatewayTarget.forMcpServer(this, "McpTarget", {
      gateway: this.gateway,
      gatewayTargetName: "spoken-letter",
      description: "alexa.spokenletter.com /mcp",
      endpoint: props.mcpEndpoint,
      credentialProviderConfigurations: [agentcore.GatewayCredentialProvider.fromOauthIdentity(provider, { scopes: ["mcp:service"] })],
    });
    // Tools are listed from the endpoint and cached at the control plane (plan: ListingMode DEFAULT).
    (this.target.node.defaultChild as agentcore.CfnGatewayTarget).addPropertyOverride("TargetConfiguration.Mcp.McpServer.ListingMode", "DEFAULT");

    // The invoke grant lives here, on the API role, so this stack depends on ApiStack
    // (not the other way round) and can be deployed after the endpoint is reachable.
    const apiRole = props.api.fn.role;
    if (apiRole) {
      new iam.Policy(this, "ApiInvokesGateway", {
        roles: [apiRole],
        statements: [new iam.PolicyStatement({ actions: ["bedrock-agentcore:InvokeGateway"], resources: [this.gateway.gatewayArn] })],
      });
    }

    // The cached tool list follows the server: the physical id carries the API bundle
    // hash, so the target re-synchronizes exactly when the deployed code changes and
    // the template stays deterministic otherwise.
    const synchronize: cr.AwsSdkCall = {
      service: "@aws-sdk/client-bedrock-agentcore-control",
      action: "SynchronizeGatewayTargetsCommand",
      parameters: { gatewayIdentifier: this.gateway.gatewayId, targetIdList: [this.target.targetId] },
      physicalResourceId: cr.PhysicalResourceId.of(`${this.gateway.gatewayId}:sync:${props.api.bundleHash}`),
    };
    const sync = new cr.AwsCustomResource(this, "SynchronizeTarget", {
      resourceType: "Custom::SlaSynchronizeGatewayTarget",
      onCreate: synchronize,
      onUpdate: synchronize,
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({ actions: ["bedrock-agentcore:SynchronizeGatewayTargets"], resources: [this.gateway.gatewayArn, `${this.gateway.gatewayArn}/*`] }),
      ]),
    });
    sync.node.addDependency(this.target);

    new CfnOutput(this, "GatewayUrl", {
      value: this.gateway.gatewayUrl ?? "",
      description: "AgentCore Gateway MCP endpoint; pass as -c sla:gatewayUrl=... on the next deploy",
    });
  }
}
