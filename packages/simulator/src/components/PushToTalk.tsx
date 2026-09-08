import { useCallback, useEffect, useRef, useState } from "react";

export const MAX_UTTERANCE_MS = 15_000;
const MIME = "audio/webm;codecs=opus";

export function microphoneAvailable(): boolean {
  if (typeof navigator === "undefined" || typeof MediaRecorder === "undefined") return false;
  // `mediaDevices` is absent in insecure contexts and in jsdom, whatever the DOM types say.
  const devices = (navigator as { mediaDevices?: MediaDevices }).mediaDevices;
  return typeof devices?.getUserMedia === "function";
}

type Props = {
  /** True while the device is listening; the button stops the recording on the next press. */
  listening: boolean;
  /** Disabled while thinking or replying. */
  busy: boolean;
  onStart: () => void;
  onCancel: (reason: string) => void;
  onUtterance: (audio: Blob) => void;
};

/**
 * The push-to-talk "Alexa" button: press to record (MediaRecorder, WebM/Opus, at most
 * 15 s), press again to send. The ring around the orb follows the microphone level.
 */
export function PushToTalk({ listening, busy, onStart, onCancel, onUtterance }: Props) {
  const available = microphoneAvailable();
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const frameRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [level, setLevel] = useState(0);

  const teardown = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    cancelAnimationFrame(frameRef.current);
    streamRef.current?.getTracks().forEach((track) => {
      track.stop();
    });
    streamRef.current = null;
    void contextRef.current?.close();
    contextRef.current = null;
    recorderRef.current = null;
    setLevel(0);
  }, []);

  useEffect(() => teardown, [teardown]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }, []);

  const start = useCallback(async () => {
    if (!available) return;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      onCancel("Microphone permission was refused. Type your request below instead.");
      return;
    }
    streamRef.current = stream;
    const mimeType = MediaRecorder.isTypeSupported(MIME) ? MIME : undefined;
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      const audio = new Blob(chunks, { type: mimeType ?? recorder.mimeType });
      teardown();
      if (audio.size === 0) onCancel("Nothing was recorded. Try again, or type below.");
      else onUtterance(audio);
    };
    recorderRef.current = recorder;

    // Microphone level for the ring, an analyser on the same stream.
    try {
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaStreamSource(stream).connect(analyser);
      contextRef.current = context;
      const samples = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) {
          const centred = (sample - 128) / 128;
          sum += centred * centred;
        }
        setLevel(Math.min(1, Math.sqrt(sum / samples.length) * 4));
        frameRef.current = requestAnimationFrame(tick);
      };
      frameRef.current = requestAnimationFrame(tick);
    } catch {
      // No analyser: the ring stays static while recording.
    }

    recorder.start();
    onStart();
    timerRef.current = setTimeout(stop, MAX_UTTERANCE_MS);
  }, [available, onCancel, onStart, onUtterance, stop, teardown]);

  const onClick = () => {
    if (listening) stop();
    else void start();
  };

  return (
    <div>
      <div className="orb-wrap">
        <span className="orb-ring" data-active={listening} style={{ transform: `scale(${0.85 + level * 0.3})` }} aria-hidden="true" />
        <button
          type="button"
          className="orb"
          data-active={listening}
          disabled={!available || busy}
          aria-pressed={listening}
          aria-label="Alexa"
          onClick={onClick}
        >
          Alexa
        </button>
      </div>
      <p className="orb-hint">
        {!available
          ? "No microphone here. Use the keyboard below."
          : listening
            ? "Listening. Press again to send (15 s max)."
            : "Press to talk, press again to send."}
      </p>
    </div>
  );
}
