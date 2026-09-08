import { describe, expect, test, vi } from "vitest";

import { createAgentClient } from "./agent-client.ts";

const BASE = "https://alexa.spokenletter.com";

const urlOf = (input: Parameters<typeof fetch>[0]): string => (typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
const bodyOf = (init: RequestInit | undefined): unknown => JSON.parse(init?.body as string);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("createAgentClient", () => {
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
