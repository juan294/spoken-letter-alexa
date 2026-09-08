// The redirect hop of "Connect my Spoken Letter". The verifier and state live in
// sessionStorage only for the hop; tokens are never stored anywhere but memory.
import { buildAuthorizeUrl, challengeFor, generateVerifier, randomState } from "./pkce.ts";

export const PENDING_KEY = "sla:pkce";

export type PendingFlow = { verifier: string; state: string };

export function redirectUriFor(origin: string): string {
  return `${origin}/demo/callback`;
}

export async function beginConnect(origin: string, navigate: (url: string) => void): Promise<void> {
  const pending: PendingFlow = { verifier: generateVerifier(), state: randomState() };
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  const challenge = await challengeFor(pending.verifier);
  navigate(buildAuthorizeUrl({ origin, redirectUri: redirectUriFor(origin), challenge, state: pending.state }));
}

export function readPending(): PendingFlow | null {
  const raw = sessionStorage.getItem(PENDING_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PendingFlow>;
    return typeof parsed.verifier === "string" && typeof parsed.state === "string"
      ? { verifier: parsed.verifier, state: parsed.state }
      : null;
  } catch {
    return null;
  }
}

export function clearPending(): void {
  sessionStorage.removeItem(PENDING_KEY);
}
