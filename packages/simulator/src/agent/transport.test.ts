import { describe, expect, it, vi } from "vitest";
import { createHttpTransport } from "./http.ts";
import { createMockTransport, FIXTURE_STORY } from "./mock.ts";

describe("http transport", () => {
  it("posts JSON to the agent routes and validates the contract shapes", async () => {
    const fetchImpl = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
      if (url.endsWith("/agent/session")) {
        expect(JSON.parse(init?.body as string)).toEqual({ mode: "linked", accessToken: "jwt" });
        return Promise.resolve(Response.json({ sessionId: "s1", mode: "linked", subject: "uid", offline: false }));
      }
      if (url.endsWith("/agent/turn")) {
        return Promise.resolve(Response.json({ say: "Hi", play: null, speechUrl: "https://x/y.mp3", toolCalls: [] }));
      }
      if (url.endsWith("/agent/transcribe")) {
        expect(init?.headers).toMatchObject({ "content-type": "audio/webm;codecs=opus" });
        return Promise.resolve(Response.json({ text: "Alexa, play the story Grandpa sent" }));
      }
      if (url.endsWith("/agent/health")) return Promise.resolve(Response.json({ ok: true, offline: true, model: null }));
      return Promise.resolve(new Response("nope", { status: 404 }));
    });
    const transport = createHttpTransport({ fetchImpl, origin: "http://localhost:4310" });
    await expect(transport.createSession({ mode: "linked", accessToken: "jwt" })).resolves.toEqual({
      sessionId: "s1",
      mode: "linked",
      subject: "uid",
      offline: false,
    });
    await expect(transport.turn("s1", "hello")).resolves.toMatchObject({ say: "Hi", play: null });
    await expect(transport.transcribe(new Blob(["x"], { type: "audio/webm;codecs=opus" }))).resolves.toEqual({
      text: "Alexa, play the story Grandpa sent",
    });
    await expect(transport.health()).resolves.toEqual({ ok: true, offline: true, model: null });
  });

  it("turns error bodies into an AgentError with the server message", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(Response.json({ error: "no_session", message: "unknown session" }, { status: 404 })));
    const transport = createHttpTransport({ fetchImpl, origin: "" });
    await expect(transport.turn("nope", "hi")).rejects.toMatchObject({ name: "AgentError", code: "no_session", message: "unknown session" });
  });

  it("rejects a response that does not match the contract", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(Response.json({ say: 1 })));
    const transport = createHttpTransport({ fetchImpl, origin: "" });
    await expect(transport.turn("s", "hi")).rejects.toThrow(/contract/i);
  });
});

describe("mock transport", () => {
  it("answers the contract with the fixture story", async () => {
    const transport = createMockTransport();
    const session = await transport.createSession({ mode: "demo" });
    expect(session.mode).toBe("demo");
    const turn = await transport.turn(session.sessionId, "Alexa, play the story Grandpa sent");
    expect(turn.play?.title).toBe(FIXTURE_STORY.title);
    expect(turn.play?.storyteller).toBe("Grandpa Juan");
    expect(turn.play?.durationSeconds).toBe(184);
    expect(turn.speechUrl).toBeNull();
    expect(turn.toolCalls.map((call) => call.name)).toEqual(["spoken-letter___list_family_stories", "spoken-letter___get_family_story"]);
    await expect(transport.transcribe(new Blob())).resolves.toEqual({ text: "Alexa, play the story Grandpa sent" });
  });
});
