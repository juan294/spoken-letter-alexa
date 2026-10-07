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

## Phase 2: es-ES interaction model and manifest

Commits: `3deae2e` (implementation), `7f600c9` (review repairs), `215c93b` (simplify).

- `generate.ts` holds everything that differs by locale in one `LOCALE_TABLES` record: lowercasing, alphabet, child words, denied fragments, kinship forms, samples, catch-all carriers, slot types and example phrases. `generateInteractionModel({ locale })` builds the en-US intents and slots, then swaps in the es-ES samples. A missing or unknown intent in a locale's sample table throws. `MODEL_PATHS` and `TRAINING_PATHS` are built from `SKILL_LOCALES`. Existing en-US callers keep their defaults.
- `interactionModels/custom/es-ES.json` is generated and drift-checked: 36 intents, the same slots as en-US, and English canonical slot values with Spanish synonyms. `StorytellerName` adds `tía`, `tita` and `la tía`/`la tita` forms for "Aunt", the article forms of `abuela` and `abuelo`, `mamá`/`papá` forms, and the bare name.
- `skill.json` gains the es-ES locale (Spanish summary, description and keywords; the en-US icon files), `distributionCountries: ["US","ES"]`, and a Spanish line in the shared testing instructions. `withExamplePhrases` rewrites one locale's array in place, so the hand-formatted manifest is never reflowed. A `JSON.stringify` round trip changes the committed file (reviewer-verified).
- `deploy.mjs` checks both locales' models and icons and names both device languages.
- `handler.ts` builds storyteller aliases from both models. The Spanish `askStoryteller` capture drops `a la`, `a el` and `al`.

Red evidence: before implementation, the new model tests and handler alias tests failed (M2 drift, M3 Spanish samples, the M4 tables, M6, M7 and the alias tests). Review repairs added 5 more failing tests before their fixes.

Independent review of `3deae2e`: CHANGES REQUESTED. Dispositions:

| # | Finding | Disposition |
| --- | --- | --- |
| 1 | The M4 test exempted handoff and credit samples from every check | Fixed: only "enviar" (handoff) and "crédito" (credit help) are masked, mirroring en-US's "send" and "credit" |
| 2 | No "cuento" samples | Fixed: PlayStory, StartStory (with "inventa"), Wish and WishFromStoryteller samples |
| 3 | No "pídele" sample; an article in the slot ("la tía Whitney") missed resolution | Fixed: "pídele" samples and article synonyms; handler test for a raw "la tía Whitney" |
| 4 | Spain uses the perfect tense ("ha mandado") | Fixed: two PlayStory samples |
| 5 | "crea una historia para {listeneralias}" is close to "crea una historia para dormir" | Accepted. A mis-route only gives the handoff explanation; check in Amazon's utterance profiler after `ask deploy` |
| 6 | "pon otra" vs "ponla otra vez"; "me {choice}" is short | Accepted; device acceptance in Phase 4 |
| 7 | `withExamplePhrases` was not bounded to its locale | Fixed: refuses an array past the next locale key; test added |
| 8 | "pide a spoken letter qué hay de nuevo" reads awkwardly | Owner decision: the plan mandates it; "pregunta a spoken letter qué hay de nuevo" is the alternative |
| 9 | Extra child words (nene, nena, bebé); unaccented forms pass | Follow-up only. The lists match the plan, and es-ES has no training input today |
| 10 | "pídeles a los abuelos" is not matched | Accepted; no plural catalog storyteller exists |

Re-review of `7f600c9`: APPROVE. The reviewer's node scan of es-ES.json found no duplicate samples, no sample shape shared across intents, no synonym shared across values, and no catch-all carrier that prefixes a play sample.

