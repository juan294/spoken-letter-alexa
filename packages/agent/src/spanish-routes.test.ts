import { type Message, type ModelStreamEvent, type StreamOptions } from "@strands-agents/sdk";
import { describe, expect, test } from "vitest";

import { canonicalTheme, MemoryDemoDraftStore } from "./demo-drafts.ts";
import { MemoryDemoUpdateStore, type DemoStory } from "./demo-updates.ts";
import { ALEXA_PERSONA, SPANISH_LANGUAGE_LINE } from "./persona.ts";
import { MemoryPlaylistStore } from "./playlist.ts";
import { createAgentApp } from "./routes.ts";
import { ScriptedModel } from "./scripted-model.ts";
import { MemorySessionStore } from "./sessions.ts";
import { MCP_URL, mcpHarness } from "./test-support.ts";

const SECRET = "test-skill-secret";
const DEVICE = "amzn1.ask.account.OWNER";
const ENGLISH = /\b(?:you|the|your|is|was|playing|saved|ready|story|stories|there|ask|try|theme|setting|ending)\b/i;

/** Records every system prompt the agent was invoked with. */
class PromptRecordingModel extends ScriptedModel {
  readonly prompts: string[] = [];

  override async *stream(messages: Message[], options?: StreamOptions): AsyncIterable<ModelStreamEvent> {
    if (typeof options?.systemPrompt === "string") this.prompts.push(options.systemPrompt);
    yield* super.stream(messages, options);
  }
}

/** Fails every model call, so the turn falls back. */
class FailingModel extends ScriptedModel {
  // eslint-disable-next-line require-yield -- a model that fails before producing any event
  override async *stream(): AsyncIterable<ModelStreamEvent> {
    await Promise.resolve();
    throw new Error("model down");
  }
}

async function harness(model: ScriptedModel = new ScriptedModel()) {
  const h = await mcpHarness();
  const stories: DemoStory[] = [{ id: "st_lighthouse", title: "A lighthouse for Mateo", storyteller: "Grandpa Juan", deliveredAt: "2026-09-02T20:05:00.000Z",
    audioUrl: "http://localhost:4310/fixtures/audio/st_lighthouse.mp3" }];
  const app = createAgentApp({
    model, modelId: null, mcpUrl: MCP_URL, mcpFetch: h.fetch, deviceMcp: { url: MCP_URL, fetch: h.fetch },
    sessions: new MemorySessionStore(), speech: { synthesize: () => Promise.resolve(null) }, transcribe: () => Promise.resolve(""),
    demoToken: h.serviceToken, offline: true,
    playlist: { store: new MemoryPlaylistStore(), secret: SECRET },
    drafts: { store: new MemoryDemoDraftStore(), generator: () => Promise.resolve({ place: "quiet shore", challenge: "small mystery", ending: "kindness" }) },
    updates: { store: new MemoryDemoUpdateStore(), stories, seed: [
      { eventId: "evt-story", type: "new_story", occurredAt: "2026-09-02T20:05:00.000Z", storyId: "st_lighthouse", detail: "A new story is ready." },
      { eventId: "evt-occasion", type: "occasion", occurredAt: "2026-09-01T10:00:00.000Z", detail: "A family birthday is coming up. You can create a story for the occasion." },
    ] },
  });
  const post = async (path: string, body: Record<string, unknown>) => {
    const response = await app.request(path, { method: "POST", headers: { "content-type": "application/json", "x-alexa-skill-secret": SECRET }, body: JSON.stringify(body) });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };
  return { post };
}

const spanish = (text: unknown) => {
  expect(typeof text).toBe("string");
  const withoutTitles = String(text).replaceAll("A lighthouse for Mateo", "").replaceAll("Grandpa Juan", "");
  expect(withoutTitles, String(text)).not.toMatch(ENGLISH);
};

