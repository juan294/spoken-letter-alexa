import { createHttpTransport } from "./http.ts";
import { createMockTransport } from "./mock.ts";
import type { AgentTransport } from "./types.ts";

export const AGENT_MOCK_ENABLED = import.meta.env.VITE_AGENT_MOCK === "1";

/** The real agent behind `/agent/*`, or the in-app mock when `VITE_AGENT_MOCK=1`. */
export function createTransport(): AgentTransport {
  return AGENT_MOCK_ENABLED ? createMockTransport() : createHttpTransport();
}

export type { AgentTransport, Play, SessionResponse, ToolCall, TurnResponse } from "./types.ts";
export { AgentError } from "./types.ts";
