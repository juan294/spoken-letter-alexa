import { log } from "@spoken-letter-alexa/shared";
import { afterEach, describe, expect, test, vi } from "vitest";

import { MemoryDemoDraftStore } from "../../agent/src/demo-drafts.ts";
import { MemoryDemoUpdateStore } from "../../agent/src/demo-updates.ts";
import { MemoryPlaylistStore } from "../../agent/src/playlist.ts";
import { createAgentApp } from "../../agent/src/routes.ts";
import { ScriptedModel } from "../../agent/src/scripted-model.ts";
import { deviceSessionId, MemorySessionStore } from "../../agent/src/sessions.ts";
import { ISSUER, MCP_URL, mcpHarness, TEST_STORIES } from "../../agent/src/test-support.ts";
import spanishModel from "../skill-package/interactionModels/custom/es-ES.json" with { type: "json" };
import { createAgentClient } from "./agent-client.ts";
import { type AlexaRequestEnvelope, type AlexaResponseEnvelope, createHandler } from "./handler.ts";

// Phase 4 local rehearsal (phase-4.md R1–R4): the real handler, the real HTTP client and the
// Hono agent routes with in-memory stores and the scripted model, driven by Spanish
// utterances. R5 is the English rehearsal in session-recovery.integration.test.ts, unmodified.

const SKILL_ID = "amzn1.ask.skill.local-rehearsal";
const DEVICE_ID = "amzn1.ask.account.local-rehearsal";
const SECRET = "local-rehearsal-command-secret";
const BASE = "http://skill-rehearsal.local";
const CATALOG_TEXT = [...TEST_STORIES.flatMap((story) => [story.title, story.storyteller])];
const ENGLISH = /\b(?:you|the|your|is|was|playing|saved|ready|story|stories|there|ask|try|say|what|which|okay)\b/i;

type Slot = { name: string; value: string; resolutions?: unknown };

/** Built-in intents a Spanish speaker reaches without a custom sample. */
const BUILT_INS: Record<string, string> = {
  pausa: "AMAZON.PauseIntent", "continúa": "AMAZON.ResumeIntent", siguiente: "AMAZON.NextIntent",
  "sí": "AMAZON.YesIntent", no: "AMAZON.NoIntent", cancela: "AMAZON.CancelIntent", ayuda: "AMAZON.HelpIntent",
};

/**
 * A local stand-in for Amazon's NLU over the generated es-ES model: an utterance must match a
 * sample exactly (slots as wildcards), custom slots must resolve against their type's values
 * and synonyms, and the most literal match wins. Anything else is AMAZON.FallbackIntent.
 */
function understand(utterance: string): { name: string; slots: Record<string, Slot> } {
  const builtIn = BUILT_INS[utterance.toLocaleLowerCase("es-ES")];
  if (builtIn) return { name: builtIn, slots: {} };
  const { intents, types } = spanishModel.interactionModel.languageModel;
  let best: { name: string; slots: Record<string, Slot>; literal: number } | null = null;
  for (const intent of intents) {
    const declared = new Map(("slots" in intent ? intent.slots : []).map((slot) => [slot.name, slot.type]));
    for (const sample of intent.samples) {
      const names = [...sample.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? "");
      const pattern = new RegExp(`^${sample.split(/\{\w+\}/).map((part) => part.replace(/[.*+?^$()|[\]\\]/g, "\\$&")).join("(.+?)")}$`, "iu");
      const match = pattern.exec(utterance);
      if (!match) continue;
      const slots: Record<string, Slot> = {};
      let resolvedAll = true;
      for (const [index, name] of names.entries()) {
        const value = match[index + 1] ?? "";
        const type = declared.get(name) ?? "";
        if (type.startsWith("AMAZON.")) { slots[name] = { name, value }; continue; }
        const entry = types.find((item) => item.name === type)?.values.find((candidate) =>
          [candidate.name.value, ...("synonyms" in candidate.name ? candidate.name.synonyms : [])].some((spoken) => spoken.toLocaleLowerCase("es-ES") === value.toLocaleLowerCase("es-ES")));
        if (!entry) { resolvedAll = false; break; }
        slots[name] = { name, value, resolutions: { resolutionsPerAuthority: [{ status: { code: "ER_SUCCESS_MATCH" }, values: [{ value: { name: entry.name.value } }] }] } };
      }
      const literal = sample.replace(/\{\w+\}/g, "").length;
      if (resolvedAll && (!best || literal > best.literal)) best = { name: intent.name, slots, literal };
    }
  }
  return best ? { name: best.name, slots: best.slots } : { name: "AMAZON.FallbackIntent", slots: {} };
}

