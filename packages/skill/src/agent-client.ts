import { type CreationRecord, creationRecordSchema, type SkillLocale } from "@spoken-letter-alexa/shared";
import { z } from "zod";

import { type Play } from "./audio.ts";

export type ToolTrace = { name: string; ms: number; era: string; ok: boolean };

export type AgentReply = { say: string; play: Play | null; needsAnswer?: boolean; toolCalls: ToolTrace[] };

/** Sent only for a non-default locale (plan D6); the agent treats an omitted locale as en-US. */
type WithLocale = { locale?: SkillLocale };

export type PlaylistCommand = WithLocale & {
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
export type DemoReaction = { status: "saved"; reactionId: string; storyId: string; choice: "like" | "love" } | { status: "dismissed" };
export type DemoWish = { status: "saved"; wishId: string; topic: string; storyteller?: string };
export type DemoEvent = { status: "read" | "dismissed" };
export type DemoInbox = { events: { eventId: string; type: string; detail: string; occurredAt: string; storyId?: string }[] };

/** The cross-session copy of the device's creation record (staged demo plan D5, revised). */
export type CreationCurrent = { status: "none" } | { status: "found"; record: CreationRecord; updatedAt: number };
const CREATE_CURRENT_BUDGET_MS = 2_000;
const creationCurrentSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("none") }),
  z.object({ status: z.literal("found"), record: creationRecordSchema, updatedAt: z.number() }),
]);

