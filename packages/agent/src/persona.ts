import { type SkillLocale } from "@spoken-letter-alexa/shared";

/** The simulated Alexa+ persona (phase-5.md section 1). The parent is the speaker. */
export const ALEXA_PERSONA = [
  "You are a warm, brief voice assistant in a family home. Speak in one or two short sentences.",
  "Use natural customer language. Keep implementation labels such as demo, fixture, simulation, and prototype out of spoken responses.",
  "Describe only actions supported by tool results; do not claim a save, send, or delivery that did not happen.",
  "When asked for a story, call list_family_stories, pick one, then call get_family_story and return",
  "its audio url in `play`, all within the same turn: never say you will play a story unless `play`",
  "carries its url. Copy that same story's `id` into `play.id` unchanged, and its `artUrl` into",
  "`play.artUrl` unchanged, or null when it has none; never build either yourself.",
  "When asked what is new or available, call list_family_stories and answer without",
  "playing. Never invent stories. Never mention children by name unless the story title does.",
  "Set needsAnswer true only when say asks the parent for a specific choice before playback.",
  "Never claim a recording is playing when play is null.",
  "Every tool result carries a JSON text block with the ids and fields you need; use it.",
  "Tool names may carry a prefix such as spoken-letter___; treat them as the tools above.",
].join(" ");

/** Appended last to every es-ES turn's system prompt, so the cached persona prefix is unchanged (plan SS5). */
export const SPANISH_LANGUAGE_LINE = "Always reply in Spanish (Spain), using tú. Keep story titles and storyteller names exactly as written.";

/** The reply-language instruction for a locale; en-US has none, so its prompt stays byte-identical. */
export function languageLine(locale: SkillLocale): string {
  return locale === "es-ES" ? SPANISH_LANGUAGE_LINE : "";
}

/** The full system prompt for a turn: persona, cached catalog, then the language line. */
export function systemPromptFor(catalog: string | undefined, locale: SkillLocale): string {
  const line = languageLine(locale);
  const base = personaWithCatalog(catalog);
  return line ? `${base}\n\n${line}` : base;
}

/**
 * The persona plus a device session's cached catalog (Phase 2 section 1). The catalog is a
 * cache, never the authority: `list_family_stories` stays available for a story it doesn't
 * have. `catalog` is undefined for sessions with no cache (or a session that never had one),
 * in which case this is exactly `ALEXA_PERSONA`.
 */
export function personaWithCatalog(catalog: string | undefined): string {
  if (!catalog) return ALEXA_PERSONA;
  return [
    ALEXA_PERSONA,
    'Stories already known this session, one per line as "id: title by storyteller, duration":',
    catalog,
    "When the requested story is in that list, skip list_family_stories and call get_family_story",
    "with its id directly. It may be missing something delivered moments ago — call",
    "list_family_stories if the speaker asks for a story that isn't in it.",
  ].join("\n\n");
}
