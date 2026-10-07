import { log } from "@spoken-letter-alexa/shared";
import { afterEach, describe, expect, test, vi } from "vitest";

import { AgentHttpError, type AgentClient } from "./agent-client.ts";
import { createHandler, type AlexaRequestEnvelope, type AlexaResponseEnvelope } from "./handler.ts";

const SKILL_ID = "amzn1.ask.skill.00000000-0000-4000-8000-000000000000";
const USER = "amzn1.ask.account.OWNER";
const PLAY = { id: "st_owl", url: "https://alexa.spokenletter.com/fixtures/audio/st_owl.mp3", title: "The owl who forgot how to hoot", storyteller: "Grandpa Juan", durationSeconds: 184, artUrl: null };

type SlotInput = string | { value: string; resolved?: string; noMatch?: boolean };

function slotFor(name: string, input: SlotInput) {
  if (typeof input === "string") return { name, value: input };
  const status = input.resolved ? "ER_SUCCESS_MATCH" : "ER_SUCCESS_NO_MATCH";
  return {
    name,
    value: input.value,
    resolutions: { resolutionsPerAuthority: [{
      authority: `amzn1.er-authority.echo-sdk.${SKILL_ID}.Type`,
      status: { code: status },
      ...(input.resolved && { values: [{ value: { name: input.resolved, id: "id" } }] }),
    }] },
  };
}

function request(locale: string | undefined, body: Record<string, unknown>, attributes: Record<string, string> = {}, audioToken?: string): AlexaRequestEnvelope {
  return {
    version: "1.0",
    session: { new: false, sessionId: "amzn1.echo-api.session.es", application: { applicationId: SKILL_ID }, user: { userId: USER }, attributes },
    context: { System: { application: { applicationId: SKILL_ID }, user: { userId: USER } }, ...(audioToken && { AudioPlayer: { token: audioToken, offsetInMilliseconds: 1000 } }) },
    request: { requestId: "amzn1.echo-api.request.es", timestamp: "2026-10-07T08:00:00Z", ...(locale !== undefined && { locale }), ...body } as AlexaRequestEnvelope["request"],
  };
}

function intent(locale: string | undefined, name: string, slots: Record<string, SlotInput> = {}, attributes: Record<string, string> = {}) {
  return request(locale, { type: "IntentRequest", intent: { name, slots: Object.fromEntries(Object.entries(slots).map(([slot, value]) => [slot, slotFor(slot, value)])) } }, attributes);
}

function fakeAgent(overrides: Partial<AgentClient> = {}): AgentClient {
  return { turn: vi.fn().mockResolvedValue({ say: "Aquí está.", play: PLAY, toolCalls: [] }), ...overrides };
}

const speech = (r: AlexaResponseEnvelope) => (r.response.outputSpeech?.ssml ?? "").replace(/^<speak>|<\/speak>$/g, "");
const reprompt = (r: AlexaResponseEnvelope) => (r.response.reprompt?.outputSpeech.ssml ?? "").replace(/^<speak>|<\/speak>$/g, "");
const ENGLISH = /\b(?:you|the|say|story|would|your|there|what|which|saved|okay)\b/i;

function expectSpanish(response: AlexaResponseEnvelope) {
  // Story titles are content and stay as the catalog has them.
  for (const text of [speech(response), reprompt(response)].map((line) => line.replaceAll(PLAY.title, ""))) {
    expect(text).not.toMatch(ENGLISH);
    expect(text).not.toMatch(/\b(?:demo|fixture|simulation|prototype)\b/i);
  }
}

type SkillTurn = { responseKey: string; interactionResult: string };
const turns = (info: { mock: { calls: unknown[][] } }) =>
  info.mock.calls.filter(([event]) => event === "skill_turn").map(([, fields]) => fields as SkillTurn);

afterEach(() => {
  vi.restoreAllMocks();
});

