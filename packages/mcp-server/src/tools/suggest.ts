import { type z } from "zod";

import { type AccountProvider, type StorySummary } from "../provider/types.ts";
import { spokenDuration, suggestInputSchema, suggestOutputSchema } from "./schemas.ts";

export const SUGGEST_TOOL = {
  name: "suggest_next_story",
  title: "Suggest the next family story",
  description:
    "Picks the delivered story that has waited longest since delivery and has not been suggested yet in this session, so bedtime rotates through the whole collection. Returns the story and a short reason.",
  inputSchema: suggestInputSchema,
  outputSchema: suggestOutputSchema,
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
} as const;

/**
 * Per-subject ring of suggested story ids. In-memory: Phase 6 may move it to the agent
 * session table; resetting on a cold start is acceptable.
 */
export class SuggestionMemory {
  private readonly rings = new Map<string, Set<string>>();

  suggested(subject: string): Set<string> {
    let ring = this.rings.get(subject);
    if (!ring) {
      ring = new Set();
      this.rings.set(subject, ring);
    }
    return ring;
  }

  reset(subject: string): void {
    this.rings.delete(subject);
  }
}

export type SuggestResult = { summary: string; structured: z.infer<typeof suggestOutputSchema> };

const SUGGEST_LIMIT = 20;

export async function runSuggestNextStory(
  _args: z.infer<typeof suggestInputSchema>,
  subject: string,
  provider: AccountProvider,
  memory: SuggestionMemory,
): Promise<SuggestResult> {
  const stories = await provider.listDeliveredStories(subject, SUGGEST_LIMIT);
  if (stories.length === 0) {
    const reason = "No stories have been delivered yet.";
    return { summary: reason, structured: { story: null, reason } };
  }
  const oldestFirst = [...stories].sort((a, b) => Date.parse(a.deliveredAt) - Date.parse(b.deliveredAt));
  let ring = memory.suggested(subject);
  let pick: StorySummary | undefined = oldestFirst.find((story) => !ring.has(story.id));
  let reason: string;
  if (pick) {
    reason = ring.size === 0 ? "It is the story that has waited longest since delivery." : "It is the next story that has not been suggested yet tonight.";
  } else {
    memory.reset(subject);
    ring = memory.suggested(subject);
    pick = oldestFirst[0];
    reason = "All delivered stories have been suggested, so the rotation starts again with the oldest.";
  }
  if (!pick) {
    const empty = "No stories have been delivered yet.";
    return { summary: empty, structured: { story: null, reason: empty } };
  }
  ring.add(pick.id);
  const duration = spokenDuration(pick.durationSeconds);
  const summary = `How about "${pick.title}" by ${pick.storyteller}${duration ? ` (${duration})` : ""}? ${reason}`;
  return { summary: summary.slice(0, 299), structured: { story: pick, reason } };
}
