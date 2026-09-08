import { useEffect, useRef, useState } from "react";
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
  // The one outcome of this page load. React StrictMode runs the effect twice in
  // development; the pending PKCE flow is consumed synchronously on the first run and
  // the second run only re-attaches to this promise, so the code is exchanged once. A
  // second exchange would be refused by the server and revoke the family's link.
  const outcome = useRef<Promise<string> | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!outcome.current) {
      const params = new URLSearchParams(search);
      const failure = params.get("error");
      const code = params.get("code");
      const state = params.get("state");
      const pending = readPending();
      clearPending();
      if (failure) {
        outcome.current = Promise.reject(new Error(params.get("error_description") ?? `The authorization server answered ${failure}.`));
      } else if (!code || !state || !pending) {
        outcome.current = Promise.reject(new Error("This link is missing its authorization code or state. Start again from the demo."));
      } else if (state !== pending.state) {
        outcome.current = Promise.reject(new Error("The state of this link does not match the flow you started. Start again from the demo."));
      } else {
        outcome.current = exchangeCode({
          origin,
          code,
          verifier: pending.verifier,
          redirectUri: redirectUriFor(origin),
          ...(fetchImpl ? { fetchImpl } : {}),
        }).then((tokens) => tokens.access_token);
      }
    }
    outcome.current
      .then((token) => {
        if (!cancelled) onLinked(token);
      })
      .catch((cause: unknown) => {
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