type Step = { name: string; slots?: Record<string, SlotInput>; launch?: boolean };
const JOURNEYS: [string, Step[], Partial<AgentClient>?][] = [
  ["launch", [{ name: "", launch: true }]],
  ["help", [{ name: "AMAZON.HelpIntent" }]],
  ["two fallbacks", [{ name: "AMAZON.FallbackIntent" }, { name: "AMAZON.FallbackIntent" }]],
  ["resume, start over and previous with nothing playing", [{ name: "AMAZON.ResumeIntent" }, { name: "AMAZON.StartOverIntent" }, { name: "AMAZON.PreviousIntent" }]],
  ["loop and shuffle", [{ name: "AMAZON.LoopOnIntent" }, { name: "AMAZON.ShuffleOffIntent" }]],
  ["pause and stop", [{ name: "AMAZON.PauseIntent" }, { name: "AMAZON.StopIntent" }]],
  ["draft fallbacks then cancel", [{ name: "StartStoryIntent" }, { name: "AMAZON.FallbackIntent" }, { name: "AMAZON.FallbackIntent" }, { name: "AMAZON.CancelIntent" }]],
  ["wish fallbacks then cancel", [{ name: "WishStoryIntent", slots: { wishtopic: { value: "space", resolved: "space" } } }, { name: "AMAZON.FallbackIntent" }, { name: "AMAZON.FallbackIntent" }, { name: "AMAZON.CancelIntent" }]],
  ["reaction fallbacks then cancel", [{ name: "", launch: true }, { name: "AMAZON.FallbackIntent" }, { name: "AMAZON.FallbackIntent" }, { name: "AMAZON.CancelIntent" }],
    { demoNext: vi.fn().mockResolvedValue({ pendingReaction: { storyId: "st_owl", title: "The owl who forgot how to hoot", storyteller: "Grandpa Juan" } }), demoReact: vi.fn().mockResolvedValue({ status: "dismissed" }) }],
  ["reading updates with none unread", [{ name: "UpdatesIntent" }], { demoInbox: vi.fn().mockResolvedValue({ events: [] }) }],
  ["reading a missing draft", [{ name: "ReadDemoDraftIntent" }], { latestDraft: vi.fn().mockResolvedValue({ status: "missing" }) }],
];

async function run(locale: string, steps: Step[], overrides: Partial<AgentClient> = {}) {
  const info = vi.spyOn(log, "info");
  const handler = createHandler({ skillId: SKILL_ID, agent: fakeAgent(overrides) });
  let attributes: Record<string, string> = {};
  const responses: AlexaResponseEnvelope[] = [];
  for (const step of steps) {
    const event = step.launch ? request(locale, { type: "LaunchRequest" }, attributes) : intent(locale, step.name, step.slots, attributes);
    const response = await handler(event);
    attributes = response.sessionAttributes ?? {};
    responses.push(response);
  }
  const lines = turns(info);
  info.mockRestore();
  return { responses, lines };
}

describe("es-ES journeys match en-US structure (E1)", () => {
  test.each(JOURNEYS)("%s", async (_label, steps, overrides) => {
    const english = await run("en-US", steps, overrides);
    const spanish = await run("es-ES", steps, overrides);
    expect(spanish.lines.map((line) => [line.responseKey, line.interactionResult])).toEqual(english.lines.map((line) => [line.responseKey, line.interactionResult]));
    spanish.responses.forEach((response, index) => {
      const en = english.responses[index]!;
      expect(response.sessionAttributes).toEqual(en.sessionAttributes);
      expect(response.response.shouldEndSession).toEqual(en.response.shouldEndSession);
      expect(response.response.directives).toEqual(en.response.directives);
      expect(Boolean(response.response.reprompt)).toBe(Boolean(en.response.reprompt));
      if (en.response.outputSpeech) {
        expect(speech(response)).not.toBe(speech(en));
        expectSpanish(response);
      }
    });
  });
});

