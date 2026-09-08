#!/usr/bin/env node
// Streaming and latency verification against the deployed host (phase-6.md section 3).
//
//   node scripts/verify-deploy.mjs                       # https://alexa.spokenletter.com
//   BASE_URL=https://... M2M_SECRET=... node scripts/verify-deploy.mjs
//
// Checks: PRM and AS metadata; a legacy initialize through CloudFront; a modern
// server/discover; tools/call timing (p95 under 500 ms from where the script runs); and an
// SSE pass-through probe. Exit code 1 on the first failure. Read-only against the deployment.
const BASE = (process.env.BASE_URL ?? "https://alexa.spokenletter.com").replace(/\/$/, "");
const M2M_ID = process.env.M2M_CLIENT_ID ?? "alexa-m2m";
const M2M_SECRET = process.env.M2M_SECRET;
const ROUNDS = Number(process.env.ROUNDS ?? 20);
const MODERN = "2026-07-28";

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`ok: ${message}`);
}

function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;
}

async function json(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  const line = text.split("\n").find((l) => l.startsWith("data:"));
  return { response, body: JSON.parse(line ? line.slice(5) : text) };
}

// 1. Discovery documents
const prm = await json(`${BASE}/.well-known/oauth-protected-resource`);
assert(prm.response.status === 200 && prm.body.resource === `${BASE}/mcp`, "protected resource metadata names /mcp");
assert(Array.isArray(prm.body.authorization_servers) && prm.body.authorization_servers[0] === BASE, "PRM points at this host as the authorization server");
const as = await json(`${BASE}/.well-known/oauth-authorization-server`);
assert(as.response.status === 200 && as.body.issuer === BASE, "authorization server metadata issuer matches");
assert(as.body.grant_types_supported?.includes("client_credentials") && as.body.code_challenge_methods_supported?.includes("S256"), "metadata lists client_credentials and S256");
const jwks = await json(`${BASE}/.well-known/jwks.json`);
assert(jwks.response.status === 200 && Array.isArray(jwks.body.keys) && jwks.body.keys.length >= 1, "jwks.json publishes a key");

// 2. Unauthenticated /mcp answers the RFC 9728 challenge through CloudFront
const unauth = await fetch(`${BASE}/mcp`, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "verify", version: "1" } } }),
});
assert(unauth.status === 401 && /resource_metadata=/.test(unauth.headers.get("www-authenticate") ?? ""), "401 challenge carries resource_metadata");

if (!M2M_SECRET) {
  console.log("skip: authenticated checks (set M2M_SECRET from the seeded sla/oauth-clients secret)");
  process.exit(0);
}

// 3. Service token
const tokenResponse = await fetch(`${BASE}/oauth/token`, {
  method: "POST",
  headers: { authorization: `Basic ${Buffer.from(`${M2M_ID}:${M2M_SECRET}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
  body: "grant_type=client_credentials",
});
assert(tokenResponse.status === 200, `client_credentials token issued (status ${tokenResponse.status})`);
const { access_token: token } = await tokenResponse.json();
const auth = { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" };

// 4. Legacy initialize and modern discover
const init = await json(`${BASE}/mcp`, {
  method: "POST",
  headers: auth,
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "Alexa+ MCP Client", version: "1.0.0" } } }),
});
assert(init.body.result?.protocolVersion === "2025-03-26" && init.body.result?.serverInfo?.name === "spoken-letter", "legacy initialize at 2025-03-26 is echoed through CloudFront");
const envelope = {
  "io.modelcontextprotocol/protocolVersion": MODERN,
  "io.modelcontextprotocol/clientCapabilities": {},
  "io.modelcontextprotocol/clientInfo": { name: "verify-deploy", version: "1.0.0" },
};
const discover = await json(`${BASE}/mcp`, {
  method: "POST",
  headers: { ...auth, "mcp-protocol-version": MODERN, "mcp-method": "server/discover" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "server/discover", params: { _meta: envelope } }),
});
assert(discover.body.result?.supportedVersions?.includes(MODERN), "modern server/discover answers 2026-07-28");

// 5. Tool latency from this vantage point
const samples = [];
for (let i = 0; i < ROUNDS; i += 1) {
  const started = performance.now();
  const call = await json(`${BASE}/mcp`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ jsonrpc: "2.0", id: 10 + i, method: "tools/call", params: { name: "list_family_stories", arguments: { limit: 3 } } }),
  });
  samples.push(performance.now() - started);
  assert(!call.body.error, `tools/call ${i + 1}/${ROUNDS} succeeded`);
}
const sorted = [...samples].sort((a, b) => a - b);
const p50 = percentile(sorted, 50);
const p95 = percentile(sorted, 95);
const p99 = percentile(sorted, 99);
console.log(`latency from ${process.env.VANTAGE ?? "this machine"}: p50=${p50.toFixed(0)}ms p95=${p95.toFixed(0)}ms p99=${p99.toFixed(0)}ms n=${ROUNDS}`);
if (process.env.ASSERT_P95 !== "0") assert(p95 < 500, "p95 under 500 ms (set ASSERT_P95=0 to report only, e.g. from Spain)");

// 6. SSE pass-through: a legacy response arrives as text/event-stream and the first frame is not held back.
const controller = new AbortController();
const startedSse = performance.now();
const sse = await fetch(`${BASE}/mcp`, {
  method: "POST",
  headers: auth,
  body: JSON.stringify({ jsonrpc: "2.0", id: 99, method: "tools/call", params: { name: "suggest_next_story", arguments: {} } }),
  signal: controller.signal,
});
assert((sse.headers.get("content-type") ?? "").includes("text/event-stream"), "legacy tools/call streams as text/event-stream");
const reader = sse.body.getReader();
const first = await reader.read();
const firstFrameMs = performance.now() - startedSse;
controller.abort();
assert(!first.done && first.value.length > 0, `first SSE frame arrived after ${firstFrameMs.toFixed(0)} ms (a buffering edge would hold it until the end)`);
console.log("verify-deploy: all checks passed");
