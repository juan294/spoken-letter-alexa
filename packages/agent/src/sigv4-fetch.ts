import { Sha256 } from "@aws-crypto/sha256-js";
import { HttpRequest } from "@smithy/protocol-http";
import { SignatureV4 } from "@smithy/signature-v4";
import { type AwsCredentialIdentity, type AwsCredentialIdentityProvider } from "@smithy/types";

/**
 * A `fetch` that signs every request with SigV4 for the AgentCore Gateway (inbound IAM
 * auth). The gateway path serves the demo subject only: outbound auth is the fixed
 * `alexa-m2m` client. Used by `packages/app` when `MCP_URL` is not this server's own
 * `/mcp`.
 */
export function createSigV4Fetch(options: {
  region: string;
  credentials: AwsCredentialIdentity | AwsCredentialIdentityProvider;
  service?: string;
  fetch?: typeof fetch;
}): typeof fetch {
  const signer = new SignatureV4({
    service: options.service ?? "bedrock-agentcore",
    region: options.region,
    credentials: options.credentials,
    sha256: Sha256,
  });
  const base = options.fetch ?? fetch;
  return async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.text();
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      // Hop-by-hop and framework-managed headers are not part of the signature.
      if (["host", "content-length", "connection"].includes(key)) return;
      headers[key] = value;
    });
    headers.host = url.host;
    const signed = await signer.sign(
      new HttpRequest({
        method: request.method,
        protocol: url.protocol,
        hostname: url.hostname,
        ...(url.port && { port: Number(url.port) }),
        path: url.pathname,
        query: Object.fromEntries(url.searchParams.entries()),
        headers,
        ...(body !== undefined && { body }),
      }),
    );
    const outHeaders = new Headers();
    for (const [key, value] of Object.entries(signed.headers)) if (key !== "host") outHeaders.set(key, value);
    return base(request.url, { method: request.method, headers: outHeaders, signal: request.signal, ...(body !== undefined && { body }) });
  };
}
