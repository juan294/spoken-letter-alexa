import { type z } from "zod";

import { type AccountProvider } from "../provider/types.ts";
import { listInputSchema, listOutputSchema, spokenDuration } from "./schemas.ts";

export const LIST_TOOL = {
  name: "list_family_stories",
  title: "List delivered family stories",
  description:
    "Lists the stories a parent has already delivered to their child in Spoken Letter, newest first. Returns titles, who recorded them, and durations. Use it before playing a story.",
  inputSchema: listInputSchema,
  outputSchema: listOutputSchema,
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
} as const;

export type ListResult = { summary: string; structured: z.infer<typeof listOutputSchema> };

export async function runListFamilyStories(
  args: z.infer<typeof listInputSchema>,
  subject: string,
  provider: AccountProvider,
): Promise<ListResult> {
  const stories = await provider.listDeliveredStories(subject, args.limit ?? 10);
  if (stories.length === 0) {
    return { summary: "No stories have been delivered yet.", structured: { stories } };
  }
  const named = stories.slice(0, 3).map((story) => {
    const duration = spokenDuration(story.durationSeconds);
    return `"${story.title}" by ${story.storyteller}${duration ? ` (${duration})` : ""}`;
  });
  const more = stories.length > 3 ? ` and ${stories.length - 3} more` : "";
  const summary = `${stories.length} delivered ${stories.length === 1 ? "story" : "stories"}, newest first: ${named.join(", ")}${more}.`;
  return { summary: summary.slice(0, 299), structured: { stories } };
}
