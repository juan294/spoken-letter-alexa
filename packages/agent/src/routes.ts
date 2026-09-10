import { decodeJwtClaims, log } from "@spoken-letter-alexa/shared";
import { type MessageData, type Model } from "@strands-agents/sdk";
import { type Context, Hono } from "hono";
import { z } from "zod";

import { type SpeechSynthesizer } from "./polly.ts";
import { isCatalogStale, type SessionStore, deviceSessionId, newSession, SESSION_TTL_SECONDS } from "./sessions.ts";
import { type Transcriber } from "./transcribe.ts";
import { mcpClientFor, runTurn } from "./turn.ts";

export type AgentDeps = {
  model: Model;
  /** Reported by `/agent/health`; null when offline. */
  modelId: string | null;
  mcpUrl: string;
  mcpFetch?: typeof fetch | undefined;
  /**
   * The MCP endpoint for device (classic skill) sessions. The demo subject goes through
   * the AgentCore Gateway when `MCP_URL` names it; a gateway tool call costs seconds and
   * Alexa allows the skill eight, so device turns take the server's own `/mcp`.
   */
  deviceMcp?: { url: string; fetch?: typeof fetch | undefined } | undefined;
  sessions: SessionStore;
  speech: SpeechSynthesizer;
  transcribe: Transcriber;
  /** Mints the demo subject's client_credentials token (server-side; the secret never reaches the browser). */
  demoToken: () => Promise<string>;
  offline: boolean;
  now?: (() => number) | undefined;
};

const MAX_UTTERANCE_BYTES = 5 * 1024 * 1024;

const sessionBodySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("demo") }),
  z.object({ mode: z.literal("linked"), accessToken: z.string().min(16) }),
  z.object({ mode: z.literal("device"), deviceUserId: z.string().min(1).max(256) }),
]);
const turnBodySchema = z.object({ sessionId: z.string().min(1).max(128), text: z.string().trim().min(1).max(500) });

function jsonError(c: Context, status: 400 | 404 | 413 | 500, error: string, message: string) {
  return c.json({ error, message }, status);
}

/** Display-only subject from an access token (the MCP server verifies the token itself). */
function subjectOf(accessToken: string): string {
  const { sub } = decodeJwtClaims(accessToken);
  return typeof sub === "string" ? sub : "unknown";
}

/** Service tokens live 1 hour and sessions 2; a token without a readable `exp` counts as expiring. */
export const TOKEN_RENEWAL_WINDOW_SECONDS = 300;

/**
 * One service token per process, re-minted shortly before `exp`. Demo and device sessions
 * never rely on the token stored with them: a warm skill container keeps a device session
 * for hours, longer than any token (review F9-2).
 */
export function cachedServiceToken(mint: () => Promise<string>, now: () => number): () => Promise<string> {
  let token: string | undefined;
  let exp = 0;
  return async () => {
    if (token !== undefined && exp - now() > TOKEN_RENEWAL_WINDOW_SECONDS) return token;
    token = await mint();
    const claims = decodeJwtClaims(token);
    exp = typeof claims.exp === "number" ? claims.exp : 0;
    return token;
  };
}

const catalogStorySchema = z.object({ id: z.string(), title: z.string(), storyteller: z.string(), durationSeconds: z.number().optional() });
const catalogStoriesSchema = z.array(catalogStorySchema);
type CatalogStory = z.infer<typeof catalogStorySchema>;

function formatDuration(seconds: number | undefined): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return "unknown length";
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return minutes > 0 ? `${minutes}m${rest}s` : `${rest}s`;
}

/** One line per story: id, title, storyteller and duration (phase-2.md section 1). */
function formatCatalog(stories: CatalogStory[]): string {
  return stories.map((story) => `${story.id}: ${story.title} by ${story.storyteller}, ${formatDuration(story.durationSeconds)}`).join("\n");
}

/**
 * `list_family_stories` once, through the same in-process MCP endpoint (and cached client,
 * `mcpClientFor`) a device turn uses. Never throws: a failed fetch just means no catalog, and
 * the turn falls back to calling the tool itself (phase-2.md section 1).
 */
async function fetchCatalog(mcp: { url: string; fetch?: typeof fetch | undefined }, accessToken: string): Promise<string | undefined> {
  try {
    const client = mcpClientFor(mcp.url, accessToken, mcp.fetch);
    const listTool = (await client.listTools()).find((tool) => tool.name === "list_family_stories" || tool.name.endsWith("_list_family_stories"));
    if (!listTool) return undefined;
    const result = (await client.callTool(listTool, { limit: 20 })) as { structuredContent?: { stories?: unknown } } | undefined;
    const parsed = catalogStoriesSchema.safeParse(result?.structuredContent?.stories);
    if (!parsed.success || parsed.data.length === 0) return undefined;
    return formatCatalog(parsed.data);
  } catch (error) {
    log.warn("agent_catalog_fetch_failed", { message: error instanceof Error ? error.message : String(error) });
    return undefined;
  }
}

