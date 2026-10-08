import { type CreationRecord, findTake, parseDemoCreate, parseTakesManifest } from "@spoken-letter-alexa/shared";
import { describe, expect, test, vi } from "vitest";

import { type AgentClient } from "./agent-client.ts";
import { RESUME_SECONDS } from "./create-flow.ts";
import { CREATE_MESSAGES as c } from "./create-messages.ts";
import { createHandler, type AlexaRequestEnvelope, type AlexaResponseEnvelope } from "./handler.ts";
import { escapeSsml } from "./responses.ts";
import status from "./apl/status.json" with { type: "json" };
import teleprompter from "./apl/teleprompter.json" with { type: "json" };
import skillManifest from "../skill-package/skill.json" with { type: "json" };
import demoCreate from "../../../fixtures/demo-create.json" with { type: "json" };
import takesManifest from "../../../fixtures/takes/manifest.json" with { type: "json" };

const SKILL_ID = "amzn1.ask.skill.00000000-0000-4000-8000-000000000000";
const BASE_URL = "https://alexa.spokenletter.com";
const DEMO = parseDemoCreate(demoCreate);
const TAKE = findTake(parseTakesManifest(takesManifest), DEMO.story.script);
const APL = { "Alexa.Presentation.APL": { runtime: { maxVersion: "2024.3" } } };
const NOW = 1_800_000_000;

type Options = { apl?: boolean; attributes?: Record<string, string>; locale?: string; newSession?: boolean };
type SlotInput = string | { value: string; canonical: string };

function envelope(request: Record<string, unknown>, options: Options = {}): AlexaRequestEnvelope {
  return {
    version: "1.0",
    session: { new: options.newSession ?? false, sessionId: "amzn1.echo-api.session.1", application: { applicationId: SKILL_ID }, user: { userId: "amzn1.ask.account.OWNER" }, ...(options.attributes && { attributes: options.attributes }) },
    context: { System: { application: { applicationId: SKILL_ID }, user: { userId: "amzn1.ask.account.OWNER" }, ...((options.apl ?? true) && { device: { supportedInterfaces: APL } }) } },
    request: { requestId: "amzn1.echo-api.request.1", timestamp: "2026-10-08T18:00:00Z", locale: options.locale ?? "en-US", ...request } as AlexaRequestEnvelope["request"],
  };
}

function intent(name: string, slots: Record<string, SlotInput> = {}, options: Options = {}): AlexaRequestEnvelope {
  return envelope({ type: "IntentRequest", intent: { name, slots: Object.fromEntries(Object.entries(slots).map(([slot, input]) => [slot, typeof input === "string"
    ? { name: slot, value: input }
    : { name: slot, value: input.value, resolutions: { resolutionsPerAuthority: [{ status: { code: "ER_SUCCESS_MATCH" }, values: [{ value: { name: input.canonical } }] }] } }])) } }, options);
}
const done = (options: Options = {}) => envelope({ type: "Alexa.Presentation.APL.UserEvent", token: "teleprompter", arguments: ["done"] }, options);

/** The agent's creation routes, in memory. */
function creations(initial?: { record: CreationRecord; updatedAt: number }) {
  let stored = initial;
  const createSave = vi.fn((input: { record: CreationRecord }) => { stored = { record: input.record, updatedAt: NOW }; return Promise.resolve({ status: "saved" as const }); });
  const createCurrent = vi.fn(() => Promise.resolve(stored ? { status: "found" as const, ...stored } : { status: "none" as const }));
  return { createSave, createCurrent, stored: () => stored };
}

/** `publicBaseUrl` null: no host serves the takes. */
function device(agent: Partial<AgentClient> = creations(), publicBaseUrl: string | null = BASE_URL) {
  const handler = createHandler({ skillId: SKILL_ID, agent: { turn: vi.fn(), ...agent }, publicBaseUrl: publicBaseUrl ?? undefined, now: () => NOW });
  let attributes: Record<string, string> | undefined;
  /** One turn on a screen device; the session carries the previous turn's attributes, as Alexa does. */
  return async (name: string, slots: Record<string, SlotInput> = {}, options: Options = {}): Promise<AlexaResponseEnvelope> => {
    const withSession = { ...(attributes && { attributes }), ...options };
    const response = await handler(name === "done" ? done(withSession) : intent(name, slots, withSession));
    attributes = response.response.shouldEndSession === true ? undefined : response.sessionAttributes;
    return response;
  };
}

