import { type McpServer, OAuthError } from "@modelcontextprotocol/server";
import { log } from "@spoken-letter-alexa/shared";

import { withLatencyMetric } from "../metrics.ts";
import { ProviderUnavailableError, type ProviderResolver } from "../provider/types.ts";
import { GET_TOOL, runGetFamilyStory } from "./get.ts";
import { LIST_TOOL, runListFamilyStories } from "./list.ts";
import { ToolFailure, type ToolErrorCode } from "./schemas.ts";
import { runSuggestNextStory, SUGGEST_TOOL, type SuggestionMemory } from "./suggest.ts";

export const TOOL_METADATA = [LIST_TOOL, GET_TOOL, SUGGEST_TOOL] as const;

export type ToolDeps = {
  providerFor: ProviderResolver;
  suggestions: SuggestionMemory;
  /** Resolves the subject for the current call; Phase 1 reads the stub bearer, Phase 2 the JWT `sub`. */
  subjectOf: (ctx: { http?: { authInfo?: { extra?: Record<string, unknown> } | undefined } | undefined }) => string;
};

type TextBlock = { type: "text"; text: string };

const ERROR_TEXT: Record<ToolErrorCode, string> = {
  unauthenticated: "This Alexa link is no longer valid. Reconnect Spoken Letter in the Alexa app.",
  provider_unavailable: "Spoken Letter is not reachable right now. Try again in a moment.",
  story_not_found: "I couldn't find that story. Ask for the list of delivered stories first.",
  audio_unavailable: "That story's recording is not available right now. Try another story.",
};

function toolError(code: ToolErrorCode, message = ERROR_TEXT[code]) {
  return {
    isError: true as const,
    content: [{ type: "text", text: message } satisfies TextBlock],
    structuredContent: { error: code, message },
  };
}

/**
 * Maps a thrown error to a tool error result. Unknown errors are logged with their
 * message and answered with the generic `provider_unavailable` text: the SDK would
 * otherwise echo the raw message to the client, and Alexa would speak it.
 */
function failureResult(toolName: string, error: unknown) {
  if (error instanceof ToolFailure) return toolError(error.code, error.message);
  if (error instanceof OAuthError) return toolError("unauthenticated");
  if (error instanceof ProviderUnavailableError) {
    log.warn("provider_unavailable", { tool: toolName, message: error.message });
    return toolError("provider_unavailable");
  }
  log.error("tool_failed", { tool: toolName, message: error instanceof Error ? error.message : String(error) });
  return toolError("provider_unavailable");
}

export function registerTools(server: McpServer, deps: ToolDeps): void {
  const { name: listName, ...listConfig } = LIST_TOOL;
  server.registerTool(listName, listConfig, async (args, ctx) => {
    try {
      const subject = deps.subjectOf(ctx);
      const result = await withLatencyMetric(listName, () =>
        runListFamilyStories(args, subject, deps.providerFor(subject)),
      );
      return { content: [{ type: "text", text: result.summary }], structuredContent: result.structured };
    } catch (error) {
      return failureResult(listName, error);
    }
  });

  const { name: getName, ...getConfig } = GET_TOOL;
  server.registerTool(getName, getConfig, async (args, ctx) => {
    try {
      const subject = deps.subjectOf(ctx);
      const result = await withLatencyMetric(getName, () =>
        runGetFamilyStory(args, subject, deps.providerFor(subject)),
      );
      return {
        content: [{ type: "text", text: result.summary }, result.resourceLink],
        structuredContent: result.structured,
      };
    } catch (error) {
      return failureResult(getName, error);
    }
  });

  const { name: suggestName, ...suggestConfig } = SUGGEST_TOOL;
  server.registerTool(suggestName, suggestConfig, async (args, ctx) => {
    try {
      const subject = deps.subjectOf(ctx);
      const result = await withLatencyMetric(suggestName, () =>
        runSuggestNextStory(args, subject, deps.providerFor(subject), deps.suggestions),
      );
      return { content: [{ type: "text", text: result.summary }], structuredContent: result.structured };
    } catch (error) {
      return failureResult(suggestName, error);
    }
  });
}
