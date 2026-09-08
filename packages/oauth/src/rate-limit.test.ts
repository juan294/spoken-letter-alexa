import { describe, expect, test } from "vitest";

import { TokenBucket } from "./rate-limit.ts";

describe("TokenBucket", () => {
  test("allows `limit` requests per window per key and refills over time", () => {
    let now = 0;
    const bucket = new TokenBucket({ limit: 3, windowMs: 60_000, now: () => now });
    expect(bucket.take("ip-a")).toBe(true);
    expect(bucket.take("ip-a")).toBe(true);
    expect(bucket.take("ip-a")).toBe(true);
    expect(bucket.take("ip-a")).toBe(false);
    expect(bucket.take("ip-b")).toBe(true);
    now = 20_000; // one third of the window refills one token
    expect(bucket.take("ip-a")).toBe(true);
    expect(bucket.take("ip-a")).toBe(false);
    now = 120_000;
    expect(bucket.take("ip-a")).toBe(true);
  });

  test("forgets idle keys so memory stays bounded", () => {
    let now = 0;
    const bucket = new TokenBucket({ limit: 1, windowMs: 1_000, now: () => now, maxKeys: 2 });
    bucket.take("a");
    bucket.take("b");
    bucket.take("c");
    expect(bucket.size).toBeLessThanOrEqual(2);
    now = 5_000;
    bucket.sweep();
    expect(bucket.size).toBe(0);
  });
});