/** Sessions kept this many turns of history; longer evenings would otherwise grow the prompt forever. */
export const MAX_HISTORY_MESSAGES = 8;

function hasToolResult(message: MessageData): boolean {
  return message.content.some((block) => "toolResult" in block);
}

/**
 * The last `max` messages, never splitting a tool-use/tool-result pair: a user message that
 * opens with a tool result depends on the assistant's tool-use message just before it, so the
 * cutoff backs up past it rather than leaving a dangling `toolUse` the model would reject.
 */
export function trimHistory(history: MessageData[], max = MAX_HISTORY_MESSAGES): MessageData[] {
  if (history.length <= max) return history;
  let start = history.length - max;
  while (start > 0) {
    const boundary = history[start];
    if (!boundary || !hasToolResult(boundary)) break;
    start -= 1;
  }
  return history.slice(start);
}

export function createAgentApp(deps: AgentDeps): Hono {
  const app = new Hono();
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000));
  const serviceToken = cachedServiceToken(deps.demoToken, now);

  app.onError((error, c) => {
    log.error("agent_unhandled", { path: c.req.path, message: error.message });
    return c.json({ error: "server_error", message: "The agent hit an internal error" }, 500);
  });

  app.get("/agent/health", (c) => c.json({ ok: true, offline: deps.offline, model: deps.modelId }));

  app.post("/agent/session", async (c) => {
    const parsed = sessionBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return jsonError(c, 400, "invalid_request", "mode must be demo, device with a deviceUserId, or linked with an accessToken");
    const { mode } = parsed.data;
    const accessToken = parsed.data.mode === "linked" ? parsed.data.accessToken : await serviceToken();
    // A device (Echo user) keeps one conversation across invocations; other modes start fresh.
    const id = parsed.data.mode === "device" ? deviceSessionId(parsed.data.deviceUserId) : undefined;
    const existing = id === undefined ? null : await deps.sessions.get(id);
    let session = existing
      ? { ...existing, expiresAt: now() + SESSION_TTL_SECONDS }
      : newSession({ mode, subject: subjectOf(accessToken), accessToken, ...(id !== undefined && { id }) }, now);
    if (mode === "device" && deps.deviceMcp && isCatalogStale(session, now())) {
      const catalog = await fetchCatalog(deps.deviceMcp, accessToken);
      if (catalog !== undefined) session = { ...session, catalog, catalogFetchedAt: now() };
    }
    await deps.sessions.put(session);
    log.info("agent_session", { mode: session.mode, offline: deps.offline });
    return c.json({ sessionId: session.id, mode: session.mode, subject: session.subject, offline: deps.offline });
  });

  app.post("/agent/turn", async (c) => {
    const parsed = turnBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return jsonError(c, 400, "invalid_request", "sessionId and text are required");
    const session = await deps.sessions.get(parsed.data.sessionId);
    if (!session) return jsonError(c, 404, "session_not_found", "Start a new session");
    const accessToken = session.mode === "linked" ? session.accessToken : await serviceToken();
    const mcp = session.mode === "device" && deps.deviceMcp ? deps.deviceMcp : { url: deps.mcpUrl, fetch: deps.mcpFetch };
    const result = await runTurn(
      { model: deps.model, mcpUrl: mcp.url, accessToken, fetch: mcp.fetch, history: session.history, catalog: session.catalog, reuseMcpClient: session.mode === "device" },
      parsed.data.text,
    );
    // The skill speaks `say` with Alexa's own voice, so Polly runs for the simulator only.
    const [speechUrl] = await Promise.all([
      session.mode === "device" ? Promise.resolve(null) : deps.speech.synthesize(result.say),
      deps.sessions.put({ ...session, history: trimHistory(result.history) }),
    ]);
    log.info("agent_turn", { mode: session.mode, tools: result.toolCalls.map((call) => `${call.name}:${call.ms}ms`), played: Boolean(result.play) });
    return c.json({ say: result.say, play: result.play, speechUrl, toolCalls: result.toolCalls });
  });

  app.post("/agent/transcribe", async (c) => {
    const declared = Number(c.req.header("content-length") ?? "0");
    if (declared > MAX_UTTERANCE_BYTES) return jsonError(c, 413, "utterance_too_large", "Keep utterances under 15 seconds");
    const audio = new Uint8Array(await c.req.arrayBuffer());
    if (audio.byteLength > MAX_UTTERANCE_BYTES) return jsonError(c, 413, "utterance_too_large", "Keep utterances under 15 seconds");
    const text = await deps.transcribe(audio, c.req.header("content-type") ?? "audio/webm");
    return c.json({ text });
  });

  return app;
}
