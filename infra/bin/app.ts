import { App } from "aws-cdk-lib";

import { ApiStack } from "../lib/api-stack.ts";
import { CoreStack } from "../lib/core-stack.ts";
import { EdgeStack } from "../lib/edge-stack.ts";
import { GatewayStack } from "../lib/gateway-stack.ts";
import { ObservabilityStack } from "../lib/observability-stack.ts";
import { ASSETS_BUCKET_NAME, SimulatorStack } from "../lib/simulator-stack.ts";

const env = { account: "106403001709", region: "us-east-1" };
const DOMAIN = "alexa.spokenletter.com";
const PUBLIC_BASE_URL = `https://${DOMAIN}`;

const app = new App();

// Owner-supplied context (infra/cdk.context.json or `-c key=value`):
//   sla:certificateArn  ACM certificate for alexa.spokenletter.com in us-east-1 (Phase 0 manual step)
//   sla:alertEmail      Owner address for the latency alarm
//   sla:gatewayUrl      AgentCore Gateway MCP endpoint once GatewayStack is deployed (second deploy)
const certificateArn = app.node.tryGetContext("sla:certificateArn") as string | undefined;
const alertEmail = (app.node.tryGetContext("sla:alertEmail") as string | undefined) ?? "juan294@gmail.com";
const gatewayUrl = app.node.tryGetContext("sla:gatewayUrl") as string | undefined;

const core = new CoreStack(app, "SpokenLetterAlexaCore", { env });
new SimulatorStack(app, "SpokenLetterAlexaSimulator", { env });
const api = new ApiStack(app, "SpokenLetterAlexaApi", {
  env,
  core,
  assetsBucketName: ASSETS_BUCKET_NAME,
  publicBaseUrl: PUBLIC_BASE_URL,
  ...(gatewayUrl && { mcpUrl: gatewayUrl }),
});
if (certificateArn) {
  new EdgeStack(app, "SpokenLetterAlexaEdge", {
    env,
    api,
    assetsBucketName: ASSETS_BUCKET_NAME,
    certificateArn,
    hostedZoneId: "Z066897727OCGC5BEA1V8",
    zoneName: "spokenletter.com",
    domainName: DOMAIN,
  });
}
new GatewayStack(app, "SpokenLetterAlexaGateway", { env, core, api, mcpEndpoint: `${PUBLIC_BASE_URL}/mcp` });
new ObservabilityStack(app, "SpokenLetterAlexaObservability", { env, api, alertEmail });
// The Phase 7 LegacyStack (infra/lib/legacy-stack.ts) is intentionally not instantiated.
