import { createMcpHandler, McpServer, type McpHttpHandler, type McpServerFactory } from "@modelcontextprotocol/server";
import { log } from "@spoken-letter-alexa/shared";

import { subjectFromAuth } from "./auth.ts";
import { type ProviderResolver } from "./provider/types.ts";
import { registerTools } from "./tools/index.ts";
import { SuggestionMemory } from "./tools/suggest.ts";
import pkg from "../package.json" with { type: "json" };

export const SERVER_NAME = "spoken-letter";
export const SERVER_VERSION: string = pkg.version;

export type ServerFactoryOptions = { providerFor: ProviderResolver; suggestions?: SuggestionMemory | undefined };

/**
 * One `McpServer` per serving unit (per request under `createMcpHandler`, per session
 * under the legacy-sessions contingency). Tools are registered fresh each time while the
 * suggestion memory lives for the process.
 */
export function createServerFactory(options: ServerFactoryOptions): McpServerFactory {
  const suggestions = options.suggestions ?? new SuggestionMemory();
  return () => {
    const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { capabilities: { tools: {} } });
    registerTools(server, { providerFor: options.providerFor, suggestions, subjectOf: subjectFromAuth });
    return server;
  };
}

export function reportMcpError(error: Error): void {
  log.error("mcp_error", { message: error.message });
}

/**
 * The dual-era MCP handler. `legacy` is left at its default (`'stateless'`): Alexa+'s live
 * client opens with `initialize` at 2025-03-26 and must be answered. NEVER set
 * `legacy: 'reject'` here (only `legacy-sessions.ts` does, behind its own routing).
 */
export function createHandler(options: ServerFactoryOptions): McpHttpHandler {
  return createMcpHandler(createServerFactory(options), { onerror: reportMcpError });
}