describe("localized agent routes (B1, B2)", () => {
  test("B1 playlist start speaks Spanish with the same action, story and token shape", async () => {
    const en = await (await harness()).post("/agent/playlist", { deviceUserId: DEVICE, command: "start", order: "newest" });
    const es = await (await harness()).post("/agent/playlist", { deviceUserId: DEVICE, command: "start", order: "newest", locale: "es-ES" });
    expect(es.status).toBe(en.status);
    expect(es.body.action).toBe(en.body.action);
    expect(es.body.play).toEqual(en.body.play);
    expect(typeof es.body.token).toBe("string");
    expect(es.body.say).toBe("Pongo A lighthouse for Mateo, de Grandpa Juan.");
    expect(en.body.say).toBe("Playing A lighthouse for Mateo by Grandpa Juan.");
  });

  test("B1 playlist replies with no story are Spanish too", async () => {
    const { post } = await harness();
    const previous = await post("/agent/playlist", { deviceUserId: DEVICE, command: "previous", locale: "es-ES" });
    expect(previous.body).toMatchObject({ action: "none" });
    spanish(previous.body.say);
    const missing = await post("/agent/playlist", { deviceUserId: DEVICE, command: "title", title: "dinosaurios", locale: "es-ES" });
    spanish(missing.body.say);
  });

  test("B1 demo next and inbox render update details in Spanish", async () => {
    const { post } = await harness();
    const next = await post("/agent/demo/next", { deviceUserId: DEVICE, locale: "es-ES" });
    const event = next.body.event as { eventId: string; detail: string };
    expect(event.eventId).toBe("evt-story");
    expect(event.detail).toBe('Ya tienes una historia nueva. "A lighthouse for Mateo", de Grandpa Juan.');
    const inbox = await post("/agent/demo/inbox", { deviceUserId: DEVICE, locale: "es-ES" });
    const details = (inbox.body.events as { detail: string }[]).map((item) => item.detail);
    expect(details).toHaveLength(2);
    for (const detail of details) spanish(detail);
    const english = await post("/agent/demo/inbox", { deviceUserId: DEVICE });
    expect((english.body.events as { detail: string }[])[1]?.detail).toBe("A family birthday is coming up. You can create a story for the occasion.");
  });

  test("B1 a Spanish wish saves the same receipt and its update is read back in Spanish", async () => {
    const { post } = await harness();
    const wish = await post("/agent/demo/wish", { deviceUserId: DEVICE, requestId: "w1", topic: "bedtime", confirmed: true, locale: "es-ES" });
    expect(wish.status).toBe(200);
    expect(wish.body).toMatchObject({ status: "saved", topic: "bedtime" });
    const inbox = await post("/agent/demo/inbox", { deviceUserId: DEVICE, locale: "es-ES" });
    expect((inbox.body.events as { detail: string }[]).map((item) => item.detail)).toContain("He guardado tu deseo de una historia para dormir.");
  });

  test("B2 an omitted locale answers in English and an unknown extra field is accepted", async () => {
    const { post } = await harness();
    const playlist = await post("/agent/playlist", { deviceUserId: DEVICE, command: "start", order: "newest", future: "field" });
    expect(playlist.status).toBe(200);
    expect(playlist.body.say).toBe("Playing A lighthouse for Mateo by Grandpa Juan.");
    for (const path of ["/agent/demo/next", "/agent/demo/inbox"]) expect((await post(path, { deviceUserId: DEVICE, future: "field" })).status).toBe(200);
    expect((await post("/agent/demo/draft", { deviceUserId: DEVICE, requestId: "d1", theme: "space", future: "field" })).status).toBe(200);
    expect((await post("/agent/demo/wish", { deviceUserId: DEVICE, requestId: "w1", topic: "space", confirmed: true, future: "field" })).status).toBe(200);
    expect((await post("/agent/session", { mode: "device", deviceUserId: DEVICE, future: "field" })).status).toBe(200);
  });
});

describe("Spanish drafts (B5, B6)", () => {
  test.each([
    ["sirenas", "mermaids"], ["estrellas", "space"], ["el mar", "ocean"], ["bosque", "forest"], ["perros", "animals"],
    ["amigos", "friendship"], ["hora de dormir", "bedtime"], ["las sirenas", "mermaids"], ["el océano", "ocean"],
    ["dinosaurios", null], ["dragones amables", null], ["María", null],
    ["que sea de perros", "animals"], ["perros que sea bonita", "animals"], ["mermaids", "mermaids"], ["bedtime", "bedtime"],
  ])("B5 canonicalTheme(%s, es-ES) is %s", (speech, theme) => {
    expect(canonicalTheme(speech, "es-ES")).toBe(theme);
  });

  test("B5 the English rows are unchanged and Spanish words never change an English result", () => {
    expect(canonicalTheme("a sleepy bedtime story")).toBe("bedtime");
    expect(canonicalTheme("rockets and the moon")).toBe("space");
    expect(canonicalTheme("dinosaurs")).toBeNull();
    expect(canonicalTheme("a story about Luna the cat")).toBe("animals");
    expect(canonicalTheme("sirenas")).toBeNull();
  });

  test("SS3 a Spanish theme the table does not know is refused, never saved", async () => {
    const { post } = await harness();
    const refused = await post("/agent/demo/draft", { deviceUserId: DEVICE, requestId: "d1", theme: "dinosaurios", locale: "es-ES" });
    expect(refused.status).toBe(422);
    expect(refused.body.error).toBe("unsupported_theme");
    expect((await post("/agent/demo/draft/latest", { deviceUserId: DEVICE })).body).toEqual({ status: "none" });
  });

  test("B6 a Spanish draft reads back in Spanish; an English draft reads back as stored", async () => {
    const { post } = await harness();
    const saved = await post("/agent/demo/draft", { deviceUserId: DEVICE, requestId: "d1", theme: "sirenas", locale: "es-ES" });
    expect(saved.body).toMatchObject({ status: "saved", theme: "mermaids" });
    expect(saved.body.outline).toBe("Tema: las sirenas. Lugar: una orilla tranquila. Nudo: un pequeño misterio. Final: la bondad trae a todos de vuelta a casa.");
    expect((await post("/agent/demo/draft/latest", { deviceUserId: DEVICE, locale: "es-ES" })).body.outline).toBe(saved.body.outline);

    const other = await harness();
    const english = await other.post("/agent/demo/draft", { deviceUserId: DEVICE, requestId: "d2", theme: "space" });
    expect(english.body.outline).toBe("Theme: space. Setting: a quiet shore. Middle: a small mystery. Ending: kindness brings everyone home.");
    expect((await other.post("/agent/demo/draft/latest", { deviceUserId: DEVICE, locale: "es-ES" })).body.outline).toBe(english.body.outline);
  });
});

