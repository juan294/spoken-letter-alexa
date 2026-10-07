/** The locales the skill and the agent API speak. Anything else is answered in English. */
export const SKILL_LOCALES = ["en-US", "es-ES"] as const;

export type SkillLocale = (typeof SKILL_LOCALES)[number];

export const isSkillLocale = (value: unknown): value is SkillLocale => SKILL_LOCALES.some((locale) => locale === value);

/** Any Spanish request locale (`es-ES`, `es-MX`, `es-US`) gets the Spanish catalog; everything else, or none, gets English. */
export function resolveLocale(locale: string | undefined): SkillLocale {
  return /^es(?:-|$)/i.test(locale ?? "") ? "es-ES" : "en-US";
}