describe("es-ES slot resolution and catalog names", () => {
  test("E2 a spoken Spanish theme resolves to its canonical value and saves one draft", async () => {
    const saveDraft = vi.fn().mockResolvedValue({ status: "saved", draftId: "d1", theme: "mermaids", outline: "Una sirena." });
    const handler = createHandler({ skillId: SKILL_ID, agent: fakeAgent({ saveDraft }) });
    const start = await handler(intent("es-ES", "StartStoryIntent"));
    expectSpanish(start);
    expect(speech(start)).toMatch(/sirenas/);
    const saved = await handler(intent("es-ES", "ThemeChoiceIntent", { drafttheme: { value: "sirenas", resolved: "mermaids" } }, start.sessionAttributes));
    expect(saveDraft).toHaveBeenCalledExactlyOnceWith({ deviceUserId: USER, requestId: "amzn1.echo-api.request.es", theme: "mermaids" });
    expect(speech(saved)).toMatch(/He guardado el borrador/);
    expectSpanish(saved);
  });

  test("E3 resolved reaction, wish and storyteller values reach the backend as canonical values", async () => {
    const demoReact = vi.fn().mockResolvedValue({ status: "saved", reactionId: "r1", storyId: "st_owl", choice: "love" });
    const demoWish = vi.fn().mockResolvedValue({ status: "saved", wishId: "w1" });
    const handler = createHandler({ skillId: SKILL_ID, agent: fakeAgent({ demoReact, demoWish }) });

    const reacted = await handler(intent("es-ES", "ReactToStoryIntent", { choice: { value: "encanta", resolved: "love" } }, { demoFlow: "reaction" }));
    expect(demoReact).toHaveBeenCalledWith({ deviceUserId: USER, requestId: "amzn1.echo-api.request.es", choice: "love" });
    expect(speech(reacted)).toBe("He guardado que te ha encantado la historia.");

    const wish = await handler(intent("es-ES", "WishStoryIntent", { wishtopic: { value: "el espacio", resolved: "space" } }));
    expect(wish.sessionAttributes).toEqual({ demoFlow: "wish", demoTopic: "space" });
    expectSpanish(wish);
    expect(speech(wish)).toMatch(/espacio/);

    const fromTeller = await handler(intent("es-ES", "WishFromStorytellerIntent", {
      wishtopic: { value: "sirenas", resolved: "mermaids" },
      storyteller: { value: "tía Whitney", resolved: "Aunt Whitney" },
    }));
    expect(fromTeller.sessionAttributes).toEqual({ demoFlow: "wish", demoTopic: "mermaids", demoStoryteller: "Aunt Whitney" });
    expect(speech(fromTeller)).toContain("Aunt Whitney");
    expect(speech(fromTeller)).not.toContain("tía Whitney");

    const yes = await handler(intent("es-ES", "AMAZON.YesIntent", {}, fromTeller.sessionAttributes));
    expect(demoWish).toHaveBeenCalledWith({ deviceUserId: USER, requestId: "amzn1.echo-api.request.es", topic: "mermaids", storyteller: "Aunt Whitney", confirmed: true });
    expect(speech(yes)).toBe("He guardado tu deseo.");
  });

  test("an unresolved Spanish reaction still matches its spoken form", async () => {
    const demoReact = vi.fn().mockResolvedValue({ status: "saved", reactionId: "r1", storyId: "st_owl", choice: "like" });
    const handler = createHandler({ skillId: SKILL_ID, agent: fakeAgent({ demoReact }) });
    await handler(intent("es-ES", "ReactToStoryIntent", { choice: "me gusta" }));
    expect(demoReact).toHaveBeenCalledWith(expect.objectContaining({ choice: "like" }));
  });

  test("E6 an unmatched theme goes to the backend raw and an unsupported theme gets the Spanish prompt", async () => {
    const saveDraft = vi.fn().mockRejectedValue(new AgentHttpError(422, "unsupported_theme", "unsupported"));
    const handler = createHandler({ skillId: SKILL_ID, agent: fakeAgent({ saveDraft }) });
    const response = await handler(intent("es-ES", "ThemeChoiceIntent", { drafttheme: { value: "dinosaurios", noMatch: true } }, { demoFlow: "draft" }));
    expect(saveDraft).toHaveBeenCalledWith(expect.objectContaining({ theme: "dinosaurios" }));
    expect(speech(response)).toMatch(/sirenas o el espacio/);
    expect(response.sessionAttributes).toEqual({ demoFlow: "draft" });
    expectSpanish(response);
  });
});

