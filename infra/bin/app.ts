import { App } from "aws-cdk-lib";

import { CoreStack } from "../lib/core-stack.ts";

const env = { account: "106403001709", region: "us-east-1" };

const app = new App();
new CoreStack(app, "SpokenLetterAlexaCore", { env });
// Phase 6 adds ApiStack, SimulatorStack, EdgeStack, GatewayStack, ObservabilityStack.
