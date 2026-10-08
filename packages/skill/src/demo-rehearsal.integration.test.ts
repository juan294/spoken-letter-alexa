import { loadFixtureCatalog } from "@spoken-letter-alexa/mcp-server";
import { log } from "@spoken-letter-alexa/shared";
import { afterEach, describe, expect, test, vi } from "vitest";

import { MemoryCreationStore } from "../../agent/src/create-flow.ts";
import { type DraftGenerator, MemoryDemoDraftStore } from "../../agent/src/demo-drafts.ts";
import { MemoryDemoUpdateStore } from "../../agent/src/demo-updates.ts";
import { MemoryPlaylistStore } from "../../agent/src/playlist.ts";
import { createAgentApp } from "../../agent/src/routes.ts";
import { ScriptedModel } from "../../agent/src/scripted-model.ts";
import { deviceSessionId, MemorySessionStore } from "../../agent/src/sessions.ts";
import { MCP_URL, mcpHarness } from "../../agent/src/test-support.ts";
import { createAgentClient } from "./agent-client.ts";
import type { PlayDirective } from "./audio.ts";
import { type AlexaRequestEnvelope, type AlexaResponseEnvelope, createHandler } from "./handler.ts";
import { FIXTURES_PATH } from "./model/generate.ts";

const SKILL_ID = "amzn1.ask.skill.demo-rehearsal";
const DEVICE_ID = "amzn1.ask.account.demo-rehearsal";
const SECRET = "demo-rehearsal-command-secret";
const AGENT = "http://skill-rehearsal.local";
const PUBLIC = "https://alexa.spokenletter.com";
const APL = { "Alexa.Presentation.APL": { runtime: { maxVersion: "2024.3" } } };
const unusedGenerator: DraftGenerator = () => Promise.reject(new Error("no drafts in this rehearsal"));

type Slot = string | { heard: string; canonical: string };

/**
 * J1 (staged demo plan, revised for Jordan's script): her lines, verbatim, through the real
 * handler, agent client, agent routes and MCP fixture catalog, on a screen device. Alexa's
 * replies are compared with her script's wording; line 9 is the credits-only replacement for
 * the dropped purchase scene (D10).
 */
async function rehearsal() {
  const mcp = await mcpHarness(await loadFixtureCatalog(FIXTURES_PATH));
  const creations = new MemoryCreationStore();
  const app = createAgentApp({
    model: new ScriptedModel(), modelId: null, mcpUrl: MCP_URL, mcpFetch: mcp.fetch,
    deviceMcp: { url: MCP_URL, fetch: mcp.fetch }, sessions: new MemorySessionStore(),
    speech: { synthesize: () => Promise.resolve(null) }, transcribe: () => Promise.resolve(""),
    demoToken: mcp.serviceToken, offline: true,
    playlist: { store: new MemoryPlaylistStore(), secret: SECRET },
    drafts: { store: new MemoryDemoDraftStore(), generator: unusedGenerator },
    updates: { store: new MemoryDemoUpdateStore(), stories: [], seed: [] },
    creations: { store: creations },
  });
  const agent = createAgentClient({ baseUrl: AGENT, fetch: async (input, init) => app.request(input instanceof Request ? input.url : String(input), init), timeoutMs: 7_000, skillSecret: SECRET });
  const handler = createHandler({ skillId: SKILL_ID, agent, publicBaseUrl: PUBLIC });
  let attributes: Record<string, string> | undefined;
  let sessionIndex = 0;
  let requestIndex = 0;
  const event = (request: Record<string, unknown>, fresh: boolean): AlexaRequestEnvelope => {
    if (fresh) { sessionIndex += 1; attributes = undefined; }
    return {
      version: "1.0",
      session: { new: fresh, sessionId: `rehearsal-session-${sessionIndex}`, application: { applicationId: SKILL_ID }, user: { userId: DEVICE_ID }, ...(attributes && { attributes }) },
      context: { System: { application: { applicationId: SKILL_ID }, user: { userId: DEVICE_ID }, device: { supportedInterfaces: APL } } },
      request: { requestId: `rehearsal-request-${++requestIndex}`, timestamp: "2026-10-08T18:00:00Z", locale: "en-US", ...request } as AlexaRequestEnvelope["request"],
    };
  };
  const submit = async (envelope: AlexaRequestEnvelope) => {
    const response = await handler(envelope);
    attributes = response.response.shouldEndSession === true ? undefined : response.sessionAttributes;
    return response;
  };
  return {
    creations,
    /** "Alexa, open Spoken Letter." */
    open: () => submit(event({ type: "LaunchRequest" }, true)),
    /** A reply in the open session, or with `fresh` a one-shot "Alexa, … on Spoken Letter". */
    say: (name: string, slots: Record<string, Slot> = {}, fresh = false) => submit(event({ type: "IntentRequest", intent: { name, slots: Object.fromEntries(Object.entries(slots).map(([slot, input]) => [slot, typeof input === "string"
      ? { name: slot, value: input }
      : { name: slot, value: input.heard, resolutions: { resolutionsPerAuthority: [{ status: { code: "ER_SUCCESS_MATCH" }, values: [{ value: { name: input.canonical } }] }] } }])) } }, fresh)),
  };
}