describe("es-ES catch-all routing (E4)", () => {
  test("a Spanish wish phrase proposes a canonical wish", async () => {
    const response = await createHandler({ skillId: SKILL_ID, agent: fakeAgent() })(intent("es-ES", "CatchAllIntent", { text: "quiero una historia sobre el mar" }));
    expect(response.sessionAttributes).toEqual({ demoFlow: "wish", demoTopic: "ocean" });
    expectSpanish(response);
  });

  test("a Spanish send request hands off without repeating the name or writing", async () => {
    const saveDraft = vi.fn();
    const agent = fakeAgent({ saveDraft });
    const handler = createHandler({ skillId: SKILL_ID, agent });
    for (const text of ["envíale una historia a Ana", "crea una historia para Ana"]) {
      const response = await handler(intent("es-ES", "CatchAllIntent", { text }));
      expect(speech(response)).toMatch(/Abre Spoken Letter/);
      expect(speech(response)).not.toContain("Ana");
    }
    expect(saveDraft).not.toHaveBeenCalled();
    expect(agent.turn).not.toHaveBeenCalled();
  });

  test("a Spanish credits question gets credits help", async () => {
    const response = await createHandler({ skillId: SKILL_ID, agent: fakeAgent() })(intent("es-ES", "CatchAllIntent", { text: "cómo añado créditos" }));
    expect(speech(response)).toMatch(/créditos/);
    expectSpanish(response);
  });

  test("a Spanish creation-help question gets creation help, and a create request asks for a theme", async () => {
    const saveDraft = vi.fn();
    const handler = createHandler({ skillId: SKILL_ID, agent: fakeAgent({ saveDraft }) });
    const help = await handler(intent("es-ES", "CatchAllIntent", { text: "cómo creo una historia" }));
    expect(speech(help)).toMatch(/elegir a quién enviarla/);
    const create = await handler(intent("es-ES", "CatchAllIntent", { text: "vamos a crear una historia" }));
    expect(create.sessionAttributes).toEqual({ demoFlow: "draft" });
    const about = await handler(intent("es-ES", "CatchAllIntent", { text: "crea una historia sobre el bosque" }));
    expect(saveDraft).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ theme: "el bosque" }));
    expectSpanish(about);
  });

  test("a pending Spanish draft accepts an explicit or bare theme", async () => {
    const saveDraft = vi.fn().mockResolvedValue({ status: "saved" });
    const handler = createHandler({ skillId: SKILL_ID, agent: fakeAgent({ saveDraft }) });
    await handler(intent("es-ES", "CatchAllIntent", { text: "sobre dragones amables" }, { demoFlow: "draft" }));
    await handler(intent("es-ES", "CatchAllIntent", { text: "las sirenas" }, { demoFlow: "draft" }));
    expect(saveDraft.mock.calls.map(([input]) => (input as { theme: string }).theme)).toEqual(["dragones amables", "las sirenas"]);
  });

  test("a Spanish play request falls back to a title playlist command without writing a draft", async () => {
    const saveDraft = vi.fn();
    const playlist = vi.fn().mockResolvedValue({ say: "Pongo la historia.", action: "play", play: PLAY, token: "server-token", playBehavior: "REPLACE_ALL" });
    const turn = vi.fn().mockResolvedValue({ say: "No la encuentro.", play: null, toolCalls: [] });
    const handler = createHandler({ skillId: SKILL_ID, agent: fakeAgent({ saveDraft, playlist, turn }) });
    await handler(intent("es-ES", "CatchAllIntent", { text: "pon la de Ignacio" }, { demoFlow: "draft" }));
    expect(playlist).toHaveBeenCalledWith({ deviceUserId: USER, command: "title", title: "Ignacio" });
    expect(saveDraft).not.toHaveBeenCalled();
  });

  test("S4 a past-tense story request never starts a draft or a handoff", async () => {
    const saveDraft = vi.fn();
    const turn = vi.fn().mockResolvedValue({ say: "Aquí está.", play: PLAY, toolCalls: [] });
    const handler = createHandler({ skillId: SKILL_ID, agent: fakeAgent({ saveDraft, turn }) });
    for (const text of ["pon la historia que creó la abuela", "pon la historia que mandó Aunt Whitney", "qué historias me envió el abuelo"]) {
      const response = await handler(intent("es-ES", "CatchAllIntent", { text }, { demoFlow: "draft" }));
      expect(speech(response)).not.toMatch(/Abre Spoken Letter|borrador/);
    }
    expect(saveDraft).not.toHaveBeenCalled();
    expect(turn).toHaveBeenCalledTimes(3);
  });
});