export type AgentClient = {
  /** One line of text for the device user; the agent keeps the conversation per user. */
  turn: (input: { deviceUserId: string; text: string } & WithLocale) => Promise<AgentReply>;
  playlist?: (input: PlaylistCommand) => Promise<PlaylistReply>;
  saveDraft?: (input: { deviceUserId: string; requestId: string; theme: string } & WithLocale) => Promise<DraftReceipt>;
  latestDraft?: (input: { deviceUserId: string }) => Promise<LatestDraft>;
  demoNext?: (input: { deviceUserId: string } & WithLocale) => Promise<DemoNext>;
  demoReact?: (input: { deviceUserId: string; requestId: string; choice: "like" | "love" | "dismiss" }) => Promise<DemoReaction>;
  demoWish?: (input: { deviceUserId: string; requestId: string; topic: string; storyteller?: string; confirmed: true } & WithLocale) => Promise<DemoWish>;
  demoEvent?: (input: { deviceUserId: string; eventId: string; action: "read" | "dismiss" }) => Promise<DemoEvent>;
  demoInbox?: (input: { deviceUserId: string } & WithLocale) => Promise<DemoInbox>;
  demoPlaybackFinished?: (input: { deviceUserId: string; observedToken: string; eventId: string }) => Promise<{ status: "recorded" | "duplicate" | "ignored" }>;
  createCurrent?: (input: { deviceUserId: string }) => Promise<CreationCurrent>;
  createSave?: (input: { deviceUserId: string; record: CreationRecord }) => Promise<{ status: "saved" }>;
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
 * `{ mode: "device", deviceUserId }` (plus `locale` when not en-US) and remembered per user for
 * the life of the Lambda container; a `session_not_found` (expired on the server) reopens once,
 * and a turn in a different locale reopens so the server stores the new one (plan SS6).
 */
export function createAgentClient(options: AgentClientOptions): AgentClient {
  const base = options.baseUrl.replace(/\/$/, "");
  const fetchImpl = options.fetch ?? fetch;
  const sessions = new Map<string, { sessionId: string; locale: SkillLocale | undefined }>();

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

  async function sessionFor(deviceUserId: string, locale: SkillLocale | undefined, signal: AbortSignal, fresh = false): Promise<string> {
    const known = sessions.get(deviceUserId);
    if (known !== undefined && known.locale === locale && !fresh) return known.sessionId;
    const session = await post<SessionBody>("/agent/session", { mode: "device", deviceUserId, ...(locale && { locale }) }, signal);
    if (typeof session.sessionId !== "string") throw new AgentHttpError(200, "malformed", "agent session reply has no sessionId");
    sessions.set(deviceUserId, { sessionId: session.sessionId, locale });
    return session.sessionId;
  }

  const skillSecret = options.skillSecret;
  async function skillPost<T>(path: string, body: unknown, timeoutMs = options.timeoutMs): Promise<T> {
    if (!skillSecret) throw new AgentHttpError(503, "skill_secret_missing", "The skill action is unavailable");
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); }, timeoutMs);
    try {
      return await post<T>(path, body, controller.signal, { "x-alexa-skill-secret": skillSecret });
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    ...(skillSecret && {
      demoNext: (input: { deviceUserId: string } & WithLocale): Promise<DemoNext> => skillPost("/agent/demo/next", input),
      async demoReact(input: { deviceUserId: string; requestId: string; choice: "like" | "love" | "dismiss" }): Promise<DemoReaction> {
        const reply: unknown = await skillPost("/agent/demo/reaction", input);
        if (!reply || typeof reply !== "object" || !("status" in reply) || (reply.status !== "saved" && reply.status !== "dismissed")) {
          throw new AgentHttpError(200, "malformed", "agent reaction reply is incomplete");
        }
        if (reply.status === "saved" && (!("reactionId" in reply) || typeof reply.reactionId !== "string" || !reply.reactionId || !("storyId" in reply) || typeof reply.storyId !== "string" || !reply.storyId || !("choice" in reply) || reply.choice !== input.choice)) {
          throw new AgentHttpError(200, "malformed", "agent reaction reply is incomplete");
        }
        return reply as DemoReaction;
      },
      async demoWish(input: { deviceUserId: string; requestId: string; topic: string; storyteller?: string; confirmed: true } & WithLocale): Promise<DemoWish> {
        const reply: unknown = await skillPost("/agent/demo/wish", input);
        if (!reply || typeof reply !== "object" || !("status" in reply) || reply.status !== "saved" || !("wishId" in reply) || typeof reply.wishId !== "string" || !("topic" in reply) || typeof reply.topic !== "string") {
          throw new AgentHttpError(200, "malformed", "agent wish reply is incomplete");
        }
        return reply as DemoWish;
      },
      demoEvent: (input: { deviceUserId: string; eventId: string; action: "read" | "dismiss" }): Promise<DemoEvent> => skillPost("/agent/demo/event", input),
      demoInbox: (input: { deviceUserId: string } & WithLocale): Promise<DemoInbox> => skillPost("/agent/demo/inbox", input),
      demoPlaybackFinished: (input: { deviceUserId: string; observedToken: string; eventId: string }): Promise<{ status: "recorded" | "duplicate" | "ignored" }> => skillPost("/agent/demo/playback-finished", input),
      async saveDraft(input: { deviceUserId: string; requestId: string; theme: string } & WithLocale): Promise<DraftReceipt> {
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
      async createCurrent(input: { deviceUserId: string }): Promise<CreationCurrent> {
        // Launch makes up to three agent calls inside Alexa's 8 seconds; a resume check must not use them all.
        const reply = creationCurrentSchema.safeParse(await skillPost("/agent/demo/create/current", input, Math.min(options.timeoutMs, CREATE_CURRENT_BUDGET_MS)));
        if (!reply.success) throw new AgentHttpError(200, "malformed", "agent creation reply is incomplete");
        return reply.data;
      },
      async createSave(input: { deviceUserId: string; record: CreationRecord }): Promise<{ status: "saved" }> {
        const reply: unknown = await skillPost("/agent/demo/create/save", input);
        if (!reply || typeof reply !== "object" || !("status" in reply) || reply.status !== "saved") throw new AgentHttpError(200, "malformed", "agent creation reply is incomplete");
        return { status: "saved" };
      },
      async playlist(input: PlaylistCommand): Promise<PlaylistReply> {
        const reply = await skillPost<PlaylistReply>("/agent/playlist", input);
        if (reply.action === "play" && (!reply.play || !reply.token)) {
          throw new AgentHttpError(200, "malformed", "agent playlist reply is incomplete");
        }
        return reply;
      },
    }),
    async turn({ deviceUserId, text, locale }) {
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, options.timeoutMs);
      try {
        let sessionId = await sessionFor(deviceUserId, locale, controller.signal);
        let reply: TurnBody;
        try {
          reply = await post<TurnBody>("/agent/turn", { sessionId, text }, controller.signal);
        } catch (error) {
          if (!(error instanceof AgentHttpError && error.status === 404 && error.code === "session_not_found")) throw error;
          sessionId = await sessionFor(deviceUserId, locale, controller.signal, true);
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