describe("Spanish agent turns (B3, B4)", () => {
  test("B3 the stored locale follows the latest device session open, and each turn's prompt follows it", async () => {
    const model = new PromptRecordingModel();
    const { post } = await harness(model);
    const es = await post("/agent/session", { mode: "device", deviceUserId: DEVICE, locale: "es-ES" });
    await post("/agent/turn", { sessionId: es.body.sessionId, text: "qué hay de nuevo" });
    expect(model.prompts.at(-1)?.startsWith(ALEXA_PERSONA)).toBe(true);
    expect(model.prompts.at(-1)?.endsWith(SPANISH_LANGUAGE_LINE)).toBe(true);
    await post("/agent/turn", { sessionId: es.body.sessionId, text: "pon otra" });
    expect(model.prompts.at(-1)?.endsWith(SPANISH_LANGUAGE_LINE)).toBe(true);

    const en = await post("/agent/session", { mode: "device", deviceUserId: DEVICE });
    expect(en.body.sessionId).toBe(es.body.sessionId);
    await post("/agent/turn", { sessionId: en.body.sessionId, text: "what's new?" });
    expect(model.prompts.at(-1)).not.toContain(SPANISH_LANGUAGE_LINE);
  });

  test("B4 a Spanish turn with the scripted model answers in Spanish", async () => {
    const { post } = await harness();
    const session = await post("/agent/session", { mode: "device", deviceUserId: DEVICE, locale: "es-ES" });
    const listed = await post("/agent/turn", { sessionId: session.body.sessionId, text: "qué hay de nuevo" });
    spanish(listed.body.say);
    expect(listed.body.play).toBeNull();
    const played = await post("/agent/turn", { sessionId: session.body.sessionId, text: "pon la historia más nueva" });
    spanish(played.body.say);
    expect(played.body.play).toMatchObject({ id: "st_lighthouse" });
    const again = await post("/agent/turn", { sessionId: session.body.sessionId, text: "pon la más nueva" });
    expect(again.body.play).toMatchObject({ id: "st_lighthouse" });
  });

  test("B4 the fallback reply is Spanish when the model fails", async () => {
    const { post } = await harness(new FailingModel());
    const session = await post("/agent/session", { mode: "device", deviceUserId: DEVICE, locale: "es-ES" });
    const turn = await post("/agent/turn", { sessionId: session.body.sessionId, text: "qué hay de nuevo" });
    expect(turn.status).toBe(200);
    expect(turn.body.say).toBe("Ahora mismo no puedo conectar con Spoken Letter. Inténtalo de nuevo en un momento o vuelve a conectarlo en la app de Alexa.");
  });
});

describe("stored session locale (SS6)", () => {
  test("the Dynamo store reads back a supported locale and drops anything else", async () => {
    const { DynamoDBClient } = await import("@aws-sdk/client-dynamodb");
    const { DynamoDBDocumentClient, GetCommand } = await import("@aws-sdk/lib-dynamodb");
    const { mockClient } = await import("aws-sdk-client-mock");
    const { DynamoSessionStore, newSession } = await import("./sessions.ts");
    const ddb = mockClient(DynamoDBDocumentClient);
    try {
      const store = new DynamoSessionStore({ client: DynamoDBDocumentClient.from(new DynamoDBClient({ region: "us-east-1" })), tableName: "t", now: () => 1_000 });
      const session = newSession({ mode: "device", subject: "svc", accessToken: "t", id: "dev_1" }, () => 1_000);
      ddb.on(GetCommand, { Key: { sessionId: "dev_1" } }).resolves({ Item: { sessionId: "dev_1", ...session, locale: "es-ES" } });
      await expect(store.get("dev_1")).resolves.toMatchObject({ locale: "es-ES" });
      ddb.on(GetCommand, { Key: { sessionId: "dev_2" } }).resolves({ Item: { sessionId: "dev_2", ...session, id: "dev_2", locale: "fr-FR" } });
      expect(await store.get("dev_2")).not.toHaveProperty("locale");
    } finally {
      ddb.restore();
    }
  });
});
