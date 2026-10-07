import { log, type SkillLocale, spanishPattern } from "@spoken-letter-alexa/shared";
import { afterEach, describe, expect, test, vi } from "vitest";

import { MemoryDemoDraftStore } from "../../agent/src/demo-drafts.ts";
import { MemoryDemoUpdateStore } from "../../agent/src/demo-updates.ts";
import { MemoryPlaylistStore } from "../../agent/src/playlist.ts";
import { createAgentApp } from "../../agent/src/routes.ts";
import { ScriptedModel } from "../../agent/src/scripted-model.ts";
import { deviceSessionId, MemorySessionStore } from "../../agent/src/sessions.ts";
import { ISSUER, MCP_URL, mcpHarness, TEST_STORIES } from "../../agent/src/test-support.ts";
import englishModel from "../skill-package/interactionModels/custom/en-US.json" with { type: "json" };
import spanishModel from "../skill-package/interactionModels/custom/es-ES.json" with { type: "json" };
import { createAgentClient } from "./agent-client.ts";
import { type InteractionModel, SLOT_PLACEHOLDER } from "./model/generate.ts";
import { type AlexaRequestEnvelope, type AlexaResponseEnvelope, createHandler } from "./handler.ts";

// Phase 4 local rehearsal (phase-4.md R1–R5): the real handler, the real HTTP client and the
// Hono agent routes with in-memory stores and the scripted model, driven by spoken utterances.
// R1 and R3 also run with en-US requests and English utterances against exact English lines
// (R5), next to the unmodified English rehearsal in session-recovery.integration.test.ts.

const SKILL_ID = "amzn1.ask.skill.local-rehearsal";
const DEVICE_ID = "amzn1.ask.account.local-rehearsal";
const SECRET = "local-rehearsal-command-secret";
const BASE = "http://skill-rehearsal.local";
const CATALOG_TEXT = TEST_STORIES.flatMap((story) => [story.title, story.storyteller]);
const titleOf = (id: string | undefined) => TEST_STORIES.find((story) => story.id === id)?.title;
const ENGLISH = /\b(?:you|the|your|is|was|playing|saved|ready|story|stories|there|ask|try|say|what|which|okay)\b/i;

type Slot = { name: string; value: string; resolutions?: unknown };

/** Built-in intents a speaker reaches without a custom sample. */
const BUILT_INS: Record<SkillLocale, Record<string, string>> = {
  "en-US": { pause: "AMAZON.PauseIntent", resume: "AMAZON.ResumeIntent", next: "AMAZON.NextIntent", yes: "AMAZON.YesIntent", no: "AMAZON.NoIntent" },
  "es-ES": {
    pausa: "AMAZON.PauseIntent", "continúa": "AMAZON.ResumeIntent", siguiente: "AMAZON.NextIntent",
    "sí": "AMAZON.YesIntent", no: "AMAZON.NoIntent", cancela: "AMAZON.CancelIntent", ayuda: "AMAZON.HelpIntent",
  },
};
const MODELS: Record<SkillLocale, InteractionModel> = { "en-US": englishModel, "es-ES": spanishModel };

/** A sample as an anchored pattern, each `{slot}` a lazy capture. */
const samplePattern = (sample: string): RegExp =>
  new RegExp(`^${sample.split(SLOT_PLACEHOLDER).map((part, index) => (index % 2 === 1 ? "(.+?)" : part.replace(/[.*+?^$()|[\]\\]/g, "\\$&"))).join("")}$`, "iu");

/**
 * A local stand-in for Amazon's NLU over a generated model: an utterance must match a sample
 * exactly (slots as wildcards), custom slots must resolve against their type's values and
 * synonyms, and the most literal match wins. Anything else is AMAZON.FallbackIntent. It is
 * stricter than Amazon's NLU, which also routes near matches and unresolved custom slots
 * (Phase 4 device acceptance covers that).
 */
