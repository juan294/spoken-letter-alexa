import { describe, expect, test, vi } from "vitest";

import { createAgentClient } from "./agent-client.ts";

const BASE = "https://alexa.spokenletter.com";

const urlOf = (input: Parameters<typeof fetch>[0]): string => (typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
const bodyOf = (init: RequestInit | undefined): unknown => JSON.parse(init?.body as string);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("createAgentClient", () => {
  test("demo update calls use the authenticated skill routes and a confirmed wish", async () => {
    const paths: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>((input, init) => {
      expect(new Headers(init?.headers).get("x-alexa-skill-secret")).toBe("skill-secret");
      const path = new URL(urlOf(input)).pathname;
      paths.push(path);
      if (path.endsWith("/wish")) expect(bodyOf(init)).toEqual({ deviceUserId: "owner", requestId: "r1", topic: "mermaids", confirmed: true });
      return Promise.resolve(jsonResponse(path.endsWith("/inbox") ? { events: [] } : {}));
    });
    const client = createAgentClient({ baseUrl: BASE, fetch: fetchImpl, timeoutMs: 6_000, skillSecret: "skill-secret" });
    await client.demoNext!({ deviceUserId: "owner" });
    await client.demoReact!({ deviceUserId: "owner", requestId: "r1", choice: "like" });
    await client.demoWish!({ deviceUserId: "owner", requestId: "r1", topic: "mermaids", confirmed: true });
    await client.demoEvent!({ deviceUserId: "owner", eventId: "e1", action: "read" });
    await client.demoInbox!({ deviceUserId: "owner" });
    expect(paths).toEqual(["/agent/demo/next", "/agent/demo/reaction", "/agent/demo/wish", "/agent/demo/event", "/agent/demo/inbox"]);
  });
  test("saves and reads a demo draft through authenticated routes", async () => {
    const fetchImpl = vi.fn<typeof fetch>((input, init) => {
      expect(new Headers(init?.headers).get("x-alexa-skill-secret")).toBe("skill-secret");
      if (urlOf(input).endsWith("/agent/demo/draft/latest")) {
        expect(bodyOf(init)).toEqual({ deviceUserId: "owner" });
        return Promise.resolve(jsonResponse({ status: "saved", draftId: "draft-1", theme: "space", outline: "A gentle trip through the stars." }));
      }
      expect(urlOf(input)).toBe(`${BASE}/agent/demo/draft`);
      expect(bodyOf(init)).toEqual({ deviceUserId: "owner", requestId: "request-1", theme: "space" });
      return Promise.resolve(jsonResponse({ status: "saved", draftId: "draft-1", theme: "space", outline: "A gentle trip through the stars." }));
    });
    const client = createAgentClient({ baseUrl: BASE, fetch: fetchImpl, timeoutMs: 6_000, skillSecret: "skill-secret" });
    await expect(client.saveDraft!({ deviceUserId: "owner", requestId: "request-1", theme: "space" })).resolves.toMatchObject({ status: "saved", draftId: "draft-1" });
    await expect(client.latestDraft!({ deviceUserId: "owner" })).resolves.toMatchObject({ status: "saved", draftId: "draft-1" });
  });
  test("authenticates a playlist command and preserves its server token", async () => {
    const fetchImpl = vi.fn<typeof fetch>((input, init) => {
      expect(urlOf(input)).toBe(`${BASE}/agent/playlist`);
      expect(new Headers(init?.headers).get("x-alexa-skill-secret")).toBe("skill-secret");
      expect(bodyOf(init)).toEqual({ deviceUserId: "owner", command: "start", order: "newest" });
      return Promise.resolve(jsonResponse({ say: "Starting.", action: "play", play: { id: "story", url: "https://example.com/story.mp3", title: "Story", storyteller: "Aunt", durationSeconds: 42 }, token: "controller-token", playBehavior: "REPLACE_ALL" }));
    });
    const client = createAgentClient({ baseUrl: BASE, fetch: fetchImpl, timeoutMs: 6_000, skillSecret: "skill-secret" });
    await expect(client.playlist!({ deviceUserId: "owner", command: "start", order: "newest" })).resolves.toMatchObject({ action: "play", token: "controller-token" });
  });
  test("opens a device session once per device user and reuses it for the turn", async () => {
    const fetchImpl = vi.fn<typeof fetch>((input, init) => {
      const url = urlOf(input);
      if (url.endsWith("/agent/session")) {
        expect(bodyOf(init)).toEqual({ mode: "device", deviceUserId: "amzn1.ask.account.OWNER" });
        return Promise.resolve(jsonResponse({ sessionId: "dev_abc", mode: "device", subject: "svc:alexa-m2m", offline: false }));
      }
      expect(bodyOf(init)).toEqual({ sessionId: "dev_abc", text: "play a story" });
      return Promise.resolve(jsonResponse({ say: "Here.", play: null, speechUrl: null, toolCalls: [{ name: "list_family_stories", ms: 3, era: "legacy", ok: true }] }));
    });
    const client = createAgentClient({ baseUrl: BASE, fetch: fetchImpl, timeoutMs: 6_000 });
    const first = await client.turn({ deviceUserId: "amzn1.ask.account.OWNER", text: "play a story" });
    expect(first).toEqual({ say: "Here.", play: null, toolCalls: [{ name: "list_family_stories", ms: 3, era: "legacy", ok: true }] });
    await client.turn({ deviceUserId: "amzn1.ask.account.OWNER", text: "play a story" });
    expect(fetchImpl.mock.calls.filter(([url]) => urlOf(url).endsWith("/agent/session"))).toHaveLength(1);
  });

  test("a 404 session_not_found reopens the session once", async () => {
    let sessions = 0;
    let turns = 0;
    const fetchImpl = vi.fn<typeof fetch>((input) => {
      const url = urlOf(input);
      if (url.endsWith("/agent/session")) {
        sessions += 1;
        return Promise.resolve(jsonResponse({ sessionId: `s${sessions}`, mode: "device", subject: "demo", offline: true }));
      }
      turns += 1;
      return Promise.resolve(turns === 1 ? jsonResponse({ error: "session_not_found", message: "gone" }, 404) : jsonResponse({ say: "ok", play: null, speechUrl: null, toolCalls: [] }));
    });
    const client = createAgentClient({ baseUrl: BASE, fetch: fetchImpl, timeoutMs: 6_000 });
    await expect(client.turn({ deviceUserId: "u", text: "hi" })).resolves.toMatchObject({ say: "ok" });
    expect(sessions).toBe(2);
    expect(turns).toBe(2);
  });

  test("times out within the budget and rejects malformed replies", async () => {
    const hanging = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );
    const slow = createAgentClient({ baseUrl: BASE, fetch: hanging, timeoutMs: 20 });
    await expect(slow.turn({ deviceUserId: "u", text: "hi" })).rejects.toThrow(/abort/i);
    const broken = createAgentClient({ baseUrl: BASE, fetch: () => Promise.resolve(new Response("not json", { status: 200 })), timeoutMs: 100 });
    await expect(broken.turn({ deviceUserId: "u", text: "hi" })).rejects.toThrow();
  });
});
