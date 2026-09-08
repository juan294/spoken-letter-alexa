import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { log } from "@spoken-letter-alexa/shared";
import { Agent, AfterToolCallEvent, BeforeToolCallEvent, McpClient, type MessageData, type Model } from "@strands-agents/sdk";

import { ALEXA_PERSONA } from "./persona.ts";
import { FALLBACK_SAY, type Play, type ToolTrace, turnOutputSchema } from "./schema.ts";

/** The MCP TypeScript SDK 1.x client speaks the 2025-era protocol (legacy `initialize`). */
export const CLIENT_ERA = "legacy";

export type TurnOptions = {
  model: Model;
  /** `/mcp` on the same host locally; the AgentCore Gateway endpoint in AWS (Phase 6). */
  mcpUrl: string;
  accessToken: string;
  fetch?: typeof fetch | undefined;
  history?: MessageData[] | undefined;
  systemPrompt?: string | undefined;
};

export type TurnResult = {
  say: string;
  play: Play | null;
  toolCalls: ToolTrace[];
  history: MessageData[];
};

/**
 * One conversational turn: a fresh Strands agent over the session's history, an MCP
 * client with the session's bearer token, structured output validated with zod, and a
 * trace of every tool call for the simulator's "Under the hood" drawer.
 */
export async function runTurn(options: TurnOptions, text: string): Promise<TurnResult> {
  const toolCalls: ToolTrace[] = [];
  const started = new Map<string, number>();
  const transport = new StreamableHTTPClientTransport(new URL(options.mcpUrl), {
    requestInit: { headers: { authorization: `Bearer ${options.accessToken}` } },
    ...(options.fetch && { fetch: options.fetch }),
  });
  const mcp = new McpClient({ transport });
  const agent = new Agent({
    model: options.model,
    tools: [mcp],
    systemPrompt: options.systemPrompt ?? ALEXA_PERSONA,
    structuredOutputSchema: turnOutputSchema,
    messages: options.history ?? [],
    printer: false,
  });
  agent.addHook(BeforeToolCallEvent, (event) => {
    started.set(event.toolUse.toolUseId, performance.now());
  });
  agent.addHook(AfterToolCallEvent, (event) => {
    // The structured-output validator is a local tool, not an MCP call; it stays off the trace.
    if (event.toolUse.name === "strands_structured_output") return;
    const begun = started.get(event.toolUse.toolUseId);
    toolCalls.push({
      name: event.toolUse.name,
      ms: begun === undefined ? 0 : Math.round((performance.now() - begun) * 10) / 10,
      era: CLIENT_ERA,
      ok: event.result.status === "success" && !event.error,
    });
  });

  try {
    const result = await agent.invoke(text);
    const parsed = turnOutputSchema.safeParse(result.structuredOutput);
    const history = JSON.parse(JSON.stringify(agent.messages)) as MessageData[];
    if (!parsed.success) {
      log.warn("agent_output_invalid", { issues: parsed.error.issues.length });
      return { say: FALLBACK_SAY, play: null, toolCalls, history };
    }
    return { say: parsed.data.say, play: parsed.data.play, toolCalls, history };
  } catch (error) {
    log.warn("agent_turn_failed", { message: error instanceof Error ? error.message : String(error), toolCalls: toolCalls.length });
    return { say: FALLBACK_SAY, play: null, toolCalls, history: options.history ?? [] };
  } finally {
    await mcp.disconnect().catch(() => undefined);
  }
}