describe("es-ES matchers stay no wider than en-US (review repairs)", () => {
  test.each([
    "haz que suene la historia sobre el mar",
    "puedes hacer que suene la historia sobre sirenas",
    "pon la historia que me envía la abuela",
    "pon la que manda el abuelo",
    "quiero una historia de la abuela",
    "pon la historia de la compra",
  ])("%s plays instead of writing, handing off, wishing or giving credits help", async (text) => {
    const saveDraft = vi.fn();
    const turn = vi.fn().mockResolvedValue({ say: "Aquí está.", play: PLAY, toolCalls: [] });
    const response = await createHandler({ skillId: SKILL_ID, agent: fakeAgent({ saveDraft, turn }) })(intent("es-ES", "CatchAllIntent", { text }));
    expect(saveDraft).not.toHaveBeenCalled();
    expect(turn).toHaveBeenCalledOnce();
    expect(response.sessionAttributes).toEqual({});
    expect(response.response.directives?.[0]).toMatchObject({ type: "AudioPlayer.Play" });
  });

  test("léeme and cuento carriers reduce to the title", async () => {
    const playlist = vi.fn().mockResolvedValue({ say: "Pongo la historia.", action: "play", play: PLAY, token: "server-token", playBehavior: "REPLACE_ALL" });
    const turn = vi.fn().mockResolvedValue({ say: "No la encuentro.", play: null, toolCalls: [] });
    const response = await createHandler({ skillId: SKILL_ID, agent: fakeAgent({ playlist, turn }) })(intent("es-ES", "CatchAllIntent", { text: "léeme el cuento de Ignacio" }));
    expect(playlist).toHaveBeenCalledWith({ deviceUserId: USER, command: "title", title: "Ignacio" });
    expect(response.response.directives?.[0]).toMatchObject({ audioItem: { metadata: { subtitle: "leída por Grandpa Juan" } } });
  });

  test("a resumed story card keeps the Spanish subtitle", async () => {
    const { encodeStreamToken } = await import("./audio.ts");
    const event = request("es-ES", { type: "IntentRequest", intent: { name: "AMAZON.ResumeIntent" } }, {}, encodeStreamToken(PLAY));
    const response = await createHandler({ skillId: SKILL_ID, agent: fakeAgent() })(event);
    expect(response.response.directives?.[0]).toMatchObject({ audioItem: { stream: { offsetInMilliseconds: 1000 }, metadata: { subtitle: "leída por Grandpa Juan" } } });
  });

  test("the wish confirmation names the storyteller before the topic and says bedtime naturally", async () => {
    const handler = createHandler({ skillId: SKILL_ID, agent: fakeAgent() });
    const fromTeller = await handler(intent("es-ES", "WishFromStorytellerIntent", { wishtopic: { value: "sirenas", resolved: "mermaids" }, storyteller: { value: "tía Whitney", resolved: "Aunt Whitney" } }));
    expect(speech(fromTeller)).toBe("¿Guardo tu deseo de una historia de Aunt Whitney sobre sirenas? Di sí o no.");
    const bedtime = await handler(intent("es-ES", "WishStoryIntent", { wishtopic: { value: "dormir", resolved: "bedtime" } }));
    expect(speech(bedtime)).toBe("¿Guardo tu deseo de una historia para dormir? Di sí o no.");
  });
});

