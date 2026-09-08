// The packages/agent HTTP contract, validated with zod so the UI never trusts a shape.
import { z } from "zod";

export const sessionResponseSchema = z.object({
  sessionId: z.string(),
  mode: z.enum(["demo", "linked"]),
  subject: z.string(),
  offline: z.boolean(),
});

export const toolCallSchema = z.object({
  name: z.string(),
  ms: z.number(),
  era: z.string(),
  ok: z.boolean(),
});

export const playSchema = z.object({
  url: z.string(),
  title: z.string(),
  storyteller: z.string(),
  durationSeconds: z.number().nullable(),
});

export const turnResponseSchema = z.object({
  say: z.string(),
  play: playSchema.nullable(),
  speechUrl: z.string().nullable(),
  toolCalls: z.array(toolCallSchema),
});

export const transcribeResponseSchema = z.object({ text: z.string() });

export const healthResponseSchema = z.object({
  ok: z.boolean(),
  offline: z.boolean(),
  model: z.string().nullable(),
});

export const errorResponseSchema = z.object({ error: z.string(), message: z.string() });

export type SessionResponse = z.infer<typeof sessionResponseSchema>;
export type ToolCall = z.infer<typeof toolCallSchema>;
export type Play = z.infer<typeof playSchema>;
export type TurnResponse = z.infer<typeof turnResponseSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export type SessionRequest = { mode: "demo" } | { mode: "linked"; accessToken: string };

/** What the UI needs from the agent; the HTTP and mock transports both implement it. */
export type AgentTransport = {
  createSession(request: SessionRequest): Promise<SessionResponse>;
  turn(sessionId: string, text: string): Promise<TurnResponse>;
  transcribe(audio: Blob): Promise<{ text: string }>;
  health(): Promise<HealthResponse>;
};

export class AgentError extends Error {
  override readonly name = "AgentError";
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
