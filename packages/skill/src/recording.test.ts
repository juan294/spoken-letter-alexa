import { parseTakesManifest, spikeTake } from "@spoken-letter-alexa/shared";
import { describe, expect, test, vi } from "vitest";

import { type AgentClient } from "./agent-client.ts";
import { CREATE_MESSAGES } from "./create-messages.ts";
import { createHandler, type AlexaRequestEnvelope, type AlexaResponseEnvelope } from "./handler.ts";
import teleprompter from "./apl/teleprompter.json" with { type: "json" };
import skillManifest from "../skill-package/skill.json" with { type: "json" };
import takesManifest from "../../../fixtures/takes/manifest.json" with { type: "json" };

const SKILL_ID = "amzn1.ask.skill.00000000-0000-4000-8000-000000000000";
const BASE_URL = "https://alexa.spokenletter.com";
const SPIKE = spikeTake(parseTakesManifest(takesManifest));
const APL = { "Alexa.Presentation.APL": { runtime: { maxVersion: "2024.3" } } };

function envelope(request: Record<string, unknown>, options: { apl?: boolean; attributes?: Record<string, string>; locale?: string } = {}): AlexaRequestEnvelope {
  return {
    version: "1.0",
    session: { new: false, sessionId: "amzn1.echo-api.session.1", application: { applicationId: SKILL_ID }, user: { userId: "amzn1.ask.account.OWNER" }, ...(options.attributes && { attributes: options.attributes }) },
    context: { System: { application: { applicationId: SKILL_ID }, user: { userId: "amzn1.ask.account.OWNER" }, ...(options.apl && { device: { supportedInterfaces: APL } }) } },
    request: { requestId: "amzn1.echo-api.request.1", timestamp: "2026-10-08T18:00:00Z", locale: options.locale ?? "en-US", ...request } as AlexaRequestEnvelope["request"],
  };
}

const intent = (name: string, options: Parameters<typeof envelope>[1] = {}) => envelope({ type: "IntentRequest", intent: { name, slots: {} } }, options);
const done = (options: Parameters<typeof envelope>[1] = {}) => envelope({ type: "Alexa.Presentation.APL.UserEvent", token: "teleprompter", arguments: ["done"], source: { type: "TouchWrapper", handler: "Press", id: "doneButton" } }, options);

const agent = { turn: vi.fn() } as unknown as AgentClient;
const handler = createHandler({ skillId: SKILL_ID, agent, publicBaseUrl: BASE_URL });

/** Same copy rules as the handler suite (handler.test.ts `ssml`). */
function speech(response: AlexaResponseEnvelope): string {
  const text = response.response.outputSpeech?.ssml ?? "";
  for (const line of [text, response.response.reprompt?.outputSpeech.ssml ?? ""]) {
    expect(line).not.toMatch(/\b(?:demo|fixture|simulation|prototype|name-free)\b/i);
    expect(line).not.toMatch(/not sent|not contact anyone|not a real/i);
  }
  return text;
}

type Command = { type: string; componentId?: string; property?: string; value?: unknown; delay?: number; distance?: number; commands?: Command[] };
const flatten = (commands: Command[]): Command[] => commands.flatMap((command) => [command, ...flatten(command.commands ?? [])]);

test("the takes manifest carries a spike entry", () => {
  expect(SPIKE).toBeDefined();
});

test("the skill manifest declares APL and keeps the AudioPlayer", () => {
  expect(skillManifest.manifest.apis.custom.interfaces).toEqual([{ type: "AUDIO_PLAYER" }, { type: "ALEXA_PRESENTATION_APL" }]);
});

