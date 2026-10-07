import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { log, type SkillLocale } from "@spoken-letter-alexa/shared";
import { Agent, AfterToolCallEvent, BeforeToolCallEvent, McpClient, type MessageData, type Model, type Usage } from "@strands-agents/sdk";

import { AGENT_MESSAGES } from "./messages.ts";
import { systemPromptFor } from "./persona.ts";
import { type Play, type ToolTrace, turnOutputSchema } from "./schema.ts";

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
  /** Phase 2 section 1: the session's cached catalog, composed into the system prompt after ALEXA_PERSONA. */
  catalog?: string | undefined;
  /**
   * Reuse a cached `McpClient` across turns (phase-2.md section 3) instead of a fresh one per
   * turn. Device sessions only: they share one service token by construction
   * (`cachedServiceToken` in routes.ts), so one mutable token box per `(mcpUrl, fetch)` is safe.
   * A linked session's `accessToken` is a real per-user OAuth token — caching it the same way
   * would let one user's in-flight tool call pick up a token overwritten by a different,
   * concurrently-turning user sharing the same `mcpUrl`/`fetch`, so linked (and demo) turns
   * always get an unshared, disconnected-after-use client.
   */
  reuseMcpClient?: boolean | undefined;
  /** The reply language: selects the system prompt's language line and the fallback reply. */
  locale?: SkillLocale | undefined;
};

/** Bedrock tokens for one turn, summed over its model calls. Cache fields are 0 when Bedrock reports none. */
export type TurnUsage = { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheWriteInputTokens: number };

export type TurnResult = {
  say: string;
  play: Play | null;
  needsAnswer?: boolean;
  toolCalls: ToolTrace[];
  history: MessageData[];
  usage: TurnUsage;
};

function turnUsage(usage: Usage): TurnUsage {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadInputTokens: usage.cacheReadInputTokens ?? 0,
    cacheWriteInputTokens: usage.cacheWriteInputTokens ?? 0,
  };
}

type CachedMcpClient = { client: McpClient; token: { current: string } };

/**
 * One connected `McpClient` per `(mcpUrl, fetch)` for the caller's lifetime (Phase 2 section
 * 3): containers recycle every 10-30 minutes, so reopening the handshake every turn is
 * avoidable work. Keyed by the `fetch` implementation's identity, not just `mcpUrl`, so a
 * caller that passes a fresh `fetch` per call (every test harness does) gets a fresh client
 * rather than one bound to a previous, now-defunct server.
 *
 * `StreamableHTTPClientTransport`'s `requestInit` is a static object fixed at construction,
 * so it cannot carry a token that changes between calls — this wraps `fetch` instead, reading
 * the token from a box updated on every call.
 */
const mcpClientsByFetch = new WeakMap<object, Map<string, CachedMcpClient>>();

/** Exported so a caller outside a turn (the session-open catalog fetch, phase-2.md section 1) shares the same cache. */
export function mcpClientFor(mcpUrl: string, accessToken: string, fetchImpl: typeof fetch | undefined): McpClient {
  const base = fetchImpl ?? fetch;
  let byUrl = mcpClientsByFetch.get(base);
  if (!byUrl) {
    byUrl = new Map();
    mcpClientsByFetch.set(base, byUrl);
  }
  const cached = byUrl.get(mcpUrl);
  if (cached) {
    cached.token.current = accessToken;
    return cached.client;
  }
  const token = { current: accessToken };
  const authenticatedFetch: typeof fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("authorization", `Bearer ${token.current}`);
    return base(input, { ...init, headers });
  };
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), { fetch: authenticatedFetch });
  const client = new McpClient({ transport });
  byUrl.set(mcpUrl, { client, token });
  return client;
}

/** A single-use client with the token fixed at construction — demo and linked turns (see `TurnOptions.reuseMcpClient`). */
function freshMcpClient(mcpUrl: string, accessToken: string, fetchImpl: typeof fetch | undefined): McpClient {
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
    requestInit: { headers: { authorization: `Bearer ${accessToken}` } },
    ...(fetchImpl && { fetch: fetchImpl }),
  });
  return new McpClient({ transport });
}

/**
 * One conversational turn: a fresh Strands agent over the session's history, an MCP client
 * carrying the session's bearer token (cached and reused for device turns, fresh and
 * disconnected afterward for everything else — see `TurnOptions.reuseMcpClient`), structured
 * output validated with zod, and a trace of every tool call for the simulator's "Under the
 * hood" drawer.
 */
export async function runTurn(options: TurnOptions, text: string): Promise<TurnResult> {
  const toolCalls: ToolTrace[] = [];
  const fallbackSay = AGENT_MESSAGES[options.locale ?? "en-US"].fallbackSay;
  const started = new Map<string, number>();
  const reuse = options.reuseMcpClient === true;
  const mcp = reuse ? mcpClientFor(options.mcpUrl, options.accessToken, options.fetch) : freshMcpClient(options.mcpUrl, options.accessToken, options.fetch);
  const agent = new Agent({
    model: options.model,
    tools: [mcp],
    systemPrompt: options.systemPrompt ?? systemPromptFor(options.catalog, options.locale ?? "en-US"),
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

  // A fresh agent per turn, so its accumulated usage is this turn's, failed turns included.
  try {
    const result = await agent.invoke(text);
    const parsed = turnOutputSchema.safeParse(result.structuredOutput);
    const history = JSON.parse(JSON.stringify(agent.messages)) as MessageData[];
    const usage = turnUsage(agent.metrics.accumulatedUsage);
    if (!parsed.success) {
      log.warn("agent_output_invalid", { issues: parsed.error.issues.length });
      return { say: fallbackSay, play: null, toolCalls, history, usage };
    }
    return { say: parsed.data.say, play: parsed.data.play, needsAnswer: parsed.data.needsAnswer ?? false, toolCalls, history, usage };
  } catch (error) {
    log.warn("agent_turn_failed", { message: error instanceof Error ? error.message : String(error), toolCalls: toolCalls.length });
    return { say: fallbackSay, play: null, toolCalls, history: options.history ?? [], usage: turnUsage(agent.metrics.accumulatedUsage) };
  } finally {
    if (!reuse) await mcp.disconnect().catch(() => undefined);
  }
}
