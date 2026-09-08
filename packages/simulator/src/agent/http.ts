import type { z } from "zod";
import {
  AgentError,
  errorResponseSchema,
  healthResponseSchema,
  sessionResponseSchema,
  transcribeResponseSchema,
  turnResponseSchema,
  type AgentTransport,
  type SessionRequest,
} from "./types.ts";

export type HttpTransportOptions = {
  /** Same-origin by default; tests and the dev proxy pass an explicit origin. */
  origin?: string;
  fetchImpl?: typeof fetch;
};

async function parse<T extends z.ZodType>(response: Response, schema: T, route: string): Promise<z.infer<T>> {
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new AgentError("bad_response", `${route} returned no JSON (${response.status})`, response.status);
  }
  if (!response.ok) {
    const failure = errorResponseSchema.safeParse(json);
    if (failure.success) throw new AgentError(failure.data.error, failure.data.message, response.status);
    throw new AgentError("http_error", `${route} failed with ${response.status}`, response.status);
  }
  const result = schema.safeParse(json);
  if (!result.success) {
    throw new AgentError("bad_response", `${route} response does not match the agent contract`, response.status);
  }
  return result.data;
}

export function createHttpTransport(options: HttpTransportOptions = {}): AgentTransport {
  const origin = options.origin ?? "";
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const postJson = (route: string, body: unknown) =>
    fetchImpl(`${origin}${route}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  return {
    async createSession(request: SessionRequest) {
      return parse(await postJson("/agent/session", request), sessionResponseSchema, "/agent/session");
    },
    async turn(sessionId, text) {
      return parse(await postJson("/agent/turn", { sessionId, text }), turnResponseSchema, "/agent/turn");
    },
    async transcribe(audio) {
      const response = await fetchImpl(`${origin}/agent/transcribe`, {
        method: "POST",
        headers: { "content-type": audio.type || "audio/webm;codecs=opus" },
        body: audio,
      });
      return parse(response, transcribeResponseSchema, "/agent/transcribe");
    },
    async health() {
      return parse(await fetchImpl(`${origin}/agent/health`), healthResponseSchema, "/agent/health");
    },
  };
}
