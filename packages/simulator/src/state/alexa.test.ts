import { describe, expect, it } from "vitest";
import type { TurnResponse } from "../agent/types.ts";
import { initialState, reduce, type AlexaState } from "./alexa.ts";

const story: TurnResponse = {
  say: "Here it is.",
  play: { url: "/fixtures/silence.mp3", title: "The owl who forgot how to hoot", storyteller: "Grandpa Juan", durationSeconds: 184 },
  speechUrl: null,
  toolCalls: [{ name: "spoken-letter___get_family_story", ms: 80, era: "2025-03-26", ok: true }],
};

const playing = (): AlexaState => reduce(initialState, { type: "turn-ok", you: "play it", response: story });

describe("alexa reducer", () => {
  it("plays a story reply straight away when there is no speech audio", () => {
    expect(playing().status).toBe("playing");
  });

  it("a new turn pauses the playing story", () => {
    expect(reduce(playing(), { type: "turn-start" }).status).toBe("thinking");
    expect(reduce(playing(), { type: "listen" }).status).toBe("listening");
  });

  it("gives every story reply a fresh playback key so a repeat starts from the top", () => {
    const first = playing();
    const second = reduce(reduce(first, { type: "turn-start" }), { type: "turn-ok", you: "again", response: story });
    expect(second.playKey).not.toBe(first.playKey);
    expect(second.status).toBe("playing");
  });

  it("accumulates tool calls across turns and clears the story when a reply has none", () => {
    const state = reduce(playing(), { type: "turn-ok", you: "what time is it", response: { say: "Bedtime.", play: null, speechUrl: null, toolCalls: [] } });
    expect(state.play).toBeNull();
    expect(state.status).toBe("idle");
    expect(state.toolCalls).toHaveLength(1);
  });

  it("resumes from paused and replays from idle", () => {
    const paused = reduce(playing(), { type: "pause" });
    expect(paused.status).toBe("paused");
    expect(reduce(paused, { type: "resume" }).status).toBe("playing");
    const ended = reduce(playing(), { type: "story-ended" });
    expect(ended.status).toBe("idle");
    expect(reduce(ended, { type: "resume" }).status).toBe("playing");
  });

  it("starts a fresh conversation on a new session", () => {
    const state = reduce(playing(), { type: "session", session: { sessionId: "s2", mode: "linked", subject: "uid", offline: false } });
    expect(state.toolCalls).toEqual([]);
    expect(state.play).toBeNull();
    expect(state.session?.sessionId).toBe("s2");
  });
});
