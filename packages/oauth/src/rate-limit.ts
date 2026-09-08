type Bucket = { tokens: number; updatedAt: number };

/**
 * In-memory token bucket per key (client IP). One instance per process; Phase 6 adds a
 * CloudFront rate rule in front of it. Bounded: idle keys are swept and the map is capped.
 */
export class TokenBucket {
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly maxKeys: number;
  private readonly buckets = new Map<string, Bucket>();

  constructor(options: { limit: number; windowMs: number; now?: () => number; maxKeys?: number }) {
    this.limit = options.limit;
    this.windowMs = options.windowMs;
    this.now = options.now ?? Date.now;
    this.maxKeys = options.maxKeys ?? 10_000;
  }

  get size(): number {
    return this.buckets.size;
  }

  take(key: string): boolean {
    const now = this.now();
    let bucket = this.buckets.get(key);
    if (!bucket) {
      if (this.buckets.size >= this.maxKeys) this.sweep();
      if (this.buckets.size >= this.maxKeys) {
        const oldest = this.buckets.keys().next().value;
        if (oldest !== undefined) this.buckets.delete(oldest);
      }
      bucket = { tokens: this.limit, updatedAt: now };
      this.buckets.set(key, bucket);
    } else {
      const refill = ((now - bucket.updatedAt) / this.windowMs) * this.limit;
      bucket.tokens = Math.min(this.limit, bucket.tokens + refill);
      bucket.updatedAt = now;
    }
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }

  /** Drops buckets that have been idle for a full window (they would be full anyway). */
  sweep(): void {
    const now = this.now();
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.updatedAt >= this.windowMs) this.buckets.delete(key);
    }
  }
}
