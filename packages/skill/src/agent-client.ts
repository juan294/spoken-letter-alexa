import { type Play } from "./audio.ts";

export type ToolTrace = { name: string; ms: number; era: string; ok: boolean };

export type AgentReply = { say: string; play: Play | null; needsAnswer?: boolean; toolCalls: ToolTrace[] };

export type PlaylistCommand = {
  deviceUserId: string;
  command: "start" | "title" | "next" | "previous" | "restart" | "resume" | "reset" | "nearlyFinished" | "finished";
  order?: "shuffle" | "newest";
  storyteller?: string;
  title?: string;
  observedToken?: string;
  eventId?: string;
  offsetInMilliseconds?: number;
};

export type PlaylistReply = {
  say: string | null;
  action: "play" | "none";
  play?: Play;
  token?: string;
  playBehavior?: "REPLACE_ALL" | "ENQUEUE";
  expectedPreviousToken?: string;
  offsetInMilliseconds?: number;
  fallbackToSuggestion?: boolean;
};

export type DraftReceipt = { status: "saved"; draftId: string; theme: string; outline: string };
export type LatestDraft = DraftReceipt | { status: "none" };
export type DemoNext = {
  pendingReaction?: { storyId: string; title: string; storyteller: string };
  event?: { eventId: string; type: string; detail: string; occurredAt: string; storyId?: string };
};
export type DemoReaction = { status: "saved" | "dismissed" };
export type DemoWish = { status: "saved"; wishId: string; topic: string; storyteller?: string };
export type DemoEvent = { status: "read" | "dismissed" };
export type DemoInbox = { events: { eventId: string; type: string; detail: string; occurredAt: string; storyId?: string }[] };

export type AgentClient = {
  /** One line of text for the device user; the agent keeps the conversation per user. */
  turn: (input: { deviceUserId: string; text: string }) => Promise<AgentReply>;
  playlist?: (input: PlaylistCommand) => Promise<PlaylistReply>;
  saveDraft?: (input: { deviceUserId: string; requestId: string; theme: string }) => Promise<DraftReceipt>;
  latestDraft?: (input: { deviceUserId: string }) => Promise<LatestDraft>;
  demoNext?: (input: { deviceUserId: string }) => Promise<DemoNext>;
  demoReact?: (input: { deviceUserId: string; requestId: string; choice: "like" | "love" | "dismiss" }) => Promise<DemoReaction>;
  demoWish?: (input: { deviceUserId: string; requestId: string; topic: string; storyteller?: string; confirmed: true }) => Promise<DemoWish>;
  demoEvent?: (input: { deviceUserId: string; eventId: string; action: "read" | "dismiss" }) => Promise<DemoEvent>;
  demoInbox?: (input: { deviceUserId: string }) => Promise<DemoInbox>;
  demoPlaybackFinished?: (input: { deviceUserId: string; observedToken: string; eventId: string }) => Promise<{ status: "recorded" | "duplicate" | "ignored" }>;
};

export type AgentClientOptions = {
  /** `https://alexa.spokenletter.com`; the client calls `/agent/session` and `/agent/turn`. */
  baseUrl: string;
  fetch?: typeof fetch;
  /** Whole-turn budget (session plus turn); Alexa waits about 8 s, the Lambda gives 7. */
  timeoutMs: number;
  skillSecret?: string;
};

type SessionBody = { sessionId: string };
type TurnBody = { say: string; play: Play | null; needsAnswer?: boolean; toolCalls: ToolTrace[] };
type ErrorBody = { error?: string; message?: string };

export class AgentHttpError extends Error {
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

  async function post<T>(path: string, body: unknown, signal: AbortSignal, headers: Record<string, string> = {}): Promise<T> {
    const response = await fetchImpl(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", ...headers },
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

  const skillSecret = options.skillSecret;
  async function skillPost<T>(path: string, body: unknown): Promise<T> {
    if (!skillSecret) throw new AgentHttpError(503, "skill_secret_missing", "The skill action is unavailable");
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); }, options.timeoutMs);
    try {
      return await post<T>(path, body, controller.signal, { "x-alexa-skill-secret": skillSecret });
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    ...(skillSecret && {
      demoNext: (input: { deviceUserId: string }): Promise<DemoNext> => skillPost("/agent/demo/next", input),
      demoReact: (input: { deviceUserId: string; requestId: string; choice: "like" | "love" | "dismiss" }): Promise<DemoReaction> => skillPost("/agent/demo/reaction", input),
      demoWish: (input: { deviceUserId: string; requestId: string; topic: string; storyteller?: string; confirmed: true }): Promise<DemoWish> => skillPost("/agent/demo/wish", input),
      demoEvent: (input: { deviceUserId: string; eventId: string; action: "read" | "dismiss" }): Promise<DemoEvent> => skillPost("/agent/demo/event", input),
      demoInbox: (input: { deviceUserId: string }): Promise<DemoInbox> => skillPost("/agent/demo/inbox", input),
      demoPlaybackFinished: (input: { deviceUserId: string; observedToken: string; eventId: string }): Promise<{ status: "recorded" | "duplicate" | "ignored" }> => skillPost("/agent/demo/playback-finished", input),
      async saveDraft(input: { deviceUserId: string; requestId: string; theme: string }): Promise<DraftReceipt> {
        const reply: unknown = await skillPost("/agent/demo/draft", input);
        if (!reply || typeof reply !== "object" || !("status" in reply) || reply.status !== "saved" || !("draftId" in reply) || typeof reply.draftId !== "string" || !("outline" in reply) || typeof reply.outline !== "string" || !("theme" in reply) || typeof reply.theme !== "string") {
          throw new AgentHttpError(200, "malformed", "agent draft reply is incomplete");
        }
        return reply as DraftReceipt;
      },
      async latestDraft(input: { deviceUserId: string }): Promise<LatestDraft> {
        const reply: unknown = await skillPost("/agent/demo/draft/latest", input);
        if (!reply || typeof reply !== "object" || !("status" in reply) || (reply.status !== "none" && reply.status !== "saved")) {
          throw new AgentHttpError(200, "malformed", "agent draft reply is incomplete");
        }
        if (reply.status === "saved" && (!("draftId" in reply) || typeof reply.draftId !== "string" || !("outline" in reply) || typeof reply.outline !== "string" || !("theme" in reply) || typeof reply.theme !== "string")) {
          throw new AgentHttpError(200, "malformed", "agent draft reply is incomplete");
        }
        return reply as LatestDraft;
      },
      async playlist(input: PlaylistCommand): Promise<PlaylistReply> {
        const reply = await skillPost<PlaylistReply>("/agent/playlist", input);
        if (reply.action === "play" && (!reply.play || !reply.token)) {
          throw new AgentHttpError(200, "malformed", "agent playlist reply is incomplete");
        }
        return reply;
      },
    }),
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
        return { say: reply.say, play: reply.play ?? null, ...(reply.needsAnswer === true && { needsAnswer: true }), toolCalls: reply.toolCalls };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