function understand(utterance: string, locale: SkillLocale): { name: string; slots: Record<string, Slot> } {
  const builtIn = BUILT_INS[locale][utterance.toLocaleLowerCase(locale)];
  if (builtIn) return { name: builtIn, slots: {} };
  const { intents, types } = MODELS[locale].interactionModel.languageModel;
  let best: { name: string; slots: Record<string, Slot>; literal: number } | null = null;
  for (const intent of intents) {
    const declared = new Map((intent.slots ?? []).map((slot) => [slot.name, slot.type]));
    for (const sample of intent.samples) {
      const names = [...sample.matchAll(SLOT_PLACEHOLDER)].map((match) => match[1] ?? "");
      const match = samplePattern(sample).exec(utterance);
      if (!match) continue;
      const slots: Record<string, Slot> = {};
      let resolvedAll = true;
      for (const [index, name] of names.entries()) {
        const value = match[index + 1] ?? "";
        const type = declared.get(name) ?? "";
        if (type.startsWith("AMAZON.")) { slots[name] = { name, value }; continue; }
        const entry = types.find((item) => item.name === type)?.values.find((candidate) =>
          [candidate.name.value, ...(candidate.name.synonyms ?? [])].some((spoken) => spoken.toLocaleLowerCase(locale) === value.toLocaleLowerCase(locale)));
        if (!entry) { resolvedAll = false; break; }
        slots[name] = { name, value, resolutions: { resolutionsPerAuthority: [{ status: { code: "ER_SUCCESS_MATCH" }, values: [{ value: { name: entry.name.value } }] }] } };
      }
      const literal = sample.replace(SLOT_PLACEHOLDER, "").length;
      if (resolvedAll && (!best || literal > best.literal)) best = { name: intent.name, slots, literal };
    }
  }
  return best ? { name: best.name, slots: best.slots } : { name: "AMAZON.FallbackIntent", slots: {} };
}

