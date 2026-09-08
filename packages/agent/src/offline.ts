// `pnpm dev:offline`: the whole loop without AWS. The scripted model drives the real MCP
// tools, replies are shown as text (no Polly) and the microphone yields a canned phrase.
import { type AgentDeps } from "./routes.ts";
import { ScriptedModel } from "./scripted-model.ts";
import { MemorySessionStore } from "./sessions.ts";

export const OFFLINE_UTTERANCE = "Alexa, play the story Grandpa sent";

export function createOfflineDeps(options: {
  mcpUrl: string;
  mcpFetch?: typeof fetch | undefined;
  demoToken: () => Promise<string>;
}): AgentDeps {
  return {
    model: new ScriptedModel(),
    modelId: null,
    mcpUrl: options.mcpUrl,
    mcpFetch: options.mcpFetch,
    sessions: new MemorySessionStore(),
    speech: { synthesize: () => Promise.resolve(null) },
    transcribe: () => Promise.resolve(OFFLINE_UTTERANCE),
    demoToken: options.demoToken,
    offline: true,
  };
}
