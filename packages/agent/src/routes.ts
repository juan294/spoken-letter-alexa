import { createHash, timingSafeEqual } from "node:crypto";

import { decodeJwtClaims, log, sha256Hex } from "@spoken-letter-alexa/shared";
import { type MessageData, type Model } from "@strands-agents/sdk";
import { type Context, Hono } from "hono";
import { z } from "zod";

import { type SpeechSynthesizer } from "./polly.ts";
import { createModelDraftGenerator, DemoDraftController, DemoDraftError, type DemoDraftStore, type DraftGenerator } from "./demo-drafts.ts";
import { DemoUpdateController, DemoUpdateError, type DemoUpdateStore, type DemoStory, type FixtureEvent } from "./demo-updates.ts";
import { PlaylistController, type PlaylistCatalog, type PlaylistStore } from "./playlist.ts";
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
  playlist?: { store: PlaylistStore; secret: string } | undefined;
  drafts?: { store: DemoDraftStore; generator?: DraftGenerator | undefined } | undefined;
  updates?: { store: DemoUpdateStore; stories: DemoStory[]; seed: FixtureEvent[] } | undefined;
  now?: (() => number) | undefined;
};

const MAX_UTTERANCE_BYTES = 5 * 1024 * 1024;

const sessionBodySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("demo") }),
  z.object({ mode: z.literal("linked"), accessToken: z.string().min(16) }),
  z.object({ mode: z.literal("device"), deviceUserId: z.string().min(1).max(256) }),
]);
const turnBodySchema = z.object({ sessionId: z.string().min(1).max(128), text: z.string().trim().min(1).max(500) });
const draftBodySchema = z.object({ deviceUserId: z.string().min(1).max(256), requestId: z.string().min(1).max(256),
  theme: z.string().trim().min(1).max(160) });
const draftLatestBodySchema = z.object({ deviceUserId: z.string().min(1).max(256) });
const updateDeviceSchema = z.object({ deviceUserId: z.string().min(1).max(256) });
const legacyFinishedBodySchema = updateDeviceSchema.extend({ observedToken: z.string().min(1).max(4096), eventId: z.string().min(1).max(256) });
const reactionBodySchema = updateDeviceSchema.extend({ requestId: z.string().min(1).max(256), choice: z.enum(["like", "love", "dismiss"]) });
const wishBodySchema = updateDeviceSchema.extend({ requestId: z.string().min(1).max(256), topic: z.string().trim().min(1).max(160),
  storyteller: z.string().trim().min(1).max(80).optional(), confirmed: z.literal(true) });
const eventBodySchema = updateDeviceSchema.extend({ eventId: z.string().min(1).max(80), action: z.enum(["read", "dismiss"]) });
const playlistBodySchema = z.discriminatedUnion("command", [
  z.object({ deviceUserId: z.string().min(1).max(256), command: z.literal("start"), order: z.enum(["shuffle", "newest"]).optional(), storyteller: z.string().trim().min(1).max(80).optional() }),
  z.object({ deviceUserId: z.string().min(1).max(256), command: z.literal("title"), title: z.string().trim().min(1).max(200), storyteller: z.string().trim().min(1).max(80).optional() }),
  ...(["next", "previous", "restart", "reset"] as const).map((command) => z.object({ deviceUserId: z.string().min(1).max(256),
    command: z.literal(command), observedToken: z.string().min(1).max(2048).optional() })),
  z.object({ deviceUserId: z.string().min(1).max(256), command: z.literal("resume"), observedToken: z.string().min(1).max(2048),
    offsetInMilliseconds: z.number().int().min(0).max(24 * 60 * 60 * 1000) }),
  ...(["nearlyFinished", "finished"] as const).map((command) => z.object({ deviceUserId: z.string().min(1).max(256), command: z.literal(command), observedToken: z.string().min(1).max(2048), eventId: z.string().min(1).max(256) })),
]);
const playlistSummarySchema = z.object({ id: z.string(), title: z.string(), storyteller: z.string(), deliveredAt: z.string() });
const playlistAudioSchema = playlistSummarySchema.extend({
  audio: z.object({ url: z.url(), expiresAt: z.iso.datetime() }),
  durationSeconds: z.number().int().positive().optional(), artUrl: z.string().optional(),
});

