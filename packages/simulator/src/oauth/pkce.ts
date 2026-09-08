// PKCE (RFC 7636) for the public `simulator` client, WebCrypto only.

export const CLIENT_ID = "simulator";
export const SCOPE = "mcp:tools mcp:resources";

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** 32 random bytes, base64url: 43 characters. */
export function generateVerifier(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

export function randomState(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(16)));
}

/** S256: base64url(sha256(ascii(verifier))). */
export async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

export function buildAuthorizeUrl(input: { origin: string; redirectUri: string; challenge: string; state: string }): string {
  const url = new URL("/oauth/authorize", input.origin);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: input.redirectUri,
    code_challenge: input.challenge,
    code_challenge_method: "S256",
    state: input.state,
    scope: SCOPE,
  }).toString();
  return url.toString();
}

export type TokenResponse = {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
};

export async function exchangeCode(input: {
  origin: string;
  code: string;
  verifier: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
}): Promise<TokenResponse> {
  const fetchImpl = input.fetchImpl ?? ((request, init) => fetch(request, init));
  const response = await fetchImpl(`${input.origin}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      code_verifier: input.verifier,
      redirect_uri: input.redirectUri,
      client_id: CLIENT_ID,
    }).toString(),
  });
  const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || !json || typeof json.access_token !== "string") {
    const description = json && typeof json.error_description === "string" ? json.error_description : null;
    const code = json && typeof json.error === "string" ? json.error : `HTTP ${response.status}`;
    throw new Error(description ?? `Token exchange failed (${code})`);
  }
  return json as TokenResponse;
}
