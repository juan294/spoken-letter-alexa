# Spanish (es-ES) skill handoff

## Authorization and implementation entry

On 2026-10-07 the Owner invoked `/rpi-implement` on [the plan](2026-10-07-alexa-skill-spanish-locale.md) with "All phases, no stopping. When you're done merge to develop and prune your tree." That covers Phases 1–4 local work, a local merge into `develop` and pruning this task's worktree. It does not cover push, `pnpm deploy`, `ask deploy`, notification sends or device steps; Phase 4's release checklist keeps its separate Owner gates. Owner copy review of the Spanish strings (Phases 1 and 3) is still owed and is listed under pending work.

Entry state: `develop` at `8deba9bfe1aa1117d511d3ff5d2fec25f2eb97e7` (the plan commit on top of the planned base `7b19135`), clean. Worktree `/Users/juan/code/spoken-letter-alexa-es-es`, branch `feat/es-es-locale`. The probe worktree `/Users/juan/code/spoken-letter-alexa-es-probe` (`probe/es-es-locale` at `b13c7bc`) was left untouched. `graphify_local` failed to connect in this session; structure came from direct reads.

## Phase 1: skill locale and Spanish replies

Commits: `e99cff3` (implementation), `be32934` (review repairs), `dff9005` (simplify).

- `packages/shared/src/locale.ts`: `SKILL_LOCALES`, `SkillLocale`, `resolveLocale` (any `es`/`es-*` to `es-ES`, everything else to `en-US`), exported from the package index.
- `packages/skill/src/messages.ts`: `MESSAGES` and `MATCHERS`, typed `Record<SkillLocale, …>`, plus `DEMO_TOPICS`. English values moved verbatim from `handler.ts`. The Spanish matchers use a Unicode word boundary (`es()`), because JavaScript's `\b` treats accented letters as non-word characters.
- `handler.ts` resolves the locale once per request. It reads `ER_SUCCESS_MATCH` canonical values for `drafttheme`, `wishtopic`, `choice` and `storyteller` (`resolvedValue`), keeps `slotValue` for SearchQuery and FirstName slots, and passes the locale to every `playDirective` call (agent reply, playlist, resume).
- `audio.ts` subtitle comes from the catalog (`read by` / `leída por`). Proactive `localizedAttributes` are built from `SKILL_LOCALES`.

Red evidence: before implementation, the new tests failed (26 skill failures, plus the shared `locale.test.ts` failing to import). Review repairs added 8 more failing tests before their fixes.

Independent review (fresh context) returned CHANGES REQUESTED with 9 findings. Dispositions:

| # | Finding | Disposition |
| --- | --- | --- |
| 1 | "haz que suene la historia sobre…" matched createStory and could save a draft | Fixed: `(?!\s+que\b)` on create verbs; test added |
| 2 | Present-tense "que me envía / que manda" routed to handoff | Fixed: lookbehind for `que (me/nos/te/le)`; tests added |
| 3 | Wish accepted `de` ("quiero una historia de la abuela") | Fixed: needs `sobre` or `acerca de`; test added |
| 4 | wishConfirm wording ambiguous; "sobre la hora de dormir" | Fixed: storyteller before topic; bedtime is "para dormir"; exact-text test |
| 5 | Notes file and en-US device behavior change not recorded | Fixed: this file, Deviations below |
| 6 | Credits matched the noun "compra" | Fixed: verbs only; test added |
| 7 | "cuento", "léeme", "cuéntame", "pídele al…" not handled | Fixed: added to carriers, wish, createStory, askStoryteller; test added |
| 8 | Spanish `shortTitle` strips a leading "Historia de" from a real title | Accepted risk; same class as the English trailing "story" wrapper |
| 9 | Test English-word guard is ASCII-only | Covered by E1's per-line comparison with en-US |

Copy suggestions taken: help, noPlay, progressiveNews. Commas before "o" were kept for spoken pauses. Re-review of `be32934`: APPROVE.

Simplify (four read-only angles): efficiency clean. Applied: helpers take only `locale`; one `DEMO_TOPICS` list typed into `SPANISH_TOPICS`, with a test against the model's `DemoTopic` values; `progressiveText` inlined; proactive locales derived from `SKILL_LOCALES`. Skipped: dropping the en-US `wishTopicStart` key (would change the en-US catalog); dropping the `SKILL_LOCALES` value (Phase 3's zod enum uses it); a shared test-helper module (would modify `handler.test.ts`, which the plan keeps unmodified); making `playDirective`'s locale required (would modify existing `audio.test.ts` calls); a resolved/raw flag on `resolvedValue` (optional; two call sites). Carried to Phase 2: the handler's storyteller aliases must also read the es-ES model, and the Spanish catch-all capture keeps the article ("la tía Whitney").

Gate: `python3 .rpi/scripts/rpi-verify.py` on `dff9005` passed all 5 checks (typecheck, lint, test, cdk-synth, e2e with 8 of 8). Identity sha256 `2ff6b754…eb2d`, 628 files, unchanged before and after. Existing `handler.test.ts`, `session-recovery.integration.test.ts` and `progressive.test.ts` are unmodified.

## Deviations

- Plan said existing English assertions stay unmodified. Found `proactive-events.test.ts` asserted `localizedAttributes: [{ locale: "en-US" }]` exactly. Chose to update that one assertion to both locales. Why: D10 and oracle E8 require the es-ES entry, so this test cannot pass unchanged.
- Plan said en-US behavior is unchanged. Found that step 5 (D4 resolution for every custom slot) changes what a real en-US device sends when Alexa resolves a synonym: storyteller "Whitney" becomes "Aunt Whitney", and drafttheme "sea" becomes "ocean". Chose to follow step 5 as written. Why: the canonical value is what the backend matches anyway; en-US test envelopes carry no resolutions, so the suite cannot observe it. Phase 4's English regression on a device covers it.
- Plan step 6 kept storyteller aliases on the en-US model for Phase 1. Kept as written; Phase 2 extends the handler to read the es-ES model's synonyms.
