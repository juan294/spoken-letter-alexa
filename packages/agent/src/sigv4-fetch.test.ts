import { describe, expect, test, vi } from "vitest";

import { createSigV4Fetch } from "./sigv4-fetch.ts";

const CREDENTIALS = { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" };

describe("createSigV4Fetch", () => {
  test("signs a POST for bedrock-agentcore in the region and keeps the body and MCP headers", async () => {
    const inner = vi.fn<typeof fetch>(() => Promise.resolve(new Response("{}", { status: 200 })));
    const signedFetch = createSigV4Fetch({ region: "us-east-1", credentials: CREDENTIALS, fetch: inner });
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    await signedFetch("https://gw.example.bedrock-agentcore.us-east-1.amazonaws.com/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-11-25" },
      body,
    });
    expect(inner).toHaveBeenCalledTimes(1);
    const [url, init] = inner.mock.calls[0]!;
    expect(url).toBe("https://gw.example.bedrock-agentcore.us-east-1.amazonaws.com/mcp");
    const headers = new Headers(init?.headers);
    const authorization = headers.get("authorization") ?? "";
    expect(authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE\/\d{8}\/us-east-1\/bedrock-agentcore\/aws4_request/);
    expect(authorization).toMatch(/SignedHeaders=[^,]*content-type[^,]*host[^,]*x-amz-date/);
    expect(headers.get("x-amz-date")).toMatch(/^\d{8}T\d{6}Z$/);
    expect(headers.get("x-amz-content-sha256")).toMatch(/^[0-9a-f]{64}$/);
    expect(headers.get("mcp-protocol-version")).toBe("2025-11-25");
    expect(init?.body).toBe(body);
    expect(init?.method).toBe("POST");
  });

  test("accepts a credential provider and signs GETs without a body", async () => {
    const inner = vi.fn<typeof fetch>(() => Promise.resolve(new Response("", { status: 405 })));
    const provider = vi.fn(() => Promise.resolve(CREDENTIALS));
    const signedFetch = createSigV4Fetch({ region: "us-east-1", credentials: provider, fetch: inner });
    const response = await signedFetch("https://gw.example/mcp", { method: "GET" });
    expect(response.status).toBe(405);
    expect(provider).toHaveBeenCalled();
    const headers = new Headers(inner.mock.calls[0]![1]?.headers);
    expect(headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256/);
    expect(inner.mock.calls[0]![1]?.body).toBeUndefined();
  });
});
