import { log } from "@spoken-letter-alexa/shared";
import { afterEach, describe, expect, test, vi } from "vitest";

import { AgentHttpError, type AgentClient } from "./agent-client.ts";
import { encodeStreamToken } from "./audio.ts";
import { createHandler, type AlexaRequestEnvelope, type AlexaResponseEnvelope } from "./handler.ts";

const SKILL_ID = "amzn1.ask.skill.00000000-0000-4000-8000-000000000000";
const ART_URL = "https://alexa.spokenletter.com/fixtures/art/st_owl.png";
const PLAY = { id: "st_owl", url: "https://alexa.spokenletter.com/fixtures/audio/st_owl.mp3", title: "The owl who forgot how to hoot", storyteller: "Grandpa Juan", durationSeconds: 184, artUrl: ART_URL };

function envelope(request: Record<string, unknown>, overrides: Partial<AlexaRequestEnvelope> = {}): AlexaRequestEnvelope {
  return {
    version: "1.0",
    session: { new: true, sessionId: "amzn1.echo-api.session.1", application: { applicationId: SKILL_ID }, user: { userId: "amzn1.ask.account.OWNER" } },
    context: { System: { application: { applicationId: SKILL_ID }, user: { userId: "amzn1.ask.account.OWNER" } } },
    request: { requestId: "amzn1.echo-api.request.1", timestamp: "2026-09-08T18:00:00Z", locale: "en-US", ...request } as AlexaRequestEnvelope["request"],
    ...overrides,
  };
}

function intent(name: string, slots: Record<string, string | undefined> = {}) {
  return envelope({
    type: "IntentRequest",
    intent: { name, slots: Object.fromEntries(Object.entries(slots).map(([slot, value]) => [slot, { name: slot, ...(value !== undefined && { value }) }])) },
  });
}

function fakeAgent(overrides: Partial<AgentClient> = {}): AgentClient & { turn: ReturnType<typeof vi.fn> } {
  const turn = vi.fn().mockResolvedValue({ say: "Here it is.", play: PLAY, toolCalls: [] });
  return { turn, ...overrides } as AgentClient & { turn: ReturnType<typeof vi.fn> };
}

