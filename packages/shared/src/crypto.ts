import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Constant-time string comparison; unequal lengths still burn a comparison. */
export function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function sha256Base64Url(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("base64url");
}

export function hmacSha256Hex(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value, "utf8").digest("hex");
}

/** `bytes` random bytes as base64url (no padding). */
export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}
