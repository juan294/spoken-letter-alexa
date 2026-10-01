import { log } from "@spoken-letter-alexa/shared";
import { afterEach, describe, expect, test, vi } from "vitest";

import { type DraftGenerator, MemoryDemoDraftStore } from "../../agent/src/demo-drafts.ts";
import { MemoryPlaylistStore } from "../../agent/src/playlist.ts";
import { createAgentApp } from "../../agent/src/routes.ts";
import { ScriptedModel } from "../../agent/src/scripted-model.ts";
import { deviceSessionId, MemorySessionStore } from "../../agent/src/sessions.ts";
import { MCP_URL, mcpHarness } from "../../agent/src/test-support.ts";
import { createAgentClient } from "./agent-client.ts";
import { type AlexaRequestEnvelope, type AlexaResponseEnvelope, createHandler } from "./handler.ts";

const SKILL_ID = "amzn1.ask.skill.local-rehearsal";
const DEVICE_ID = "amzn1.ask.account.local-rehearsal";
const SECRET = "local-rehearsal-command-secret";
const BASE = "http://skill-rehearsal.local";
const choices = { place: "quiet shore", challenge: "small mystery", ending: "kindness" } as const;
const speech = (response: AlexaResponseEnvelope) => response.response.outputSpeech?.ssml ?? "";
type SafeTurn = {
  responseKey: string; interactionResult: string; flowBefore: string; flowAfter: string;
  sessionHash?: string; requestHash: string; slotPresence?: Record<string, string>; outcome: string; errorClass?: string;
};

async function rehearsal(generator: DraftGenerator = () => Promise.resolve(choices)) {
  const mcp = await mcpHarness();
  const drafts = new MemoryDemoDraftStore();
  const sessions = new MemorySessionStore();
  const app = createAgentApp({
    model: new ScriptedModel(), modelId: null, mcpUrl: MCP_URL, mcpFetch: mcp.fetch,
    deviceMcp: { url: MCP_URL, fetch: mcp.fetch }, sessions,
    speech: { synthesize: () => Promise.resolve(null) }, transcribe: () => Promise.resolve(""),
    demoToken: mcp.serviceToken, offline: true,
    playlist: { store: new MemoryPlaylistStore(), secret: SECRET }, drafts: { store: drafts, generator },
  });
  const requests: { path: string; status: number }[] = [];
  const network: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    expect(new URL(url).origin).toBe(BASE);
    const path = new URL(url).pathname;
    if (path.startsWith("/agent/demo/") || path === "/agent/playlist") {
      expect(new Headers(init?.headers).get("x-alexa-skill-secret")).toBe(SECRET);
    }
    const response = await app.request(url, init);
    requests.push({ path, status: response.status });
    return response;
  };
  const agent = createAgentClient({ baseUrl: BASE, fetch: network, timeoutMs: 7_000, skillSecret: SECRET });
  const handler = createHandler({ skillId: SKILL_ID, agent });
  let attributes: Record<string, string> = {};
  let requestIndex = 0;
  let sessionIndex = 1;
  let previous: AlexaRequestEnvelope | undefined;
  const submit = async (event: AlexaRequestEnvelope) => {
    const response = await handler(event);
    attributes = response.sessionAttributes ?? {};
    previous = event;
    return response;
  };
  const eventFor = (name: string, slots: Record<string, string>, launch = false): AlexaRequestEnvelope => ({
    version: "1.0",
    session: {
      new: launch, sessionId: `rehearsal-session-${sessionIndex}`, application: { applicationId: SKILL_ID },
      user: { userId: DEVICE_ID }, attributes,
    },
    context: { System: { application: { applicationId: SKILL_ID }, user: { userId: DEVICE_ID } } },
    request: {
      type: launch ? "LaunchRequest" : "IntentRequest", requestId: `rehearsal-request-${++requestIndex}`,
      timestamp: "2026-10-01T12:00:00Z", locale: "en-US",
      ...(!launch && { intent: { name, slots: Object.fromEntries(Object.entries(slots).map(([key, value]) => [key, { name: key, value }])) } }),
    },
  });
  return {
    drafts, sessions, requests,
    state: () => drafts.get(deviceSessionId(DEVICE_ID)),
    turn: (name: string, slots: Record<string, string> = {}) => submit(eventFor(name, slots)),
    open: () => { attributes = {}; sessionIndex += 1; return submit(eventFor("", {}, true)); },
    duplicate: () => { if (!previous) throw new Error("No prior turn"); return submit(previous); },
  };
}

