// Raw HTTP fixtures against the Hono app. No SDK client: the point is to pin the wire
// shapes Alexa+ (legacy, 2025-03-26), the Local Inspector (2025-06-18) and a modern
// 2026-07-28 client send, and what this server answers.
import { describe, expect, test } from "vitest";
import { z } from "zod";

import { ProviderUnavailableError, type AccountProvider } from "./provider/types.ts";
import {
  LEGACY_INITIALIZE,
  TEST_BASE_URL,
  TEST_DEV_TOKEN,
  legacyCall,
  mcpPost,
  modernCall,
  readJsonRpc,
  testApp,
} from "./test-support.ts";
import { storySummarySchema, storyWithAudioSchema } from "./tools/schemas.ts";

const app = testApp();

describe("legacy era (Alexa+ live client and Local Inspector)", () => {
  test.each(["2025-03-26", "2025-06-18", "2025-11-25"])("initialize at %s is echoed", async (version) => {
    const response = await mcpPost(app, LEGACY_INITIALIZE(version));
    expect(response.status).toBe(200);
    const [message] = await readJsonRpc(response);
    expect(message?.result).toMatchObject({
      protocolVersion: version,
      serverInfo: { name: "spoken-letter" },
      capabilities: { tools: expect.any(Object) as object },
    });
  });

  test("tools/list after a legacy initialize lists the three tools with JSON Schema and annotations", async () => {
    await mcpPost(app, LEGACY_INITIALIZE("2025-03-26"));
    const message = await legacyCall(app, "tools/list");
    const tools = (message.result as { tools: Record<string, unknown>[] }).tools;
    expect(tools.map((tool) => tool.name)).toEqual(["list_family_stories", "get_family_story", "suggest_next_story"]);
    for (const tool of tools) {
      expect(tool.inputSchema).toMatchObject({ type: "object" });
      expect(tool.outputSchema).toMatchObject({ type: "object" });
      expect(tool.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
      expect(typeof tool.description).toBe("string");
    }
  });

  test("tools/call list_family_stories returns structured content matching the output schema", async () => {
    const message = await legacyCall(app, "tools/call", { name: "list_family_stories", arguments: { limit: 2 } });
    const result = message.result as { structuredContent: unknown; content: { type: string; text?: string }[] };
    const parsed = z.object({ stories: z.array(storySummarySchema) }).parse(result.structuredContent);
    expect(parsed.stories).toHaveLength(2);
    expect(parsed.stories[0]?.id).toBe("st_lighthouse");
    expect(result.content[0]).toMatchObject({ type: "text" });
    // The structured result is also serialised as the last text block (MCP backwards
    // compatibility; agent frameworks that map only `content` still see the ids).
    const last = result.content.at(-1);
    expect(last?.type).toBe("text");
    expect(JSON.parse(last?.text ?? "")).toEqual(result.structuredContent);
    expect(JSON.stringify(result.structuredContent)).not.toMatch(/recipient|spaceId|senderId|senderEmail|content|yoto/i);
  });

  test("tools/call get_family_story includes a resource_link to the MP3", async () => {
    const message = await legacyCall(app, "tools/call", { name: "get_family_story", arguments: { storyId: "st_owl" } });
    const result = message.result as { structuredContent: unknown; content: Record<string, unknown>[] };
    const parsed = storyWithAudioSchema.parse(result.structuredContent);
    expect(parsed.audio.url).toBe(`${TEST_BASE_URL}/fixtures/audio/st_owl.mp3`);
    expect(result.content).toContainEqual({
      type: "resource_link",
      uri: `${TEST_BASE_URL}/fixtures/audio/st_owl.mp3`,
      name: "The owl who forgot how to hoot",
      mimeType: "audio/mpeg",
    });
    const last = result.content.at(-1) as { type: string; text?: string } | undefined;
    expect(last?.type).toBe("text");
    expect(JSON.parse(last?.text ?? "")).toEqual(result.structuredContent);
  });

  test("tools/call suggest_next_story returns a story and a reason", async () => {
    const message = await legacyCall(app, "tools/call", { name: "suggest_next_story", arguments: {} });
    const result = message.result as { structuredContent: unknown };
    const parsed = z.object({ story: storySummarySchema.nullable(), reason: z.string() }).parse(result.structuredContent);
    expect(parsed.story?.id).toBe("st_bread");
    const blocks = (message.result as { content: { type: string; text?: string }[] }).content;
    expect(JSON.parse(blocks.at(-1)?.text ?? "")).toEqual(result.structuredContent);
  });

  test("unknown story id is a tool error with the story_not_found class", async () => {
    const message = await legacyCall(app, "tools/call", { name: "get_family_story", arguments: { storyId: "nope" } });
    const result = message.result as { isError?: boolean; content: { type: string; text: string }[]; structuredContent?: unknown };
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/couldn't find/i);
    expect(result.structuredContent).toMatchObject({ error: "story_not_found" });
    expect(JSON.parse(result.content.at(-1)?.text ?? "")).toEqual(result.structuredContent);
  });

  test("a provider outage is a provider_unavailable tool error, not a protocol error", async () => {
    const failing: AccountProvider = {
      listDeliveredStories: () => Promise.reject(new ProviderUnavailableError("bridge 503")),
      getStory: () => Promise.reject(new ProviderUnavailableError("bridge 503")),
    };
    const outage = testApp({ providerFor: () => failing });
    const message = await legacyCall(outage, "tools/call", { name: "list_family_stories", arguments: {} });
    const result = message.result as { isError?: boolean; content: { text: string }[]; structuredContent?: unknown };
    expect(message.error).toBeUndefined();
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ error: "provider_unavailable" });
    expect(result.content[0]?.text).toMatch(/not reachable/i);
  });

  test("an unexpected provider failure never leaks its message to the client", async () => {
    const exploding: AccountProvider = {
      listDeliveredStories: () => Promise.reject(new Error("db exploded at https://internal.example?token=abc")),
      getStory: () => Promise.reject(new Error("db exploded")),
    };
    const broken = testApp({ providerFor: () => exploding });
    const message = await legacyCall(broken, "tools/call", { name: "list_family_stories", arguments: {} });
    const result = message.result as { isError?: boolean; content: { text: string }[]; structuredContent?: unknown };
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/exploded|internal\.example|token=abc/);
    expect(result.structuredContent).toMatchObject({ error: "provider_unavailable" });
  });

  test("a token without a subject is an unauthenticated tool error", async () => {
    const noSubject = testApp({
      bearerGate: () =>
        Promise.resolve({ token: "t", clientId: "x", scopes: ["mcp:tools"], expiresAt: Math.floor(Date.now() / 1000) + 60 }),
    });
    const message = await legacyCall(noSubject, "tools/call", { name: "list_family_stories", arguments: {} });
    const result = message.result as { isError?: boolean; structuredContent?: unknown };
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ error: "unauthenticated" });
  });

  test("legacy GET /mcp is 405 (stateless serving, no session stream)", async () => {
    const response = await app.request("/mcp", {
      method: "GET",
      headers: { accept: "text/event-stream", authorization: `Bearer ${TEST_DEV_TOKEN}` },
    });
    expect(response.status).toBe(405);
  });
});

