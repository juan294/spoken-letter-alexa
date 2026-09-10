// Contract-shaped responses for the mocked fetch used by the component tests. Shapes
// mirror the packages/agent API exactly; a change there must land here too.
import { vi } from "vitest";

export const FIXTURE_TURN = {
  say: "Here is the story Grandpa sent.",
  play: {
    url: "/fixtures/silence.mp3",
    title: "The owl who forgot how to hoot",
    storyteller: "Grandpa Juan",
    durationSeconds: 184,
    artUrl: "/fixtures/story-art.png",
  },
  speechUrl: null as string | null,
  toolCalls: [
    { name: "spoken-letter___list_family_stories", ms: 120, era: "2025-03-26", ok: true },
    { name: "spoken-letter___get_family_story", ms: 80, era: "2025-03-26", ok: true },
  ],
};

export type Route = (request: { path: string; method: string; body: unknown; raw: Request }) => Response | Promise<Response>;

/** A fetch stub that routes by pathname, so tests do not depend on call order. */
export function routedFetch(routes: Record<string, Route>) {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = input instanceof Request ? input : new Request(input, init);
    const path = new URL(raw.url, "http://localhost").pathname;
    const route = routes[`${raw.method} ${path}`];
    if (!route) return Response.json({ error: "not_found", message: `no route for ${raw.method} ${path}` }, { status: 404 });
    const contentType = raw.headers.get("content-type") ?? "";
    const body: unknown = contentType.includes("json") ? ((await raw.json()) as unknown) : contentType.includes("form") ? await raw.text() : null;
    return route({ path, method: raw.method, body, raw });
  });
  return fetchImpl;
}

export function demoSession() {
  return Response.json({ sessionId: "s-demo", mode: "demo", subject: "demo", offline: true });
}
