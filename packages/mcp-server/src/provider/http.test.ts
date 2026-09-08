import { describe, expect, test, vi } from "vitest";

import { HttpProvider } from "./http.ts";
import { ProviderUnavailableError } from "./types.ts";

const BASE = "https://spokenletter.com";
const SECRET = "test-bridge-secret-not-a-real-credential";

const BRIDGE_STORIES = {
  stories: [
    {
      id: "st_1",
      title: "A lighthouse for Mateo",
      storyteller: "Grandpa Juan",
      durationSeconds: 241,
      deliveredAt: "2026-09-02T20:05:00.000Z",
      recipientName: "must not survive",
      recipientId: "rcp_1",
      spaceId: "sp_1",
      senderEmail: "x@example.com",
    },
    { id: "st_2", title: "The owl who forgot how to hoot", storyteller: "Grandpa Juan", deliveredAt: "2026-08-30T19:12:00.000Z" },
  ],
};

type FetchImpl = typeof fetch;

function urlOf(input: string | URL | Request): string {
  return input instanceof Request ? input.url : input.toString();
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function provider(fetchImpl: FetchImpl, now?: () => number): HttpProvider {
  return new HttpProvider({ base: BASE, secret: SECRET, fetch: fetchImpl, ...(now && { now }) });
}

describe("HttpProvider.listDeliveredStories", () => {
  test("calls the bridge with the bearer secret and drops every non-boundary field", async () => {
    const fetchImpl = vi.fn<FetchImpl>(() => Promise.resolve(jsonResponse(BRIDGE_STORIES)));
    const stories = await provider(fetchImpl).listDeliveredStories("uid_1", 5);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(urlOf(url)).toBe(`${BASE}/api/alexa/bridge/stories?subject=uid_1&limit=5`);
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${SECRET}`);
    expect(stories).toEqual([
      { id: "st_1", title: "A lighthouse for Mateo", storyteller: "Grandpa Juan", durationSeconds: 241, deliveredAt: "2026-09-02T20:05:00.000Z" },
      { id: "st_2", title: "The owl who forgot how to hoot", storyteller: "Grandpa Juan", deliveredAt: "2026-08-30T19:12:00.000Z" },
    ]);
    expect(JSON.stringify(stories)).not.toMatch(/recipient|spaceId|senderEmail/);
  });

  test("URL-encodes the subject", async () => {
    const fetchImpl = vi.fn<FetchImpl>(() => Promise.resolve(jsonResponse({ stories: [] })));
    await provider(fetchImpl).listDeliveredStories("a b/c", 1);
    expect(urlOf(fetchImpl.mock.calls[0]![0])).toContain("subject=a%20b%2Fc");
  });

  test.each([401, 403, 500, 503])("a %s from the bridge is provider_unavailable", async (status) => {
    const fetchImpl = vi.fn<FetchImpl>(() => Promise.resolve(jsonResponse({ error: "x" }, status)));
    await expect(provider(fetchImpl).listDeliveredStories("uid_1", 5)).rejects.toBeInstanceOf(ProviderUnavailableError);
  });

  test("malformed JSON and a wrong shape are provider_unavailable", async () => {
    const broken = vi.fn<FetchImpl>(() => Promise.resolve(new Response("not json", { status: 200 })));
    await expect(provider(broken).listDeliveredStories("uid_1", 5)).rejects.toBeInstanceOf(ProviderUnavailableError);
    const wrong = vi.fn<FetchImpl>(() => Promise.resolve(jsonResponse({ stories: [{ id: 1 }] })));
    await expect(provider(wrong).listDeliveredStories("uid_1", 5)).rejects.toBeInstanceOf(ProviderUnavailableError);
  });

  test("a bridge that never answers times out as provider_unavailable", async () => {
    const hanging = vi.fn<FetchImpl>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );
    const slow = new HttpProvider({ base: BASE, secret: SECRET, fetch: hanging, timeoutMs: 20 });
    await expect(slow.listDeliveredStories("uid_1", 5)).rejects.toBeInstanceOf(ProviderUnavailableError);
  });

  test("a bridge that sends headers then stalls the body times out as provider_unavailable", async () => {
    const stalling = vi.fn<FetchImpl>((_url, init) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"stories":['));
          init?.signal?.addEventListener("abort", () => {
            controller.error(new DOMException("aborted", "AbortError"));
          });
        },
      });
      return Promise.resolve(new Response(body, { status: 200, headers: { "content-type": "application/json" } }));
    });
    const slow = new HttpProvider({ base: BASE, secret: SECRET, fetch: stalling, timeoutMs: 20 });
    await expect(slow.listDeliveredStories("uid_1", 5)).rejects.toBeInstanceOf(ProviderUnavailableError);
  });

  test("caches the list per subject for 30 seconds", async () => {
    let now = 1_000_000;
    const fetchImpl = vi.fn<FetchImpl>(() => Promise.resolve(jsonResponse(BRIDGE_STORIES)));
    const p = provider(fetchImpl, () => now);
    await p.listDeliveredStories("uid_1", 5);
    await p.listDeliveredStories("uid_1", 5);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await p.listDeliveredStories("uid_2", 5);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    now += 31_000;
    await p.listDeliveredStories("uid_1", 5);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});

describe("HttpProvider.getStory", () => {
  test("combines the cached summary with a freshly signed audio URL and never caches the URL", async () => {
    const fetchImpl = vi.fn<FetchImpl>((url) => {
      if (urlOf(url).endsWith("/api/alexa/bridge/audio-url")) {
        return Promise.resolve(
          jsonResponse({ url: "https://storage.example/signed?x=1", expiresAt: "2026-09-08T20:00:00.000Z", contentType: "audio/mpeg" }),
        );
      }
      return Promise.resolve(jsonResponse(BRIDGE_STORIES));
    });
    const p = provider(fetchImpl);
    const story = await p.getStory("uid_1", "st_1");
    expect(story).toEqual({
      id: "st_1",
      title: "A lighthouse for Mateo",
      storyteller: "Grandpa Juan",
      durationSeconds: 241,
      deliveredAt: "2026-09-02T20:05:00.000Z",
      audio: { url: "https://storage.example/signed?x=1", expiresAt: "2026-09-08T20:00:00.000Z", contentType: "audio/mpeg" },
    });
    const audioCall = fetchImpl.mock.calls.find(([url]) => urlOf(url).endsWith("/audio-url"))!;
    expect(audioCall[1]?.method).toBe("POST");
    expect(JSON.parse(audioCall[1]?.body as string)).toEqual({ subject: "uid_1", storyId: "st_1", ttlSeconds: 21_600 });
    await p.getStory("uid_1", "st_1");
    expect(fetchImpl.mock.calls.filter(([url]) => urlOf(url).endsWith("/audio-url"))).toHaveLength(2);
  });

  test("returns null for a story that is not delivered, and provider_unavailable when the audio endpoint fails", async () => {
    const fetchImpl = vi.fn<FetchImpl>((url) =>
      Promise.resolve(urlOf(url).endsWith("/audio-url") ? jsonResponse({ error: "boom" }, 503) : jsonResponse(BRIDGE_STORIES)),
    );
    const p = provider(fetchImpl);
    await expect(p.getStory("uid_1", "st_missing")).resolves.toBeNull();
    await expect(p.getStory("uid_1", "st_1")).rejects.toBeInstanceOf(ProviderUnavailableError);
  });

  test("a 404 from the audio endpoint means the recording is unavailable", async () => {
    const fetchImpl = vi.fn<FetchImpl>((url) =>
      Promise.resolve(urlOf(url).endsWith("/audio-url") ? jsonResponse({ error: "alexa_audio_unavailable" }, 404) : jsonResponse(BRIDGE_STORIES)),
    );
    await expect(provider(fetchImpl).getStory("uid_1", "st_1")).rejects.toMatchObject({ code: "audio_unavailable" });
  });
});
