import { App } from "aws-cdk-lib";

import { ApiStack } from "../lib/api-stack.ts";
import { CoreStack } from "../lib/core-stack.ts";
import { EdgeStack } from "../lib/edge-stack.ts";
import { GatewayStack } from "../lib/gateway-stack.ts";
import { ObservabilityStack } from "../lib/observability-stack.ts";
import { ASSETS_BUCKET_NAME, SimulatorStack } from "../lib/simulator-stack.ts";
import { SkillStack } from "../lib/skill-stack.ts";

const env = { account: "106403001709", region: "us-east-1" };
const DOMAIN = "alexa.spokenletter.com";
const PUBLIC_BASE_URL = `https://${DOMAIN}`;

const app = new App();

// Owner-supplied context (infra/cdk.context.json or `-c key=value`), see docs/release.md A3a:
//   sla:certificateArn  ACM certificate for alexa.spokenletter.com in us-east-1 (Phase 0 manual step)
//   sla:alertEmail      Owner address for the latency alarm
//   sla:deployGateway   "1" on the second deploy, after seed:secrets, once DNS resolves
//   sla:gatewayUrl      the GatewayUrl output; on the third deploy the agent targets the gateway
//   sla:skillId         the Alexa skill id once `pnpm -F skill deploy` has run (Phase 9)
const context = (key: string) => app.node.tryGetContext(key) as string | undefined;
const certificateArn = context("sla:certificateArn");
const alertEmail = context("sla:alertEmail") ?? "juan294@gmail.com";
const gatewayUrl = context("sla:gatewayUrl");
const deployGateway = context("sla:deployGateway") === "1";
const skillId = context("sla:skillId");

const core = new CoreStack(app, "SpokenLetterAlexaCore", { env });
const simulator = new SimulatorStack(app, "SpokenLetterAlexaSimulator", { env });
const api = new ApiStack(app, "SpokenLetterAlexaApi", {
  env,
  core,
  assetsBucketName: ASSETS_BUCKET_NAME,
  publicBaseUrl: PUBLIC_BASE_URL,
  ...(gatewayUrl && { mcpUrl: gatewayUrl }),
});
let edge: EdgeStack | undefined;
if (certificateArn) {
  edge = new EdgeStack(app, "SpokenLetterAlexaEdge", {
    env,
    api,
    assetsBucketName: ASSETS_BUCKET_NAME,
    originVerifySecret: core.originVerifySecret,
    certificateArn,
    hostedZoneId: "Z066897727OCGC5BEA1V8",
    zoneName: "spokenletter.com",
    domainName: DOMAIN,
  });
  // The bucket policy in EdgeStack targets the SimulatorStack bucket by name.
  edge.addStackDependency(simulator);
}
if (deployGateway) {
  const gateway = new GatewayStack(app, "SpokenLetterAlexaGateway", { env, core, api, mcpEndpoint: `${PUBLIC_BASE_URL}/mcp` });
  // The target synchronizes tools from the public endpoint: DNS and TLS must exist first.
  if (edge) gateway.addStackDependency(edge);
}
new ObservabilityStack(app, "SpokenLetterAlexaObservability", { env, api, alertEmail });
new SkillStack(app, "SpokenLetterAlexaSkill", { env, publicBaseUrl: PUBLIC_BASE_URL, ...(skillId && { skillId }) });
// The Phase 7 LegacyStack (infra/lib/legacy-stack.ts) is intentionally not instantiated.