const ssml = (r: AlexaResponseEnvelope) => (r.response.outputSpeech as { ssml?: string } | undefined)?.ssml ?? "";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("skill handler", () => {
  test("rejects a wrong or missing application id before touching the agent", async () => {
    const agent = fakeAgent();
    const handler = createHandler({ skillId: SKILL_ID, agent });
    await expect(handler(envelope({ type: "LaunchRequest" }, { context: { System: { application: { applicationId: "amzn1.ask.skill.other" }, user: { userId: "u" } } } }))).rejects.toThrow(/application id/);
    await expect(handler(envelope({ type: "LaunchRequest" }, { context: { System: { application: { applicationId: "" }, user: { userId: "u" } } } }))).rejects.toThrow(/application id/);
    expect(agent.turn).not.toHaveBeenCalled();
  });

  test("LaunchRequest greets with SSML, a reprompt, and keeps the session open", async () => {
    const handler = createHandler({ skillId: SKILL_ID, agent: fakeAgent() });
    const response = await handler(envelope({ type: "LaunchRequest" }));
    expect(ssml(response)).toMatch(/<speak>.*Spoken Letter.*<\/speak>/);
    expect(response.response.reprompt?.outputSpeech).toBeDefined();
    expect(response.response.shouldEndSession).toBe(false);
  });

  test.each([
    { name: "PlayStoryIntent", slots: { title: "the owl", storyteller: "Grandpa" }, text: "play the story the owl by Grandpa" },
    { name: "PlayStoryIntent", slots: {}, text: "play a family story" },
    { name: "WhatIsNewIntent", slots: {}, text: "what family stories are new?" },
    { name: "NextStoryIntent", slots: {}, text: "play the next family story" },
    { name: "CatchAllIntent", slots: { text: "put on the lighthouse one" }, text: "put on the lighthouse one" },
  ])("$name sends one line of text to the agent for the device user", async ({ name, slots, text }) => {
    const agent = fakeAgent();
    const handler = createHandler({ skillId: SKILL_ID, agent });
    await handler(intent(name, slots));
    expect(agent.turn).toHaveBeenCalledWith({ deviceUserId: "amzn1.ask.account.OWNER", text });
  });

  test("a reply with a story speaks `say` then plays the MP3 with AudioPlayer.Play and metadata", async () => {
    const handler = createHandler({ skillId: SKILL_ID, agent: fakeAgent() });
    const response = await handler(intent("PlayStoryIntent", { title: "the owl" }));
    expect(ssml(response)).toBe("<speak>Here it is.</speak>");
    expect(response.response.shouldEndSession).toBe(true);
    const [directive] = response.response.directives ?? [];
    expect(directive).toMatchObject({
      type: "AudioPlayer.Play",
      playBehavior: "REPLACE_ALL",
      audioItem: {
        stream: { url: PLAY.url, offsetInMilliseconds: 0, token: encodeStreamToken(PLAY) },
        metadata: {
          title: PLAY.title,
          subtitle: "read by Grandpa Juan",
          art: { sources: [{ url: ART_URL, size: "X_SMALL", widthPixels: 480, heightPixels: 480 }] },
        },
      },
    });
  });

  test("a story with no artwork plays with a card that carries no art", async () => {
    const { artUrl: _artUrl, ...bare } = PLAY;
    const agent = fakeAgent({ turn: vi.fn().mockResolvedValue({ say: "Here it is.", play: bare, toolCalls: [] }) });
    const handler = createHandler({ skillId: SKILL_ID, agent });
    const response = await handler(intent("PlayStoryIntent", { title: "the owl" }));
    const [directive] = response.response.directives ?? [];
    const metadata = (directive as { audioItem: { metadata: Record<string, unknown> } }).audioItem.metadata;
    expect(metadata).toEqual({ title: PLAY.title, subtitle: "read by Grandpa Juan" });
  });

  test("a reply without a story keeps talking and leaves the session open", async () => {
    const agent = fakeAgent({ turn: vi.fn().mockResolvedValue({ say: "You have 2 stories.", play: null, toolCalls: [] }) });
    const handler = createHandler({ skillId: SKILL_ID, agent });
    const response = await handler(intent("WhatIsNewIntent"));
    expect(ssml(response)).toBe("<speak>You have 2 stories.</speak>");
    expect(response.response.directives ?? []).toHaveLength(0);
    expect(response.response.shouldEndSession).toBe(false);
  });

  test("SSML escapes the agent's text", async () => {
    const agent = fakeAgent({ turn: vi.fn().mockResolvedValue({ say: 'Tom & "Jerry" <3', play: null, toolCalls: [] }) });
    const handler = createHandler({ skillId: SKILL_ID, agent });
    expect(ssml(await handler(intent("WhatIsNewIntent")))).toBe("<speak>Tom &amp; &quot;Jerry&quot; &lt;3</speak>");
  });

  test("pause stops playback; resume restarts from the offset Alexa reports; stop and cancel stop", async () => {
    const handler = createHandler({ skillId: SKILL_ID, agent: fakeAgent() });
    const token = encodeStreamToken(PLAY);
    const playing = { AudioPlayer: { token, offsetInMilliseconds: 42_000, playerActivity: "PLAYING" } };
    const pause = await handler(envelope({ type: "IntentRequest", intent: { name: "AMAZON.PauseIntent" } }, { context: { ...envelope({}).context, ...playing } }));
    expect(pause.response.directives).toEqual([{ type: "AudioPlayer.Stop" }]);
    expect(pause.response.shouldEndSession).toBe(true);
    const resume = await handler(
      envelope({ type: "IntentRequest", intent: { name: "AMAZON.ResumeIntent" } }, { context: { ...envelope({}).context, AudioPlayer: { ...playing.AudioPlayer, playerActivity: "PAUSED" } } }),
    );
    expect(resume.response.directives?.[0]).toMatchObject({ type: "AudioPlayer.Play", audioItem: { stream: { url: PLAY.url, token, offsetInMilliseconds: 42_000 } } });
    const nothing = await handler(envelope({ type: "IntentRequest", intent: { name: "AMAZON.ResumeIntent" } }));
    expect(ssml(nothing)).toMatch(/nothing to resume/i);
    for (const name of ["AMAZON.StopIntent", "AMAZON.CancelIntent"]) {
      const stop = await handler(envelope({ type: "IntentRequest", intent: { name } }));
      expect(stop.response.directives).toEqual([{ type: "AudioPlayer.Stop" }]);
    }
  });

  test("start over and repeat restart the current story at offset 0 (phase-3.md section 1)", async () => {
    const handler = createHandler({ skillId: SKILL_ID, agent: fakeAgent() });
    const token = encodeStreamToken(PLAY);
    const playing = { AudioPlayer: { token, offsetInMilliseconds: 90_000, playerActivity: "PLAYING" } };
    for (const name of ["AMAZON.StartOverIntent", "AMAZON.RepeatIntent"]) {
      const response = await handler(envelope({ type: "IntentRequest", intent: { name } }, { context: { ...envelope({}).context, ...playing } }));
      expect(response.response.directives?.[0]).toMatchObject({ type: "AudioPlayer.Play", audioItem: { stream: { url: PLAY.url, token, offsetInMilliseconds: 0 } } });
    }
    const nothing = await handler(envelope({ type: "IntentRequest", intent: { name: "AMAZON.StartOverIntent" } }));
    expect(ssml(nothing)).toMatch(/nothing to resume/i);
  });

  test("previous always answers honestly: no story history is kept", async () => {
    const handler = createHandler({ skillId: SKILL_ID, agent: fakeAgent() });
    const response = await handler(envelope({ type: "IntentRequest", intent: { name: "AMAZON.PreviousIntent" } }));
    expect(ssml(response)).toMatch(/first one/i);
    expect(response.response.shouldEndSession).toBe(false);
  });

  test("loop and shuffle intents are acknowledged with speech, never an empty response", async () => {
    const handler = createHandler({ skillId: SKILL_ID, agent: fakeAgent() });
    for (const name of ["AMAZON.LoopOnIntent", "AMAZON.LoopOffIntent", "AMAZON.ShuffleOnIntent", "AMAZON.ShuffleOffIntent"]) {
      const response = await handler(envelope({ type: "IntentRequest", intent: { name } }));
      expect(response.response.outputSpeech).toBeDefined();
      expect(ssml(response)).toMatch(/one at a time/i);
    }
  });

  test("AMAZON.NextIntent routes identically to NextStoryIntent (phase-3.md \"Routing note\")", async () => {
    const agent = fakeAgent();
    const handler = createHandler({ skillId: SKILL_ID, agent });
    await handler(intent("AMAZON.NextIntent"));
    expect(agent.turn).toHaveBeenCalledWith({ deviceUserId: "amzn1.ask.account.OWNER", text: "play the next family story" });
  });

  test("AudioPlayer lifecycle requests get an empty response and SessionEndedRequest too", async () => {
    const agent = fakeAgent();
    const handler = createHandler({ skillId: SKILL_ID, agent });
    for (const type of ["AudioPlayer.PlaybackStarted", "AudioPlayer.PlaybackFinished", "AudioPlayer.PlaybackStopped", "AudioPlayer.PlaybackNearlyFinished", "AudioPlayer.PlaybackFailed", "SessionEndedRequest"]) {
      const response = await handler(envelope({ type }));
      expect(response.response.outputSpeech).toBeUndefined();
      expect(response.response.directives ?? []).toHaveLength(0);
    }
    expect(agent.turn).not.toHaveBeenCalled();
  });

  test("help and fallback answer with one sentence and a reprompt", async () => {
    const handler = createHandler({ skillId: SKILL_ID, agent: fakeAgent() });
    for (const name of ["AMAZON.HelpIntent", "AMAZON.FallbackIntent"]) {
      const response = await handler(envelope({ type: "IntentRequest", intent: { name } }));
      expect(ssml(response)).toMatch(/play the story|what is new/i);
      expect(response.response.reprompt).toBeDefined();
      expect(response.response.shouldEndSession).toBe(false);
    }
  });

  test("an agent timeout or failure becomes a spoken retry, never a skill error", async () => {
    const agent = fakeAgent({ turn: vi.fn().mockRejectedValue(new Error("aborted")) });
    const handler = createHandler({ skillId: SKILL_ID, agent });
    const response = await handler(intent("PlayStoryIntent"));
    expect(ssml(response)).toMatch(/still looking|ask again/i);
    expect(response.response.shouldEndSession).toBe(false);
  });

  test("recording mode logs catch-all phrasings and nothing else", async () => {
    const record = vi.fn();
    const handler = createHandler({ skillId: SKILL_ID, agent: fakeAgent(), recordUtterance: record });
    await handler(intent("CatchAllIntent", { text: "let's hear grandpa" }));
    await handler(intent("WhatIsNewIntent"));
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith({ locale: "en-US", text: "let's hear grandpa" });
  });
});

