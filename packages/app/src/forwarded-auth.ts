/**
 * CloudFront signs origin requests to the function URL with an origin access control,
 * which replaces the viewer's `Authorization` header. A CloudFront Function (EdgeStack)
 * copies the viewer's value into `x-forwarded-authorization`; this restores it on the
 * Lambda event before Hono sees the request. A request that reaches the function URL
 * without the forwarded header keeps whatever `authorization` it carries (direct IAM
 * callers, local tests).
 */
export const FORWARDED_AUTHORIZATION_HEADER = "x-forwarded-authorization";
export const ORIGIN_VERIFY_HEADER = "x-origin-verify";

/**
 * The function URL is public (D18); only requests carrying the `x-origin-verify` value
 * CloudFront adds from `sla/origin-verify` are served. Compared in constant time.
 */
export function originVerified(event: HeaderedEvent, expected: string): boolean {
  const headers = event.headers ?? {};
  const key = Object.keys(headers).find((name) => name.toLowerCase() === ORIGIN_VERIFY_HEADER);
  const value = key === undefined ? undefined : headers[key];
  return typeof value === "string" && value.length > 0 && constantTimeEqual(value, expected);
}

import { constantTimeEqual } from "@spoken-letter-alexa/shared";

export type HeaderedEvent = { headers?: Record<string, string | undefined> | undefined };

export function rewriteForwardedAuthorization<T extends HeaderedEvent>(event: T): T {
  const headers = event.headers;
  if (!headers) return event;
  const forwardedKey = Object.keys(headers).find((key) => key.toLowerCase() === FORWARDED_AUTHORIZATION_HEADER);
  if (forwardedKey === undefined) return event;
  const value = headers[forwardedKey];
  if (!value) return event;
  const rewritten: Record<string, string | undefined> = {};
  for (const [key, header] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (lower === "authorization" || lower === FORWARDED_AUTHORIZATION_HEADER) continue;
    rewritten[key] = header;
  }
  rewritten.authorization = value;
  return { ...event, headers: rewritten };
}
