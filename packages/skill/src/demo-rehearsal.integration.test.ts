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
 * replies are compared with her script's wording, the staged purchase scene (lines 9-15) included.
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

    // Credits: the staged purchase (nothing is charged).
    expect(said(await h.say("StartStoryIntent", {}, true))).toBe("Okay, create a story. There are no story credits on your account. Would you like to buy some?"); // 8-9
    expect(said(await h.say("AMAZON.YesIntent"))) // 10
      .toBe("Small story pack, 2 credits, for two ninety-nine euros. Family story pack, 10 credits, for eleven ninety-nine. Or Founding family pack, 20 credits, for nineteen ninety-nine. Which would you like?"); // 11
    expect(said(await h.say("ChoosePackIntent", { pack: { heard: "the founding family pack", canonical: "Founding family pack" } }))) // 12
      .toBe("Founding family pack, 20 credits, for nineteen ninety-nine euros. Shall I complete the purchase?"); // 13
    expect(said(await h.say("AMAZON.YesIntent"))).toBe("Thank you. 20 story credits added. Who is the story for?"); // 14-16

    // Shaping the story.
    expect(said(await h.say("ChooseListenerIntent", { listener: { heard: "samuel", canonical: "Samuel" } }))) // 17
      .toBe("There's a saved wish for Samuel: a space adventure. Would you like to create a story about space?"); // 18
    expect(said(await h.say("AMAZON.YesIntent"))).toBe("A space story it is. Who are the characters, and what happens?"); // 19–20
    expect(said(await h.say("StoryDetailIntent", { detail: "astronaut named sam travels to the moon and meets an alien named monica" }))) // 21
      .toBe("Sam the astronaut meeting Monica the alien is a great start. What do Sam and Monica do together?"); // 22
    expect(said(await h.say("StoryDetailIntent", { detail: "play hide and seek" }))).toBe("Hide and seek in low gravity sounds fun. How does the adventure end?"); // 23–24
    const handOver = await h.say("AMAZON.FallbackIntent"); // 25: no carrier phrase
    expect(said(handOver)).toBe("A lovely ending. Your script is on the screen. Say \"<phoneme alphabet=\"ipa\" ph=\"ɹɪˈkɔɹd\">record</phoneme>\" when you're ready, and \"the end\" when you finish."); // 26
    expect(handOver.response.directives?.[0]).toMatchObject({ type: "Alexa.Presentation.APL.RenderDocument", token: "teleprompter" }); // 27

    // Recording.
    const record = await h.say("RecordStoryIntent"); // 28
    expect(record.response.directives?.map((directive) => directive.type)).toEqual(["Alexa.Presentation.APL.RenderDocument", "Alexa.Presentation.APL.ExecuteCommands"]); // 29
    expect(said(await h.say("TheEndIntent"))).toBe("Your recording is saved. Say \"playback\" to listen, \"<phoneme alphabet=\"ipa\" ph=\"ˌɹiɹɪˈkɔɹd\">re-record</phoneme>\" to try again, or \"next\" to continue."); // 30–31
    expect(said(await h.say("PlaybackIntent"))).toBe(`${audio("sam_on_the_moon_plain.mp3")} Say "<phoneme alphabet="ipa" ph="ˌɹiɹɪˈkɔɹd">re-record</phoneme>" to try again, or "next" to continue.`); // 32–33

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
    await h.say("AMAZON.YesIntent");
    expect(said(await h.say("CatchAllIntent", { text: "the founding family pack" }))).toMatch(/^Founding family pack, 20 credits/);
    expect(said(await h.say("AMAZON.YesIntent"))).toMatch(/^Thank you\. 20 story credits added\./);
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

  // Alexa+ on Jordan's Echo (2026-10-13) filled only {title} for line 3, and nothing played.
  test.each(["a story by aunt whitney", "a story from aunt whitney", "aunt whitney", "an aunt whitney story", "aunt whitney's story", "the story by aunt whitney",
    // Issue 21: the reply was "I couldn't find that delivered story", so "play" or a misheard name stayed in the title.
    "play a story by aunt whitney", "a story by ant whitney", "ant whitney",
    // 2026-10-17: a title-only line 3 still played nothing. Misheard names and the invocation tail.
    "a story by aunt witney", "a story by aunt britney", "a story by aunt whitley", "story by whitney", "a story from auntie whitney",
    "a story by aunt whitney on spoken letter", "aunt whitney on spoken letter", "story by and whitney"])(
    "J3 line 3 heard as the title %j still plays an Aunt Whitney story", async (title) => {
      const h = await rehearsal();
      await h.open();
      const response = await h.say("PlayStoryIntent", { title });
      expect(said(response)).toMatch(/^Playing .+ by Aunt Whitney\.$/);
      expect(played(response)?.audioItem.metadata.subtitle).toContain("Aunt Whitney");
    });

  // Line 5, said over a playing story. Alexa+ fills only {title}; Spanish names are often misheard.
  test.each(["el trasgu by tio manuel", "el trasgu by tío manuel on spoken letter", "el trasgo by tio manual", "el trasgu by theo manuel",
    "el trasgu by uncle manuel", "the trasgu by tio manuel", "el trasgu from tio manuel", "el trasgu", "el trasgu story"])(
    "J6 line 5 heard as the title %j plays El Trasgu by Tío Manuel", async (title) => {
      const h = await rehearsal();
      const response = await h.say("PlayStoryIntent", { title }, true);
      expect(said(response)).toBe("Playing El Trasgu by Tío Manuel.");
      expect(played(response)?.audioItem.stream.url).toMatch(/\/fixtures\/audio\/st_el_trasgu\.mp3$/);
    });

  test("J6 line 5 with only the storyteller slot filled plays El Trasgu", async () => {
    const h = await rehearsal();
    const response = await h.say("PlayStoryIntent", { title: "el trasgu", storyteller: { heard: "tio manuel", canonical: "Tío Manuel" } }, true);
    expect(said(response)).toBe("Playing El Trasgu by Tío Manuel.");
  });

  // Line 8, said over a playing story, through each intent Alexa+ might choose.
  test.each([["StartStoryIntent", {}], ["CatchAllIntent", { text: "create a story" }], ["PlayStoryIntent", { title: "create a story" }], ["StartStoryIntent", { theme: "on spoken letter" }]] as const)(
    "J7 line 8 through %s %j opens the purchase scene and stops the playing story", async (name, slots) => {
      const h = await rehearsal();
      const response = await h.say(name, slots, true);
      expect(said(response)).toBe("Okay, create a story. There are no story credits on your account. Would you like to buy some?");
      expect(response.response.directives?.[0]).toEqual({ type: "AudioPlayer.Stop" });
    });
});

