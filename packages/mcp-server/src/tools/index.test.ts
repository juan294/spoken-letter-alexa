import { assertAgentToolMetadata } from "@spoken-letter-alexa/shared";
import { describe, expect, test } from "vitest";

import { FixtureProvider } from "../provider/fixtures.ts";
import { TEST_BASE_URL, TEST_STORIES } from "../test-support.ts";
import { runGetFamilyStory } from "./get.ts";
import { TOOL_METADATA } from "./index.ts";
import { runListFamilyStories } from "./list.ts";
import { runSuggestNextStory, SuggestionMemory } from "./suggest.ts";

const provider = new FixtureProvider({ stories: TEST_STORIES, publicBaseUrl: TEST_BASE_URL });

describe("TOOL_METADATA", () => {
  test("declares exactly the three read-only tools", () => {
    expect(TOOL_METADATA.map((tool) => tool.name)).toEqual([
      "list_family_stories",
      "get_family_story",
      "suggest_next_story",
    ]);
    for (const tool of TOOL_METADATA) {
      expect(tool.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
    }
  });

  test.each(TOOL_METADATA.map((tool) => ({ name: tool.name, tool })))(
    "$name passes the vendored agent-tool contract",
    ({ tool }) => {
      expect(assertAgentToolMetadata({ ...tool, safetyClass: "read" }, tool.name)).toEqual([]);
    },
  );
});

describe("tool runners", () => {
  test("list returns newest first with a short spoken summary", async () => {
    const result = await runListFamilyStories({ limit: 2 }, "demo", provider);
    expect(result.structured.stories.map((story) => story.id)).toEqual(["st_lighthouse", "st_owl"]);
    expect(result.summary.length).toBeLessThan(300);
    expect(result.summary).toContain("A lighthouse for Mateo");
  });

  test("list defaults to ten", async () => {
    const result = await runListFamilyStories({}, "demo", provider);
    expect(result.structured.stories).toHaveLength(3);
  });

  test("get returns the story with audio and a resource link", async () => {
    const result = await runGetFamilyStory({ storyId: "st_owl" }, "demo", provider);
    expect(result.structured.audio.contentType).toBe("audio/mpeg");
    expect(result.resourceLink).toEqual({
      type: "resource_link",
      uri: `${TEST_BASE_URL}/fixtures/audio/st_owl.mp3`,
      name: "The owl who forgot how to hoot",
      mimeType: "audio/mpeg",
    });
    expect(result.summary.length).toBeLessThan(300);
  });

  test("get reports story_not_found for an unknown id", async () => {
    await expect(runGetFamilyStory({ storyId: "missing" }, "demo", provider)).rejects.toMatchObject({
      code: "story_not_found",
    });
  });

  test("suggest walks from the least recently delivered story and never repeats within a ring", async () => {
    const memory = new SuggestionMemory();
    const first = await runSuggestNextStory({}, "demo", provider, memory);
    const second = await runSuggestNextStory({}, "demo", provider, memory);
    const third = await runSuggestNextStory({}, "demo", provider, memory);
    expect([first, second, third].map((r) => r.structured.story?.id)).toEqual(["st_bread", "st_owl", "st_lighthouse"]);
    const fourth = await runSuggestNextStory({}, "demo", provider, memory);
    expect(fourth.structured.story?.id).toBe("st_bread");
    expect(fourth.structured.reason).toMatch(/all/i);
  });

  test("suggest keeps rings per subject", async () => {
    const memory = new SuggestionMemory();
    await runSuggestNextStory({}, "demo", provider, memory);
    const other = await runSuggestNextStory({}, "someone-else", provider, memory);
    expect(other.structured.story?.id).toBe("st_bread");
  });

  test("suggest returns null with a reason when nothing is delivered", async () => {
    const empty = new FixtureProvider({ stories: [], publicBaseUrl: TEST_BASE_URL });
    const result = await runSuggestNextStory({}, "demo", empty, new SuggestionMemory());
    expect(result.structured).toEqual({ story: null, reason: expect.stringContaining("No stories") as string });
  });
});
