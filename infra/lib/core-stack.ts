import { Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as kms from "aws-cdk-lib/aws-kms";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { type Construct } from "constructs";

/**
 * Long-lived state shared by every other stack: the OAuth table, the JWT signing key
 * and the bridge secret. Phase 0 content; Phase 6 adds the agent-session table and the
 * static-client secret.
 */
export class CoreStack extends Stack {
  readonly oauthTable: dynamodb.Table;
  readonly agentSessionsTable: dynamodb.Table;
  readonly jwtKey: kms.Key;
  readonly bridgeSecret: secretsmanager.Secret;
  readonly oauthClientsSecret: secretsmanager.Secret;
  readonly originVerifySecret: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    this.oauthTable = new dynamodb.Table(this, "OAuthTable", {
      tableName: "sla-oauth",
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "expiresAt",
      removalPolicy: RemovalPolicy.RETAIN,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
    });
    // Refresh-token items carry `familyId` and `subject`; revocation queries them.
    this.oauthTable.addGlobalSecondaryIndex({
      indexName: "byFamily",
      partitionKey: { name: "familyId", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.KEYS_ONLY,
    });
    this.oauthTable.addGlobalSecondaryIndex({
      indexName: "bySubject",
      partitionKey: { name: "subject", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.KEYS_ONLY,
    });

    this.agentSessionsTable = new dynamodb.Table(this, "AgentSessionsTable", {
      tableName: "sla-agent-sessions",
      partitionKey: { name: "sessionId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "expiresAt",
      removalPolicy: RemovalPolicy.DESTROY,
    });

    this.jwtKey = new kms.Key(this, "JwtSigningKey", {
      description: "sla-jwt-signing: RSA key that signs Spoken Letter for Alexa+ JWT access tokens",
      keySpec: kms.KeySpec.RSA_2048,
      keyUsage: kms.KeyUsage.SIGN_VERIFY,
      alias: "alias/sla-jwt",
      removalPolicy: RemovalPolicy.RETAIN,
      pendingWindow: Duration.days(30),
    });

    this.oauthClientsSecret = new secretsmanager.Secret(this, "OAuthClientsSecret", {
      secretName: "sla/oauth-clients",
      description: "Static OAuth clients and the alexa-m2m secret as JSON; written by pnpm -F infra seed:secrets.",
      generateSecretString: { secretStringTemplate: JSON.stringify({ clients: [] }), generateStringKey: "m2mSecret", excludePunctuation: true, passwordLength: 48 },
    });

    this.originVerifySecret = new secretsmanager.Secret(this, "OriginVerifySecret", {
      secretName: "sla/origin-verify",
      description: "Shared header value CloudFront presents to the function URL (x-origin-verify); the Lambda refuses requests without it.",
      generateSecretString: { excludePunctuation: true, passwordLength: 48 },
    });

    this.bridgeSecret = new secretsmanager.Secret(this, "BridgeSecret", {
      secretName: "sla/bridge",
      description:
        "ALEXA_BRIDGE_SECRET shared with the private Spoken Letter API. Generated here; pnpm -F infra seed:secrets rotates it on request.",
      generateSecretString: {
        excludePunctuation: true,
        passwordLength: 48,
      },
    });
  }
}
