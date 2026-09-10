import { describe, expect, test } from "vitest";

import { ScriptedModel } from "./scripted-model.ts";
import { ISSUER, MCP_URL, mcpHarness } from "./test-support.ts";
import { runTurn } from "./turn.ts";

describe("runTurn with the scripted model against the real MCP server", () => {
  test("calls list then get, returns validated structured output and tool traces", async () => {
    const h = await mcpHarness();
    const result = await runTurn(
      { model: new ScriptedModel(), mcpUrl: MCP_URL, accessToken: await h.serviceToken(), fetch: h.fetch },
      "Alexa, play the story Grandpa sent",
    );
    expect(result.toolCalls.map((call) => call.name)).toEqual(["list_family_stories", "get_family_story"]);
    for (const call of result.toolCalls) {
      expect(call.ms).toBeGreaterThanOrEqual(0);
      expect(call.ok).toBe(true);
      expect(call.era).toBe("legacy");
    }
    expect(result.say.length).toBeGreaterThan(0);
    expect(result.say.length).toBeLessThanOrEqual(400);
    // Newest first: the lighthouse story was delivered last.
    expect(result.play).toEqual({
      url: `${ISSUER}/fixtures/audio/st_lighthouse.mp3`,
      title: "A lighthouse for Mateo",
      storyteller: "Grandpa Juan",
      durationSeconds: 241,
      artUrl: `${ISSUER}/fixtures/art/st_lighthouse.png`,
    });
    expect(result.history.length).toBeGreaterThan(0);
  });

  test("a second turn with history asks for the next story", async () => {
    const h = await mcpHarness();
    const token = await h.serviceToken();
    const first = await runTurn({ model: new ScriptedModel(), mcpUrl: MCP_URL, accessToken: token, fetch: h.fetch }, "play a story");
    const second = await runTurn(
      { model: new ScriptedModel(), mcpUrl: MCP_URL, accessToken: token, fetch: h.fetch, history: first.history },
      "play another one",
    );
    expect(second.play?.title).toBe("The owl who forgot how to hoot");
    // That story carries no artwork, and the reply says so rather than reusing the last one's.
    expect(second.play?.artUrl).toBeNull();
    expect(second.toolCalls.map((call) => call.name)).toEqual(["list_family_stories", "get_family_story"]);
  });

  test("a question that needs no story answers without playing anything", async () => {
    const h = await mcpHarness();
    const result = await runTurn(
      { model: new ScriptedModel(), mcpUrl: MCP_URL, accessToken: await h.serviceToken(), fetch: h.fetch },
      "what stories are new?",
    );
    expect(result.play).toBeNull();
    expect(result.toolCalls.map((call) => call.name)).toEqual(["list_family_stories"]);
    expect(result.say).toMatch(/lighthouse/i);
  });

  test("a rejected token fails at connect time: no tool trace, a spoken apology, nothing thrown", async () => {
    const h = await mcpHarness();
    const result = await runTurn({ model: new ScriptedModel(), mcpUrl: MCP_URL, accessToken: "not-a-token", fetch: h.fetch }, "play a story");
    expect(result.play).toBeNull();
    expect(result.toolCalls).toEqual([]);
    expect(result.say).toMatch(/reconnect|not reachable|try again/i);
  });
});