const said = (response: AlexaResponseEnvelope) => (response.response.outputSpeech?.ssml ?? "")
  .replace(/^<speak>|<\/speak>$/g, "").replace(/&quot;/g, "\"").replace(/&amp;/g, "&");
const played = (response: AlexaResponseEnvelope) =>
  (response.response.directives ?? []).find((directive): directive is PlayDirective => directive.type === "AudioPlayer.Play");
const audio = (file: string) => `<audio src="${PUBLIC}/fixtures/takes/${file}"/>`;

afterEach(() => { vi.restoreAllMocks(); });

describe("Jordan's demo script (J1, J2)", () => {
  test("J1 every line, start to finish, offline", async () => {
    const info = vi.spyOn(log, "info");
    const h = await rehearsal();

    // Listening.
    expect(said(await h.open())).toBe("Here's Spoken Letter. Which story would you like to hear?"); // 1–2
    const whitney = await h.say("PlayStoryIntent", { storyteller: { heard: "aunt whitney", canonical: "Aunt Whitney" } }); // 3
    expect(played(whitney)?.audioItem.metadata.subtitle).toContain("Aunt Whitney"); // 4
    expect(said(whitney)).toMatch(/^Playing .+ by Aunt Whitney\.$/);
    const trasgu = await h.say("PlayStoryIntent", { title: "el trasgu by tio manuel" }, true); // 5
    expect(said(trasgu)).toBe("Playing El Trasgu by Tío Manuel."); // 6
    expect(played(trasgu)?.audioItem.stream.url).toMatch(/\/fixtures\/audio\/st_el_trasgu\.mp3$/); // 7

    // Credits (D10: the account already has credits) and shaping the story.
    expect(said(await h.say("StartStoryIntent", {}, true))).toBe("Okay, create a story. You have 20 story credits, and this story uses one. Who is the story for?"); // 8, 9, 16
    expect(said(await h.say("ChooseListenerIntent", { listener: { heard: "samuel", canonical: "Samuel" } }))) // 17
      .toBe("There's a saved wish for Samuel: a space adventure. Would you like to create a story about space?"); // 18
    expect(said(await h.say("AMAZON.YesIntent"))).toBe("A space story it is. Who are the characters, and what happens?"); // 19–20
    expect(said(await h.say("StoryDetailIntent", { detail: "astronaut named sam travels to the moon and meets an alien named monica" }))) // 21
      .toBe("Sam the astronaut meeting Monica the alien is a great start. What do Sam and Monica do together?"); // 22
    expect(said(await h.say("StoryDetailIntent", { detail: "play hide and seek" }))).toBe("Hide and seek in low gravity sounds fun. How does the adventure end?"); // 23–24
    const handOver = await h.say("AMAZON.FallbackIntent"); // 25: no carrier phrase
    expect(said(handOver)).toBe("A lovely ending. Your script is on the screen. Say \"record\" when you're ready, and \"the end\" when you finish."); // 26
    expect(handOver.response.directives?.[0]).toMatchObject({ type: "Alexa.Presentation.APL.RenderDocument", token: "teleprompter" }); // 27

    // Recording.
    const record = await h.say("RecordStoryIntent"); // 28
    expect(record.response.directives?.map((directive) => directive.type)).toEqual(["Alexa.Presentation.APL.RenderDocument", "Alexa.Presentation.APL.ExecuteCommands"]); // 29
    expect(said(await h.say("TheEndIntent"))).toBe("Your recording is saved. Say \"playback\" to listen, \"re-record\" to try again, or \"next\" to continue."); // 30–31
    expect(said(await h.say("PlaybackIntent"))).toBe(`${audio("sam_on_the_moon_plain.mp3")} Say "re-record" to try again, or "next" to continue.`); // 32–33

    // Finishing.
    expect(said(await h.say("AMAZON.NextIntent"))).toBe("Time for the finishing touches. What would you like to call your story?"); // 34–35
    expect(said(await h.say("StoryTitleIntent", { storytitle: { heard: "sam on the moon", canonical: "Sam on the Moon" } }))) // 36
      .toBe("Would you like to add music or sound effects to Sam on the Moon?"); // 37
    expect(said(await h.say("SoundChoiceIntent", { sound: { heard: "add both", canonical: "both" } }))) // 38
      .toBe("Soft background music and gentle sound effects added. Say \"playback\" or \"send story\"."); // 39
    const sent = await h.say("SendStoryIntent"); // 40
    expect(said(sent)).toBe(`Sam on the Moon has been sent to Samuel's family. Here it is. ${audio("sam_on_the_moon_both.mp3")}`); // 41–42
    expect(sent.response.shouldEndSession).toBe(true);

    expect((await h.creations.get(deviceSessionId(DEVICE_ID)))?.record).toEqual({ stage: "sent", listenerId: "samuel", title: "Sam on the Moon", sound: "both" });
    const turns = info.mock.calls.filter(([name]) => name === "skill_turn").map(([, fields]) => fields as { responseKey: string; outcome: string; interactionResult: string });
    expect(turns.filter((turn) => turn.outcome !== "ok")).toEqual([]);
    expect(turns.map((turn) => turn.responseKey).filter((key) => /recovery|retry|help/.test(key))).toEqual([]);
  });

  test("J2 the same lines heard without resolutions, capitals or punctuation give the same replies", async () => {
    const h = await rehearsal();
    await h.say("StartStoryIntent", {}, true);
    expect(said(await h.say("ChooseListenerIntent", { listener: "samuel" }))).toContain("There's a saved wish for Samuel");
    await h.say("AMAZON.YesIntent");
    await h.say("CatchAllIntent", { text: "an astronaut named sam travels to the moon and meets an alien named monica" });
    await h.say("PlayStoryIntent", { title: "hide and seek" });
    expect(said(await h.say("CatchAllIntent", { text: "sam has to go home for dinner and says goodbye" }))).toMatch(/^A lovely ending\./);
    await h.say("RecordStoryIntent");
    await h.say("TheEndIntent");
    await h.say("PlayStoryIntent", { title: "back" });
    await h.say("NextStoryIntent");
    expect(said(await h.say("StoryTitleIntent", { storytitle: "sam on the moon" }))).toBe("Would you like to add music or sound effects to Sam on the Moon?");
    expect(said(await h.say("SoundChoiceIntent", { sound: "yes add both" }))).toMatch(/^Soft background music and gentle sound effects added\./);
    expect(said(await h.say("AMAZON.YesIntent"))).toMatch(/^Sam on the Moon has been sent to Samuel's family\./);
  });
});
