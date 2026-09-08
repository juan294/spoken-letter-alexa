import { createMcpHandler, McpServer, type McpHttpHandler } from "@modelcontextprotocol/server";
import { log } from "@spoken-letter-alexa/shared";

import { subjectFromAuth } from "./auth.ts";
import { type ProviderResolver } from "./provider/types.ts";
import { registerTools } from "./tools/index.ts";
import { SuggestionMemory } from "./tools/suggest.ts";
import pkg from "../package.json" with { type: "json" };

export const SERVER_NAME = "spoken-letter";
export const SERVER_VERSION: string = pkg.version;

/**
 * The dual-era MCP handler. `legacy` is left at its default (`'stateless'`): Alexa+'s live
 * client opens with `initialize` at 2025-03-26 and must be answered. NEVER set
 * `legacy: 'reject'`. The factory runs once per request, so tools are registered fresh
 * each time while the suggestion memory lives for the process.
 */
export function createHandler(options: { providerFor: ProviderResolver; suggestions?: SuggestionMemory }): McpHttpHandler {
  const suggestions = options.suggestions ?? new SuggestionMemory();
  return createMcpHandler(
    () => {
      const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { capabilities: { tools: {} } });
      registerTools(server, { providerFor: options.providerFor, suggestions, subjectOf: subjectFromAuth });
      return server;
    },
    {
      onerror: (error) => {
        log.error("mcp_error", { message: error.message });
      },
    },
  );
}
