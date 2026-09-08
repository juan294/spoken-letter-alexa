import { SecretValue, Stack, type StackProps } from "aws-cdk-lib";
import * as agentcore from "aws-cdk-lib/aws-bedrockagentcore";
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
 * bound to the `alexa-m2m` static client (secret from `sla/oauth-clients`); inbound auth
 * is IAM for the agent Lambda. The agent's `MCP_URL` becomes the gateway URL.
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

    this.gateway.grantInvoke(props.api.fn);
  }
}
