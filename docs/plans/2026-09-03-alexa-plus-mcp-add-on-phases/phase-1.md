# Phase 1 — MCP server core `[batch-eligible]`

`packages/mcp-server`. Dual-era MCP server with the three read-only tools, a fixture account provider, bearer verification stub, latency test. Runs locally with `pnpm -F mcp-server dev`. No AWS calls in this phase.

## Design-system note

Strictly non-visual: server package and tests. Zero rendered output.

## 1. Provider interface (`src/provider/types.ts`)

```ts
export type StorySummary = {
  id: string; title: string; storyteller: string;           // storyteller = sender display name or "A storyteller"
  durationSeconds?: number; deliveredAt: string;             // ISO; from downloadedAt
};
export type StoryAudio = { url: string; expiresAt: string; contentType: "audio/mpeg" };
export interface AccountProvider {
  listDeliveredStories(subject: string, limit: number): Promise<StorySummary[]>;
  getStory(subject: string, storyId: string): Promise<(StorySummary & { audio: StoryAudio }) | null>;
}
export class ProviderUnavailableError extends Error {}
```

Never present on this interface: recipient name, recipient id, space id, sender email, story content, Yoto fields. The type is the ADR 0013 boundary for this repository.

## 2. Fixture provider (`src/provider/fixtures.ts`, `fixtures/audio/*.mp3`, `fixtures/stories.json`)

Owner supplies three of his own delivered stories exported through Spoken Letter's MP3 download (manual step; the `downloaded` status is exactly what the product calls delivery). Each fixture entry: id, title, storyteller "Grandpa Juan" style display name chosen by the Owner, durationSeconds measured with `ffprobe`, deliveredAt. `fixtures/README.md` states the recordings are the author's own voice and are included under the MIT licence for demonstration.

`getStory` returns `audio.url` as `${PUBLIC_BASE_URL}/fixtures/audio/<id>.mp3` with `expiresAt` one hour ahead. Locally the Hono app serves `fixtures/audio` statically; in Phase 6 the files live in S3 behind CloudFront.

## 3. Tools (`src/tools/{list,get,suggest}.ts`, `src/tools/index.ts`)

```ts
export const TOOL_METADATA = [
  { name: "list_family_stories", title: "List delivered family stories",
    description: "Lists the stories a parent has already delivered to their child in Spoken Letter, newest first. Returns titles, who recorded them, and durations. Use it before playing a story.",
    inputSchema: z.object({ limit: z.number().int().min(1).max(20).optional().describe("How many stories to return, newest first (default 10)") }),
    outputSchema: z.object({ stories: z.array(storySummarySchema) }),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } },
  { name: "get_family_story", ... inputSchema: z.object({ storyId: z.string().min(1).max(64).describe("Story id from list_family_stories") }),
    outputSchema: storyWithAudioSchema },
  { name: "suggest_next_story", ... inputSchema: z.object({}), outputSchema: z.object({ story: storySummarySchema.nullable(), reason: z.string() }) },
] as const;
```

`src/tools/index.test.ts` runs `assertAgentToolMetadata` from `@spoken-letter-alexa/shared` on each entry and expects zero diagnostics.

Handler shape, all three:

```ts
registerTool(name, config, async (args, ctx) => {
  const subject = subjectFromAuth(ctx)                     // Phase 1: from a stub bearer; Phase 2: JWT sub
  const provider = providerFor(subject)                    // "demo" → FixtureProvider; else HttpProvider (Phase 4)
  try {
    const result = await withLatencyMetric(name, () => run(args, subject, provider))
    return { content: [text(summary), ...(result.audio ? [resourceLink(result.audio)] : [])], structuredContent: result }
  } catch (e) {
    if (e instanceof ProviderUnavailableError) return toolError("provider_unavailable", "Spoken Letter is not reachable right now. Try again in a moment.")
    ...
  }
})
```

`resourceLink` emits `{ type: "resource_link", uri: audio.url, name: title, mimeType: "audio/mpeg" }`. Text summaries stay under 300 characters so Alexa's spoken response is short. `suggest_next_story` keeps a per-subject in-memory ring of suggested ids (DynamoDB-backed in Phase 6 via the agent session table; acceptable to reset on cold start).

## 4. Handler and HTTP (`src/server.ts`, `src/http.ts`, `src/local.ts`, `src/lambda.ts`)

```ts
// server.ts
export const mcpHandler = createMcpHandler(() => {
  const server = new McpServer({ name: "spoken-letter", version: PKG_VERSION }, { capabilities: { tools: {} } });
  registerTools(server);
  return server;
}, { /* legacy omitted → 'stateless' (default). NEVER 'reject'. */ onerror: (e) => log.error("mcp_error", { message: e.message }) });

// http.ts (Hono)
app.use("/mcp", bearerGate)                                  // Phase 1: static dev token; Phase 2: requireBearerAuth with JWKS verifier
app.all("/mcp", (c) => mcpHandler(c.req.raw))
app.get("/.well-known/oauth-protected-resource", (c) => c.json(prm))   // Phase 1 placeholder issuer = PUBLIC_BASE_URL
app.get("/healthz", ...)
// lambda.ts: export const handler = streamHandle(app)      // hono/aws-lambda, RESPONSE_STREAM (Phase 6 wires the URL)
// local.ts: @hono/node-server on :4310
```

The unauthenticated response is exactly what Amazon's quickstart checks: `401` with `WWW-Authenticate: Bearer resource_metadata="https://<host>/.well-known/oauth-protected-resource"`.

## 5. Protocol tests (`src/protocol.test.ts`) — raw HTTP fixtures, no SDK client

- `initialize` with `protocolVersion: "2025-03-26"` (Alexa+ live client payload copied from the client-lifecycle page) → 200, response echoes `2025-03-26`, `serverInfo.name === "spoken-letter"`.
- `initialize` with `2025-06-18` and `2025-11-25` → 200, echoed.
- `tools/list` after a legacy initialize → three tools with `inputSchema` JSON Schema and annotations.
- `tools/call` for each tool with the fixture provider → `structuredContent` validates against the output schema; `get_family_story` includes a `resource_link`.
- Modern era: `server/discover` with `MCP-Protocol-Version: 2026-07-28`, `Mcp-Method`, `Mcp-Name` headers → 200 with the capability document. A modern `tools/call` succeeds.
- Legacy `GET /mcp` → 405 (documents the stateless choice; the Inspector risk is tracked in Phase 7).
- Missing bearer → 401 with the `WWW-Authenticate` header above.

## 6. Latency test (`src/latency.test.ts`)

Calls each tool 50 times through the handler with the fixture provider; asserts p95 < 250 ms and p99 < 400 ms (headroom under Amazon's 500 ms round trip; network is measured in Phase 6). Emits the distribution to stdout for the friction log.

## Success criteria

Automated: `pnpm -F mcp-server test` green (contract, protocol, latency); `pnpm typecheck && pnpm lint` green.

Manual: Owner exports three of his own stories and places them under `fixtures/audio/` with entries in `fixtures/stories.json`; `pnpm -F mcp-server dev` then `curl` of the three tools returns them.
