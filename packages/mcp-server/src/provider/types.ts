/**
 * The account-provider boundary. This is the ADR 0013 boundary for this repository:
 * nothing here names a recipient, a space, a sender email, story content or Yoto fields.
 */
export type StorySummary = {
  id: string;
  title: string;
  /** Sender display name, or "A storyteller" when the provider has none. */
  storyteller: string;
  durationSeconds?: number | undefined;
  /** ISO 8601; the Owner's delivery moment (`downloadedAt` in Spoken Letter). */
  deliveredAt: string;
  /**
   * The story's own artwork for a screen device. Absent when the story carries none, and
   * ignored by a caller with no screen. A URL to a picture of the story: no Yoto id, no
   * card id and no icon title cross the boundary with it.
   */
  artUrl?: string | undefined;
};

export type StoryAudio = { url: string; expiresAt: string; contentType: "audio/mpeg" };

export type StoryWithAudio = StorySummary & { audio: StoryAudio };

export interface AccountProvider {
  listDeliveredStories(subject: string, limit: number): Promise<StorySummary[]>;
  getStory(subject: string, storyId: string): Promise<StoryWithAudio | null>;
}

export class ProviderUnavailableError extends Error {
  override readonly name = "ProviderUnavailableError";
}

/** Resolves the provider that serves a subject. `demo` and `svc:*` map to fixtures. */
export type ProviderResolver = (subject: string) => AccountProvider;