describe("es-ES storyteller aliases (Phase 2)", () => {
  test.each(["pídele a la tía Whitney otra historia sobre sirenas", "pídele a tita Whitney un cuento sobre sirenas", "pide a Whitney una historia sobre sirenas"])(
    "%s proposes a wish from the catalog storyteller",
    async (text) => {
      const response = await createHandler({ skillId: SKILL_ID, agent: fakeAgent() })(intent("es-ES", "CatchAllIntent", { text }));
      expect(response.sessionAttributes).toEqual({ demoFlow: "wish", demoTopic: "mermaids", demoStoryteller: "Aunt Whitney" });
      expect(speech(response)).toBe("¿Guardo tu deseo de una historia de Aunt Whitney sobre sirenas? Di sí o no.");
    },
  );

  test.each(["tía Whitney", "la tía Whitney"])("an unresolved Spanish storyteller slot %s still maps to the catalog name", async (storyteller) => {
    const response = await createHandler({ skillId: SKILL_ID, agent: fakeAgent() })(intent("es-ES", "WishFromStorytellerIntent", { wishtopic: "sirenas", storyteller }));
    expect(response.sessionAttributes).toEqual({ demoFlow: "wish", demoTopic: "mermaids", demoStoryteller: "Aunt Whitney" });
  });
});

describe("es-ES locale resolution and playback (E5)", () => {
  test.each([
    [undefined, "Spoken Letter. Which family story would you like?"],
    ["fr-FR", "Spoken Letter. Which family story would you like?"],
    ["es-MX", "Spoken Letter. ¿Qué historia familiar quieres escuchar?"],
    ["es-ES", "Spoken Letter. ¿Qué historia familiar quieres escuchar?"],
  ])("launch with locale %s", async (locale, expected) => {
    const response = await createHandler({ skillId: SKILL_ID, agent: fakeAgent() })(request(locale, { type: "LaunchRequest" }));
    expect(speech(response)).toBe(expected);
  });

  test("a played story card says who read it in Spanish", async () => {
    const response = await createHandler({ skillId: SKILL_ID, agent: fakeAgent() })(intent("es-ES", "PlayStoryIntent"));
    expect(response.response.directives?.[0]).toMatchObject({ audioItem: { metadata: { title: PLAY.title, subtitle: "leída por Grandpa Juan" } } });
  });

  test("the progressive filler is Spanish", async () => {
    vi.useFakeTimers();
    try {
      const progressiveFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
      const turn = vi.fn().mockImplementation(() => new Promise((resolve) => { setTimeout(() => { resolve({ say: "Aquí está.", play: PLAY, toolCalls: [] }); }, 700); }));
      const event = intent("es-ES", "PlayStoryIntent");
      event.context.System = { ...event.context.System, apiEndpoint: "https://api.amazonalexa.com", apiAccessToken: "token" };
      const pending = createHandler({ skillId: SKILL_ID, agent: fakeAgent({ turn }), progressiveFetch })(event);
      await vi.advanceTimersByTimeAsync(700);
      await pending;
      const body = JSON.parse(progressiveFetch.mock.calls[0]?.[1]?.body as string) as { directive: { speech: string } };
      expect(body.directive.speech).toBe("Buscando esa historia.");
    } finally {
      vi.useRealTimers();
    }
  });
});