/** Lines 9-42 as Jordan's script has them, checked against Alexa's reply to each of her lines. */
const SCRIPT_REPLIES = {
  9: "Okay, create a story. There are no story credits on your account. Would you like to buy some?",
  11: "Small story pack, 2 credits, for two ninety-nine euros. Family story pack, 10 credits, for eleven ninety-nine. Or Founding family pack, 20 credits, for nineteen ninety-nine. Which would you like?",
  13: "Founding family pack, 20 credits, for nineteen ninety-nine euros. Shall I complete the purchase?",
  16: "Thank you. 20 story credits added. Who is the story for?",
  18: "There's a saved wish for Samuel: a space adventure. Would you like to create a story about space?",
  20: "A space story it is. Who are the characters, and what happens?",
  22: "Sam the astronaut meeting Monica the alien is a great start. What do Sam and Monica do together?",
  24: "Hide and seek in low gravity sounds fun. How does the adventure end?",
  26: "A lovely ending. Your script is on the screen. Say \"<phoneme alphabet=\"ipa\" ph=\"ɹɪˈkɔɹd\">record</phoneme>\" when you're ready, and \"the end\" when you finish.",
  29: "Get ready.",
  31: "Your recording is saved. Say \"playback\" to listen, \"<phoneme alphabet=\"ipa\" ph=\"ˌɹiɹɪˈkɔɹd\">re-record</phoneme>\" to try again, or \"next\" to continue.",
  33: `${audio("sam_on_the_moon_plain.mp3")} Say "<phoneme alphabet="ipa" ph="ˌɹiɹɪˈkɔɹd">re-record</phoneme>" to try again, or "next" to continue.`,
  35: "Time for the finishing touches. What would you like to call your story?",
  37: "Would you like to add music or sound effects to Sam on the Moon?",
  39: "Soft background music and gentle sound effects added. Say \"playback\" or \"send story\".",
  41: `Sam on the Moon has been sent to Samuel's family. Here it is. ${audio("sam_on_the_moon_both.mp3")}`,
} as const;

type Heard = readonly [intent: string, slots?: Record<string, Slot>];
/** Jordan's lines 10-40 in order, each paired with the reply line it must produce. */
const USER_LINES = [10, 12, 14, 17, 19, 21, 23, 25, 28, 30, 32, 34, 36, 38, 40] as const;
const REPLY_TO: Record<(typeof USER_LINES)[number], keyof typeof SCRIPT_REPLIES> = { 10: 11, 12: 13, 14: 16, 17: 18, 19: 20, 21: 22, 23: 24, 25: 26, 28: 29, 30: 31, 32: 33, 34: 35, 36: 37, 38: 39, 40: 41 };

