import { FixtureProvider, loadFixtureCatalog } from "@spoken-letter-alexa/mcp-server";
import { expect, test } from "vitest";

import { playDirective, type Play } from "./audio.ts";
import { FIXTURES_PATH } from "./model/generate.ts";

/**
 * R4 (staged demo plan, phase 1): the AudioPlayer card the Owner accepted on the device stays
 * byte-identical while APL joins the response. The snapshot was written on `develop` before
 * any phase 1 change; a diff here means the card changed. The three stories are named, so a
 * story added later (phase 2) does not touch this baseline.
 */
const BASELINE_STORIES = ["st_ignacio_the_snail", "st_martina_the_mermaid", "st_mauricio_the_bull"];

test("playDirective output for every fixture story is unchanged", async () => {
  const provider = new FixtureProvider({ stories: await loadFixtureCatalog(FIXTURES_PATH), publicBaseUrl: "https://alexa.spokenletter.com" });
  const directives = [];
  for (const id of BASELINE_STORIES) {
    const story = await provider.getStory("demo", id);
    if (!story) throw new Error(`fixture story ${id} did not resolve`);
    const play: Play = { id: story.id, url: story.audio.url, title: story.title, storyteller: story.storyteller, durationSeconds: story.durationSeconds, artUrl: story.artUrl ?? null };
    directives.push(
      playDirective(play),
      playDirective(play, 42_000, { locale: "es-ES" }),
      playDirective(play, 0, { token: "pl_token", expectedPreviousToken: "pl_previous" }),
    );
  }
  expect(directives).toHaveLength(9);
  await expect(`${JSON.stringify(directives, null, 2)}\n`).toMatchFileSnapshot("./__snapshots__/audio-fixtures.json");
});
