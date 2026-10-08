import { loadFixtureCatalog } from "@spoken-letter-alexa/mcp-server";
import { describe, expect, test } from "vitest";

import { type DraftGenerator, MemoryDemoDraftStore } from "../../agent/src/demo-drafts.ts";
import { MemoryPlaylistStore } from "../../agent/src/playlist.ts";
import { createAgentApp } from "../../agent/src/routes.ts";
import { ScriptedModel } from "../../agent/src/scripted-model.ts";
import { MemorySessionStore } from "../../agent/src/sessions.ts";
import { MCP_URL, mcpHarness } from "../../agent/src/test-support.ts";
import { createAgentClient } from "./agent-client.ts";
import type { PlayDirective } from "./audio.ts";
import { type AlexaRequestEnvelope, createHandler } from "./handler.ts";
import { FIXTURES_PATH } from "./model/generate.ts";

const SKILL_ID = "amzn1.ask.skill.catalog-playback";
const DEVICE_ID = "amzn1.ask.account.catalog-playback";
const SECRET = "catalog-playback-command-secret";
const BASE = "http://skill-catalog.local";
const unusedGenerator: DraftGenerator = () => Promise.reject(new Error("no drafts in this test"));

/** S3 (staged demo plan, phase 2): the real fixture catalog, played through the skill, agent and MCP server. */
async function catalogSkill() {
  const mcp = await mcpHarness(await loadFixtureCatalog(FIXTURES_PATH));
  const app = createAgentApp({
    model: new ScriptedModel(), modelId: null, mcpUrl: MCP_URL, mcpFetch: mcp.fetch,
    deviceMcp: { url: MCP_URL, fetch: mcp.fetch }, sessions: new MemorySessionStore(),
    speech: { synthesize: () => Promise.resolve(null) }, transcribe: () => Promise.resolve(""),
    demoToken: mcp.serviceToken, offline: true,
    playlist: { store: new MemoryPlaylistStore(), secret: SECRET }, drafts: { store: new MemoryDemoDraftStore(), generator: unusedGenerator },
  });
  const agent = createAgentClient({ baseUrl: BASE, fetch: async (input, init) => app.request(input instanceof Request ? input.url : String(input), init), timeoutMs: 7_000, skillSecret: SECRET });
  return createHandler({ skillId: SKILL_ID, agent });
}

/** An intent whose `storyteller` slot Alexa resolved from a synonym to its canonical catalog value. */
function intent(name: string, slots: { title?: string; storyteller?: { heard: string; canonical: string } }): AlexaRequestEnvelope {
  return {
    version: "1.0",
    session: { new: true, sessionId: "catalog-session", application: { applicationId: SKILL_ID }, user: { userId: DEVICE_ID }, attributes: {} },
    context: { System: { application: { applicationId: SKILL_ID }, user: { userId: DEVICE_ID } } },
    request: {
      type: "IntentRequest", requestId: `catalog-${name}`, timestamp: "2026-10-08T12:00:00Z", locale: "en-US",
      intent: {
        name,
        slots: {
          ...(slots.title && { title: { name: "title", value: slots.title } }),
          ...(slots.storyteller && { storyteller: { name: "storyteller", value: slots.storyteller.heard, resolutions: { resolutionsPerAuthority: [
            { status: { code: "ER_SUCCESS_MATCH" }, values: [{ value: { name: slots.storyteller.canonical } }] },
          ] } } }),
        },
      },
    },
  };
}

const played = (directives: unknown[] | undefined) => directives?.find((directive): directive is PlayDirective => (directive as { type?: string }).type === "AudioPlayer.Play");

describe("S3 new storytellers play from the real catalog", () => {
  test("a story by title plays with its storyteller on the card", async () => {
    const response = await (await catalogSkill())(intent("PlayStoryIntent", { title: "Andrea and the Crocodile" }));
    const play = played(response.response.directives);
    expect(play?.audioItem.stream.url).toMatch(/\/fixtures\/audio\/st_andrea_and_the_crocodile\.mp3$/);
    expect(play?.audioItem.metadata.subtitle).toContain("Aunt Jordan");
  });

  test("\"play my stories from Tio Manuel\" plays his story, named on the card", async () => {
    const response = await (await catalogSkill())(intent("PlayCreatorStoriesIntent", { storyteller: { heard: "tio manuel", canonical: "Tío Manuel" } }));
    const play = played(response.response.directives);
    expect(play?.audioItem.stream.url).toMatch(/\/fixtures\/audio\/st_el_trasgu\.mp3$/);
    expect(play?.audioItem.metadata.subtitle).toContain("Tío Manuel");
  });
});