afterEach(() => vi.restoreAllMocks());

describe("real skill session recovery rehearsal", () => {
  test("I1 two fallbacks make no write and one bare theme produces exact receipt readback", async () => {
    const info = vi.spyOn(log, "info");
    const h = await rehearsal();
    const start = await h.turn("StartStoryIntent");
    expect(start.response.reprompt?.outputSpeech.ssml).toMatch(/mermaids.*space/i);
    expect(await h.state()).toBeNull();
    await h.turn("AMAZON.FallbackIntent");
    const repeated = await h.turn("AMAZON.FallbackIntent");
    expect(speech(repeated)).toMatch(/about mermaids.*cancel/i);
    expect(await h.state()).toBeNull();
    expect(h.requests).toHaveLength(0);
    const saved = await h.turn("ThemeChoiceIntent", { drafttheme: "mermaids" });
    expect(speech(saved)).toMatch(/saved your story draft/i);
    const state = await h.state();
    expect(state?.receipts).toHaveLength(1);
    const receipt = state?.receipts[0];
    expect(receipt?.theme).toBe("mermaids");
    const read = await h.turn("ReadDemoDraftIntent");
    expect(speech(read)).toBe(`<speak>Your story draft says: ${receipt?.outline}</speak>`);
    expect((await h.state())?.receipts[0]?.draftId).toBe(receipt?.draftId);
    expect(h.requests).toEqual([{ path: "/agent/demo/draft", status: 200 }, { path: "/agent/demo/draft/latest", status: 200 }]);
    const turns = info.mock.calls.filter(([event]) => event === "skill_turn").map(([, fields]) => fields as SafeTurn);
    expect(turns).toHaveLength(5);
    expect(turns.map((turn) => turn.interactionResult)).toEqual(["awaiting_input", "fallback", "fallback", "completed", "completed"]);
    expect(turns.map((turn) => turn.responseKey)).toEqual(["theme_prompt", "theme_recovery", "theme_recovery", "draft_saved", "draft_read"]);
    expect(turns.map((turn) => [turn.flowBefore, turn.flowAfter])).toEqual([["none", "draft"], ["draft", "draft"], ["draft", "draft"], ["draft", "none"], ["none", "none"]]);
    for (const turn of turns) expect(turn.sessionHash).toMatch(/^[a-f0-9]{64}$/);
    expect(new Set(turns.map((turn) => turn.sessionHash)).size).toBe(1);
    expect(new Set(turns.map((turn) => turn.requestHash)).size).toBe(5);
    expect(turns[3]?.slotPresence).toEqual({ drafttheme: "present" });
    expect(JSON.stringify(turns)).not.toMatch(/rehearsal-session|rehearsal-request|amzn1\.ask\.account/);
  });

  test("I2 unavailable generation recovers and duplicate delivery adds no receipt", async () => {
    const info = vi.spyOn(log, "info");
    let generationCalls = 0;
    const h = await rehearsal(() => {
      generationCalls += 1;
      return generationCalls === 1 ? Promise.reject(new Error("private model failure")) : Promise.resolve(choices);
    });
    await h.turn("StartStoryIntent");
    const failed = await h.turn("ThemeIntent", { theme: "forest" });
    expect(speech(failed)).toMatch(/no draft was saved/i);
    expect(failed.sessionAttributes).toEqual({ demoFlow: "draft" });
    expect(await h.state()).toBeNull();
    const saved = await h.turn("ThemeChoiceIntent", { drafttheme: "stars" });
    expect(speech(saved)).toMatch(/saved your story draft/i);
    const receipt = (await h.state())?.receipts[0];
    expect(receipt?.theme).toBe("space");
    const duplicate = await h.duplicate();
    expect(speech(duplicate)).toBe(speech(saved));
    expect((await h.state())?.receipts).toHaveLength(1);
    expect((await h.state())?.receipts[0]?.draftId).toBe(receipt?.draftId);
    expect(generationCalls).toBe(2);
    expect(h.requests.map((request) => request.status)).toEqual([503, 200, 200]);
    const turns = info.mock.calls.filter(([event]) => event === "skill_turn").map(([, fields]) => fields as SafeTurn);
    expect(turns[1]).toMatchObject({ outcome: "rejected", errorClass: "AgentHttpError:draft_unavailable", interactionResult: "retry", responseKey: "theme_recovery" });
    expect(turns[2]?.requestHash).toBe(turns[3]?.requestHash);
    expect(JSON.stringify(turns)).not.toContain("private model failure");
  });

  test("I3 cancellation and reopening discard pending entry, fresh explicit flow works", async () => {
    const h = await rehearsal();
    await h.turn("StartStoryIntent");
    const canceled = await h.turn("AMAZON.CancelIntent");
    expect(canceled.sessionAttributes).toEqual({});
    await h.turn("ThemeChoiceIntent", { drafttheme: "mermaids" });
    expect(await h.state()).toBeNull();
    await h.turn("StartStoryIntent");
    await h.open();
    await h.turn("ThemeChoiceIntent", { drafttheme: "space" });
    expect(await h.state()).toBeNull();
    expect(h.requests.filter((request) => request.path === "/agent/demo/draft")).toHaveLength(0);
    await h.turn("StartStoryIntent");
    const saved = await h.turn("ThemeIntent", { theme: "animals" });
    expect(speech(saved)).toMatch(/saved your story draft/i);
    expect((await h.state())?.receipts).toHaveLength(1);
    expect((await h.state())?.receipts[0]?.theme).toBe("animals");
  });

  test("I4 handoff, unsupported input, and playback never turn names or playback into drafts", async () => {
    const info = vi.spyOn(log, "info");
    const h = await rehearsal();
    await h.turn("StartStoryIntent");
    const named = await h.turn("CatchAllIntent", { text: "create a story for Lily" });
    expect(named.sessionAttributes).toEqual({});
    expect(speech(named)).not.toContain("Lily");
    expect(await h.state()).toBeNull();
    await h.turn("StartStoryIntent");
    const unsupported = await h.turn("ThemeIntent", { theme: "for Lily" });
    expect(speech(unsupported)).toMatch(/no draft was saved/i);
    expect(speech(unsupported)).not.toContain("Lily");
    expect(unsupported.sessionAttributes).toEqual({ demoFlow: "draft" });
    expect(await h.state()).toBeNull();
    const playback = await h.turn("CatchAllIntent", { text: "play the forest story" });
    expect(playback.response.directives?.[0]?.type).toBe("AudioPlayer.Play");
    expect(playback.sessionAttributes).toEqual({});
    expect(await h.state()).toBeNull();
    const session = await h.sessions.get(deviceSessionId(DEVICE_ID));
    expect(session).not.toBeNull();
    expect(JSON.stringify(session)).not.toContain("Lily");
    await h.turn("StartStoryIntent");
    const saved = await h.turn("ThemeChoiceIntent", { drafttheme: "mermaids" });
    expect(speech(saved)).toMatch(/saved your story draft/i);
    const state = await h.state();
    expect(state?.receipts).toHaveLength(1);
    expect(state?.receipts[0]?.theme).toBe("mermaids");
    expect(JSON.stringify(state)).not.toContain("Lily");
    expect(JSON.stringify(info.mock.calls)).not.toContain("Lily");
    expect(h.requests.filter((request) => request.path === "/agent/demo/draft").map((request) => request.status)).toEqual([422, 200]);
  });
});