/** Same copy rules as the handler suite (handler.test.ts `ssml`). */
function speech(response: AlexaResponseEnvelope): string {
  const text = response.response.outputSpeech?.ssml ?? "";
  for (const line of [text, response.response.reprompt?.outputSpeech.ssml ?? ""]) {
    expect(line).not.toMatch(/\b(?:demo|fixture|simulation|prototype|name-free)\b/i);
    expect(line).not.toMatch(/not sent|not contact anyone|not a real/i);
    // D11 (F8): never a claim of direct delivery to a child.
    expect(line).not.toMatch(/sent to (?:samuel|sam)\b(?!'s family)/i);
  }
  return text;
}
const spoken = (text: string) => `<speak>${escapeSsml(text)}</speak>`;
const audioOf = (file: string | undefined) => `<audio src="${BASE_URL}/fixtures/takes/${file ?? "missing"}"/>`;
type Render = { token: string; document: unknown; datasources: Record<string, Record<string, unknown>> };
const renders = (response: AlexaResponseEnvelope) => (response.response.directives ?? []).filter((directive) => directive.type === "Alexa.Presentation.APL.RenderDocument") as Render[];

type Command = { type: string; componentId?: string; value?: unknown; commands?: Command[] };
const flatten = (commands: Command[]): Command[] => commands.flatMap((command) => [command, ...flatten(command.commands ?? [])]);

test("the skill manifest declares APL and keeps the AudioPlayer", () => {
  expect(skillManifest.manifest.apis.custom.interfaces).toEqual([{ type: "AUDIO_PLAYER" }, { type: "ALEXA_PRESENTATION_APL" }]);
});

test("J3 the demo story's script has a take with all four mixes", () => {
  expect(TAKE?.files).toEqual({ plain: "sam_on_the_moon_plain.mp3", effects: "sam_on_the_moon_both.mp3", music: "sam_on_the_moon_both.mp3", both: "sam_on_the_moon_both.mp3" });
});

describe("Jordan's script, lines 8 to 42", () => {
  test("every line in order, with the record kept in step", async () => {
    const agent = creations();
    const turn = device(agent);

    const start = await turn("StartStoryIntent", {}, { newSession: true });
    expect(speech(start)).toBe(spoken("Okay, create a story. You have 20 story credits, and this story uses one. Who is the story for?"));
    expect(start.response.shouldEndSession).toBe(false);
    expect(start.sessionAttributes).toEqual({ demoFlow: "create", createStage: "listener" });

    const wish = await turn("ChooseListenerIntent", { listener: { value: "samuel", canonical: "Samuel" } });
    expect(speech(wish)).toBe(spoken("There's a saved wish for Samuel: a space adventure. Would you like to create a story about space?"));
    expect(wish.sessionAttributes).toEqual({ demoFlow: "create", createStage: "wish", createListener: "samuel" });

    expect(speech(await turn("AMAZON.YesIntent"))).toBe(spoken("A space story it is. Who are the characters, and what happens?"));

    const second = await turn("StoryDetailIntent", { detail: "astronaut named sam travels to the moon and meets an alien named monica" });
    expect(speech(second)).toBe(spoken("Sam the astronaut meeting Monica the alien is a great start. What do Sam and Monica do together?"));
    expect(second.sessionAttributes).toMatchObject({ createStage: "conversation", createAnswers: "1" });

    expect(speech(await turn("StoryDetailIntent", { detail: "play hide and seek" }))).toBe(spoken("Hide and seek in low gravity sounds fun. How does the adventure end?"));

    // Line 25 has no carrier phrase, so it may arrive as a fallback; it still counts as the answer.
    const handOver = await turn("AMAZON.FallbackIntent");
    expect(speech(handOver)).toBe(spoken("A lovely ending. Your script is on the screen. Say \"record\" when you're ready, and \"the end\" when you finish."));
    expect(handOver.response.reprompt?.outputSpeech.ssml).toBe(spoken(c.recordReprompt));
    const [preview] = renders(handOver);
    expect(preview).toMatchObject({ token: "teleprompter", document: teleprompter, datasources: { teleprompter: { preview: true, title: c.scriptTitle } } });
    expect(String(preview?.datasources.teleprompter?.script)).toMatch(/^One morning, you woke up ready for adventure!/);
    expect(String(preview?.datasources.teleprompter?.script)).toContain("<br><br>You zoomed past planets");
    expect(handOver.sessionAttributes).toEqual({ demoFlow: "create", createStage: "recording", createListener: "samuel" });

    const record = await turn("RecordStoryIntent");
    expect(speech(record)).toBe(spoken(c.recordCue));
    expect("shouldEndSession" in record.response).toBe(false);
    const execute = record.response.directives?.find((directive) => directive.type === "Alexa.Presentation.APL.ExecuteCommands") as { commands: Command[] } | undefined;
    expect(flatten(execute?.commands ?? []).filter((step) => step.componentId === "countdown").map((step) => step.value)).toEqual(["3", "2", "1"]);
    expect(renders(record)[0]?.datasources.teleprompter).toMatchObject({ preview: false, title: c.teleprompterTitle });
    expect(record.sessionAttributes).toEqual({ demoFlow: "create", createStage: "recording", createListener: "samuel", createReading: "1" });

    const end = await turn("TheEndIntent");
    expect(speech(end)).toBe(spoken("Your recording is saved. Say \"playback\" to listen, \"re-record\" to try again, or \"next\" to continue."));
    expect(renders(end)[0]).toMatchObject({ token: "status", document: status, datasources: { status: { eyebrow: "For Samuel", heading: c.yourStory, detail: c.status.saved } } });
    expect(agent.stored()?.record).toEqual({ stage: "review", listenerId: "samuel" });

    const playback = await turn("PlaybackIntent");
    expect(speech(playback)).toBe(`<speak>${audioOf(TAKE?.files.plain)} ${escapeSsml(c.afterPlayback)}</speak>`);
    expect(playback.response.shouldEndSession).toBe(false);

    expect(speech(await turn("AMAZON.NextIntent"))).toBe(spoken("Time for the finishing touches. What would you like to call your story?"));

    const soundQuestion = await turn("StoryTitleIntent", { storytitle: { value: "sam on the moon", canonical: "Sam on the Moon" } });
    expect(speech(soundQuestion)).toBe(spoken("Would you like to add music or sound effects to Sam on the Moon?"));
    expect(renders(soundQuestion)[0]?.datasources.status).toMatchObject({ heading: "Sam on the Moon" });

    const added = await turn("SoundChoiceIntent", { sound: { value: "both", canonical: "both" } });
    expect(speech(added)).toBe(spoken("Soft background music and gentle sound effects added. Say \"playback\" or \"send story\"."));
    expect(added.sessionAttributes).toMatchObject({ createStage: "finish", createTitle: "Sam on the Moon", createSound: "both" });

    const sent = await turn("SendStoryIntent");
    expect(speech(sent)).toBe(`<speak>${escapeSsml("Sam on the Moon has been sent to Samuel's family. Here it is.")} ${audioOf(TAKE?.files.both)}</speak>`);
    expect(sent.response.shouldEndSession).toBe(true);
    expect(sent.response.directives?.[0]).toEqual({ type: "AudioPlayer.Stop" });
    expect(renders(sent)[0]?.datasources.status).toEqual({ eyebrow: "For Samuel", heading: "Sam on the Moon", detail: "Sent to Samuel's family" });
    expect(agent.stored()?.record).toEqual({ stage: "sent", listenerId: "samuel", title: "Sam on the Moon", sound: "both" });
  });

  test("the record never stores what the adult said, only codes, counts and the title", async () => {
    const agent = creations();
    const turn = device(agent);
    await turn("StartStoryIntent");
    await turn("ChooseListenerIntent", { listener: "Samuel" });
    await turn("AMAZON.YesIntent");
    await turn("StoryDetailIntent", { detail: "astronaut named sam travels to the moon" });
    expect(JSON.stringify(agent.createSave.mock.calls)).not.toMatch(/astronaut|moon/i);
    expect(agent.createSave.mock.calls.at(-1)?.[0]).toEqual({ deviceUserId: "amzn1.ask.account.OWNER", record: { stage: "conversation", listenerId: "samuel", answers: 1 } });
  });
});

describe("entries", () => {
  test.each([
    ["create a story for Sam", "CatchAllIntent", { text: "create a story for Sam" }],
    ["AppHandoffIntent", "AppHandoffIntent", { listeneralias: "Samuel" }],
  ])("%s skips the listener question", async (_label, name, slots) => {
    const response = await device()(name, slots);
    expect(speech(response)).toBe(spoken(`${c.start(DEMO.credits)} There's a saved wish for Samuel: a space adventure. Would you like to create a story about space?`));
  });

  test("SS7 an unknown listener lists the names without repeating what was said, and keeps the stage", async () => {
    const turn = device();
    await turn("StartStoryIntent");
    const response = await turn("ChooseListenerIntent", { listener: "Mia" });
    expect(speech(response)).toBe(spoken(`${c.unknownListener("Samuel")} ${c.whoFor}`));
    expect(speech(response)).not.toContain("Mia");
    expect(response.sessionAttributes).toEqual({ demoFlow: "create", createStage: "listener" });
  });

  test("record story outside the flow starts it (phase-5.md F9)", async () => {
    expect(speech(await device()("RecordStoryIntent"))).toBe(spoken(`${c.start(DEMO.credits)} ${c.whoFor}`));
  });

  test("a no to the wish still asks for the characters", async () => {
    const turn = device();
    await turn("StartStoryIntent");
    await turn("ChooseListenerIntent", { listener: "Samuel" });
    expect(speech(await turn("AMAZON.NoIntent"))).toBe(spoken(`${c.wishNo} ${c.firstQuestion}`));
  });

  test("how-to questions keep their app guidance", async () => {
    expect(speech(await device()("CatchAllIntent", { text: "how do I create a story" }))).not.toContain(escapeSsml(c.whoFor));
  });

  test("Spanish keeps its theme prompt and never enters the English-only flow (D1, C11)", async () => {
    const response = await device()("StartStoryIntent", {}, { locale: "es-ES" });
    expect(response.sessionAttributes).toEqual({ demoFlow: "draft" });
    expect(speech(await device()("done", {}, { locale: "es-ES" }))).not.toContain("<audio");
  });
});

describe("stages", () => {
  const at = (attributes: Record<string, string>, publicBaseUrl: string | null = BASE_URL) => {
    const turn = device(creations(), publicBaseUrl);
    return (name: string, slots: Record<string, SlotInput> = {}, options: Options = {}) => turn(name, slots, { attributes, ...options });
  };
  const review = { demoFlow: "create", createStage: "review", createListener: "samuel" };

  test.each(["AMAZON.HelpIntent", "AMAZON.FallbackIntent", "ChooseListenerIntent"])("%s in review repeats the review prompt", async (name) => {
    const response = await at(review)(name);
    expect(speech(response)).toBe(spoken(c.reviewReprompt));
    expect(response.sessionAttributes).toEqual(review);
  });

  test("re-record goes back to the teleprompter", async () => {
    const response = await at(review)("RecordStoryIntent");
    expect(renders(response)[0]?.token).toBe("teleprompter");
    expect(response.sessionAttributes).toMatchObject({ createStage: "recording", createReading: "1" });
  });

  test.each([["the PlayStoryIntent title back", "PlayStoryIntent", { title: "back" }], ["play it again", "PlayAgainIntent", {}]])("%s plays the take back", async (_label, name, slots) => {
    expect(speech(await at(review)(name, slots))).toContain(audioOf(TAKE?.files.plain));
  });

  test("SS5 without a host for takes, playback says the take is not ready and stays at review", async () => {
    const response = await at(review, null)("PlaybackIntent");
    expect(speech(response)).toBe(spoken(c.takeMissing));
    expect(response.sessionAttributes).toEqual(review);
  });

  test("a done tap and the end both finish the reading", async () => {
    const reading = { demoFlow: "create", createStage: "recording", createListener: "samuel", createReading: "1" };
    expect(speech(await at(reading)("done"))).toBe(spoken(c.saved));
    expect(speech(await at(reading)("TheEndIntent"))).toBe(spoken(c.saved));
  });

  test("a fallback while reading repeats how to finish, with the microphone closed", async () => {
    const response = await at({ demoFlow: "create", createStage: "recording", createReading: "1" })("AMAZON.FallbackIntent");
    expect(speech(response)).toBe(spoken(c.recordingHelp));
    expect("shouldEndSession" in response.response).toBe(false);
  });

  test("before reading, a fallback asks for record again with the microphone open", async () => {
    const response = await at({ demoFlow: "create", createStage: "recording" })("AMAZON.FallbackIntent");
    expect(speech(response)).toBe(spoken(c.recordReprompt));
    expect(response.response.shouldEndSession).toBe(false);
  });

  test("without a screen, the hand-over and the reading are spoken (SS1)", async () => {
    const turn = device();
    const conversation = { demoFlow: "create", createStage: "conversation", createListener: "samuel", createAnswers: "2" };
    const handOver = await turn("StoryDetailIntent", { detail: "x" }, { apl: false, attributes: conversation });
    expect(speech(handOver)).toBe(spoken(c.handOverNoScreen));
    expect(handOver.response.directives).toBeUndefined();
    const record = await turn("RecordStoryIntent", {}, { apl: false });
    expect(speech(record)).toContain("One morning, you woke up ready for adventure!");
    expect(speech(record)).toContain("Alexa, the end");
    expect(record.response.directives).toBeUndefined();
  });

  test("a spoken title without a resolution is title-cased without its carrier", async () => {
    const response = await at({ demoFlow: "create", createStage: "title", createListener: "samuel" })("CatchAllIntent", { text: "call it the moon picnic" });
    expect(speech(response)).toBe(spoken("Would you like to add music or sound effects to The Moon Picnic?"));
  });

  test("a fallback in title asks again", async () => {
    expect(speech(await at({ demoFlow: "create", createStage: "title" })("AMAZON.FallbackIntent"))).toBe(spoken(c.titleReprompt));
  });

  test.each([
    ["yes", "AMAZON.YesIntent", {}, c.soundWhich],
    ["no", "AMAZON.NoIntent", {}, `${c.soundAdded.plain} ${c.finishPrompt}`],
    ["music, unresolved", "SoundChoiceIntent", { sound: "music please" }, `${c.soundAdded.music} ${c.finishPrompt}`],
    ["sound effects", "SoundChoiceIntent", { sound: { value: "sound effects", canonical: "effects" } }, `${c.soundAdded.effects} ${c.finishPrompt}`],
  ])("sound: %s", async (_label, name, slots, line) => {
    const response = await at({ demoFlow: "create", createStage: "sound", createListener: "samuel", createTitle: "Sam on the Moon" })(name, slots);
    expect(speech(response)).toBe(spoken(line));
  });

  test("playback before sending plays the chosen mix", async () => {
    const response = await at({ demoFlow: "create", createStage: "finish", createListener: "samuel", createTitle: "Sam on the Moon", createSound: "both" })("PlaybackIntent");
    expect(speech(response)).toContain(audioOf(TAKE?.files.both));
    expect(response.response.shouldEndSession).toBe(false);
  });

  test("SS5 after the sound choice, playback without a host offers only send", async () => {
    const response = await at({ demoFlow: "create", createStage: "finish", createSound: "both" }, null)("PlaybackIntent");
    expect(speech(response)).toBe(spoken(c.finishMissing));
    expect(speech(response)).not.toMatch(/re-record/);
  });

  test("stop ends the flow and stores it as stopped, so the next launch opens plainly", async () => {
    const agent = creations({ record: { stage: "review", listenerId: "samuel" }, updatedAt: NOW - 60 });
    const response = await device(agent)("AMAZON.StopIntent", {}, { attributes: review });
    expect(speech(response)).toBe(spoken(c.canceled));
    expect(response.response.shouldEndSession).toBe(true);
    expect(agent.stored()?.record).toEqual({ stage: "stopped" });
    const launch = await createHandler({ skillId: SKILL_ID, agent: { turn: vi.fn(), ...agent }, publicBaseUrl: BASE_URL, now: () => NOW })(envelope({ type: "LaunchRequest" }, { newSession: true }));
    expect(speech(launch)).not.toContain("Welcome back");
  });

  test.each(["ChooseListenerIntent", "SoundChoiceIntent", "StoryDetailIntent", "SendStoryIntent"])("%s outside the flow gets the fallback recovery", async (name) => {
    const response = await device()(name, { detail: "a story by aunt whitney" });
    expect(response.sessionAttributes).toEqual({ fallbackCount: "1" });
    expect(response.response.shouldEndSession).toBe(false);
  });

  test("one credit is said in the singular", () => {
    expect(c.start(1)).toBe("Okay, create a story. You have 1 story credit, and this story uses one.");
  });

  test("tampered session values are dropped", async () => {
    const response = await at({ demoFlow: "create", createStage: "finish", createListener: "mateo", createTitle: "x".repeat(61), createSound: "loud", createReading: "1" })("AMAZON.HelpIntent");
    expect(response.sessionAttributes).toEqual({ demoFlow: "create", createStage: "finish" });
  });

  test("an unknown stage is dropped from the session", async () => {
    expect((await at({ demoFlow: "create", createStage: "script" })("AMAZON.HelpIntent")).sessionAttributes).toEqual({});
  });
});

describe("resume (SS2)", () => {
  const launch = (agent: Partial<AgentClient>) => createHandler({ skillId: SKILL_ID, agent: { turn: vi.fn(), ...agent }, publicBaseUrl: BASE_URL, now: () => NOW })(envelope({ type: "LaunchRequest" }, { newSession: true }));

  test("a launch soon after the session dropped while reading or in review resumes at review", async () => {
    for (const record of [{ stage: "recording" as const, reading: true as const }, { stage: "review" as const }]) {
      const response = await launch(creations({ record: { ...record, listenerId: "samuel" }, updatedAt: NOW - 60 }));
      expect(speech(response)).toBe(spoken(c.resumeReview));
      expect(response.sessionAttributes).toEqual({ demoFlow: "create", createStage: "review", createListener: "samuel" });
    }
  });

  test.each([
    ["an old recording", { record: { stage: "recording" as const, reading: true as const }, updatedAt: NOW - RESUME_SECONDS - 1 }],
    ["the script on screen before record", { record: { stage: "recording" as const }, updatedAt: NOW - 60 }],
    ["a stopped run", { record: { stage: "stopped" as const }, updatedAt: NOW - 60 }],
    ["another stage", { record: { stage: "finish" as const }, updatedAt: NOW - 60 }],
    ["a sent story", { record: { stage: "sent" as const }, updatedAt: NOW - 60 }],
  ])("%s gives the plain launch, so the next run's opening line never changes", async (_label, stored) => {
    const response = await launch(creations(stored));
    expect(speech(response)).not.toContain("Welcome back");
    expect(response.sessionAttributes).toEqual({});
  });

  test("a failing creation store never blocks the launch", async () => {
    expect(speech(await launch({ createCurrent: vi.fn().mockRejectedValue(new Error("down")) }))).not.toContain("Welcome back");
  });

  test("a done tap after the session closed finishes a recent reading", async () => {
    const agent = creations({ record: { stage: "recording", listenerId: "samuel", reading: true }, updatedAt: NOW - 60 });
    expect(speech(await device(agent)("done", {}, { newSession: true }))).toBe(spoken(c.saved));
  });

  test("a failed save keeps the flow going in the session", async () => {
    const { log } = await import("@spoken-letter-alexa/shared");
    const warn = vi.spyOn(log, "warn");
    const response = await device({ createSave: vi.fn().mockRejectedValue(new Error("down")) })("StartStoryIntent");
    expect(speech(response)).toBe(spoken(`${c.start(DEMO.credits)} ${c.whoFor}`));
    expect(warn).toHaveBeenCalledWith("create_save_failed", { errorClass: "Error" });
    warn.mockRestore();
  });
});

describe("telemetry and screens", () => {
  test("an APL runtime error while reading is logged by type only, with no speech, and keeps the stage", async () => {
    const { log } = await import("@spoken-letter-alexa/shared");
    const warn = vi.spyOn(log, "warn");
    const handler = createHandler({ skillId: SKILL_ID, agent: { turn: vi.fn() }, publicBaseUrl: BASE_URL });
    const attributes = { demoFlow: "create", createStage: "recording", createReading: "1" };
    const response = await handler(envelope({ type: "Alexa.Presentation.APL.RuntimeError", token: "teleprompter", errors: [{ type: "LINK_ERROR", reason: "INVALID_COMMAND", message: "Scroll failed on scriptScroll" }] }, { attributes }));
    expect(response.response.outputSpeech).toBeUndefined();
    expect(response.sessionAttributes).toEqual(attributes);
    expect(warn).toHaveBeenCalledWith("apl_runtime_error", { errors: ["LINK_ERROR:INVALID_COMMAND"] });
    warn.mockRestore();
  });

  test("the turn log names the response key and the flow, never the title or the script", async () => {
    const { log } = await import("@spoken-letter-alexa/shared");
    const info = vi.spyOn(log, "info");
    await device()("StoryTitleIntent", { storytitle: "a secret title" }, { attributes: { demoFlow: "create", createStage: "title" } });
    const fields = info.mock.calls.find(([event]) => event === "skill_turn")?.[1];
    expect(fields).toMatchObject({ responseKey: "create_sound", flowBefore: "create", flowAfter: "create", intent: "StoryTitleIntent" });
    expect(JSON.stringify(fields)).not.toMatch(/secret|One morning/i);
    info.mockRestore();
  });
});