function skillSecretMatches(actual: string | undefined, expected: string): boolean {
  if (!actual || !expected) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(actual), digest(expected));
}

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
  const demoDrafts = deps.drafts ? new DemoDraftController({
    store: deps.drafts.store, generator: deps.drafts.generator ?? createModelDraftGenerator(deps.model), now,
  }) : null;
  const demoUpdates = deps.updates ? new DemoUpdateController({ ...deps.updates, now }) : null;

  function updateError(error: unknown, c: Context) {
    if (error instanceof DemoUpdateError) {
      if (error.code === "confirmation_required") return c.json({ error: error.code, message: "Confirm the general topic before I save a demo wish." }, 422);
      if (error.code === "unsupported_topic") return c.json({ error: error.code, message: "Try a topic like mermaids, space, ocean, forest, animals, or friendship." }, 422);
      if (error.code === "unknown_storyteller" || error.code === "ambiguous_storyteller") {
        const names = [...new Set(deps.updates?.stories.map((story) => story.storyteller) ?? [])];
        return c.json({ error: error.code, message: `Which adult storyteller do you mean? Available storytellers: ${names.join(", ")}.` }, 422);
      }
      if (error.code === "no_pending_reaction") return c.json({ error: error.code, message: "There is no completed story waiting for a demo reaction." }, 409);
      if (error.code === "event_not_found") return c.json({ error: error.code, message: "That demo update is unavailable. Ask for your updates again." }, 404);
      if (error.code === "update_limit_reached") return c.json({ error: error.code, message: "Nothing new was saved. Try again later." }, 429);
    }
    return c.json({ error: "update_unavailable", message: "Nothing new was saved. Try again in a moment." }, 503);
  }

  const playlistCatalog: PlaylistCatalog = {
    async list() {
      const mcp = deps.deviceMcp ?? { url: deps.mcpUrl, fetch: deps.mcpFetch };
      const client = mcpClientFor(mcp.url, await serviceToken(), mcp.fetch);
      const tool = (await client.listTools()).find((item) => item.name === "list_family_stories" || item.name.endsWith("_list_family_stories"));
      if (!tool) throw new Error("list_family_stories is unavailable");
      const result = (await client.callTool(tool, { limit: 20 })) as { structuredContent?: { stories?: unknown } };
      return z.array(playlistSummarySchema).parse(result.structuredContent?.stories);
    },
    async get(id) {
      const mcp = deps.deviceMcp ?? { url: deps.mcpUrl, fetch: deps.mcpFetch };
      const client = mcpClientFor(mcp.url, await serviceToken(), mcp.fetch);
      const tool = (await client.listTools()).find((item) => item.name === "get_family_story" || item.name.endsWith("_get_family_story"));
      if (!tool) throw new Error("get_family_story is unavailable");
      const result = (await client.callTool(tool, { storyId: id })) as { isError?: boolean; structuredContent?: unknown };
      if (result.isError) return null;
      const story = playlistAudioSchema.parse(result.structuredContent);
      return { id: story.id, title: story.title, storyteller: story.storyteller, url: story.audio.url,
        durationSeconds: story.durationSeconds ?? null, artUrl: story.artUrl ?? null,
        expiresAt: Math.floor(Date.parse(story.audio.expiresAt) / 1000) };
    },
  };

  app.onError((error, c) => {
    log.error("agent_unhandled", { path: c.req.path, message: error.message });
    return c.json({ error: "server_error", message: "The agent hit an internal error" }, 500);
  });

  app.get("/agent/health", (c) => c.json({ ok: true, offline: deps.offline, model: deps.modelId }));

  app.post("/agent/playlist", async (c) => {
    if (!deps.playlist) return c.json({ error: "unavailable", message: "Playlist commands are unavailable" }, 503);
    if (!skillSecretMatches(c.req.header("x-alexa-skill-secret"), deps.playlist.secret)) {
      return c.json({ error: "unauthorized", message: "Skill authorization is required" }, 401);
    }
    const parsed = playlistBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return jsonError(c, 400, "invalid_request", "A valid playlist command is required");
    const { deviceUserId, ...command } = parsed.data;
    const deviceKey = deviceSessionId(deviceUserId);
    const controller = new PlaylistController({ store: deps.playlist.store, catalog: playlistCatalog, now });
    const result = await controller.command(deviceKey, command);
    if (command.command === "finished" && demoUpdates) {
      try {
        const playlist = await deps.playlist.store.get(deviceKey);
        if (playlist?.lastFinishedTokenDigest === sha256Hex(command.observedToken)) {
          const match = /^pl_\d+_(\d+)_[A-Za-z0-9_-]+$/u.exec(command.observedToken);
          const position = match ? Number(match[1]) : NaN;
          const storyId = playlist.ids[position];
          if (storyId) await demoUpdates.recordFinished(deviceKey, storyId, command.eventId);
        }
      } catch (error) {
        return updateError(error, c);
      }
    }
    return c.json(result);
  });

  app.post("/agent/demo/next", async (c) => {
    if (!demoUpdates || !deps.playlist) return c.json({ error: "update_unavailable", message: "Demo updates are unavailable." }, 503);
    if (!skillSecretMatches(c.req.header("x-alexa-skill-secret"), deps.playlist.secret)) return c.json({ error: "unauthorized", message: "Skill authorization is required" }, 401);
    const parsed = updateDeviceSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return jsonError(c, 400, "invalid_request", "A device is required");
    try { return c.json(await demoUpdates.next(deviceSessionId(parsed.data.deviceUserId))); }
    catch (error) { return updateError(error, c); }
  });

  app.post("/agent/demo/playback-finished", async (c) => {
    if (!demoUpdates || !deps.playlist) return c.json({ error: "update_unavailable", message: "Demo updates are unavailable." }, 503);
    if (!skillSecretMatches(c.req.header("x-alexa-skill-secret"), deps.playlist.secret)) return c.json({ error: "unauthorized", message: "Skill authorization is required" }, 401);
    const parsed = legacyFinishedBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return jsonError(c, 400, "invalid_request", "A device, stream token, and event ID are required");
    try { return c.json(await demoUpdates.recordLegacyFinished(deviceSessionId(parsed.data.deviceUserId), parsed.data.observedToken, parsed.data.eventId)); }
    catch (error) { return updateError(error, c); }
  });

  app.post("/agent/demo/reaction", async (c) => {
    if (!demoUpdates || !deps.playlist) return c.json({ error: "update_unavailable", message: "Demo updates are unavailable." }, 503);
    if (!skillSecretMatches(c.req.header("x-alexa-skill-secret"), deps.playlist.secret)) return c.json({ error: "unauthorized", message: "Skill authorization is required" }, 401);
    const parsed = reactionBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return jsonError(c, 400, "invalid_request", "A device, request ID, and reaction are required");
    try { return c.json(await demoUpdates.react(deviceSessionId(parsed.data.deviceUserId), parsed.data.requestId, parsed.data.choice)); }
    catch (error) { return updateError(error, c); }
  });

  app.post("/agent/demo/wish", async (c) => {
    if (!demoUpdates || !deps.playlist) return c.json({ error: "update_unavailable", message: "Demo updates are unavailable." }, 503);
    if (!skillSecretMatches(c.req.header("x-alexa-skill-secret"), deps.playlist.secret)) return c.json({ error: "unauthorized", message: "Skill authorization is required" }, 401);
    const parsed = wishBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "confirmation_required", message: "Confirm the general topic before I save a demo wish." }, 422);
    try { return c.json(await demoUpdates.wish(deviceSessionId(parsed.data.deviceUserId), parsed.data.requestId,
      parsed.data.topic, parsed.data.storyteller, parsed.data.confirmed)); }
    catch (error) { return updateError(error, c); }
  });

  app.post("/agent/demo/inbox", async (c) => {
    if (!demoUpdates || !deps.playlist) return c.json({ error: "update_unavailable", message: "Demo updates are unavailable." }, 503);
    if (!skillSecretMatches(c.req.header("x-alexa-skill-secret"), deps.playlist.secret)) return c.json({ error: "unauthorized", message: "Skill authorization is required" }, 401);
    const parsed = updateDeviceSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return jsonError(c, 400, "invalid_request", "A device is required");
    try { return c.json(await demoUpdates.inbox(deviceSessionId(parsed.data.deviceUserId))); }
    catch (error) { return updateError(error, c); }
  });

  app.post("/agent/demo/event", async (c) => {
    if (!demoUpdates || !deps.playlist) return c.json({ error: "update_unavailable", message: "Demo updates are unavailable." }, 503);
    if (!skillSecretMatches(c.req.header("x-alexa-skill-secret"), deps.playlist.secret)) return c.json({ error: "unauthorized", message: "Skill authorization is required" }, 401);
    const parsed = eventBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return jsonError(c, 400, "invalid_request", "A device, event, and action are required");
    try { return c.json(await demoUpdates.markEvent(deviceSessionId(parsed.data.deviceUserId), parsed.data.eventId, parsed.data.action)); }
    catch (error) { return updateError(error, c); }
  });

  app.post("/agent/demo/draft", async (c) => {
    if (!demoDrafts || !deps.playlist) return c.json({ error: "draft_unavailable", message: "No demo draft was saved. Try again in a moment." }, 503);
    if (!skillSecretMatches(c.req.header("x-alexa-skill-secret"), deps.playlist.secret)) {
      return c.json({ error: "unauthorized", message: "Skill authorization is required" }, 401);
    }
    const parsed = draftBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return jsonError(c, 400, "invalid_request", "A device, request ID, and theme are required");
    try {
      return c.json(await demoDrafts.save(deviceSessionId(parsed.data.deviceUserId), parsed.data.requestId, parsed.data.theme));
    } catch (error) {
      if (error instanceof DemoDraftError && error.code === "unsupported_theme") {
        return c.json({ error: "unsupported_theme", message: "Try a theme like bedtime, space, ocean, forest, animals, friendship, or mermaids." }, 422);
      }
      if (error instanceof DemoDraftError && error.code === "draft_limit_reached") {
        return c.json({ error: "draft_limit_reached", message: "No demo draft was saved. Try again later." }, 429);
      }
      return c.json({ error: "draft_unavailable", message: "No demo draft was saved. Try again in a moment." }, 503);
    }
  });

  app.post("/agent/demo/draft/latest", async (c) => {
    if (!demoDrafts || !deps.playlist) return c.json({ error: "draft_unavailable", message: "The demo draft is unavailable. Try again in a moment." }, 503);
    if (!skillSecretMatches(c.req.header("x-alexa-skill-secret"), deps.playlist.secret)) {
      return c.json({ error: "unauthorized", message: "Skill authorization is required" }, 401);
    }
    const parsed = draftLatestBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return jsonError(c, 400, "invalid_request", "A device is required");
    try {
      const receipt = await demoDrafts.latest(deviceSessionId(parsed.data.deviceUserId));
      return c.json(receipt ?? { status: "none" });
    } catch {
      return c.json({ error: "draft_unavailable", message: "The demo draft is unavailable. Try again in a moment." }, 503);
    }
  });

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
    return c.json({ say: result.say, play: result.play, needsAnswer: result.needsAnswer ?? false, speechUrl, toolCalls: result.toolCalls });
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