async function rehearsal(locale: SkillLocale) {
  const mcp = await mcpHarness();
  const playlist = new MemoryPlaylistStore();
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
    playlist: { store: playlist, secret: SECRET },
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
  const responses: AlexaResponseEnvelope[] = [];
  let audio: { token: string; offsetInMilliseconds: number } | undefined;
  let requestIndex = 0;
  let sessionIndex = 1;
  const envelope = (request: Record<string, unknown>, isNew = false): AlexaRequestEnvelope => ({
    version: "1.0",
    session: { new: isNew, sessionId: `es-session-${sessionIndex}`, application: { applicationId: SKILL_ID }, user: { userId: DEVICE_ID }, attributes },
    context: { System: { application: { applicationId: SKILL_ID }, user: { userId: DEVICE_ID } }, ...(audio && { AudioPlayer: audio }) },
    request: { requestId: `es-request-${++requestIndex}`, timestamp: "2026-10-07T12:00:00Z", locale, ...request } as AlexaRequestEnvelope["request"],
  });
  const submit = async (event: AlexaRequestEnvelope) => {
    const response = await handler(event);
    responses.push(response);
    if (event.request.type === "IntentRequest" || event.request.type === "LaunchRequest") attributes = response.sessionAttributes ?? {};
    const play = response.response.directives?.find((directive) => directive.type === "AudioPlayer.Play");
    if (play) audio = { token: play.audioItem.stream.token, offsetInMilliseconds: play.audioItem.stream.offsetInMilliseconds };
    return response;
  };
  return {
    drafts, updates, sessions, bodies, responses,
    playlistState: () => playlist.get(deviceSessionId(DEVICE_ID)),
    audio: () => audio,
    launch: () => { attributes = {}; sessionIndex += 1; return submit(envelope({ type: "LaunchRequest" }, true)); },
    say: (utterance: string) => submit(envelope({ type: "IntentRequest", intent: understand(utterance, locale) })),
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

/** Lines the R1 and R3 journeys speak, per locale. Titles come from the playlist state, which is shuffled. */
const LINES = {
  "en-US": {
    launch: 'A new story is ready. "A lighthouse for Mateo" by Grandpa Juan. You can say let\'s create a story.',
    whatIsNew: 'You have 2 delivered stories. The newest is "A lighthouse for Mateo" by Grandpa Juan.',
    play: (title: string) => `Playing ${title} by Grandpa Juan.`,
    next: (title: string) => `Playing ${title}.`,
    subtitle: "read by Grandpa Juan",
    wishProposed: "Save a wish for a space story? Say yes or no.",
    wishSaved: "I saved your wish.",
    reactionPrompt: (title: string) => `Did you like or love ${title}?`,
    reactionSaved: "I saved that you loved the story.",
  },
  "es-ES": {
    launch: 'Ya tienes una historia nueva. "A lighthouse for Mateo", de Grandpa Juan. Puedes decir vamos a crear una historia.',
    whatIsNew: 'Tienes 2 historias. La más reciente es "A lighthouse for Mateo", de Grandpa Juan.',
    play: (title: string) => `Pongo ${title}, de Grandpa Juan.`,
    next: (title: string) => `Pongo ${title}.`,
    subtitle: "leída por Grandpa Juan",
    wishProposed: "¿Guardo tu deseo de una historia sobre el espacio? Di sí o no.",
    wishSaved: "He guardado tu deseo.",
    reactionPrompt: (title: string) => `¿Te ha gustado o te ha encantado ${title}?`,
    reactionSaved: "He guardado que te ha encantado la historia.",
  },
};
const UTTERANCES = {
  "en-US": { whatIsNew: "what is new", playAll: "play my stories", pause: "pause", resume: "resume", next: "next",
    wish: "i want a story about space", yes: "yes", love: "i love that story" },
  "es-ES": { whatIsNew: "qué hay de nuevo", playAll: "pon mis historias", pause: "pausa", resume: "continúa", next: "siguiente",
    wish: "quiero una historia sobre el espacio", yes: "sí", love: "me encanta" },
};

describe.each(["es-ES", "en-US"] as const)("R1 and R3 journeys in %s (R5 for en-US)", (locale) => {
  const lines = LINES[locale];
  const words = UTTERANCES[locale];

  test("R1 launch, what is new, play, pause, resume and next continue one playlist with exact lines", async () => {
    const h = await rehearsal(locale);
    expect(speechOf(await h.launch())).toBe(lines.launch);
    const whatIsNew = await h.say(words.whatIsNew);
    expect(speechOf(whatIsNew)).toBe(lines.whatIsNew);
    expect(whatIsNew.response.directives).toBeUndefined();
    const play = await h.say(words.playAll);
    const started = await h.playlistState();
    expect(started?.index).toBe(0);
    expect(speechOf(play)).toBe(lines.play(titleOf(started?.ids[0]) ?? ""));
    expect(h.audio()?.token).toMatch(new RegExp(`^pl_${started?.generation}_0_`));
    const pause = await h.say(words.pause);
    expect(pause.response.directives).toEqual([{ type: "AudioPlayer.Stop" }]);
    h.paused(42_000);
    const resume = await h.say(words.resume);
    expect(resume.response.outputSpeech).toBeUndefined();
    expect(resume.response.directives?.[0]).toMatchObject({ type: "AudioPlayer.Play",
      audioItem: { stream: { offsetInMilliseconds: 42_000 }, metadata: { title: titleOf(started?.ids[0]), subtitle: lines.subtitle } } });
    const resumed = await h.playlistState();
    expect(resumed).toMatchObject({ ids: started?.ids, index: 0, generation: (started?.generation ?? 0) + 1 });
    expect(h.audio()?.token).toMatch(new RegExp(`^pl_${resumed?.generation}_0_`));
    const next = await h.say(words.next);
    const advanced = await h.playlistState();
    expect(advanced).toMatchObject({ ids: started?.ids, index: 1, generation: (resumed?.generation ?? 0) + 1 });
    expect(speechOf(next)).toBe(lines.next(titleOf(started?.ids[1]) ?? ""));
    expect(h.audio()?.token).toMatch(new RegExp(`^pl_${advanced?.generation}_1_`));
    if (locale === "es-ES") for (const response of h.responses) expectSpanish(response);
  });

  test("R3 a confirmed wish and a reaction after a finished story save one receipt each with exact confirmations", async () => {
    const h = await rehearsal(locale);
    expect(speechOf(await h.say(words.wish))).toBe(lines.wishProposed);
    expect(speechOf(await h.say(words.yes))).toBe(lines.wishSaved);
    await h.say(words.playAll);
    const finishedTitle = titleOf((await h.playlistState())?.ids[0]) ?? "";
    await h.finished();
    expect(speechOf(await h.launch())).toBe(lines.reactionPrompt(finishedTitle));
    expect(speechOf(await h.say(words.love))).toBe(lines.reactionSaved);
    const state = await h.updates.get(deviceSessionId(DEVICE_ID));
    expect(state?.wishes.map((wish) => wish.topic)).toEqual(["space"]);
    expect(state?.reactions.map((reaction) => reaction.choice)).toEqual(["love"]);
    if (locale === "es-ES") for (const response of h.responses) expectSpanish(response);
  });
});

describe("Spanish rehearsal through the real handler, client and routes (phase-4.md)", () => {
  test.each([
    ["qué hay de nuevo", "WhatIsNewIntent"], ["pon mis historias", "PlayAllIntent"], ["vamos a crear una historia", "StartStoryIntent"],
    ["sirenas", "ThemeChoiceIntent"], ["lee mi borrador", "ReadDemoDraftIntent"], ["quiero una historia sobre el espacio", "WishStoryIntent"],
    ["me encanta", "ReactToStoryIntent"], ["envíale una historia a Ana", "AppHandoffIntent"], ["cómo añado créditos", "CreditHelpIntent"],
    ["algo que no tiene sentido", "AMAZON.FallbackIntent"],
  ])("the generated es-ES model routes %s to %s", (utterance, intent) => {
    expect(understand(utterance, "es-ES").name).toBe(intent);
  });

  test("R2 create, fallback, a bare Spanish theme and readback save one mermaid receipt read in Spanish", async () => {
    const h = await rehearsal("es-ES");
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

  test("R4 a named send request and a credits question hand off without the name reaching replies, logs, the agent or storage", async () => {
    const logged = (["info", "warn", "error"] as const).map((level) => vi.spyOn(log, level));
    const h = await rehearsal("es-ES");
    const handoff = await h.say("envíale una historia a Ana");
    expect(speechOf(handoff)).toBe("Puedo ayudarte a empezar una historia. Abre Spoken Letter para elegir quién la escucha y enviarla.");
    const credits = await h.say("cómo añado créditos");
    expect(speechOf(credits)).toBe("Puedes añadir créditos para historias en Spoken Letter.");
    await h.say("qué hay de nuevo");
    const session = await h.sessions.get(deviceSessionId(DEVICE_ID));
    expect(session).not.toBeNull();
    const name = spanishPattern(String.raw`\bana\b`);
    for (const evidence of [JSON.stringify(h.responses), ...logged.map((spy) => JSON.stringify(spy.mock.calls)), h.bodies.join("\n"),
      JSON.stringify(session), JSON.stringify((await h.drafts.get(deviceSessionId(DEVICE_ID))) ?? null),
      JSON.stringify((await h.updates.get(deviceSessionId(DEVICE_ID))) ?? null)]) {
      expect(evidence).not.toMatch(name);
    }
    expect(logged[0]?.mock.calls.length).toBeGreaterThan(0);
  });
});
