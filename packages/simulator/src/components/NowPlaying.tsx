import { useEffect, useRef, useState } from "react";
import type { Play } from "../agent/types.ts";
import { BrandMark } from "../brand/BrandMark.tsx";
import { Eyebrow } from "../brand/Eyebrow.tsx";
import { MoonPixels } from "../brand/MoonPixels.tsx";
import { formatClock } from "../lib/format.ts";
import type { Status } from "../state/alexa.ts";
import { StatusChip } from "./StatusChip.tsx";

type Props = {
  status: Status;
  play: Play | null;
  /** Remounts the audio element for every story reply. */
  playKey: number;
  speechUrl: string | null;
  sampleUtterance: string;
  onReplyEnded: () => void;
  onPause: () => void;
  onResume: () => void;
  onStoryEnded: () => void;
};

/**
 * The ink "Now Playing" panel (Applications export, phone 3): amber arc with a radial
 * glow, serif cream title, storyteller, progress bar, pause and resume. The idle screen
 * shows the pixel moon and the sample utterance.
 */
export function NowPlaying({ status, play, playKey, speechUrl, sampleUtterance, onReplyEnded, onPause, onResume, onStoryEnded }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [position, setPosition] = useState(0);
  const [mediaDuration, setMediaDuration] = useState<number | null>(null);

  const active = status === "playing" || status === "paused";
  const duration = play?.durationSeconds ?? mediaDuration;

  // Drive the element from the state machine, never the other way round: it plays only
  // while the status is "playing", so a new turn (listening, thinking, replying) pauses it.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (status === "playing") void audio.play().catch(() => undefined);
    else audio.pause();
  }, [status, playKey]);

  useEffect(() => {
    setPosition(0);
    setMediaDuration(null);
  }, [playKey]);

  const progress = duration && duration > 0 ? Math.min(100, Math.round((position / duration) * 100)) : 0;

  return (
    <section className="ink-panel on-ink" data-testid="now-playing" aria-label="Now playing">
      <div className="panel-head">
        <div>
          <Eyebrow tone="amber-on-dark">Now playing</Eyebrow>
          <h2 className="headline headline-card">
            {play ? (
              <>
                Tonight's <span className="accent">story</span>
              </>
            ) : (
              <>
                Nothing playing <span className="accent">yet</span>
              </>
            )}
          </h2>
        </div>
        <StatusChip status={status} />
      </div>

      {speechUrl ? (
        <audio data-testid="reply-audio" src={speechUrl} autoPlay onEnded={onReplyEnded} onError={onReplyEnded} />
      ) : null}

      <div className="panel-body">
        {play ? (
          <>
            <BrandMark size="xl" leftDot="cream" glow />
            <p className="panel-title" data-testid="now-playing-title">
              {play.title}
            </p>
            <p className="panel-sub">read by {play.storyteller}</p>
            <audio
              key={playKey}
              ref={audioRef}
              data-testid="story-audio"
              src={play.url}
              preload="metadata"
              onTimeUpdate={(event) => {
                setPosition(event.currentTarget.currentTime);
              }}
              onLoadedMetadata={(event) => {
                if (Number.isFinite(event.currentTarget.duration)) setMediaDuration(event.currentTarget.duration);
              }}
              onEnded={onStoryEnded}
            />
          </>
        ) : (
          <>
            <div className="moon-screen">
              <MoonPixels />
            </div>
            <p className="panel-title">
              Say '{sampleUtterance}'
            </p>
            <p className="panel-hint">Only stories the parent has already delivered can play here.</p>
          </>
        )}
      </div>

      {play ? (
        <div>
          <div
            className="progress"
            role="progressbar"
            aria-label="Story progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
          >
            <div className="progress-fill" style={{ width: `${progress}%` }} />
            <div className="progress-knob" style={{ left: `${progress}%` }} />
          </div>
          <div className="progress-times">
            <span>{formatClock(position)}</span>
            <span>{formatClock(duration)}</span>
          </div>
          <div className="panel-controls">
            {status === "paused" || !active ? (
              <button
                type="button"
                className="pill pill-primary play-button"
                onClick={() => {
                  if (!active && audioRef.current) audioRef.current.currentTime = 0;
                  onResume();
                }}
              >
                {active ? "Resume" : "Play again"}
              </button>
            ) : (
              <button type="button" className="pill pill-ghost" onClick={onPause}>
                Pause
              </button>
            )}
          </div>
        </div>
      ) : null}

      <p className="panel-foot">The family recording plays untouched; only Alexa's replies are synthesized.</p>
    </section>
  );
}
