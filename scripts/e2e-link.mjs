#!/usr/bin/env node
// End-to-end link flow against two local servers (phase-4.md section 4).
//
//   Terminal 1: DEV_ROUTES=1 PROVIDER_MODE=auto pnpm dev            (prints ALEXA_BRIDGE_SECRET)
//   Terminal 2: ALEXA_BRIDGE_SECRET=... node scripts/mock-spoken-letter.mjs   (or the real
//               Spoken Letter dev server on :3007 once Phase 3 exists; then set SL_SESSION_COOKIE)
//   Terminal 3: node scripts/e2e-link.mjs
//
// Steps 1 to 6 mirror the plan: authorize, confirm, continue, exchange, legacy initialize +
// tools with the JWT, get_family_story URL check, disconnect and the refresh failure.
import { createHash, randomBytes } from "node:crypto";

const AS = process.env.ALEXA_BRIDGE_ORIGIN ?? "http://localhost:4310";
const SL = process.env.SPOKEN_LETTER_ORIGIN ?? "http://localhost:3007";
const SESSION_COOKIE = process.env.SL_SESSION_COOKIE; // real Spoken Letter only
const CLIENT_ID = "simulator";
const REDIRECT_URI = `${AS}/dev/callback`;

const verifier = randomBytes(48).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");
const state = randomBytes(8).toString("base64url");

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`ok: ${message}`);
}

async function mcp(token, body) {
  const response = await fetch(`${AS}/mcp`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const line = text.split("\n").find((l) => l.startsWith("data:"));
  return { status: response.status, message: JSON.parse(line ? line.slice(5) : text) };
}

// 1. authorize
const authorize = await fetch(
  `${AS}/oauth/authorize?${new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    scope: "mcp:tools mcp:resources",
  })}`,
  { redirect: "manual" },
);
assert(authorize.status === 302, "authorize answers 302");
const linkUrl = authorize.headers.get("location") ?? "";
assert(linkUrl.startsWith(`${SL}/link/alexa/sla_`), `authorize redirects to the link page (${linkUrl.slice(0, 40)}…)`);
const linkToken = linkUrl.split("/link/alexa/")[1];

// 2. confirm (Spoken Letter session, or the mock)
const confirm = await fetch(`${SL}/api/alexa/link/confirm`, {
  method: "POST",
  headers: { "content-type": "application/json", ...(SESSION_COOKIE && { cookie: SESSION_COOKIE }) },
  body: JSON.stringify({ token: linkToken }),
});
assert(confirm.status === 200, `link confirm answers 200 (got ${confirm.status})`);
const { continueUrl } = await confirm.json();
assert(typeof continueUrl === "string" && continueUrl.startsWith(`${AS}/oauth/continue?`), "confirm returns a continueUrl");

// 3. continue → code
const cont = await fetch(continueUrl, { redirect: "manual" });
assert(cont.status === 302, "continue answers 302");
const callback = new URL(cont.headers.get("location") ?? "");
assert(callback.searchParams.get("state") === state, "state round-trips");
const code = callback.searchParams.get("code");
assert(Boolean(code), "code is present");

// 4. token
const token = await fetch(`${AS}/oauth/token`, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: REDIRECT_URI, client_id: CLIENT_ID }),
});
assert(token.status === 200, "token exchange answers 200");
const tokens = await token.json();
assert(typeof tokens.access_token === "string" && typeof tokens.refresh_token === "string", "access and refresh tokens issued");

// 5. legacy initialize + tools
const init = await mcp(tokens.access_token, {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "Alexa+ MCP Client", version: "1.0.0" } },
});
assert(init.message.result?.protocolVersion === "2025-03-26", "legacy initialize echoes 2025-03-26");
const list = await mcp(tokens.access_token, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "list_family_stories", arguments: {} } });
const stories = list.message.result?.structuredContent?.stories ?? [];
assert(stories.length > 0, `list_family_stories returns ${stories.length} delivered stories`);
assert(!/recipient|spaceId|senderEmail/.test(JSON.stringify(list.message)), "no recipient fields survive");
const get = await mcp(tokens.access_token, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_family_story", arguments: { storyId: stories[0].id } } });
const audio = get.message.result?.structuredContent?.audio;
assert(audio?.contentType === "audio/mpeg", "get_family_story returns audio/mpeg");
assert(Date.parse(audio.expiresAt) - Date.now() <= 6 * 3600 * 1000, "audio URL expires within 6 h");
if (SESSION_COOKIE) {
  const head = await fetch(audio.url, { method: "HEAD" });
  assert(head.status === 200 && (head.headers.get("content-type") ?? "").startsWith("audio/mpeg"), "signed audio URL answers 200 audio/mpeg");
} else {
  console.log("skip: signed URL HEAD check (mock bridge returns a placeholder-free but unreachable GCS URL)");
}

// 6. disconnect
const disconnect = await fetch(`${SL}/api/alexa/disconnect`, {
  method: "POST",
  headers: { "content-type": "application/json", ...(SESSION_COOKIE && { cookie: SESSION_COOKIE }) },
  body: "{}",
});
assert(disconnect.status === 200, "disconnect answers 200");
const refresh = await fetch(`${AS}/oauth/token`, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: CLIENT_ID }),
});
assert(refresh.status === 400 && (await refresh.json()).error === "invalid_grant", "refresh after disconnect is invalid_grant");
const stale = await mcp(tokens.access_token, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "suggest_next_story", arguments: {} } });
assert(stale.status === 200, "the stale access token still works until exp (documented)");
console.log("e2e link flow: all steps passed");
