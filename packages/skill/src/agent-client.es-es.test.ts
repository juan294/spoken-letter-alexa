import { describe, expect, test, vi } from "vitest";

import { createAgentClient } from "./agent-client.ts";

const BASE = "https://alexa.spokenletter.com";
const urlOf = (input: Parameters<typeof fetch>[0]): string => (typeof input === "string" ? input : input instanceof URL ? input.href : input.url);

function recordingClient() {
  const bodies: { path: string; body: Record<string, unknown> }[] = [];
  const fetchImpl = vi.fn<typeof fetch>((input, init) => {
    const path = new URL(urlOf(input)).pathname;
    bodies.push({ path, body: JSON.parse(init?.body as string) as Record<string, unknown> });
    const reply = path === "/agent/session" ? { sessionId: `s${bodies.length}` }
      : path === "/agent/turn" ? { say: "Hola.", play: null, toolCalls: [] }
        : path.endsWith("/inbox") ? { events: [] }
          : path.endsWith("/reaction") ? { status: "dismissed" }
            : path.endsWith("/wish") ? { status: "saved", wishId: "w1", topic: "space" }
              : path.endsWith("/draft") ? { status: "saved", draftId: "d1", theme: "space", outline: "x" }
                : path.endsWith("/latest") ? { status: "none" }
                  : path.endsWith("/event") ? { status: "read" }
                    : path.endsWith("/playback-finished") ? { status: "ignored" }
                      : path === "/agent/playlist" ? { action: "none", say: "Nada." } : {};
    return Promise.resolve(new Response(JSON.stringify(reply), { status: 200 }));
  });
  return { bodies, client: createAgentClient({ baseUrl: BASE, fetch: fetchImpl, timeoutMs: 6_000, skillSecret: "skill-secret" }) };
}

describe("agent client locale transport (B7)", () => {
  test("locale is sent on exactly the session, playlist, next, inbox, draft and wish bodies", async () => {
    const { bodies, client } = recordingClient();
    const locale = "es-ES" as const;
    await client.turn({ deviceUserId: "owner", text: "hola", locale });
    await client.playlist!({ deviceUserId: "owner", command: "start", locale });
    await client.demoNext!({ deviceUserId: "owner", locale });
    await client.demoInbox!({ deviceUserId: "owner", locale });
    await client.saveDraft!({ deviceUserId: "owner", requestId: "r1", theme: "espacio", locale });
    await client.demoWish!({ deviceUserId: "owner", requestId: "r2", topic: "space", confirmed: true, locale });
    await client.demoReact!({ deviceUserId: "owner", requestId: "r3", choice: "dismiss" });
    await client.demoEvent!({ deviceUserId: "owner", eventId: "e1", action: "read" });
    await client.latestDraft!({ deviceUserId: "owner" });
    await client.demoPlaybackFinished!({ deviceUserId: "owner", observedToken: "t", eventId: "e2" });
    const withLocale = bodies.filter(({ body }) => body.locale === "es-ES").map(({ path }) => path);
    expect(withLocale).toEqual(["/agent/session", "/agent/playlist", "/agent/demo/next", "/agent/demo/inbox", "/agent/demo/draft", "/agent/demo/wish"]);
    expect(bodies.filter(({ body }) => "locale" in body).map(({ path }) => path)).toEqual(withLocale);
  });

  test("a turn without a locale sends no locale field at all", async () => {
    const { bodies, client } = recordingClient();
    await client.turn({ deviceUserId: "owner", text: "hello" });
    expect(bodies.map(({ body }) => "locale" in body)).toEqual([false, false]);
  });

  test("SS6 a turn in a different locale reopens the device session so the server stores the new locale", async () => {
    const { bodies, client } = recordingClient();
    await client.turn({ deviceUserId: "owner", text: "hola", locale: "es-ES" });
    await client.turn({ deviceUserId: "owner", text: "otra" , locale: "es-ES" });
    await client.turn({ deviceUserId: "owner", text: "hello" });
    const sessions = bodies.filter(({ path }) => path === "/agent/session").map(({ body }) => body);
    expect(sessions).toEqual([{ mode: "device", deviceUserId: "owner", locale: "es-ES" }, { mode: "device", deviceUserId: "owner" }]);
  });
});