/** Runs lines 8-42 with each of Jordan's lines delivered as `heard(line)`, and checks every reply against the script. */
async function runScript(heard: (line: (typeof USER_LINES)[number]) => Heard) {
  const h = await rehearsal();
  expect(said(await h.say("StartStoryIntent", {}, true))).toBe(SCRIPT_REPLIES[9]);
  const replies: Record<number, AlexaResponseEnvelope> = {};
  for (const line of USER_LINES) {
    const [name, slots] = heard(line);
    const response = await h.say(name, slots ?? {});
    expect({ line, said: said(response) }).toEqual({ line, said: SCRIPT_REPLIES[REPLY_TO[line]] });
    replies[line] = response;
  }
  expect(replies[28]?.response.directives?.map((directive) => directive.type)).toEqual(["Alexa.Presentation.APL.RenderDocument", "Alexa.Presentation.APL.ExecuteCommands"]);
  expect(replies[40]?.response.shouldEndSession).toBe(true);
  expect((await h.creations.get(deviceSessionId(DEVICE_ID)))?.record).toEqual({ stage: "sent", listenerId: "samuel", title: "Sam on the Moon", sound: "both" });
}

describe("Jordan's script under Alexa+ routing (J4, J5)", () => {
  // Alexa+ on Jordan's Echo (2026-10-17) sent "Record" as FallbackIntent and a "Yes" as WhatIsNewIntent;
  // the classic model resolves both correctly, so only the device showed it.
  test("J4 every reply arriving as AMAZON.FallbackIntent still follows the script to the end", async () => {
    await runScript(() => ["AMAZON.FallbackIntent"]);
  });

  test("J5 the routes seen on the device on 2026-10-17 follow the script", async () => {
    const seen: Partial<Record<(typeof USER_LINES)[number], Heard>> = { 10: ["WhatIsNewIntent"], 19: ["AMAZON.FallbackIntent"], 28: ["AMAZON.FallbackIntent"] };
    await runScript((line) => seen[line] ?? J1_INTENTS[line]);
  });

  test("J5 each line through the other intents Alexa+ can pick follows the script", async () => {
    const other: Record<(typeof USER_LINES)[number], Heard> = {
      10: ["CatchAllIntent", { text: "yes please" }],
      12: ["CatchAllIntent", { text: "the founding family pack" }],
      14: ["CatchAllIntent", { text: "yes" }],
      17: ["CatchAllIntent", { text: "samuel" }],
      19: ["ChooseListenerIntent", { listener: "yes" }],
      21: ["CatchAllIntent", { text: "an astronaut named sam travels to the moon and meets an alien named monica" }],
      23: ["PlayStoryIntent", { title: "hide and seek" }],
      25: ["WhatIsNewIntent"],
      28: ["CatchAllIntent", { text: "record" }],
      30: ["AMAZON.StopIntent"],
      32: ["PlayStoryIntent", { title: "back" }],
      34: ["NextStoryIntent"],
      36: ["PlayStoryIntent", { title: "sam on the moon" }],
      38: ["AMAZON.YesIntent"],
      40: ["CatchAllIntent", { text: "send story" }],
    };
    await runScript((line) => other[line]);
  });

  test("J5 misheard names and titles snap to the script's listener and title", async () => {
    const misheard: Partial<Record<(typeof USER_LINES)[number], Heard>> = {
      17: ["ChooseListenerIntent", { listener: "samual" }],
      36: ["StoryTitleIntent", { storytitle: "sam on the mon" }],
    };
    await runScript((line) => misheard[line] ?? J1_INTENTS[line]);
  });
});

/** J1's classic-model routes, line by line (`profileNlu` on the live model, 2026-10-17). */
const J1_INTENTS: Record<(typeof USER_LINES)[number], Heard> = {
  10: ["AMAZON.YesIntent"],
  12: ["ChoosePackIntent", { pack: { heard: "founding family pack", canonical: "Founding family pack" } }],
  14: ["AMAZON.YesIntent"],
  17: ["ChooseListenerIntent", { listener: { heard: "samuel", canonical: "Samuel" } }],
  19: ["AMAZON.YesIntent"],
  21: ["StoryDetailIntent", { detail: "astronaut named sam travels to the moon and meets an alien named monica" }],
  23: ["StoryDetailIntent", { detail: "play hide and seek" }],
  25: ["StoryDetailIntent", { detail: "has to go home for dinner and says goodbye" }],
  28: ["RecordStoryIntent"],
  30: ["TheEndIntent"],
  32: ["PlaybackIntent"],
  34: ["AMAZON.NextIntent"],
  36: ["StoryTitleIntent", { storytitle: { heard: "sam on the moon", canonical: "Sam on the Moon" } }],
  38: ["SoundChoiceIntent", { sound: { heard: "add both", canonical: "both" } }],
  40: ["SendStoryIntent"],
};

test("J4 the classic routes give the same script", async () => {
  await runScript((line) => J1_INTENTS[line]);
});

