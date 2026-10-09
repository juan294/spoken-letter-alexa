import { createHash } from "node:crypto";

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

const ssml = (r: AlexaResponseEnvelope) => {
  const speech = (r.response.outputSpeech as { ssml?: string } | undefined)?.ssml ?? "";
  for (const text of [speech, r.response.reprompt?.outputSpeech.ssml ?? ""]) {
    expect(text).not.toMatch(/\b(?:demo|fixture|simulation|prototype|name-free)\b/i);
    expect(text).not.toMatch(/not sent|not contact anyone|not a real/i);
  }
  return speech;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("skill handler", () => {
  test("an English launch always opens with the demo script's first line, never a pending reaction or update", async () => {
    // Jordan's script line 1 (staged demo plan, revision for her script). Spanish launches keep reactions and updates.
    const demoNext = vi.fn().mockResolvedValue({ pendingReaction: { storyId: "st_martina_the_mermaid", title: "Martina the music loving mermaid", storyteller: "Aunt Whitney" }, event: { eventId: "evt-1", type: "family-occasion", detail: "A family birthday is coming up.", occurredAt: "2026-09-28T10:00:00Z" } });
    const demoEvent = vi.fn().mockResolvedValue({ status: "read" });
    const launch = await createHandler({ skillId: SKILL_ID, agent: fakeAgent({ demoNext, demoEvent }) })(envelope({ type: "LaunchRequest" }));
    expect(ssml(launch)).toBe("<speak>Here's Spoken Letter. Which story would you like to hear?</speak>");
    expect(launch.response.shouldEndSession).not.toBe(true);
    expect(demoNext).not.toHaveBeenCalled();
    expect(demoEvent).not.toHaveBeenCalled();
  });

  test("a reaction reply in the reaction flow saves one demo reaction", async () => {
    const demoReact = vi.fn().mockResolvedValue({ status: "saved", reactionId: "reaction-1", storyId: "st_martina_the_mermaid", choice: "love" });
    const handler = createHandler({ skillId: SKILL_ID, agent: fakeAgent({ demoReact }) });
    const reply = intent("ReactToStoryIntent", { choice: "love" });
    reply.session = { ...reply.session!, attributes: { demoFlow: "reaction" } };
    const saved = await handler(reply);
    expect(demoReact).toHaveBeenCalledWith({ deviceUserId: "amzn1.ask.account.OWNER", requestId: "amzn1.echo-api.request.1", choice: "love" });
    expect(ssml(saved)).toMatch(/saved.*reaction|saved that you loved/i);
    expect(ssml(saved)).not.toMatch(/sent.*creator|creator.*received/i);
  });

  test("a legacy direct-play token records completion through the demo route without speech", async () => {
    const demoPlaybackFinished = vi.fn().mockResolvedValue({ status: "recorded" });
    const token = encodeStreamToken(PLAY);
    const event = envelope({ type: "AudioPlayer.PlaybackFinished", token, requestId: "finished-1" });
    const response = await createHandler({ skillId: SKILL_ID, agent: fakeAgent({ demoPlaybackFinished }) })(event);
    expect(demoPlaybackFinished).toHaveBeenCalledWith({ deviceUserId: "amzn1.ask.account.OWNER", observedToken: token, eventId: "finished-1" });
    expect(response.response.outputSpeech).toBeUndefined();
  });

  test("reaction cancellation dismisses without a saved reaction and failure stays retryable", async () => {
    const demoReact = vi.fn().mockResolvedValue({ status: "dismissed" });
    const agent = fakeAgent({ demoReact });
    const handler = createHandler({ skillId: SKILL_ID, agent });
    const no = intent("AMAZON.NoIntent");
    no.session = { ...no.session!, attributes: { demoFlow: "reaction" } };
    const dismissed = await handler(no);
    expect(demoReact).toHaveBeenCalledWith(expect.objectContaining({ choice: "dismiss" }));
    expect(ssml(dismissed)).not.toMatch(/saved/i);
    demoReact.mockRejectedValueOnce(new AgentHttpError(503, "update_unavailable", "down"));
    const loved = intent("ReactToStoryIntent", { choice: "love" });
    loved.session = { ...loved.session!, attributes: { demoFlow: "reaction" } };
    const failed = await handler(loved);
    expect(ssml(failed)).toMatch(/no reaction was saved/i);
    expect(failed.sessionAttributes).toEqual({ demoFlow: "reaction" });
  });

  test("a reaction can recover on a later invocation after the prompt session closes", async () => {
    const demoReact = vi.fn().mockResolvedValue({ status: "saved", reactionId: "reaction-2", storyId: "st_martina_the_mermaid", choice: "like" });
    const response = await createHandler({ skillId: SKILL_ID, agent: fakeAgent({ demoReact }) })(intent("ReactToStoryIntent", { choice: "liked" }));
    expect(demoReact).toHaveBeenCalledWith(expect.objectContaining({ choice: "like" }));
    expect(ssml(response)).toMatch(/saved.*reaction|saved that you liked/i);
  });
  test("an incomplete reaction receipt never becomes a saved claim", async () => {
    const demoReact = vi.fn().mockResolvedValue({});
    const response = await createHandler({ skillId: SKILL_ID, agent: fakeAgent({ demoReact }) })(intent("ReactToStoryIntent", { choice: "love" }));
    expect(ssml(response)).toMatch(/no reaction was saved/i);
  });
  test("a status-only reaction receipt never becomes a saved claim", async () => {
    const demoReact = vi.fn().mockResolvedValue({ status: "saved" });
    const response = await createHandler({ skillId: SKILL_ID, agent: fakeAgent({ demoReact }) })(intent("ReactToStoryIntent", { choice: "love" }));
    expect(ssml(response)).toMatch(/no reaction was saved/i);
  });

  test("a confirmed adult wish saves only a canonical topic and a canceled wish does not write", async () => {
    const demoWish = vi.fn().mockResolvedValue({ status: "saved", wishId: "wish-1", topic: "mermaids", storyteller: "Aunt Whitney" });
    const handler = createHandler({ skillId: SKILL_ID, agent: fakeAgent({ demoWish }) });
    const proposed = await handler(intent("WishStoryIntent", { wishtopic: "mermaids", storyteller: "Aunt Whitney" }));
    expect(ssml(proposed)).toMatch(/save a wish/i);
    expect(proposed.sessionAttributes).toEqual({ demoFlow: "wish", demoTopic: "mermaids", demoStoryteller: "Aunt Whitney" });
    expect(demoWish).not.toHaveBeenCalled();
    const yes = intent("AMAZON.YesIntent");
    yes.session = { ...yes.session!, attributes: proposed.sessionAttributes! };
    const saved = await handler(yes);
    expect(demoWish).toHaveBeenCalledWith({ deviceUserId: "amzn1.ask.account.OWNER", requestId: "amzn1.echo-api.request.1", topic: "mermaids", storyteller: "Aunt Whitney", confirmed: true });
    expect(ssml(saved)).toMatch(/saved.*wish/i);
    const no = intent("AMAZON.NoIntent");
    no.session = { ...no.session!, attributes: proposed.sessionAttributes! };
    const canceled = await handler(no);
    expect(ssml(canceled)).toMatch(/no wish was saved/i);
    expect(demoWish).toHaveBeenCalledTimes(1);
  });

  test("missing or unknown wish details do not write or repeat an unknown name", async () => {
    const demoWish = vi.fn();
    const handler = createHandler({ skillId: SKILL_ID, agent: fakeAgent({ demoWish }) });
    const missing = await handler(intent("WishStoryIntent"));
    expect(ssml(missing)).toMatch(/what.*story.*about/i);
    const unknown = await handler(intent("WishStoryIntent", { wishtopic: "mermaids", storyteller: "Lily" }));
    expect(ssml(unknown)).toMatch(/who would you like a story from/i);
    expect(ssml(unknown)).not.toContain("Lily");
    expect(demoWish).not.toHaveBeenCalled();
    const childOrigin = await handler(intent("CatchAllIntent", { text: "Lily wants a story about mermaids" }));
    expect(childOrigin.sessionAttributes?.demoFlow).not.toBe("wish");
    expect(demoWish).not.toHaveBeenCalled();
  });

  test("catch-all adult creator request resolves the fixture alias before asking to save", async () => {
    const response = await createHandler({ skillId: SKILL_ID, agent: fakeAgent() })(intent("CatchAllIntent", { text: "ask Aunt Whitney for another mermaid story" }));
    expect(response.sessionAttributes).toEqual({ demoFlow: "wish", demoTopic: "mermaids", demoStoryteller: "Aunt Whitney" });
    const unknown = await createHandler({ skillId: SKILL_ID, agent: fakeAgent() })(intent("CatchAllIntent", { text: "ask Lily for another mermaid story" }));
    expect(ssml(unknown)).toMatch(/who would you like a story from/i);
    expect(ssml(unknown)).not.toContain("Lily");
  });

  test("a failed wish save keeps the safe confirmed request retryable", async () => {
    const demoWish = vi.fn().mockRejectedValue(new AgentHttpError(503, "update_unavailable", "down"));
    const handler = createHandler({ skillId: SKILL_ID, agent: fakeAgent({ demoWish }) });
    const yes = intent("AMAZON.YesIntent");
    yes.session = { ...yes.session!, attributes: { demoFlow: "wish", demoTopic: "mermaids" } };
    const response = await handler(yes);
    expect(ssml(response)).toMatch(/no wish was saved/i);
    expect(response.sessionAttributes).toEqual({ demoFlow: "wish", demoTopic: "mermaids" });
  });
  test("an incomplete wish receipt never becomes a saved claim", async () => {
    const demoWish = vi.fn().mockResolvedValue({});
    const yes = intent("AMAZON.YesIntent");
    yes.session = { ...yes.session!, attributes: { demoFlow: "wish", demoTopic: "mermaids" } };
    const response = await createHandler({ skillId: SKILL_ID, agent: fakeAgent({ demoWish }) })(yes);
    expect(ssml(response)).toMatch(/no wish was saved/i);
  });

  test("updates read the validated fixture story title and mark only that event", async () => {
    const demoInbox = vi.fn().mockResolvedValue({ events: [{ eventId: "evt-story", type: "new_story", occurredAt: "2026-08-03T00:03:24Z", storyId: "st_martina_the_mermaid", detail: "A new story is ready. Martina the music loving mermaid by Aunt Whitney." }] });
    const demoEvent = vi.fn().mockResolvedValue({ status: "read" });
    const response = await createHandler({ skillId: SKILL_ID, agent: fakeAgent({ demoInbox, demoEvent }) })(intent("UpdatesIntent"));
    expect(ssml(response)).toContain("Martina the music loving mermaid");
    expect(demoEvent).toHaveBeenCalledWith({ deviceUserId: "amzn1.ask.account.OWNER", eventId: "evt-story", action: "read" });
  });
  test("English creation starts the staged create flow and saves no draft (staged demo plan D1)", async () => {
    const saveDraft = vi.fn();
    const start = await createHandler({ skillId: SKILL_ID, agent: fakeAgent({ saveDraft }) })(intent("StartStoryIntent", { theme: "mermaids" }));
    expect(ssml(start)).toMatch(/Who is the story for\?/);
    expect(start.sessionAttributes).toEqual({ demoFlow: "create", createStage: "listener" });
    expect(saveDraft).not.toHaveBeenCalled();
  });

  test("a draft already in the session saves one name-free demo draft on the follow-up", async () => {
    const saveDraft = vi.fn().mockResolvedValue({ status: "saved", draftId: "draft-1", theme: "mermaids", outline: "A gentle mermaid helps a friend." });
    const agent = fakeAgent({ saveDraft });
    const handler = createHandler({ skillId: SKILL_ID, agent });
    const followup = intent("ThemeIntent", { theme: "mermaids" });
    followup.session = { ...followup.session!, attributes: { demoFlow: "draft" } };
    const saved = await handler(followup);
    expect(saveDraft).toHaveBeenCalledWith({ deviceUserId: "amzn1.ask.account.OWNER", requestId: "amzn1.echo-api.request.1", theme: "mermaids" });
    expect(ssml(saved)).toMatch(/saved.*draft/i);
    expect(ssml(saved)).toMatch(/private app|open Spoken Letter/i);
    expect(ssml(saved)).not.toMatch(/sent|delivered/i);
  });

  test("named-listener creation enters the create flow without repeating an unknown name, and credits help writes nothing", async () => {
    const saveDraft = vi.fn();
    const agent = fakeAgent({ saveDraft });
    const handler = createHandler({ skillId: SKILL_ID, agent });
    const named = await handler(intent("CatchAllIntent", { text: "create a story for Lily" }));
    expect(ssml(named)).toMatch(/I don(?:'|&#39;)t see that name on your list/i);
    expect(ssml(named)).not.toContain("Lily");
    const credits = await handler(intent("HelpTopicIntent", { topic: "add credits" }));
    expect(ssml(credits)).toMatch(/add story credits.*Spoken Letter/i);
    expect(ssml(credits)).not.toMatch(/charged|added credits/i);
    expect(saveDraft).not.toHaveBeenCalled();
    expect(agent.turn).not.toHaveBeenCalled();
  });

  test("a failed draft write never claims a save and keeps a retry path", async () => {
    const saveDraft = vi.fn().mockRejectedValue(new AgentHttpError(503, "draft_unavailable", "No demo draft was saved. Try again in a moment."));
    const agent = fakeAgent({ saveDraft });
    const handler = createHandler({ skillId: SKILL_ID, agent });
    const event = intent("ThemeIntent", { theme: "space" });
    event.session = { ...event.session!, attributes: { demoFlow: "draft" } };
    const response = await handler(event);
    expect(ssml(response)).toMatch(/no draft was saved/i);
    expect(response.sessionAttributes).toEqual({ demoFlow: "draft" });
    expect(response.response.shouldEndSession).toBe(false);
  });

  test("the parent can read back a saved demo draft", async () => {
    const latestDraft = vi.fn().mockResolvedValue({ status: "saved", draftId: "draft-1", theme: "space", outline: "A gentle trip through the stars." });
    const response = await createHandler({ skillId: SKILL_ID, agent: fakeAgent({ latestDraft }) })(intent("ReadDemoDraftIntent"));
    expect(latestDraft).toHaveBeenCalledWith({ deviceUserId: "amzn1.ask.account.OWNER" });
    expect(ssml(response)).toContain("A gentle trip through the stars.");
    expect(ssml(response)).toMatch(/story draft/i);
  });
  test("a pending draft does not turn a playback request into a saved draft", async () => {
    const saveDraft = vi.fn();
    const playlist = vi.fn().mockResolvedValue({ say: "Playing the forest story.", action: "play", play: PLAY, token: "server-token", playBehavior: "REPLACE_ALL" });
    const event = intent("CatchAllIntent", { text: "play the forest story" });
    event.session = { ...event.session!, attributes: { demoFlow: "draft" } };
    const response = await createHandler({ skillId: SKILL_ID, agent: fakeAgent({ saveDraft, playlist }) })(event);
    expect(saveDraft).not.toHaveBeenCalled();
    expect(ssml(response)).not.toMatch(/saved.*draft/i);
  });

  test("catch-all creation help gives private app steps", async () => {
    const saveDraft = vi.fn();
    const response = await createHandler({ skillId: SKILL_ID, agent: fakeAgent({ saveDraft }) })(intent("CatchAllIntent", { text: "how do I create a story" }));
    expect(ssml(response)).toMatch(/choose who to send it to in Spoken Letter/i);
    expect(saveDraft).not.toHaveBeenCalled();
  });
  test("starts a newest playlist through the authenticated command route and plays the server token", async () => {
    const playlist = vi.fn().mockResolvedValue({ say: "Playing your new stories.", action: "play", play: PLAY, token: "server-token", playBehavior: "REPLACE_ALL" });
    const agent = fakeAgent({ playlist });
    const response = await createHandler({ skillId: SKILL_ID, agent })(intent("PlayNewStoriesIntent"));
    expect(playlist).toHaveBeenCalledWith({ deviceUserId: "amzn1.ask.account.OWNER", command: "start", order: "newest" });
    expect(agent.turn).not.toHaveBeenCalled();
    expect(response.response.directives?.[0]).toMatchObject({ audioItem: { stream: { token: "server-token" } } });
  });

  test("a nearly finished callback enqueues only the controller's fresh next recording", async () => {
    const playlist = vi.fn().mockResolvedValue({ say: null, action: "play", play: PLAY, token: "next-token", playBehavior: "ENQUEUE", expectedPreviousToken: "current-token" });
    const agent = fakeAgent({ playlist });
    const response = await createHandler({ skillId: SKILL_ID, agent })(envelope({ type: "AudioPlayer.PlaybackNearlyFinished", token: "current-token", requestId: "event-1" }));
    expect(playlist).toHaveBeenCalledWith({ deviceUserId: "amzn1.ask.account.OWNER", command: "nearlyFinished", observedToken: "current-token", eventId: "event-1" });
    expect(response.response.outputSpeech).toBeUndefined();
    expect(response.response.directives?.[0]).toMatchObject({ playBehavior: "ENQUEUE", audioItem: { stream: { token: "next-token", expectedPreviousToken: "current-token" } } });
  });

  test("a finished callback records completion with no speech or playback", async () => {
    const playlist = vi.fn().mockResolvedValue({ say: null, action: "none" });
    const response = await createHandler({ skillId: SKILL_ID, agent: fakeAgent({ playlist }) })(envelope({ type: "AudioPlayer.PlaybackFinished", token: "current-token", requestId: "event-2" }));
    expect(playlist).toHaveBeenCalledWith({ deviceUserId: "amzn1.ask.account.OWNER", command: "finished", observedToken: "current-token", eventId: "event-2" });
    expect(response.response).toEqual({});
  });

  test("a failed playlist command tells the parent to retry without claiming playback", async () => {
    const playlist = vi.fn().mockRejectedValue(new Error("unavailable"));
    const response = await createHandler({ skillId: SKILL_ID, agent: fakeAgent({ playlist }) })(intent("PlayAllIntent"));
    expect(ssml(response)).toMatch(/ask again/i);
    expect(response.response.directives).toBeUndefined();
  });

  test("stale next does not ask the model to suggest another story", async () => {
    const agent = fakeAgent({ playlist: vi.fn().mockResolvedValue({ action: "none", say: null }) });
    const response = await createHandler({ skillId: SKILL_ID, agent })(intent("NextStoryIntent"));
    expect(response.response).toEqual({});
    expect(agent.turn).not.toHaveBeenCalled();
  });

  test("play again restarts the active recording instead of starting a new playlist", async () => {
    const playlist = vi.fn().mockResolvedValue({ action: "play", say: null, play: PLAY, token: "restart-token", playBehavior: "REPLACE_ALL" });
    const agent = fakeAgent({ playlist });
    const response = await createHandler({ skillId: SKILL_ID, agent })(intent("PlayAgainIntent"));
    expect(playlist).toHaveBeenCalledWith({ deviceUserId: "amzn1.ask.account.OWNER", command: "restart" });
    expect(response.response.directives?.[0]).toMatchObject({ audioItem: { stream: { offsetInMilliseconds: 0 } } });
    expect(agent.turn).not.toHaveBeenCalled();
  });

  test("resume without a stream token asks for a story before calling the controller", async () => {
    const playlist = vi.fn();
    const response = await createHandler({ skillId: SKILL_ID, agent: fakeAgent({ playlist }) })(intent("AMAZON.ResumeIntent"));
    expect(ssml(response)).toMatch(/nothing to resume/i);
    expect(playlist).not.toHaveBeenCalled();
  });

  test("a play-oriented model reply without audio never claims playback", async () => {
    const agent = fakeAgent({ turn: vi.fn().mockResolvedValue({ say: "Here it is, playing now.", play: null, toolCalls: [] }) });
    const response = await createHandler({ skillId: SKILL_ID, agent })(intent("PlayStoryIntent"));
    expect(ssml(response)).not.toMatch(/playing now/i);
    expect(response.response.directives).toBeUndefined();
  });

  test("an explicit needsAnswer reply preserves a specific clarification without punctuation", async () => {
    const agent = fakeAgent({ turn: vi.fn().mockResolvedValue({ say: "Which Aunt Whitney title did you mean", needsAnswer: true, play: null, toolCalls: [] }) });
    const response = await createHandler({ skillId: SKILL_ID, agent })(intent("PlayStoryIntent"));
    expect(ssml(response)).toContain("Which Aunt Whitney title did you mean");
  });

  test("a suggestion with no audio falls back to the newest delivered catalog story", async () => {
    const playlist = vi.fn()
      .mockResolvedValueOnce({ action: "none", say: null, fallbackToSuggestion: true })
      .mockResolvedValueOnce({ action: "play", say: "Playing Moon.", play: PLAY, token: "fallback-token", playBehavior: "REPLACE_ALL" });
    const agent = fakeAgent({ playlist, turn: vi.fn().mockResolvedValue({ say: "Here it is.", play: null, toolCalls: [] }) });
    const response = await createHandler({ skillId: SKILL_ID, agent })(intent("NextStoryIntent"));
    expect(playlist).toHaveBeenLastCalledWith({ deviceUserId: "amzn1.ask.account.OWNER", command: "start", order: "newest" });
    expect(response.response.directives?.[0]).toMatchObject({ audioItem: { stream: { token: "fallback-token" } } });
  });

  test("catch-all playback wording cannot turn model prose into a false playback claim", async () => {
    const playlist = vi.fn().mockResolvedValue({ action: "none", say: "I couldn't find that delivered story. You can ask for Moon." });
    const agent = fakeAgent({ playlist, turn: vi.fn().mockResolvedValue({ say: "Playing it now.", play: null, toolCalls: [] }) });
    const response = await createHandler({ skillId: SKILL_ID, agent })(intent("CatchAllIntent", { text: "play the lighthouse one" }));
    expect(playlist).toHaveBeenCalledWith({ deviceUserId: "amzn1.ask.account.OWNER", command: "title", title: "lighthouse" });
    expect(ssml(response)).not.toMatch(/playing it now/i);
    expect(ssml(response)).toMatch(/ask for Moon/i);
    expect(response.response.directives).toBeUndefined();
  });
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
      expect(ssml(response)).toMatch(/play my stories|what is new/i);
      expect(ssml(response)).not.toMatch(/grandpa/i);
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

  test("recording mode never records raw catch-all speech that may contain a child name", async () => {
    const record = vi.fn();
    const handler = createHandler({ skillId: SKILL_ID, agent: fakeAgent(), recordUtterance: record });
    await handler(intent("CatchAllIntent", { text: "create a story for Lily" }));
    await handler(intent("WhatIsNewIntent"));
    expect(JSON.stringify(record.mock.calls)).not.toContain("Lily");
  });
});

type SkillTurnFields = {
  slotPresence?: Record<string, "missing" | "present">;
  flowBefore: string;
  flowAfter: string;
  fallbackCount: number;
  interactionResult: string;
  responseKey: string;
  sessionHash?: string;
  requestHash: string;
  FallbackCount?: number;
  _aws?: { CloudWatchMetrics: { Dimensions: string[][]; Metrics: { Name: string }[] }[] };
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
    expect(ended).toMatchObject({ reason: "ERROR", error: "INTERNAL_SERVICE_ERROR" });
    expect(JSON.stringify(ended)).not.toContain("boom");
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
    expect(played).toMatchObject({ intent: "PlayStoryIntent", slots: { title: null }, played: true, storyId: PLAY.id, outcome: "ok" });
    expect(notPlayed).toMatchObject({ intent: "WhatIsNewIntent", slots: {}, played: false, storyId: null });
  });

  test("model speech is not logged even when logSay is requested", async () => {
    const longSay = "x".repeat(200);
    const agent = fakeAgent({ turn: vi.fn().mockResolvedValue({ say: longSay, play: null, toolCalls: [] }) });

    const withoutFlag = vi.spyOn(log, "info");
    await createHandler({ skillId: SKILL_ID, agent })(intent("WhatIsNewIntent"));
    expect(loggedSkillTurns(withoutFlag)[0]?.say).toBeUndefined();
    withoutFlag.mockRestore();

    const withFlag = vi.spyOn(log, "info");
    await createHandler({ skillId: SKILL_ID, agent, logSay: true })(intent("WhatIsNewIntent"));
    expect(loggedSkillTurns(withFlag)[0]?.say).toBeUndefined();
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


describe("session friction recovery", () => {
  function journey(agent: AgentClient, initial: Record<string, string> = {}) {
    const handler = createHandler({ skillId: SKILL_ID, agent });
    let attributes = initial;
    let request = 0;
    return async (name: string, slots: Record<string, string | undefined> = {}) => {
      const event = intent(name, slots);
      event.request.requestId = `journey-${++request}`;
      event.session = { ...event.session!, new: false, attributes };
      const response = await handler(event);
      attributes = response.sessionAttributes ?? {};
      return response;
    };
  }
  const reprompt = (r: AlexaResponseEnvelope) => r.response.reprompt?.outputSpeech.ssml ?? "";

  test.each(["mermaids", "space", "stars"])("S1 bare %s completes a prompted draft", async (theme) => {
    const saveDraft = vi.fn().mockResolvedValue({ status: "saved", draftId: "d1", theme, outline: "Safe outline." });
    // English creation is the staged create flow now, so the draft starts from its session state (D1).
    const turn = journey(fakeAgent({ saveDraft }), { demoFlow: "draft" });
    const prompt = await turn("AMAZON.HelpIntent");
    expect(reprompt(prompt)).toMatch(/mermaids.*space/i);
    const saved = await turn("ThemeChoiceIntent", { drafttheme: theme });
    expect(ssml(saved)).toMatch(/saved your story draft/i);
    expect(saveDraft).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ theme, requestId: "journey-2" }));
  });
  test("S3 consecutive fallbacks preserve the draft and escalate without writes", async () => {
    const saveDraft = vi.fn().mockResolvedValue({ status: "saved", draftId: "d1", theme: "mermaids", outline: "Safe." });
    const turn = journey(fakeAgent({ saveDraft }), { demoFlow: "draft" });
    const first = await turn("AMAZON.FallbackIntent");
    expect(first.sessionAttributes).toEqual({ demoFlow: "draft", fallbackCount: "1" });
    expect(reprompt(first)).toMatch(/mermaids.*space/i);
    const second = await turn("AMAZON.FallbackIntent");
    expect(second.sessionAttributes).toEqual({ demoFlow: "draft", fallbackCount: "2" });
    expect(ssml(second)).toMatch(/about mermaids/i);
    expect(ssml(second)).toMatch(/cancel/i);
    expect(saveDraft).not.toHaveBeenCalled();
    expect(ssml(await turn("ThemeChoiceIntent", { drafttheme: "mermaids" }))).toMatch(/saved your story draft/i);
    expect(saveDraft).toHaveBeenCalledTimes(1);
  });
  test.each([{}, { demoFlow: "reaction" }, { demoFlow: "wish", demoTopic: "space" }])("S4 bare topic outside draft does not write: %j", async (state) => {
    const saveDraft = vi.fn();
    const demoWish = vi.fn();
    const response = await journey(fakeAgent({ saveDraft, demoWish }), state)("ThemeChoiceIntent", { drafttheme: "space" });
    expect(saveDraft).not.toHaveBeenCalled();
    expect(demoWish).not.toHaveBeenCalled();
    expect(ssml(response)).toMatch(/create a story|like or love|yes or no/i);
  });
  test.each(["AMAZON.CancelIntent", "AMAZON.NoIntent", "PlayStoryIntent", "HelpTopicIntent"])("S5 %s clears obsolete draft state", async (name) => {
    const saveDraft = vi.fn();
    const turn = journey(fakeAgent({ saveDraft }), { demoFlow: "draft" });
    const response = await turn(name);
    expect(response.sessionAttributes).toEqual({});
    await turn("ThemeChoiceIntent", { drafttheme: "space" });
    expect(saveDraft).not.toHaveBeenCalled();
  });
  test("S6 fixed error copy retains theme entry and never repeats backend text", async () => {
    const saveDraft = vi.fn().mockRejectedValueOnce(new AgentHttpError(422, "unsupported_theme", "Lily private speech"))
      .mockRejectedValueOnce(new Error("private failure"))
      .mockResolvedValue({ status: "saved", draftId: "d1", theme: "space", outline: "Safe." });
    const turn = journey(fakeAgent({ saveDraft }), { demoFlow: "draft" });
    const missing = await turn("ThemeChoiceIntent");
    expect(reprompt(missing)).toMatch(/mermaids.*space/i);
    expect(saveDraft).not.toHaveBeenCalled();
    const unsupported = await turn("ThemeChoiceIntent", { drafttheme: "unknown" });
    expect(ssml(unsupported)).not.toContain("Lily");
    expect(unsupported.sessionAttributes).toEqual({ demoFlow: "draft" });
    const failed = await turn("ThemeIntent", { theme: "space" });
    expect(ssml(failed)).toMatch(/no draft was saved/i);
    expect(reprompt(failed)).toMatch(/mermaids.*space/i);
    expect(ssml(await turn("ThemeIntent", { theme: "space" }))).toMatch(/saved your story draft/i);
  });
  test.each(["AMAZON.FallbackIntent", "AMAZON.HelpIntent"])("S7 %s preserves validated wish/reaction state", async (name) => {
    const demoWish = vi.fn().mockResolvedValue({ status: "saved", wishId: "w1" });
    const wish = journey(fakeAgent({ demoWish }), { demoFlow: "wish", demoTopic: "space", demoStoryteller: "Aunt Whitney", secret: "Lily" });
    const guidance = await wish(name);
    expect(reprompt(guidance)).toMatch(/yes or no/i);
    expect(guidance.sessionAttributes).toMatchObject({ demoFlow: "wish", demoTopic: "space", demoStoryteller: "Aunt Whitney" });
    expect(JSON.stringify(guidance)).not.toContain("Lily");
    expect(ssml(await wish("AMAZON.YesIntent"))).toMatch(/saved your wish/i);
    const demoReact = vi.fn().mockResolvedValue({ status: "saved", reactionId: "r1", storyId: "s1", choice: "love" });
    const reaction = journey(fakeAgent({ demoReact }), { demoFlow: "reaction" });
    expect(reprompt(await reaction(name))).toMatch(/I like it.*I love it.*no/i);
    expect(ssml(await reaction("ReactToStoryIntent", { choice: "love" }))).toMatch(/saved that you loved/i);
  });
  test.each([
    { demoFlow: "arbitrary", fallbackCount: "900", extra: "Lily" },
    { demoFlow: "wish", demoTopic: "space for Lily" },
    { demoFlow: "wish", demoTopic: "space", demoStoryteller: "Lily" },
  ])("S8 malformed state cannot confirm a write: %j", async (state) => {
    const demoWish = vi.fn();
    const response = await journey(fakeAgent({ demoWish }), state)("AMAZON.YesIntent");
    expect(demoWish).not.toHaveBeenCalled();
    expect(JSON.stringify(response)).not.toContain("Lily");
    expect(response.sessionAttributes).toEqual({});
    expect(ssml(response)).toMatch(/wish|create a story/i);
  });
  test("S9 limit reached offers readback or later retry", async () => {
    const saveDraft = vi.fn().mockRejectedValue(new AgentHttpError(429, "draft_limit_reached", "untrusted"));
    const response = await journey(fakeAgent({ saveDraft }), { demoFlow: "draft" })("ThemeIntent", { theme: "space" });
    expect(ssml(response)).toMatch(/no draft was saved/i);
    expect(ssml(response)).toMatch(/read.*draft/i);
    expect(ssml(response)).toMatch(/later/i);
    expect(ssml(response)).not.toMatch(/again in a moment/i);
  });
});

describe("additional phase 1 acceptance", () => {
  test("S2 explicit start theme and existing carrier each save their selected theme", async () => {
    const saveDraft = vi.fn().mockResolvedValue({ status: "saved", draftId: "d1", theme: "forest", outline: "Safe." });
    const handler = createHandler({ skillId: SKILL_ID, agent: fakeAgent({ saveDraft }) });
    // An explicit start theme saves in Spanish only: English creation is the staged create flow (D1).
    const spanish = intent("StartStoryIntent", { theme: "forest" });
    spanish.request.locale = "es-ES";
    const saved = await handler(spanish);
    expect(saved.response.shouldEndSession).toBe(true);
    expect(ssml(saved)).toMatch(/borrador/i);
    const carrier = intent("ThemeIntent", { theme: "animals" });
    carrier.session = { ...carrier.session!, attributes: { demoFlow: "draft" } };
    carrier.request.requestId = "carrier-2";
    expect(ssml(await handler(carrier))).toMatch(/saved your story draft/i);
    expect(saveDraft).toHaveBeenCalledTimes(2);
    expect(saveDraft).toHaveBeenNthCalledWith(1, expect.objectContaining({ theme: "forest" }));
    expect(saveDraft).toHaveBeenNthCalledWith(2, expect.objectContaining({ theme: "animals" }));
  });
  test("S4 reopening does not resurrect pending draft state", async () => {
    const saveDraft = vi.fn();
    const handler = createHandler({ skillId: SKILL_ID, agent: fakeAgent({ saveDraft }) });
    await handler(intent("StartStoryIntent"));
    const reopened = await handler(envelope({ type: "LaunchRequest" }));
    expect(reopened.sessionAttributes).toEqual({});
    await handler(intent("ThemeChoiceIntent", { drafttheme: "mermaids" }));
    expect(saveDraft).not.toHaveBeenCalled();
  });
  test("wish entry questions use theme or wish-specific reprompts", async () => {
    const handler = createHandler({ skillId: SKILL_ID, agent: fakeAgent() });
    const missing = await handler(intent("WishStoryIntent"));
    expect(missing.response.reprompt?.outputSpeech.ssml).toMatch(/I want a story about space/i);
    const unknown = await handler(intent("WishStoryIntent", { wishtopic: "space", storyteller: "Lily" }));
    expect(unknown.response.reprompt?.outputSpeech.ssml).toMatch(/wish|want a story/i);
  });
});

test.each(["AMAZON.HelpIntent", "AMAZON.FallbackIntent"])("invalid wish state receives safe restart guidance on %s", async (name) => {
  const demoWish = vi.fn();
  const event = intent(name);
  event.session = { ...event.session!, attributes: { demoFlow: "wish", demoTopic: "space for Lily", extra: "private" } };
  const response = await createHandler({ skillId: SKILL_ID, agent: fakeAgent({ demoWish }) })(event);
  expect(ssml(response)).toMatch(/start a wish.*I want a story about space/i);
  expect(JSON.stringify(response)).not.toContain("Lily");
  expect(response.sessionAttributes).toEqual({});
  expect(demoWish).not.toHaveBeenCalled();
});


test("pending draft handoff clears state and help resets only the fallback counter", async () => {
  const saveDraft = vi.fn();
  const handler = createHandler({ skillId: SKILL_ID, agent: fakeAgent({ saveDraft }) });
  const draft = intent("AMAZON.FallbackIntent");
  draft.session = { ...draft.session!, attributes: { demoFlow: "draft", fallbackCount: "900", extra: "Lily" } };
  const first = await handler(draft);
  expect(first.sessionAttributes).toEqual({ demoFlow: "draft", fallbackCount: "1" });
  const help = intent("AMAZON.HelpIntent");
  help.session = { ...help.session!, attributes: first.sessionAttributes! };
  const helped = await handler(help);
  expect(helped.sessionAttributes).toEqual({ demoFlow: "draft" });
  draft.session.attributes = helped.sessionAttributes!;
  expect((await handler(draft)).sessionAttributes).toEqual({ demoFlow: "draft", fallbackCount: "1" });
  const named = intent("CatchAllIntent", { text: "create a story for Lily" });
  named.session = { ...named.session!, attributes: { demoFlow: "draft" } };
  const handoff = await handler(named);
  expect(handoff.sessionAttributes).toEqual({ demoFlow: "create", createStage: "listener" });
  expect(ssml(handoff)).not.toContain("Lily");
  await handler(intent("ThemeChoiceIntent", { drafttheme: "mermaids" }));
  expect(saveDraft).not.toHaveBeenCalled();
});


describe("safe session diagnostics", () => {
  afterEach(() => vi.unstubAllEnvs());
  test.each([undefined, "   ", "mermaids for Lily"])("T1 presence distinguishes supplied input %j without values", async (theme) => {
    const info = vi.spyOn(log, "info");
    await createHandler({ skillId: SKILL_ID, agent: fakeAgent() })(intent("StartStoryIntent", { theme }));
    const [line] = loggedSkillTurns(info);
    expect(line?.slotPresence).toEqual({ theme: theme?.trim() ? "present" : "missing" });
    expect(line?.slots).toEqual({ theme: null });
    expect(JSON.stringify(line)).not.toContain("Lily");
  });
  test("T2 hashes correlate start, fallbacks, and receipt-backed completion", async () => {
    vi.stubEnv("EMF_NAMESPACE", "sla/mcp");
    const info = vi.spyOn(log, "info");
    const saveDraft = vi.fn().mockResolvedValue({ status: "saved", draftId: "d1", theme: "space", outline: "Safe." });
    const handler = createHandler({ skillId: SKILL_ID, agent: fakeAgent({ saveDraft }) });
    // English creation is the staged create flow now (D1): the draft starts from its session state.
    let state: Record<string, string> = { demoFlow: "draft" };
    for (const [i, name] of ["AMAZON.HelpIntent", "AMAZON.FallbackIntent", "AMAZON.FallbackIntent", "ThemeChoiceIntent"].entries()) {
      const event = intent(name, name === "ThemeChoiceIntent" ? { drafttheme: "space" } : {});
      event.request.requestId = `turn-${i}`;
      event.session = { ...event.session!, new: false, attributes: state };
      state = (await handler(event)).sessionAttributes ?? {};
    }
    const lines = loggedSkillTurns(info);
    expect(lines.map((line) => [line.flowBefore, line.flowAfter, line.interactionResult, line.responseKey, line.fallbackCount, line.FallbackCount])).toEqual([
      ["draft", "draft", "awaiting_input", "theme_recovery", 0, 0],
      ["draft", "draft", "fallback", "theme_recovery", 1, 1],
      ["draft", "draft", "fallback", "theme_recovery", 2, 1],
      ["draft", "none", "completed", "draft_saved", 0, 0],
    ]);
    expect(new Set(lines.map((line) => line.sessionHash)).size).toBe(1);
    expect(new Set(lines.map((line) => line.requestHash)).size).toBe(4);
    expect(lines[0]?.sessionHash).toBe(createHash("sha256").update("alexa-session\0amzn1.echo-api.session.1").digest("hex"));
    expect(lines[0]?.requestHash).toBe(createHash("sha256").update("alexa-request\0turn-0").digest("hex"));
    expect(JSON.stringify(lines)).not.toMatch(/amzn1\.ask\.account|amzn1\.echo-api|turn-0/);
    for (const line of lines) {
      expect(line._aws?.CloudWatchMetrics.find((metric) => metric.Metrics[0]?.Name === "FallbackCount")?.Dimensions).toEqual([[]]);
      expect(line._aws?.CloudWatchMetrics.find((metric) => metric.Metrics[0]?.Name === "SkillTurnMs")?.Dimensions).toEqual([["Intent"], []]);
    }
  });
  test("T3 generic fallback and playback emit one and zero", async () => {
    vi.stubEnv("EMF_NAMESPACE", "sla/mcp");
    const info = vi.spyOn(log, "info");
    const handler = createHandler({ skillId: SKILL_ID, agent: fakeAgent() });
    await handler(intent("AMAZON.FallbackIntent"));
    await handler(intent("PlayStoryIntent", { title: "the owl" }));
    const [fallback, played] = loggedSkillTurns(info);
    expect(fallback).toMatchObject({ outcome: "ok", interactionResult: "fallback", responseKey: "general_recovery", FallbackCount: 1 });
    expect(played).toMatchObject({ outcome: "ok", interactionResult: "completed", responseKey: "agent_reply", played: true, FallbackCount: 0 });
  });
  test.each([
    ["ThemeIntent", "saveDraft", { theme: "space" }],
    ["ReadDemoDraftIntent", "latestDraft", {}],
    ["WishStoryIntent", "demoWish", {}],
    ["ReactToStoryIntent", "demoReact", { choice: "love" }],
    ["UpdatesIntent", "demoInbox", {}],
  ] as const)("T4 %s catches dependency errors accurately", async (name, method, slots) => {
    const info = vi.spyOn(log, "info");
    const agent = fakeAgent({ [method]: vi.fn().mockRejectedValue(new AgentHttpError(503, "update_unavailable", "Lily token=private")) });
    const handler = createHandler({ skillId: SKILL_ID, agent });
    const event = intent(name === "WishStoryIntent" ? "AMAZON.YesIntent" : name, slots);
    if (name === "WishStoryIntent") event.session = { ...event.session!, attributes: { demoFlow: "wish", demoTopic: "space" } };
    if (name === "ThemeIntent") event.session = { ...event.session!, attributes: { demoFlow: "draft" } };
    await handler(event);
    const [line] = loggedSkillTurns(info);
    expect(line).toMatchObject({ outcome: "rejected", errorClass: "AgentHttpError:update_unavailable", interactionResult: "retry" });
    expect(JSON.stringify(line)).not.toMatch(/Lily|token=private/);
  });
  test.each([
    [new AgentHttpError(200, "malformed", "Lily"), "rejected", "AgentHttpError:malformed"],
    [new AgentHttpError(503, "Lily private code", "Lily"), "rejected", "AgentHttpError:unknown"],
    [new DOMException("Lily", "AbortError"), "timeout", "DOMException"],
    [Object.assign(new Error("Lily"), { name: "Lily" }), "agent_error", "Error"],
  ] as const)("T4 draft failure classification is bounded", async (error, outcome, errorClass) => {
    const info = vi.spyOn(log, "info");
    const event = intent("ThemeIntent", { theme: "space" });
    event.session = { ...event.session!, attributes: { demoFlow: "draft" } };
    await createHandler({ skillId: SKILL_ID, agent: fakeAgent({ saveDraft: vi.fn().mockRejectedValue(error) }) })(event);
    expect(loggedSkillTurns(info)[0]).toMatchObject({ outcome, errorClass, interactionResult: "retry", responseKey: "theme_recovery" });
  });
  test("T5 adversarial slot keys, values, state, and optional flags never enter diagnostics", async () => {
    const info = vi.spyOn(log, "info");
    const record = vi.fn();
    const handler = createHandler({ skillId: SKILL_ID, agent: fakeAgent({ turn: vi.fn().mockResolvedValue({ say: "Lily model text", play: null, toolCalls: [] }) }), recordUtterance: record, logSay: true });
    const event = intent("WhatIsNewIntent", { storyteller: "Lily", "Lily-unknown-slot": "secret-token" });
    event.session = { ...event.session!, attributes: { demoFlow: "Lily", secret: "Lily" } };
    await handler(event);
    const line = loggedSkillTurns(info)[0];
    expect(line?.slotPresence).toEqual({ storyteller: "present" });
    expect(line?.slots).toEqual({ storyteller: null });
    expect(line?.flowBefore).toBe("none");
    expect(JSON.stringify(line)).not.toMatch(/Lily|secret-token|model text|amzn1\.ask\.account|amzn1\.echo-api/);
    expect(record).not.toHaveBeenCalled();
  });
  test("T6 callbacks omit absent sessions and closing turns classify once", async () => {
    const info = vi.spyOn(log, "info");
    const handler = createHandler({ skillId: SKILL_ID, agent: fakeAgent() });
    const audio = envelope({ type: "AudioPlayer.PlaybackStarted" });
    delete audio.session;
    await handler(audio);
    await handler(envelope({ type: "SessionEndedRequest", reason: "USER_INITIATED" }));
    const cancel = intent("AMAZON.CancelIntent");
    cancel.session = { ...cancel.session!, attributes: { demoFlow: "draft" } };
    await handler(cancel);
    const lines = loggedSkillTurns(info);
    expect(lines).toHaveLength(3);
    expect(lines[0]?.sessionHash).toBeUndefined();
    expect(lines[0]?.slotPresence).toBeUndefined();
    expect(lines.map((line) => line.interactionResult)).toEqual(["no_action", "no_action", "canceled"]);
    expect(lines[2]?.flowAfter).toBe("none");
  });
});

test("app handoff and credit intents discard unknown aliases without writes", async () => {
  const agent = fakeAgent({ saveDraft: vi.fn(), demoWish: vi.fn(), demoReact: vi.fn(), playlist: vi.fn() });
  const handler = createHandler({ skillId: SKILL_ID, agent });
  // English handoffs enter the staged create flow (D1); an unknown name is never repeated (SS7).
  const named = await handler(intent("AppHandoffIntent", { listeneralias: "Morgan" }));
  expect(ssml(named)).toMatch(/Who is the story for\?/);
  expect(ssml(named)).not.toContain("Morgan");
  expect(ssml(await handler(intent("CreditHelpIntent")))).toContain("add story credits in Spoken Letter");
  expect(agent.turn).not.toHaveBeenCalled();
  expect(agent.saveDraft).not.toHaveBeenCalled();
  expect(agent.demoWish).not.toHaveBeenCalled();
  expect(agent.demoReact).not.toHaveBeenCalled();
  expect(agent.playlist).not.toHaveBeenCalled();
});

test("named wish with an omitted unknown storyteller asks who instead of dropping the request", async () => {
  const demoWish = vi.fn();
  const handler = createHandler({ skillId: SKILL_ID, agent: fakeAgent({ demoWish }) });
  const response = await handler(intent("WishFromStorytellerIntent", { wishtopic: "mermaids" }));
  expect(ssml(response)).toContain("Who would you like a story from");
  expect(response.sessionAttributes).toEqual({});
  expect(demoWish).not.toHaveBeenCalled();
});

test("a title ending in a known storyteller is split into the title and the storyteller", async () => {
  const playlist = vi.fn().mockResolvedValue({ action: "none", say: "Which story?" });
  const handler = createHandler({ skillId: SKILL_ID, agent: fakeAgent({ playlist }) });
  await handler(intent("PlayStoryIntent", { title: "El Trasgu by tio manuel" }));
  expect(playlist).toHaveBeenLastCalledWith(expect.objectContaining({ command: "title", title: "El Trasgu", storyteller: "Tío Manuel" }));
  await handler(intent("PlayStoryIntent", { title: "the owl from someone else" }));
  expect(playlist).toHaveBeenLastCalledWith(expect.objectContaining({ command: "title", title: "the owl from someone else" }));
  expect(playlist.mock.lastCall?.[0]).not.toHaveProperty("storyteller");
});

test("title playback removes the spoken short-title story wrapper", async () => {
  const playlist = vi.fn().mockResolvedValue({ action: "none", say: "Which story?" });
  const handler = createHandler({ skillId: SKILL_ID, agent: fakeAgent({ playlist }) });
  await handler(intent("PlayStoryIntent", { title: "the Ignacio story" }));
  expect(playlist).toHaveBeenLastCalledWith(expect.objectContaining({ command: "title", title: "Ignacio" }));
  await handler(intent("PlayStoryIntent", { title: "Ignacio the snail" }));
  expect(playlist).toHaveBeenLastCalledWith(expect.objectContaining({ command: "title", title: "Ignacio the snail" }));
});
