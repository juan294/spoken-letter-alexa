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
};

/**
 * Amazon Bedrock AgentCore Gateway with the public MCP server as its target. Outbound
 * auth is client_credentials through an AgentCore Identity OAuth2 credential provider
 * bound to the `alexa-m2m` static client (secret from `sla/oauth-clients`, so this stack
 * deploys only after `seed:secrets`); inbound auth is IAM for the agent Lambda, which
 * signs with SigV4 when `MCP_URL` is the gateway. The target is created after the edge
 * exists (bin/app.ts orders the stacks) and synchronized once by a custom resource.
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
      clientSecret: SecretValue.secretsManager(props.core.oauthClientsSecret.secretArn, { jsonField: "m2mSecret" }),
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

    // One synchronization after the target exists so the cached tool list is populated.
    const sync = new cr.AwsCustomResource(this, "SynchronizeTarget", {
      resourceType: "Custom::SlaSynchronizeGatewayTarget",
      onCreate: {
        service: "@aws-sdk/client-bedrock-agentcore-control",
        action: "SynchronizeGatewayTargetsCommand",
        parameters: { gatewayIdentifier: this.gateway.gatewayId, targetIdList: [this.target.targetId] },
        physicalResourceId: cr.PhysicalResourceId.of(`${this.gateway.gatewayId}:sync`),
      },
      onUpdate: {
        service: "@aws-sdk/client-bedrock-agentcore-control",
        action: "SynchronizeGatewayTargetsCommand",
        parameters: { gatewayIdentifier: this.gateway.gatewayId, targetIdList: [this.target.targetId] },
        physicalResourceId: cr.PhysicalResourceId.of(`${this.gateway.gatewayId}:sync`),
      },
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