Simplify (four angles). Applied: per-locale tables in place of nine locale branches; the unknown-intent guard (it caught the catch-all carriers sitting in the samples table, now their own constant); "grab" moved into the Spanish denied fragments; the shared `spanishPattern` word boundary (exported from `messages.ts`) for the Spanish child words; paths built from `SKILL_LOCALES`; one deploy loop over models and icons, with a pointer to `SKILL_LOCALES` because the plain-Node script cannot import TypeScript. Skipped: a generated storyteller-only file to save about 13.5 KB in the Lambda bundle (well under 1 ms of cold start); aligning DemoTopic synonyms with the matcher vocabulary (a pre-existing en-US pattern); reformatting skill.json to drop the in-place rewrite (the plan says preserve its formatting).

Evidence:
- `pnpm -F @spoken-letter-alexa/skill run deploy --dry-run` passed on `215c93b` (M8). It made one read-only `aws lambda get-function` call.
- `git diff develop` is empty for en-US.json and generate.test.ts (M1).
- Gate: `python3 .rpi/scripts/rpi-verify.py` on `215c93b` passed all 5 checks (8 of 8 E2E). Identity sha256 `af8f36e7…6bea8`, 631 files, unchanged before and after.

Not done: the plan says to delete `probe/es-es-locale` and its worktree after Owner acceptance of Phase 2. That worktree holds the source of the es-ES model currently on the development stage, and the Owner's acceptance is still owed, so both are left in place for the Owner.

## Phase 3: backend localization

Commits: `15689fb` (implementation), `dee2f0f` (review repairs), `ccc4812` (simplify).

- Transport (D6). `routes.ts` accepts optional `locale: z.enum(SKILL_LOCALES)` on the session, playlist, demo next, inbox, draft and wish bodies. `AgentSession.locale` is written on every session open (default en-US), so a reopen replaces it (SS6). The Dynamo store reads back only a supported value. The skill's `agent-client.ts` sends `locale` on exactly those bodies when given, and reopens the device session when a turn's locale differs from the cached one.
- Turns. `persona.ts` exports `SPANISH_LANGUAGE_LINE` and `systemPromptFor(catalog, locale)`; en-US returns `personaWithCatalog(catalog)` unchanged. `runTurn` builds the prompt and the fallback reply from `TurnOptions.locale`. `ScriptedModel` answers in Spanish when the prompt carries the line and recognizes Spanish play, list and next words.
- Catalog (D5). `packages/agent/src/messages.ts` holds `AGENT_MESSAGES: Record<SkillLocale, …>`: playlist replies, update details (rendered by `publicEvent` in the request locale), the draft outline (rendered at save time, D7) and the fallback say. The English values are the earlier literals, unchanged. The fixture contract still checks the English detail wording.
- `canonicalTheme(speech, locale)` keeps the seven English rows, in their original order, for en-US. es-ES has its own Spanish rows, then an exact canonical value.
- Shared. `topics.ts` (`DEMO_TOPICS`, `isDemoTopic`, `SPANISH_TOPIC_PHRASES`), `text.ts` (`spanishPattern`, moved from the skill) and `isSkillLocale`.

Red evidence: before implementation, the agent route tests had 17 failures and the skill client and handler tests had 7. Review repairs added 4 more failing tests before their fixes.

Independent review of `15689fb`: CHANGES REQUESTED. Dispositions:

| # | Finding | Disposition |
| --- | --- | --- |
| 1 | The English ocean row matched the Spanish subjunctive "sea"; Spanish "luna" turned "Luna the cat" into space | Fixed: per-locale theme rows; en-US is exactly the original table; B5 rows and an SS3 route test added |
| 2 | No Phase 3 handoff | Fixed: this section |
| 3 | A per-container client cache can miss a language change made through another warm container | Accepted risk (needs a language switch plus a container split). The plan has turns use the stored locale. If seen on a device, send `locale` on the turn body as an override |
| 4 | An invalid `locale` value now gets a 400 (a 422 on `/demo/wish`) | Accepted: the skill only sends es-ES; an omitted locale is still accepted (B2) |
| 5 | ScriptedModel treated "más" as "another" | Fixed: removed; test added |
| 6 | Spanish copy (noStoriesYet, whichTitle, "He guardado", scripted "reciente" and "envía") | Fixed as proposed |

Re-review of `dee2f0f`: APPROVE.