async function rehearsal() {
  const mcp = await mcpHarness();
  const drafts = new MemoryDemoDraftStore();
  const updates = new MemoryDemoUpdateStore();
  const sessions = new MemorySessionStore();
  const stories = TEST_STORIES.map((story) => ({ id: story.id, title: story.title, storyteller: story.storyteller, deliveredAt: story.deliveredAt,
    audioUrl: `${ISSUER}/fixtures/audio/${story.file}` }));
  const app = createAgentApp({
    model: new ScriptedModel(), modelId: null, mcpUrl: MCP_URL, mcpFetch: mcp.fetch,
    deviceMcp: { url: MCP_URL, fetch: mcp.fetch }, sessions,
    speech: { synthesize: () => Promise.resolve(null) }, transcribe: () => Promise.resolve(""),
    demoToken: mcp.serviceToken, offline: true,
    playlist: { store: new MemoryPlaylistStore(), secret: SECRET },
    drafts: { store: drafts, generator: () => Promise.resolve({ place: "quiet shore", challenge: "small mystery", ending: "kindness" }) },
    updates: { store: updates, stories, seed: [
      { eventId: "evt-lighthouse", type: "new_story", occurredAt: "2026-09-02T20:05:00.000Z", storyId: "st_lighthouse", detail: "A new story is ready." },
    ] },
  });
  const bodies: string[] = [];
  const network: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (typeof init?.body === "string") bodies.push(init.body);
    return app.request(url, init);
  };
  const handler = createHandler({ skillId: SKILL_ID, agent: createAgentClient({ baseUrl: BASE, fetch: network, timeoutMs: 7_000, skillSecret: SECRET }) });
  let attributes: Record<string, string> = {};
  let audio: { token: string; offsetInMilliseconds: number } | undefined;
  let requestIndex = 0;
  let sessionIndex = 1;
  const envelope = (request: Record<string, unknown>, isNew = false): AlexaRequestEnvelope => ({
    version: "1.0",
    session: { new: isNew, sessionId: `es-session-${sessionIndex}`, application: { applicationId: SKILL_ID }, user: { userId: DEVICE_ID }, attributes },
    context: { System: { application: { applicationId: SKILL_ID }, user: { userId: DEVICE_ID } }, ...(audio && { AudioPlayer: audio }) },
    request: { requestId: `es-request-${++requestIndex}`, timestamp: "2026-10-07T12:00:00Z", locale: "es-ES", ...request } as AlexaRequestEnvelope["request"],
  });
  const submit = async (event: AlexaRequestEnvelope) => {
    const response = await handler(event);
    if (event.request.type === "IntentRequest" || event.request.type === "LaunchRequest") attributes = response.sessionAttributes ?? {};
    const play = response.response.directives?.find((directive) => directive.type === "AudioPlayer.Play");
    if (play) audio = { token: play.audioItem.stream.token, offsetInMilliseconds: play.audioItem.stream.offsetInMilliseconds };
    return response;
  };
  return {
    drafts, updates, sessions, bodies,
    audio: () => audio,
    launch: () => { attributes = {}; sessionIndex += 1; return submit(envelope({ type: "LaunchRequest" }, true)); },
    say: (utterance: string) => submit(envelope({ type: "IntentRequest", intent: understand(utterance) })),
    paused: (offsetInMilliseconds: number) => { if (audio) audio = { ...audio, offsetInMilliseconds }; },
    finished: () => submit(envelope({ type: "AudioPlayer.PlaybackFinished", token: audio?.token })),
  };
}

const unescape = (ssml: string) => ssml.replace(/<\/?speak>/g, "").replaceAll("&quot;", '"').replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
const speechOf = (response: AlexaResponseEnvelope) => unescape(response.response.outputSpeech?.ssml ?? "");

/** Every spoken line is Spanish; catalog titles and storyteller names are content and stay as written. */
function expectSpanish(response: AlexaResponseEnvelope) {
  for (const line of [speechOf(response), unescape(response.response.reprompt?.outputSpeech.ssml ?? "")]) {
    const prose = CATALOG_TEXT.reduce((rest, name) => rest.replaceAll(name, ""), line);
    expect(prose, line).not.toMatch(ENGLISH);
  }
}

afterEach(() => vi.restoreAllMocks());

