import { type z } from "zod";

import { type AccountProvider } from "../provider/types.ts";
import { clipSummary, getInputSchema, spokenDuration, storyWithAudioSchema, ToolFailure } from "./schemas.ts";

export const GET_TOOL = {
  name: "get_family_story",
  title: "Get a delivered family story",
  description:
    "Fetches one delivered story by id, with a time-limited link to its recording so it can be played. The recording is the family member's own voice. Call list_family_stories first to get the id.",
  inputSchema: getInputSchema,
  outputSchema: storyWithAudioSchema,
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
} as const;

export type ResourceLink = { type: "resource_link"; uri: string; name: string; mimeType: "audio/mpeg" };

export type GetResult = {
  summary: string;
  structured: z.infer<typeof storyWithAudioSchema>;
  resourceLink: ResourceLink;
};

export async function runGetFamilyStory(
  args: z.infer<typeof getInputSchema>,
  subject: string,
  provider: AccountProvider,
): Promise<GetResult> {
  const story = await provider.getStory(subject, args.storyId);
  if (!story) {
    throw new ToolFailure("story_not_found", "I couldn't find that story. Ask for the list of delivered stories first.");
  }
  const duration = spokenDuration(story.durationSeconds);
  const summary = `"${story.title}" by ${story.storyteller}${duration ? `, ${duration}` : ""}. The recording is ready to play.`;
  return {
    summary: clipSummary(summary),
    structured: story,
    resourceLink: { type: "resource_link", uri: story.audio.url, name: story.title, mimeType: "audio/mpeg" },
  };
}
