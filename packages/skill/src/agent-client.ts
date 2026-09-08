import { type Play } from "./audio.ts";

export type ToolTrace = { name: string; ms: number; era: string; ok: boolean };

export type AgentReply = { say: string; play: Play | null; toolCalls: ToolTrace[] };

export type AgentClient = {
  /** One line of text for the device user; the agent keeps the conversation per user. */
  turn: (input: { deviceUserId: string; text: string }) => Promise<AgentReply>;
};

export type AgentClientOptions = {
  /** `https://alexa.spokenletter.com`; the client calls `/agent/session` and `/agent/turn`. */
  baseUrl: string;
  fetch?: typeof fetch;
  /** Whole-turn budget (session plus turn); Alexa waits about 8 s, the Lambda gives 6. */
  timeoutMs: number;
};

type SessionBody = { sessionId: string };
type TurnBody = { say: string; play: Play | null; toolCalls: ToolTrace[] };
type ErrorBody = { error?: string; message?: string };

class AgentHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * The agent is the only thing the skill talks to. Sessions are opened with
 * `{ mode: "device", deviceUserId }` and remembered per user for the life of the Lambda
 * container; a `session_not_found` (expired on the server) reopens once.
 */
export function createAgentClient(options: AgentClientOptions): AgentClient {
  const base = options.baseUrl.replace(/\/$/, "");
  const fetchImpl = options.fetch ?? fetch;
  const sessions = new Map<string, string>();

  async function post<T>(path: string, body: unknown, signal: AbortSignal): Promise<T> {
    const response = await fetchImpl(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new AgentHttpError(response.status, "malformed", `agent answered ${response.status} with a non-JSON body`);
    }
    if (!response.ok) {
      const error = parsed as ErrorBody;
      throw new AgentHttpError(response.status, error.error ?? "http_error", error.message ?? `agent answered ${response.status}`);
    }
    return parsed as T;
  }

  async function sessionFor(deviceUserId: string, signal: AbortSignal, fresh = false): Promise<string> {
    const known = sessions.get(deviceUserId);
    if (known !== undefined && !fresh) return known;
    const session = await post<SessionBody>("/agent/session", { mode: "device", deviceUserId }, signal);
    if (typeof session.sessionId !== "string") throw new AgentHttpError(200, "malformed", "agent session reply has no sessionId");
    sessions.set(deviceUserId, session.sessionId);
    return session.sessionId;
  }

  return {
    async turn({ deviceUserId, text }) {
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, options.timeoutMs);
      try {
        let sessionId = await sessionFor(deviceUserId, controller.signal);
        let reply: TurnBody;
        try {
          reply = await post<TurnBody>("/agent/turn", { sessionId, text }, controller.signal);
        } catch (error) {
          if (!(error instanceof AgentHttpError && error.status === 404 && error.code === "session_not_found")) throw error;
          sessionId = await sessionFor(deviceUserId, controller.signal, true);
          reply = await post<TurnBody>("/agent/turn", { sessionId, text }, controller.signal);
        }
        if (typeof reply.say !== "string" || !Array.isArray(reply.toolCalls)) throw new AgentHttpError(200, "malformed", "agent turn reply is not a turn");
        return { say: reply.say, play: reply.play ?? null, toolCalls: reply.toolCalls };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
