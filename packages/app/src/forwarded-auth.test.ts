import { describe, expect, test } from "vitest";

import { originVerified, rewriteForwardedAuthorization } from "./forwarded-auth.ts";

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