Simplify (two combined reviewers). Applied:
- one shared `spanishPattern` in place of three drifting copies;
- shared `isSkillLocale` and `isDemoTopic`;
- the unused `FALLBACK_SAY` export removed;
- `languageLine` inlined;
- the draft enum types derived from the schema;
- scripted replies keyed by `SkillLocale`;
- the route adds the locale once;
- `runTurn` is the one place the prompt is built.

Skipped:
- storing `locale` only for non-English sessions: storing en-US explicitly is what lets a reopen replace es-ES;
- a per-request agent wrapper in place of the `localeInput` spreads: optional, and no call site is missed today.

Gate on `ccc4812`:
- Attempt 1 failed: `test` exit 1, from one simulator UI test (`App.test.tsx`, "finishes the link on /demo/callback…"). The other four checks passed. The simulator has no diff from `develop`, and its suite then passed 3 of 3 runs in isolation. This is the known first-run timing flake.
- Attempt 2 on the same identity passed all 5 checks: sha256 `eb8a379d…a245`, 636 files, unchanged before and after.
- The failed receipt is kept outside the repository at `<scratchpad>/p3-verify-attempt1-failed.log` and `p3-verification-attempt1-failed.json`.
- en-US: no pre-existing test changed. Every English literal moved verbatim (reviewer compared them character by character), and the en-US system prompt is byte-identical.

## Deviations

- Plan said existing English assertions stay unmodified. Found `proactive-events.test.ts` asserted `localizedAttributes: [{ locale: "en-US" }]` exactly. Chose to update that one assertion to both locales. Why: D10 and oracle E8 require the es-ES entry, so this test cannot pass unchanged.
- Plan said en-US behavior is unchanged. Found that step 5 (D4 resolution for every custom slot) changes what a real en-US device sends when Alexa resolves a synonym: storyteller "Whitney" becomes "Aunt Whitney", and drafttheme "sea" becomes "ocean". Chose to follow step 5 as written. Why: the canonical value is what the backend matches anyway; en-US test envelopes carry no resolutions, so the suite cannot observe it. Phase 4's English regression on a device covers it.
- Plan step 6 kept storyteller aliases on the en-US model for Phase 1. Kept as written; Phase 2 extends the handler to read the es-ES model's synonyms.
- Plan oracle M4 said every es-ES sample passes `utteranceAllowed`. Found the fixed handoff and credit-help samples must say "enviar" and "créditos", both denied fragments. Chose to mask only that one fragment for those two intents, exactly as the en-US test does for "send" and "credit". Why: the explanations are the intents' purpose and write nothing.
- Plan said `utteranceAllowed(sample, locale)` applies that locale's child words. Found applying the English list as well rejects "cuáles son las historias" ("son" means "they are"). Chose: each locale applies its own child words; the shared `CLASS_C_DENYLIST` and record/audio still apply to both, and es-ES adds "grab". Why: correct Spanish while staying stricter than the plan on fragments.
- Plan step 5 said the handler passes its resolved locale to every client call. Chose: pass it only for non-en-US requests, and only on the D6 bodies (session, playlist, next, inbox, draft, wish). Why: the agent treats an omitted locale as en-US, so this is the same contract. English request bodies stay byte-identical, and the existing exact-match handler and client tests pass unmodified, as the plan requires.
- Plan step 4 said canonicalTheme adds the Spanish patterns "in the same table". Found one shared table let English "sea" match Spanish "que sea" and Spanish "luna" change English results. Chose per-locale rows behind `canonicalTheme(speech, locale)`; en-US is exactly the original table. Why: en-US invariance and correct Spanish matching.
- Plan's consumer sweep said Phase 3 adds the locale field to `session-recovery.integration.test.ts`'s in-process requests. Not needed: those requests are en-US, and en-US sends no locale. The file stays unmodified; Phase 4 adds the es-ES journeys in a new file.
- The wish body accepts `locale` (D6), and it is used only to match a raw Spanish topic. The wish receipt has no speech; the wish's update detail is rendered in the reader's locale when read.