describe("recording (phase 1 device spike)", () => {
  test("R1 record story on a screen renders the teleprompter, counts down before scrolling and leaves the session open", async () => {
    const response = await handler(intent("RecordStoryIntent", { apl: true }));
    const directives = response.response.directives ?? [];
    const renders = directives.filter((directive) => directive.type === "Alexa.Presentation.APL.RenderDocument");
    expect(renders).toHaveLength(1);
    expect(renders[0]).toMatchObject({ token: "teleprompter", document: teleprompter, datasources: { teleprompter: { script: SPIKE?.script } } });
    const execute = directives.find((directive) => directive.type === "Alexa.Presentation.APL.ExecuteCommands") as { token: string; commands: Command[] } | undefined;
    expect(execute?.token).toBe("teleprompter");
    const steps = flatten(execute?.commands ?? []);
    const countdown = steps.filter((step) => step.componentId === "countdown").map((step) => step.value);
    expect(countdown).toEqual(["3", "2", "1"]);
    const lastCountdown = steps.findLastIndex((step) => step.componentId === "countdown");
    const firstScroll = steps.findIndex((step) => step.type === "Scroll");
    expect(firstScroll).toBeGreaterThan(lastCountdown);
    expect("shouldEndSession" in response.response).toBe(false);
    expect(speech(response)).toContain(CREATE_MESSAGES.recordCue);
    expect(response.sessionAttributes).toEqual({ demoFlow: "create", createStage: "recording" });
  });

  test("R2 record story without a screen sends no APL and speaks the script with the end cue (SS1)", async () => {
    const response = await handler(intent("RecordStoryIntent"));
    expect(response.response.directives ?? []).toEqual([]);
    const text = speech(response);
    expect(text).toContain(SPIKE?.script.slice(0, 40) ?? "missing");
    expect(text).toContain("Alexa, the end");
    expect("shouldEndSession" in response.response).toBe(false);
  });

  test.each([
    ["TheEndIntent", () => intent("TheEndIntent", { apl: true, attributes: { demoFlow: "create", createStage: "recording" } })],
    ["a Done tap", () => done({ apl: true, attributes: { demoFlow: "create", createStage: "recording" } })],
    ["a Done tap after the session closed", () => done({ apl: true })],
  ])("R3 %s plays the matched take in the session and asks to record again or continue", async (_label, request) => {
    const response = await handler(request());
    const text = speech(response);
    expect(text).toContain(`<audio src="${BASE_URL}/fixtures/takes/${SPIKE?.files.plain ?? "missing"}"/>`);
    expect(text).toMatch(/^<speak>Got it\. Here(?:'|&#39;)s your recording\./);
    expect(response.response.reprompt?.outputSpeech.ssml).toBe(`<speak>${CREATE_MESSAGES.takeQuestion}</speak>`);
    expect(response.response.shouldEndSession).toBe(false);
    expect(response.sessionAttributes).toEqual({ demoFlow: "create", createStage: "review" });
  });

  test("record again from review restarts the recording", async () => {
    const response = await handler(intent("RecordStoryIntent", { apl: true, attributes: { demoFlow: "create", createStage: "review" } }));
    expect(response.response.directives?.some((directive) => directive.type === "Alexa.Presentation.APL.RenderDocument")).toBe(true);
    expect(response.sessionAttributes).toEqual({ demoFlow: "create", createStage: "recording" });
  });

  test.each(["AMAZON.ResumeIntent", "AMAZON.NextIntent"])("%s (continue) in review ends the spike", async (name) => {
    const response = await handler(intent(name, { attributes: { demoFlow: "create", createStage: "review" } }));
    expect(speech(response)).toBe(`<speak>${CREATE_MESSAGES.takeContinue}</speak>`);
    expect(response.response.shouldEndSession).toBe(true);
    expect(response.response.directives).toBeUndefined();
  });

  test.each(["AMAZON.FallbackIntent", "AMAZON.HelpIntent"])("%s in review asks the review question again", async (name) => {
    const response = await handler(intent(name, { attributes: { demoFlow: "create", createStage: "review" } }));
    expect(speech(response)).toBe(`<speak>${CREATE_MESSAGES.takeQuestion}</speak>`);
    expect(response.response.shouldEndSession).toBe(false);
    expect(response.sessionAttributes).toEqual({ demoFlow: "create", createStage: "review" });
  });

  test("a fallback while reading repeats how to finish and keeps the session open with the mic closed", async () => {
    const response = await handler(intent("AMAZON.FallbackIntent", { apl: true, attributes: { demoFlow: "create", createStage: "recording" } }));
    expect(speech(response)).toContain("Alexa, the end");
    expect("shouldEndSession" in response.response).toBe(false);
    expect(response.sessionAttributes).toEqual({ demoFlow: "create", createStage: "recording" });
  });

  test("SS5 without a host for takes, review says the take is not ready and stays at review", async () => {
    const offline = createHandler({ skillId: SKILL_ID, agent });
    const response = await offline(intent("TheEndIntent", { attributes: { demoFlow: "create", createStage: "recording" } }));
    const text = speech(response);
    expect(text).not.toContain("<audio");
    expect(text).toContain("isn");
    expect(text).toContain("ready to play yet");
    expect(response.response.shouldEndSession).toBe(false);
    expect(response.sessionAttributes).toEqual({ demoFlow: "create", createStage: "review" });
  });

  test("continue outside review keeps its existing meaning", async () => {
    const response = await handler(intent("AMAZON.ResumeIntent"));
    expect(speech(response)).not.toContain(CREATE_MESSAGES.takeContinue);
  });

  test("an unknown create stage is dropped from the session", async () => {
    const response = await handler(intent("AMAZON.ResumeIntent", { attributes: { demoFlow: "create", createStage: "sending" } }));
    expect(speech(response)).not.toContain(CREATE_MESSAGES.takeContinue);
    expect(response.sessionAttributes).toEqual({});
  });

  test("an APL runtime error while reading is logged by type only, with no speech, and keeps the stage", async () => {
    const { log } = await import("@spoken-letter-alexa/shared");
    const warn = vi.spyOn(log, "warn");
    const response = await handler(envelope({ type: "Alexa.Presentation.APL.RuntimeError", token: "teleprompter", errors: [{ type: "LINK_ERROR", reason: "INVALID_COMMAND", message: "Scroll failed on scriptScroll" }] }, { apl: true, attributes: { demoFlow: "create", createStage: "recording" } }));
    expect(response.response.outputSpeech).toBeUndefined();
    expect("shouldEndSession" in response.response).toBe(false);
    expect(response.sessionAttributes).toEqual({ demoFlow: "create", createStage: "recording" });
    expect(warn).toHaveBeenCalledWith("apl_runtime_error", { errors: ["LINK_ERROR:INVALID_COMMAND"] });
    warn.mockRestore();
  });

  test("a UserEvent with other arguments falls back to help without playing a take", async () => {
    const response = await handler(envelope({ type: "Alexa.Presentation.APL.UserEvent", token: "teleprompter", arguments: ["other"] }, { apl: true }));
    expect(speech(response)).not.toContain("<audio");
  });

  test("Spanish requests never enter the English-only recording path (D1)", async () => {
    const response = await handler(done({ apl: true, locale: "es-ES" }));
    expect(speech(response)).not.toContain("<audio");
  });

  test("the turn log names the response key and the create flow without logging the script", async () => {
    const { log } = await import("@spoken-letter-alexa/shared");
    const info = vi.spyOn(log, "info");
    await handler(intent("TheEndIntent", { attributes: { demoFlow: "create", createStage: "recording" } }));
    const fields = info.mock.calls.find(([event]) => event === "skill_turn")?.[1];
    expect(fields).toMatchObject({ responseKey: "take_review", flowBefore: "create", flowAfter: "create", intent: "TheEndIntent" });
    expect(JSON.stringify(fields)).not.toContain(SPIKE?.script.slice(0, 20) ?? "missing");
    info.mockRestore();
  });
});
