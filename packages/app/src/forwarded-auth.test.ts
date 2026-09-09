import { describe, expect, test, vi } from "vitest";

import { gateStreamingHandler, originVerified, rewriteForwardedAuthorization, type StreamingRuntime } from "./forwarded-auth.ts";

describe("gateStreamingHandler", () => {
  function fakeRuntime() {
    const written: { metadata?: { statusCode: number; headers: Record<string, string> }; chunks: string[]; ended: boolean } = { chunks: [], ended: false };
    const stream = { write: (chunk: string) => written.chunks.push(chunk), end: () => (written.ended = true) };
    let streamified = 0;
    const runtime: StreamingRuntime = {
      streamifyResponse: (handler) => {
        streamified += 1;
        return handler;
      },
      HttpResponseStream: {
        from: (target, metadata) => {
          written.metadata = metadata;
          return target;
        },
      },
    };
    return { runtime, stream, written, streamified: () => streamified };
  }

  test("a request without the shared header gets a 403 on the stream and never reaches the app", async () => {
    const { runtime, stream, written, streamified } = fakeRuntime();
    const inner = vi.fn(() => Promise.resolve());
    const handler = gateStreamingHandler(runtime, inner, "shared-value-not-real");
    await handler({ headers: { "x-origin-verify": "wrong" } }, stream, {});
    expect(streamified()).toBe(1);
    expect(written.metadata?.statusCode).toBe(403);
    expect(JSON.parse(written.chunks.join(""))).toMatchObject({ error: "forbidden" });
    expect(written.ended).toBe(true);
    expect(inner).not.toHaveBeenCalled();
  });

  test("a verified request reaches the app on the raw stream with the forwarded bearer restored", async () => {
    const { runtime, stream, written } = fakeRuntime();
    const inner = vi.fn(() => Promise.resolve());
    const handler = gateStreamingHandler(runtime, inner, "shared-value-not-real");
    const context = { awsRequestId: "r1" };
    await handler({ headers: { "x-origin-verify": "shared-value-not-real", "x-forwarded-authorization": "Bearer token-not-real" } }, stream, context);
    expect(written.metadata).toBeUndefined();
    expect(inner).toHaveBeenCalledTimes(1);
    const [event, passedStream, passedContext] = inner.mock.calls[0] as unknown as [{ headers: Record<string, string> }, unknown, unknown];
    expect(event.headers.authorization).toBe("Bearer token-not-real");
    expect(event.headers["x-forwarded-authorization"]).toBeUndefined();
    expect(passedStream).toBe(stream);
    expect(passedContext).toBe(context);
  });
});

describe("originVerified", () => {
  test("accepts only the exact shared value, case-insensitively on the header name", () => {
    expect(originVerified({ headers: { "x-origin-verify": "shared-value-not-real" } }, "shared-value-not-real")).toBe(true);
    expect(originVerified({ headers: { "X-Origin-Verify": "shared-value-not-real" } }, "shared-value-not-real")).toBe(true);
    expect(originVerified({ headers: { "x-origin-verify": "shared-value-not-reaL" } }, "shared-value-not-real")).toBe(false);
    expect(originVerified({ headers: { "x-origin-verify": "" } }, "shared-value-not-real")).toBe(false);
    expect(originVerified({ headers: {} }, "shared-value-not-real")).toBe(false);
    expect(originVerified({ headers: undefined }, "shared-value-not-real")).toBe(false);
  });
});

describe("rewriteForwardedAuthorization", () => {
  test("restores the viewer bearer over the OAC signature and drops the carrier header", () => {
    const event = {
      headers: {
        authorization: "AWS4-HMAC-SHA256 Credential=cloudfront-oac/...",
        "x-forwarded-authorization": "Bearer viewer-token-not-real",
        accept: "application/json",
      },
      rawPath: "/mcp",
    };
    const rewritten = rewriteForwardedAuthorization(event);
    expect(rewritten.headers).toEqual({ authorization: "Bearer viewer-token-not-real", accept: "application/json" });
    expect(rewritten.rawPath).toBe("/mcp");
    // The original event is not mutated.
    expect(event.headers["x-forwarded-authorization"]).toBe("Bearer viewer-token-not-real");
  });

  test("is case-insensitive on header names", () => {
    const rewritten = rewriteForwardedAuthorization({ headers: { Authorization: "AWS4-HMAC-SHA256 ...", "X-Forwarded-Authorization": "Bearer t" } });
    expect(rewritten.headers).toEqual({ authorization: "Bearer t" });
  });

  test("leaves events without the forwarded header alone", () => {
    const direct = { headers: { authorization: "Bearer direct" } };
    expect(rewriteForwardedAuthorization(direct)).toBe(direct);
    const bare = { headers: undefined };
    expect(rewriteForwardedAuthorization(bare)).toBe(bare);
    const empty = { headers: { "x-forwarded-authorization": "" , authorization: "Bearer keep" } };
    expect(rewriteForwardedAuthorization(empty).headers).toEqual(empty.headers);
  });
});