describe("Spanish rehearsal through the real handler, client and routes (phase-4.md)", () => {
  test("every rehearsal utterance is a sample in the generated es-ES model", () => {
    for (const utterance of ["qué hay de nuevo", "pon mis historias", "vamos a crear una historia", "sirenas", "lee mi borrador",
      "quiero una historia sobre el espacio", "me encanta", "envíale una historia a Ana", "cómo añado créditos"]) {
      expect(understand(utterance).name, utterance).not.toBe("AMAZON.FallbackIntent");
    }
  });

  test("R1 launch, what is new, play, pause, resume and next stay Spanish and continue the playlist token", async () => {
    const h = await rehearsal();
    const launch = await h.launch();
    expect(speechOf(launch)).toBe('Ya tienes una historia nueva. "A lighthouse for Mateo", de Grandpa Juan. Puedes decir vamos a crear una historia.');
    const whatIsNew = await h.say("qué hay de nuevo");
    expect(whatIsNew.response.directives).toBeUndefined();
    expectSpanish(whatIsNew);
    const play = await h.say("pon mis historias");
    expectSpanish(play);
    expect(speechOf(play)).toMatch(/^Pongo .+, de Grandpa Juan\.$/);
    const first = h.audio();
    expect(first?.token).toMatch(/^pl_/);
    const pause = await h.say("pausa");
    expect(pause.response.directives).toEqual([{ type: "AudioPlayer.Stop" }]);
    h.paused(42_000);
    const resume = await h.say("continúa");
    expect(resume.response.outputSpeech).toBeUndefined();
    expect(resume.response.directives?.[0]).toMatchObject({ type: "AudioPlayer.Play", audioItem: { stream: { offsetInMilliseconds: 42_000 }, metadata: { subtitle: "leída por Grandpa Juan" } } });
    const resumedToken = h.audio()?.token;
    expect(resumedToken).toMatch(/^pl_\d+_0_/);
    const next = await h.say("siguiente");
    expectSpanish(next);
    expect(speechOf(next)).toMatch(/^Pongo .+\.$/);
    expect(h.audio()?.token).toMatch(/^pl_\d+_1_/);
    expect(h.audio()?.token).not.toBe(resumedToken);
  });

  test("R2 create, fallback, a bare Spanish theme and readback save one mermaid receipt read in Spanish", async () => {
    const h = await rehearsal();
    const start = await h.say("vamos a crear una historia");
    expectSpanish(start);
    const fallback = await h.say("algo que no tiene sentido");
    expect(fallback.sessionAttributes).toEqual({ demoFlow: "draft", fallbackCount: "1" });
    expectSpanish(fallback);
    const saved = await h.say("sirenas");
    expect(speechOf(saved)).toBe("He guardado el borrador de tu historia. Abre Spoken Letter para elegir quién la escucha y terminarla.");
    const receipts = (await h.drafts.get(deviceSessionId(DEVICE_ID)))?.receipts ?? [];
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.theme).toBe("mermaids");
    const read = await h.say("lee mi borrador");
    expect(speechOf(read)).toBe("Tu borrador dice: Tema: las sirenas. Lugar: una orilla tranquila. Nudo: un pequeño misterio. Final: la bondad trae a todos de vuelta a casa.");
  });

  test("R3 a confirmed wish and a reaction after a finished story save one receipt each, confirmed in Spanish", async () => {
    const h = await rehearsal();
    const proposed = await h.say("quiero una historia sobre el espacio");
    expect(speechOf(proposed)).toBe("¿Guardo tu deseo de una historia sobre el espacio? Di sí o no.");
    expect(speechOf(await h.say("sí"))).toBe("He guardado tu deseo.");
    await h.say("pon mis historias");
    await h.finished();
    const prompt = await h.launch();
    expectSpanish(prompt);
    expect(speechOf(prompt)).toMatch(/^¿Te ha gustado o te ha encantado .+\?$/);
    const reacted = await h.say("me encanta");
    expect(speechOf(reacted)).toBe("He guardado que te ha encantado la historia.");
    const state = await h.updates.get(deviceSessionId(DEVICE_ID));
    expect(state?.wishes.map((wish) => wish.topic)).toEqual(["space"]);
    expect(state?.reactions.map((reaction) => reaction.choice)).toEqual(["love"]);
  });

  test("R4 a named send request and a credits question hand off without the name reaching replies, logs, the agent or storage", async () => {
    const info = vi.spyOn(log, "info");
    const warn = vi.spyOn(log, "warn");
    const h = await rehearsal();
    const handoff = await h.say("envíale una historia a Ana");
    expect(speechOf(handoff)).toBe("Puedo ayudarte a empezar una historia. Abre Spoken Letter para elegir quién la escucha y enviarla.");
    const credits = await h.say("cómo añado créditos");
    expect(speechOf(credits)).toBe("Puedes añadir créditos para historias en Spoken Letter.");
    await h.say("qué hay de nuevo");
    for (const evidence of [speechOf(handoff), JSON.stringify(info.mock.calls), JSON.stringify(warn.mock.calls), h.bodies.join("\n"),
      JSON.stringify(await h.sessions.get(deviceSessionId(DEVICE_ID))), JSON.stringify(await h.drafts.get(deviceSessionId(DEVICE_ID)))]) {
      expect(evidence).not.toContain("Ana");
    }
  });
});