type SkillTurnFields = {
  event: string;
  requestType: string;
  intent?: string;
  slots?: Record<string, string | null>;
  ms: number;
  played: boolean;
  storyId?: string | null;
  tools: string[];
  say?: string;
  outcome: string;
  errorClass?: string;
  reason?: string;
};

function loggedSkillTurns(info: { mock: { calls: unknown[][] } }): SkillTurnFields[] {
  return info.mock.calls.filter(([event]) => event === "skill_turn").map(([, fields]) => fields as SkillTurnFields);
}

describe("skill_turn telemetry (phase-1.md)", () => {
  test.each([
    ["LaunchRequest", () => envelope({ type: "LaunchRequest" })],
    ["SessionEndedRequest", () => envelope({ type: "SessionEndedRequest", reason: "USER_INITIATED" })],
    ["AudioPlayer.PlaybackStarted", () => envelope({ type: "AudioPlayer.PlaybackStarted" })],
    ["IntentRequest", () => intent("WhatIsNewIntent")],
  ])("emits a skill_turn line for %s", async (requestType, buildEvent) => {
    const info = vi.spyOn(log, "info");
    const handler = createHandler({ skillId: SKILL_ID, agent: fakeAgent() });
    await handler(buildEvent());
    const [line] = loggedSkillTurns(info);
    expect(line).toBeDefined();
    expect(line?.requestType).toBe(requestType);
    expect(typeof line?.ms).toBe("number");
  });

  test("SessionEndedRequest carries reason and error; other non-intent lines carry neither", async () => {
    const info = vi.spyOn(log, "info");
    const handler = createHandler({ skillId: SKILL_ID, agent: fakeAgent() });
    await handler(envelope({ type: "SessionEndedRequest", reason: "ERROR", error: { type: "INTERNAL_SERVICE_ERROR", message: "boom" } }));
    await handler(envelope({ type: "AudioPlayer.PlaybackNearlyFinished" }));
    const [ended, audio] = loggedSkillTurns(info);
    expect(ended).toMatchObject({ reason: "ERROR", error: { type: "INTERNAL_SERVICE_ERROR", message: "boom" } });
    expect(audio && "reason" in audio).toBe(false);
  });

  test("an IntentRequest logs intent, slots ({} when none), played and storyId", async () => {
    const info = vi.spyOn(log, "info");
    const turn = vi
      .fn()
      .mockResolvedValueOnce({ say: "Here it is.", play: PLAY, toolCalls: [] })
      .mockResolvedValueOnce({ say: "You have 2 stories.", play: null, toolCalls: [] });
    const handler = createHandler({ skillId: SKILL_ID, agent: fakeAgent({ turn }) });
    await handler(intent("PlayStoryIntent", { title: "the owl" }));
    await handler(intent("WhatIsNewIntent"));
    const [played, notPlayed] = loggedSkillTurns(info);
    expect(played).toMatchObject({ intent: "PlayStoryIntent", slots: { title: "the owl" }, played: true, storyId: PLAY.id, outcome: "ok" });
    expect(notPlayed).toMatchObject({ intent: "WhatIsNewIntent", slots: {}, played: false, storyId: null });
  });

  test("say is absent when logSay is unset and present, truncated to 120 chars, when set", async () => {
    const longSay = "x".repeat(200);
    const agent = fakeAgent({ turn: vi.fn().mockResolvedValue({ say: longSay, play: null, toolCalls: [] }) });

    const withoutFlag = vi.spyOn(log, "info");
    await createHandler({ skillId: SKILL_ID, agent })(intent("WhatIsNewIntent"));
    expect(loggedSkillTurns(withoutFlag)[0]?.say).toBeUndefined();
    withoutFlag.mockRestore();

    const withFlag = vi.spyOn(log, "info");
    await createHandler({ skillId: SKILL_ID, agent, logSay: true })(intent("WhatIsNewIntent"));
    expect(loggedSkillTurns(withFlag)[0]?.say).toBe(longSay.slice(0, 120));
  });

  test("an agent HTTP rejection is classified rejected, with the AgentHttpError code", async () => {
    const info = vi.spyOn(log, "info");
    const agent = fakeAgent({ turn: vi.fn().mockRejectedValue(new AgentHttpError(404, "session_not_found", "no session")) });
    await createHandler({ skillId: SKILL_ID, agent })(intent("PlayStoryIntent"));
    expect(loggedSkillTurns(info)[0]).toMatchObject({ outcome: "rejected", errorClass: "AgentHttpError:session_not_found" });
  });

  test("an aborted (timed out) agent call is classified timeout", async () => {
    const info = vi.spyOn(log, "info");
    const agent = fakeAgent({ turn: vi.fn().mockRejectedValue(new DOMException("The operation was aborted.", "AbortError")) });
    await createHandler({ skillId: SKILL_ID, agent })(intent("PlayStoryIntent"));
    expect(loggedSkillTurns(info)[0]).toMatchObject({ outcome: "timeout", errorClass: "DOMException" });
  });
});

