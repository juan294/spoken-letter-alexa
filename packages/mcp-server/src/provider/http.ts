import { log } from "@spoken-letter-alexa/shared";
import { z } from "zod";

import { ToolFailure } from "../tools/schemas.ts";
import { type AccountProvider, ProviderUnavailableError, type StorySummary, type StoryWithAudio } from "./types.ts";

// zod drops unknown keys: recipient, space, sender and Yoto fields never survive parsing.
const bridgeStorySchema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().min(1).max(200),
  storyteller: z.string().min(1).max(80),
  durationSeconds: z.number().int().positive().optional(),
  deliveredAt: z.string().min(1),
});
const bridgeStoriesSchema = z.object({ stories: z.array(bridgeStorySchema) });
const bridgeAudioSchema = z.object({
  url: z.url(),
  expiresAt: z.string().min(1),
  contentType: z.literal("audio/mpeg"),
});

export const AUDIO_URL_TTL_SECONDS = 21_600;
const LIST_CACHE_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 1_500;

export type HttpProviderOptions = {
  /** Spoken Letter origin, e.g. `https://spokenletter.com`. */
  base: string;
  /** `ALEXA_BRIDGE_SECRET`. */
  secret: string;
  fetch?: typeof fetch | undefined;
  timeoutMs?: number | undefined;
  now?: (() => number) | undefined;
};

/**
 * Account provider over the private Spoken Letter bridge (Phase 3 routes). Delivered
 * stories are cached per subject for 30 seconds; audio URLs are never cached. A short
 * timeout keeps the tool round trip inside Amazon's budget and fails clean otherwise.
 */
export class HttpProvider implements AccountProvider {
  private readonly base: string;
  private readonly secret: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private readonly listCache = new Map<string, { at: number; limit: number; stories: StorySummary[] }>();

  constructor(options: HttpProviderOptions) {
    this.base = options.base.replace(/\/$/, "");
    this.secret = options.secret;
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.now = options.now ?? Date.now;
  }

  async listDeliveredStories(subject: string, limit: number): Promise<StorySummary[]> {
    const cached = this.listCache.get(subject);
    if (cached && cached.limit >= limit && this.now() - cached.at < LIST_CACHE_MS) return cached.stories.slice(0, limit);
    const body = await this.request(`/api/alexa/bridge/stories?subject=${encodeURIComponent(subject)}&limit=${limit}`, {
      method: "GET",
    });
    const parsed = bridgeStoriesSchema.safeParse(body);
    if (!parsed.success) throw new ProviderUnavailableError("bridge returned an unexpected stories shape");
    const stories: StorySummary[] = parsed.data.stories.map((story) => ({
      id: story.id,
      title: story.title,
      storyteller: story.storyteller,
      durationSeconds: story.durationSeconds,
      deliveredAt: story.deliveredAt,
    }));
    this.listCache.set(subject, { at: this.now(), limit, stories });
    return stories;
  }

  async getStory(subject: string, storyId: string): Promise<StoryWithAudio | null> {
    const stories = await this.listDeliveredStories(subject, 100);
    const story = stories.find((entry) => entry.id === storyId);
    if (!story) return null;
    const body = await this.request("/api/alexa/bridge/audio-url", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subject, storyId, ttlSeconds: AUDIO_URL_TTL_SECONDS }),
      notFound: () => new ToolFailure("audio_unavailable", "That story's recording is not available right now. Try another story."),
    });
    const parsed = bridgeAudioSchema.safeParse(body);
    if (!parsed.success) throw new ProviderUnavailableError("bridge returned an unexpected audio shape");
    return { ...story, audio: parsed.data };
  }

  private async request(
    path: string,
    init: { method: string; headers?: Record<string, string>; body?: string; notFound?: () => Error },
  ): Promise<unknown> {
    // One timer covers the headers and the body: a bridge that sends headers then stalls
    // the body is as unavailable as one that never answers.
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this.timeoutMs);
    try {
      let response: Response;
      try {
        response = await this.fetchImpl(`${this.base}${path}`, {
          method: init.method,
          headers: { authorization: `Bearer ${this.secret}`, accept: "application/json", ...init.headers },
          ...(init.body !== undefined && { body: init.body }),
          signal: controller.signal,
        });
      } catch (error) {
        log.warn("bridge_unreachable", { path, message: error instanceof Error ? error.message : String(error) });
        throw new ProviderUnavailableError(`bridge unreachable: ${path}`);
      }
      if (response.status === 404 && init.notFound) throw init.notFound();
      if (!response.ok) {
        log.warn("bridge_error", { path, status: response.status });
        throw new ProviderUnavailableError(`bridge ${response.status}`);
      }
      try {
        return await response.json();
      } catch (error) {
        if (controller.signal.aborted) {
          log.warn("bridge_body_timeout", { path });
          throw new ProviderUnavailableError(`bridge body timed out: ${path}`);
        }
        log.warn("bridge_malformed", { path, message: error instanceof Error ? error.message : String(error) });
        throw new ProviderUnavailableError("bridge returned malformed JSON");
      }
    } finally {
      clearTimeout(timer);
    }
  }
}
