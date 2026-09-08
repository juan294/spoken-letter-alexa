import { useCallback, useMemo, useState } from "react";
import type { AgentTransport } from "./agent/types.ts";
import { Eyebrow } from "./brand/Eyebrow.tsx";
import { Wordmark } from "./brand/Wordmark.tsx";
import { Keyboard } from "./components/Keyboard.tsx";
import { NowPlaying } from "./components/NowPlaying.tsx";
import { PushToTalk } from "./components/PushToTalk.tsx";
import { UnderTheHood } from "./components/UnderTheHood.tsx";
import { beginConnect } from "./oauth/connect.ts";
import { Callback } from "./pages/Callback.tsx";
import { useAlexa } from "./state/useAlexa.ts";

export const SAMPLE_UTTERANCE = "Alexa, play the story Grandpa sent";

/** `replace` swaps the address without a reload (after the callback); default is a real navigation. */
export type Navigate = (url: string, mode?: "replace") => void;

const defaultNavigate: Navigate = (url, mode) => {
  if (mode === "replace") history.replaceState(null, "", url);
  else location.assign(url);
};

type Props = {
  transport: AgentTransport;
  origin?: string;
  path?: string;
  search?: string;
  navigate?: Navigate;
  fetchImpl?: typeof fetch;
};

export function App({
  transport,
  origin = location.origin,
  path = location.pathname,
  search = location.search,
  navigate = defaultNavigate,
  fetchImpl,
}: Props) {
  const [route, setRoute] = useState<"main" | "callback">(path.replace(/\/$/, "").endsWith("/demo/callback") ? "callback" : "main");
  // Tokens live here and nowhere else (never localStorage).
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const { state, dispatch, send, sendAudio } = useAlexa(transport, accessToken);

  const onLinked = useCallback(
    (token: string) => {
      setAccessToken(token);
      setRoute("main");
      navigate("/demo/", "replace");
    },
    [navigate],
  );
  const onCancel = useCallback(() => {
    setRoute("main");
    navigate("/demo/", "replace");
  }, [navigate]);

  const busy = state.status === "thinking" || state.status === "replying";
  const modeLabel = useMemo(() => (accessToken ? "Connected" : "Demo mode"), [accessToken]);

  if (route === "callback") {
    return <Callback origin={origin} search={search} {...(fetchImpl ? { fetchImpl } : {})} onLinked={onLinked} onCancel={onCancel} />;
  }

  return (
    <main className="page">
      <header className="topbar">
        <Wordmark />
        <div className="topbar-actions">
          {state.session ? <span className="mode-chip" data-testid="mode-chip">{modeLabel}</span> : null}
          {accessToken ? (
            <button type="button" className="pill pill-ghost" onClick={() => { setAccessToken(null); }}>
              Disconnect
            </button>
          ) : (
            <button type="button" className="pill pill-secondary" onClick={() => void beginConnect(origin, navigate)}>
              Connect my Spoken Letter
            </button>
          )}
        </div>
      </header>

      <section className="hero">
        <Eyebrow>Simulated Alexa+ client</Eyebrow>
        <h1 className="headline headline-display">
          Ask for the story <span className="accent">Grandpa sent.</span>
        </h1>
        <p className="lead">
          A parent asks; Alexa+ finds the story the family delivered through the Spoken Letter MCP add-on and plays it in the
          storyteller's own voice.
        </p>
        <p className="notice" data-testid="simulation-notice">
          This is a simulation of an Alexa+ device: press the Alexa button to talk (push-to-talk, no wake word), or type what you
          would say. In demo mode it plays the Owner's recorded sample; connect your Spoken Letter to hear a story you delivered.
        </p>
      </section>

      <div className="stage">
        <section className="card on-cream" aria-label="The device">
          <div className="device-head">
            <div>
              <Eyebrow>The device</Eyebrow>
              <h2 className="headline headline-section">
                Talk to <span className="accent">Alexa</span>
              </h2>
            </div>
          </div>
          <div className="device-stage">
            <PushToTalk
              listening={state.status === "listening"}
              busy={busy}
              onStart={() => { dispatch({ type: "listen" }); }}
              onCancel={(message) => { dispatch({ type: "turn-fail", message }); }}
              onUtterance={(audio) => void sendAudio(audio)}
            />
            <Keyboard busy={busy} onSend={(text) => void send(text)} />
          </div>
          {state.error ? (
            <p className="alert" role="alert">
              {state.error}
            </p>
          ) : null}
          {state.exchange ? (
            <div className="transcript" aria-label="Transcript">
              <div className="transcript-row">
                <span className="who">You</span>
                <p>{state.exchange.you}</p>
              </div>
              <div className="transcript-row alexa">
                <span className="who">Alexa</span>
                <p>{state.exchange.alexa}</p>
              </div>
            </div>
          ) : null}
        </section>

        <NowPlaying
          status={state.status}
          play={state.play}
          playKey={state.playKey}
          speechUrl={state.status === "replying" ? state.speechUrl : null}
          sampleUtterance={SAMPLE_UTTERANCE}
          onReplyEnded={() => { dispatch({ type: "reply-ended" }); }}
          onPause={() => { dispatch({ type: "pause" }); }}
          onResume={() => { dispatch({ type: "resume" }); }}
          onStoryEnded={() => { dispatch({ type: "story-ended" }); }}
        />
      </div>

      <UnderTheHood toolCalls={state.toolCalls} />
    </main>
  );
}
