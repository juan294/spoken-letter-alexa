import { constantTimeEqual } from "@spoken-letter-alexa/shared";

/**
 * CloudFront's viewer-request function (EdgeStack) copies the viewer's `Authorization`
 * into `x-forwarded-authorization` and adds `x-origin-verify` from `sla/origin-verify`;
 * these helpers read both from the Lambda event before Hono sees the request. A request
 * that reaches the function URL without the forwarded header keeps whatever
 * `authorization` it carries (local tests).
 */
export const FORWARDED_AUTHORIZATION_HEADER = "x-forwarded-authorization";
export const ORIGIN_VERIFY_HEADER = "x-origin-verify";

export type HeaderedEvent = { headers?: Record<string, string | undefined> | undefined };

/** Case-insensitive header read (function URL events lowercase names; tests may not). */
function headerValue(headers: Record<string, string | undefined>, name: string): string | undefined {
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name);
  return key === undefined ? undefined : headers[key];
}

/**
 * The function URL is public (D18); only requests carrying the `x-origin-verify` value
 * CloudFront adds from `sla/origin-verify` are served. Compared in constant time.
 */
export function originVerified(event: HeaderedEvent, expected: string): boolean {
  const value = headerValue(event.headers ?? {}, ORIGIN_VERIFY_HEADER);
  return typeof value === "string" && value.length > 0 && constantTimeEqual(value, expected);
}

export function rewriteForwardedAuthorization<T extends HeaderedEvent>(event: T): T {
  const headers = event.headers;
  if (!headers) return event;
  const value = headerValue(headers, FORWARDED_AUTHORIZATION_HEADER);
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

export type ResponseStreamLike = { write(chunk: string): unknown; end(): unknown };
export type StreamingHandler<E> = (event: E, responseStream: ResponseStreamLike, context: unknown) => Promise<void>;
/** The `awslambda` global of the Node.js Lambda runtime (response streaming). */
export type StreamingRuntime = {
  streamifyResponse<E>(handler: StreamingHandler<E>): StreamingHandler<E>;
  HttpResponseStream: {
    from(stream: ResponseStreamLike, metadata: { statusCode: number; headers: Record<string, string> }): ResponseStreamLike;
  };
};

/**
 * Wraps Hono's streaming handler for the function URL. Node.js 24 on Lambda rejects any
 * plain three-parameter (callback-style) handler, and a streamified handler receives
 * `(event, responseStream, context)`, so the origin gate must itself be streamified: a
 * request without CloudFront's `x-origin-verify` value gets a 403 written to the stream;
 * every other request reaches Hono with the forwarded bearer restored.
 */
export function gateStreamingHandler<E extends HeaderedEvent>(runtime: StreamingRuntime, inner: StreamingHandler<E>, expected: string): StreamingHandler<E> {
  return runtime.streamifyResponse<E>(async (event, responseStream, context) => {
    if (!originVerified(event, expected)) {
      const out = runtime.HttpResponseStream.from(responseStream, {
        statusCode: 403,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      });
      out.write(JSON.stringify({ error: "forbidden", message: "Requests must come through alexa.spokenletter.com" }));
      out.end();
      return;
    }
    await inner(rewriteForwardedAuthorization(event), responseStream, context);
  });
}