function intentWithApi(name: string, slots: Record<string, string | undefined> = {}) {
  const base = intent(name, slots);
  return { ...base, context: { ...base.context, System: { ...base.context.System, apiEndpoint: "https://api.amazonalexa.com", apiAccessToken: "api-token" } } };
}

describe("progressive response (phase-2.md section 2)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("a hanging Directive Service call never blocks the response", async () => {
    vi.useFakeTimers();
    const progressiveFetch = vi.fn<typeof fetch>(() => new Promise<Response>(() => undefined));
    const agent = fakeAgent({
      turn: vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => { resolve({ say: "Here it is.", play: PLAY, toolCalls: [] }); }, 700);
          }),
      ),
    });
    const handler = createHandler({ skillId: SKILL_ID, agent, progressiveFetch: progressiveFetch });
    const responsePromise = handler(intentWithApi("PlayStoryIntent", { title: "the owl" }));
    // Past the 600 ms progressive delay (so the hanging fetch actually starts) and the 700 ms agent turn.
    await vi.advanceTimersByTimeAsync(700);
    const response = await responsePromise;
    expect(ssml(response)).toBe("<speak>Here it is.</speak>");
    expect(progressiveFetch).toHaveBeenCalledTimes(1);
  });

  test("a Directive Service 500 does not change the handler's response", async () => {
    vi.useFakeTimers();
    const progressiveFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 500 }));
    const agent = fakeAgent({
      turn: vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => { resolve({ say: "Here it is.", play: PLAY, toolCalls: [] }); }, 700);
          }),
      ),
    });
    const handler = createHandler({ skillId: SKILL_ID, agent, progressiveFetch: progressiveFetch });
    const responsePromise = handler(intentWithApi("PlayStoryIntent", { title: "the owl" }));
    await vi.advanceTimersByTimeAsync(700);
    const response = await responsePromise;
    expect(ssml(response)).toBe("<speak>Here it is.</speak>");
    const [directive] = response.response.directives ?? [];
    expect(directive).toMatchObject({ type: "AudioPlayer.Play" });
  });

  test("with no apiEndpoint/apiAccessToken, no Directive Service call is made", async () => {
    vi.useFakeTimers();
    const progressiveFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    const handler = createHandler({ skillId: SKILL_ID, agent: fakeAgent(), progressiveFetch: progressiveFetch });
    await handler(intent("PlayStoryIntent", { title: "the owl" }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(progressiveFetch).not.toHaveBeenCalled();
  });
});