describe("modern era (2026-07-28)", () => {
  test("server/discover returns the capability document", async () => {
    const { response, message } = await modernCall(app, "server/discover");
    expect(response.status).toBe(200);
    expect(message.result).toMatchObject({
      supportedVersions: ["2026-07-28"],
      capabilities: { tools: expect.any(Object) as object },
      resultType: "complete",
    });
  });

  test("a modern tools/call succeeds with the same structured content", async () => {
    const { message } = await modernCall(app, "tools/call", { name: "list_family_stories", arguments: {} });
    const result = message.result as { structuredContent: unknown; resultType: string };
    expect(result.resultType).toBe("complete");
    expect(z.object({ stories: z.array(storySummarySchema) }).parse(result.structuredContent).stories).toHaveLength(3);
  });
});

describe("bearer gate and discovery", () => {
  test("missing bearer is 401 with the RFC 9728 WWW-Authenticate challenge", async () => {
    const response = await mcpPost(app, LEGACY_INITIALIZE("2025-03-26"), { token: null });
    expect(response.status).toBe(401);
    // RFC 9728 section 5.1: the Bearer challenge advertises resource_metadata. The SDK
    // also emits the RFC 6750 error parameters, which Amazon's quickstart tolerates.
    const challenge = response.headers.get("www-authenticate") ?? "";
    expect(challenge.startsWith("Bearer ")).toBe(true);
    expect(challenge).toContain(`resource_metadata="${TEST_BASE_URL}/.well-known/oauth-protected-resource"`);
    expect(challenge).toContain('error="invalid_token"');
  });

  test("wrong bearer is 401", async () => {
    const response = await mcpPost(app, LEGACY_INITIALIZE("2025-03-26"), { token: "nope" });
    expect(response.status).toBe(401);
  });

  test("protected resource metadata points at this host", async () => {
    const response = await app.request("/.well-known/oauth-protected-resource");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      resource: `${TEST_BASE_URL}/mcp`,
      authorization_servers: [TEST_BASE_URL],
      bearer_methods_supported: ["header"],
      scopes_supported: ["mcp:tools", "mcp:resources"],
    });
  });

  test("healthz answers", async () => {
    const response = await app.request("/healthz");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
  });
});
