#!/usr/bin/env node
// A local stand-in for the private Spoken Letter bridge (Phase 3 lands after the freeze).
// Serves the three bridge routes and a fake "confirm" page so the whole link flow can be
// driven end to end against `pnpm dev`. No child data: the stories are the Owner's own.
//
// Usage: ALEXA_BRIDGE_SECRET=<same as the server> ALEXA_BRIDGE_ORIGIN=http://localhost:4310 \
//        node scripts/mock-spoken-letter.mjs        # listens on :3007
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";

const PORT = Number(process.env.PORT ?? 3007);
const SECRET = process.env.ALEXA_BRIDGE_SECRET;
const AS_ORIGIN = process.env.ALEXA_BRIDGE_ORIGIN ?? "http://localhost:4310";
const UID = process.env.MOCK_UID ?? "uid_owner";
if (!SECRET) {
  console.error("ALEXA_BRIDGE_SECRET is required (copy it from the server's startup output)");
  process.exit(2);
}

const STORIES = [
  { id: "real_1", title: "The night the moon was late", storyteller: "Grandpa Juan", durationSeconds: 203, deliveredAt: "2026-09-05T19:00:00.000Z", recipientId: "hidden", spaceId: "hidden" },
  { id: "real_2", title: "Bread for the seagulls", storyteller: "Grandpa Juan", durationSeconds: 150, deliveredAt: "2026-09-01T19:00:00.000Z" },
];

function authorized(req) {
  const header = req.headers.authorization ?? "";
  const token = header.replace(/^Bearer\s+/i, "");
  const a = Buffer.from(token);
  const b = Buffer.from(SECRET);
  return a.length === b.length && timingSafeEqual(a, b);
}

function json(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  try {
    if (req.method === "GET" && url.pathname === "/api/alexa/bridge/stories") {
      if (!authorized(req)) return json(res, 401, { error: "alexa_bridge_unauthorized" });
      const limit = Number(url.searchParams.get("limit") ?? 20);
      return json(res, 200, { stories: (url.searchParams.get("subject") === UID ? STORIES : []).slice(0, limit) });
    }
    if (req.method === "POST" && url.pathname === "/api/alexa/bridge/audio-url") {
      if (!authorized(req)) return json(res, 401, { error: "alexa_bridge_unauthorized" });
      const body = await readJson(req);
      const story = body.subject === UID ? STORIES.find((s) => s.id === body.storyId) : undefined;
      if (!story) return json(res, 404, { error: "alexa_audio_unavailable" });
      const ttl = Math.min(Math.max(Number(body.ttlSeconds) || 60, 60), 21_600);
      return json(res, 200, {
        url: `https://storage.googleapis.com/spoken-letter/${story.id}.mp3?signed=1&ttl=${ttl}`,
        expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
        contentType: "audio/mpeg",
      });
    }
    // The link page: a signed-in Owner would click Confirm here. The mock confirms at once.
    if (req.method === "GET" && url.pathname.startsWith("/link/alexa/")) {
      const token = url.pathname.slice("/link/alexa/".length);
      const complete = await fetch(`${AS_ORIGIN}/bridge/link/complete`, {
        method: "POST",
        headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json" },
        body: JSON.stringify({ token, subject: UID }),
      });
      if (!complete.ok) return json(res, complete.status, await complete.json());
      const { continueUrl } = await complete.json();
      res.writeHead(302, { location: continueUrl });
      return res.end();
    }
    if (req.method === "POST" && url.pathname === "/api/alexa/link/confirm") {
      const { token } = await readJson(req);
      const complete = await fetch(`${AS_ORIGIN}/bridge/link/complete`, {
        method: "POST",
        headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json" },
        body: JSON.stringify({ token, subject: UID }),
      });
      return json(res, complete.status, await complete.json());
    }
    if (req.method === "POST" && url.pathname === "/api/alexa/disconnect") {
      const revoke = await fetch(`${AS_ORIGIN}/bridge/link/revoke`, {
        method: "POST",
        headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json" },
        body: JSON.stringify({ subject: UID }),
      });
      return json(res, revoke.ok ? 200 : 503, { disconnected: revoke.ok });
    }
    return json(res, 404, { error: "not_found" });
  } catch (error) {
    return json(res, 500, { error: "mock_failure", message: String(error) });
  }
});

server.listen(PORT, () => {
  console.log(JSON.stringify({ event: "mock_spoken_letter_ready", port: PORT, uid: UID, authorizationServer: AS_ORIGIN }));
});
