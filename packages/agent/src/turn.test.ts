import {
  type BaseModelConfig,
  type Message,
  Model,
  ModelContentBlockDeltaEvent,
  ModelContentBlockStartEvent,
  ModelContentBlockStopEvent,
  ModelMessageStartEvent,
  ModelMessageStopEvent,
  type ModelStreamEvent,
  type StreamOptions,
} from "@strands-agents/sdk";
import { describe, expect, test } from "vitest";

import { ScriptedModel } from "./scripted-model.ts";
import { ISSUER, MCP_URL, mcpHarness } from "./test-support.ts";
import { runTurn } from "./turn.ts";

const STRUCTURED_OUTPUT_TOOL = "strands_structured_output";

/** Captures the system prompt it was invoked with and answers with no story, played or not. */
class CapturingModel extends Model {
  lastSystemPrompt: string | undefined;
  private config: BaseModelConfig = { modelId: "capturing" };

  updateConfig(modelConfig: BaseModelConfig): void {
    this.config = { ...this.config, ...modelConfig };
  }

  getConfig(): BaseModelConfig {
    return this.config;
  }

  async *stream(_messages: Message[], options?: StreamOptions): AsyncIterable<ModelStreamEvent> {
    this.lastSystemPrompt = typeof options?.systemPrompt === "string" ? options.systemPrompt : undefined;
    const structuredTool = options?.toolSpecs?.find((spec) => spec.name === STRUCTURED_OUTPUT_TOOL)?.name;
    const output = { say: "OK.", play: null };
    yield new ModelMessageStartEvent({ type: "modelMessageStartEvent", role: "assistant" });
    if (structuredTool) {
      yield new ModelContentBlockStartEvent({
        type: "modelContentBlockStartEvent",
        start: { type: "toolUseStart", name: structuredTool, toolUseId: "tu_capturing" },
      });
      yield new ModelContentBlockDeltaEvent({ type: "modelContentBlockDeltaEvent", delta: { type: "toolUseInputDelta", input: JSON.stringify(output) } });
      yield new ModelContentBlockStopEvent({ type: "modelContentBlockStopEvent" });
      yield new ModelMessageStopEvent({ type: "modelMessageStopEvent", stopReason: "toolUse" });
    } else {
      yield new ModelContentBlockStartEvent({ type: "modelContentBlockStartEvent" });
      yield new ModelContentBlockDeltaEvent({ type: "modelContentBlockDeltaEvent", delta: { type: "textDelta", text: JSON.stringify(output) } });
      yield new ModelContentBlockStopEvent({ type: "modelContentBlockStopEvent" });
      yield new ModelMessageStopEvent({ type: "modelMessageStopEvent", stopReason: "endTurn" });
    }
    await Promise.resolve();
  }
}

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
      id: "st_lighthouse",
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

  test("a session catalog is composed into the system prompt, with every story title present (phase-2.md section 1)", async () => {
    const h = await mcpHarness();
    const model = new CapturingModel();
    const catalog = ["st_owl: The owl who forgot how to hoot by Grandpa Juan, 3m4s", "st_lighthouse: A lighthouse for Mateo by Grandpa Juan, 4m1s"].join("\n");
    await runTurn({ model, mcpUrl: MCP_URL, accessToken: await h.serviceToken(), fetch: h.fetch, catalog }, "what is new?");
    expect(model.lastSystemPrompt).toContain("The owl who forgot how to hoot");
    expect(model.lastSystemPrompt).toContain("A lighthouse for Mateo");
  });

  test("with no catalog the system prompt is the plain persona", async () => {
    const h = await mcpHarness();
    const model = new CapturingModel();
    await runTurn({ model, mcpUrl: MCP_URL, accessToken: await h.serviceToken(), fetch: h.fetch }, "what is new?");
    expect(model.lastSystemPrompt).not.toContain("Stories already known this session");
  });

  test("without reuseMcpClient, two turns sharing an mcpUrl/fetch never share a token (phase-2.md section 3: no cross-user leak)", async () => {
    const h = await mcpHarness();
    const goodToken = await h.serviceToken();
    // Both calls target the same mcpUrl/fetch, started without awaiting either first, so a
    // shared cache (the bug this test guards against) would let the bad call's actual
    // outgoing request pick up whatever token was written last — the good one.
    const badPromise = runTurn({ model: new ScriptedModel(), mcpUrl: MCP_URL, accessToken: "not-a-token", fetch: h.fetch }, "play a story");
    const goodPromise = runTurn({ model: new ScriptedModel(), mcpUrl: MCP_URL, accessToken: goodToken, fetch: h.fetch }, "play a story");
    const [bad, good] = await Promise.all([badPromise, goodPromise]);
    expect(bad.toolCalls).toEqual([]);
    expect(bad.play).toBeNull();
    expect(bad.say).toMatch(/reconnect|not reachable|try again/i);
    expect(good.play).not.toBeNull();
  });

  test("reuseMcpClient device turns on the same mcpUrl/fetch keep working across repeated calls", async () => {
    const h = await mcpHarness();
    const token = await h.serviceToken();
    for (let i = 0; i < 3; i += 1) {
      const result = await runTurn({ model: new ScriptedModel(), mcpUrl: MCP_URL, accessToken: token, fetch: h.fetch, reuseMcpClient: true }, "play a story");
      expect(result.play).not.toBeNull();
    }
  });
});
