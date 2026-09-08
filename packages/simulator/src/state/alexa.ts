// The device's state machine. Pure reducer; the transport calls live in useAlexa.
import type { Play, SessionResponse, ToolCall, TurnResponse } from "../agent/types.ts";

export type Status = "idle" | "listening" | "thinking" | "replying" | "playing" | "paused";

export const STATUS_LABEL: Record<Status, string> = {
  idle: "Idle",
  listening: "Listening",
  thinking: "Thinking",
  replying: "Replying",
  playing: "Playing",
  paused: "Paused",
};

export type Exchange = { you: string; alexa: string };

export type AlexaState = {
  status: Status;
  session: SessionResponse | null;
  exchange: Exchange | null;
  play: Play | null;
  speechUrl: string | null;
  toolCalls: ToolCall[];
  error: string | null;
  /** Changes with every story reply so the audio element remounts and starts from the top. */
  playKey: number;
};

export type AlexaEvent =
  | { type: "session"; session: SessionResponse | null }
  | { type: "listen" }
  | { type: "turn-start" }
  | { type: "turn-ok"; you: string; response: TurnResponse }
  | { type: "turn-fail"; message: string }
  | { type: "reply-ended" }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "story-ended" };

export const initialState: AlexaState = {
  status: "idle",
  session: null,
  exchange: null,
  play: null,
  speechUrl: null,
  toolCalls: [],
  error: null,
  playKey: 0,
};

export function reduce(state: AlexaState, event: AlexaEvent): AlexaState {
  switch (event.type) {
    case "session":
      // A new session (demo or linked) starts a fresh conversation.
      return { ...initialState, session: event.session };
    // `listen` and `turn-start` leave "playing", which pauses the story (NowPlaying only
    // plays while the status is "playing"), so a Polly reply never overlaps the recording.
    case "listen":
      return { ...state, status: "listening", error: null };
    case "turn-start":
      return { ...state, status: "thinking", error: null, speechUrl: null };
    case "turn-ok": {
      const { response } = event;
      const status: Status = response.speechUrl ? "replying" : response.play ? "playing" : "idle";
      return {
        ...state,
        status,
        exchange: { you: event.you, alexa: response.say },
        play: response.play,
        speechUrl: response.speechUrl,
        toolCalls: [...state.toolCalls, ...response.toolCalls],
        error: null,
        playKey: response.play ? state.playKey + 1 : state.playKey,
      };
    }
    case "turn-fail":
      return { ...state, status: "idle", error: event.message };
    case "reply-ended":
      return { ...state, status: state.play ? "playing" : "idle", speechUrl: null };
    case "pause":
      return state.status === "playing" ? { ...state, status: "paused" } : state;
    case "resume":
      // From paused, or "Play again" once the story has ended.
      return state.status === "paused" || (state.status === "idle" && state.play) ? { ...state, status: "playing" } : state;
    case "story-ended":
      return { ...state, status: "idle" };
  }
}
