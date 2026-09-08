import { useEffect, useState } from "react";
import { Eyebrow } from "../brand/Eyebrow.tsx";
import { Wordmark } from "../brand/Wordmark.tsx";
import { clearPending, readPending, redirectUriFor } from "../oauth/connect.ts";
import { exchangeCode } from "../oauth/pkce.ts";

type Props = {
  origin: string;
  /** `location.search` of the redirect: `?code&state` or `?error&error_description`. */
  search: string;
  fetchImpl?: typeof fetch;
  onLinked: (accessToken: string) => void;
  onCancel: () => void;
};

/** `/demo/callback`: finishes the authorization-code exchange; tokens stay in memory. */
export function Callback({ origin, search, fetchImpl, onLinked, onCancel }: Props) {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(search);
    const failure = params.get("error");
    if (failure) {
      clearPending();
      setError(params.get("error_description") ?? `The authorization server answered ${failure}.`);
      return;
    }
    const code = params.get("code");
    const state = params.get("state");
    const pending = readPending();
    if (!code || !state || !pending) {
      clearPending();
      setError("This link is missing its authorization code or state. Start again from the demo.");
      return;
    }
    if (state !== pending.state) {
      clearPending();
      setError("The state of this link does not match the flow you started. Start again from the demo.");
      return;
    }
    let cancelled = false;
    exchangeCode({ origin, code, verifier: pending.verifier, redirectUri: redirectUriFor(origin), ...(fetchImpl ? { fetchImpl } : {}) })
      .then((tokens) => {
        clearPending();
        if (!cancelled) onLinked(tokens.access_token);
      })
      .catch((cause: unknown) => {
        clearPending();
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Token exchange failed.");
      });
    return () => {
      cancelled = true;
    };
  }, [origin, search, fetchImpl, onLinked]);

  return (
    <main className="page">
      <header className="topbar">
        <Wordmark />
      </header>
      <section className="card callback">
        <Eyebrow>Connect my Spoken Letter</Eyebrow>
        <h1 className="headline headline-section">
          {error ? (
            <>
              The link did not <span className="accent">finish.</span>
            </>
          ) : (
            <>
              Finishing the <span className="accent">link.</span>
            </>
          )}
        </h1>
        {error ? (
          <>
            <p className="alert" role="alert">
              {error}
            </p>
            <p>
              <button type="button" className="pill pill-secondary" onClick={onCancel}>
                Back to the demo
              </button>
            </p>
          </>
        ) : (
          <p className="lead">Exchanging the authorization code for a token. One moment.</p>
        )}
      </section>
    </main>
  );
}
