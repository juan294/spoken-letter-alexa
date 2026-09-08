// A stand-in for the private Spoken Letter bridge (Phase 3, out of scope here). It
// implements the two bridge routes and the two session routes phase-3.md section 5 gives
// the private repository; the "confirm" step stands in for a signed-in Owner. Test-only.
import { constantTimeEqual } from "@spoken-letter-alexa/shared";
import { Hono } from "hono";

export type MockBridgeOptions = {
  bridgeSecret: string;
  /** The authorization server origin (`/bridge/link/complete` lives there). */
  authorizationServer: { fetch: (request: Request) => Promise<Response> };
  authorizationServerOrigin: string;
  /** Delivered stories per uid, in the private repository's bridge shape (extra fields included on purpose). */
  stories: Record<string, Record<string, unknown>[]>;
};

export function createMockSpokenLetter(options: MockBridgeOptions): Hono {
  const app = new Hono();

  const requireBridgeSecret = (header: string | undefined): boolean => {
    const match = /^Bearer\s+(\S+)$/i.exec(header ?? "");
    return Boolean(match?.[1] && constantTimeEqual(match[1], options.bridgeSecret));
  };

  app.get("/api/alexa/bridge/stories", (c) => {
    if (!requireBridgeSecret(c.req.header("authorization"))) return c.json({ error: "alexa_bridge_unauthorized" }, 401);
    const subject = c.req.query("subject") ?? "";
    const limit = Number(c.req.query("limit") ?? "20");
    return c.json({ stories: (options.stories[subject] ?? []).slice(0, limit) });
  });

  app.post("/api/alexa/bridge/audio-url", async (c) => {
    if (!requireBridgeSecret(c.req.header("authorization"))) return c.json({ error: "alexa_bridge_unauthorized" }, 401);
    const body = await c.req.json<{ subject: string; storyId: string; ttlSeconds: number }>();
    const story = (options.stories[body.subject] ?? []).find((entry) => entry.id === body.storyId);
    if (!story) return c.json({ error: "alexa_audio_unavailable" }, 404);
    const ttl = Math.min(Math.max(body.ttlSeconds, 60), 21_600);
    return c.json({
      url: `https://storage.googleapis.com/spoken-letter/${body.storyId}.mp3?signed=1&ttl=${ttl}`,
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
      contentType: "audio/mpeg",
    });
  });

  // What `POST /api/alexa/link/confirm` does in the private repository after `withSession`.
  app.post("/api/alexa/link/confirm", async (c) => {
    const uid = c.req.header("x-mock-session-uid");
    if (!uid) return c.json({ error: "unauthenticated" }, 401);
    const { token } = await c.req.json<{ token: string }>();
    const response = await options.authorizationServer.fetch(
      new Request(`${options.authorizationServerOrigin}/bridge/link/complete`, {
        method: "POST",
        headers: { authorization: `Bearer ${options.bridgeSecret}`, "content-type": "application/json" },
        body: JSON.stringify({ token, subject: uid }),
      }),
    );
    if (response.status === 404) return c.json({ error: "alexa_link_unavailable" }, 404);
    if (!response.ok) return c.json({ error: "alexa_bridge_unavailable" }, 503);
    return c.json(await response.json());
  });

  app.post("/api/alexa/disconnect", async (c) => {
    const uid = c.req.header("x-mock-session-uid");
    if (!uid) return c.json({ error: "unauthenticated" }, 401);
    await options.authorizationServer.fetch(
      new Request(`${options.authorizationServerOrigin}/bridge/link/revoke`, {
        method: "POST",
        headers: { authorization: `Bearer ${options.bridgeSecret}`, "content-type": "application/json" },
        body: JSON.stringify({ subject: uid }),
      }),
    );
    return c.json({ disconnected: true });
  });

  return app;
}
