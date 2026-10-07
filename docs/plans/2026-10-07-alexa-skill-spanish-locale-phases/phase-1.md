# Phase 1: skill locale and Spanish replies

Entry: the Owner accepts the plan and authorizes Phase 1. Revalidate `develop`, `packages/skill/src/handler.ts` and its tests against the plan's citations. Work in a worktree off `develop`. This phase changes the skill Lambda only. The backend still answers in English until Phase 3, and es-ES requests can only arrive after Phase 2's model is published.

## Implementation

1. Add `SkillLocale` and `resolveLocale` to `packages/shared` (D3). Export them from the package index.
2. Create `packages/skill/src/messages.ts`: a `Messages` type with one key per current reply, prompt, reprompt and template (functions for templated lines, such as the wish confirmation and "Did you like or love {title}?"). Add `MESSAGES: Record<SkillLocale, Messages>`. Move the English text verbatim from `handler.ts:67-87`, `:132-148` and the inline replies at `:353-567`. Write the Spanish values (D9).
3. Thread `const m = MESSAGES[resolveLocale(event.request.locale)]` through `createHandler`. Replace every literal. `recoverFlow`, `progressiveText`, `question` and `themeQuestion` take `m`.
4. Add per-locale text matchers next to the catalog: the topic patterns behind `safeDemoTopic`, the catch-all routing patterns (wish, ask-for, send/deliver, create-for, credits, how-to-create, explicit/bare theme, create-story), the `catchAllTitle` carriers and the reaction choices. Spanish examples: `sirenas`, `espacio`, `estrellas`, `océano`, `mar`, `playa`, `bosque`, `animales`, `amistad`, `dormir`; `quiero una historia sobre`; `pon`, `reproduce`, `quiero escuchar`; `me gusta`, `me encanta`. English patterns move unchanged.
5. Read canonical values for custom slot types (D4): add `resolutions` to the `Slot` type. `resolvedValue(event, name)` returns the first `ER_SUCCESS_MATCH` value's `name`, otherwise the raw value. Use it for `drafttheme`, `wishtopic`, `choice` and `storyteller`. Keep `slotValue` for `AMAZON.SearchQuery` and `AMAZON.FirstName` slots. Keep `loggedSlots` and `slotPresence` value-free.
6. Storyteller aliases: keep building them from the en-US model in this phase. Phase 2 adds the es-ES synonyms; resolution (step 5) already yields the canonical name.
7. Localize the AudioPlayer subtitle (`audio.ts:107`: "read by" / "leída por") by passing the locale into `playDirective` metadata. Localize progressive filler. Add `es-ES` to proactive `localizedAttributes` (D10).

```text
@ handler(event) -> AlexaResponse
ctx: MESSAGES, per-locale matchers, existing agent client
pre: skill id verified; session attributes validated as today
do:
  1. compute locale via resolveLocale(request.locale)
  2. lookup messages and matchers for locale
  3. parse slots via entity resolution, raw fallback
  4. emit the same response keys, flows and telemetry as en-US
br: unknown locale -> en-US
risk: a Spanish matcher wider than the English one could start an unintended draft; oracle S4 guards
```

## Behavioral oracles

Write failing tests first. Existing `handler.test.ts`, `audio.test.ts`, `progressive.test.ts`, `proactive-events.test.ts` and `session-recovery.integration.test.ts` English assertions stay unmodified and must pass.

| ID | Journey (es-ES request locale unless stated) | Required result |
| --- | --- | --- |
| E1 | Launch, help, fallback ×2, every playback-control intent, cancel in each flow | Spanish speech and reprompt; same `responseKey`, `interactionResult` and session attributes as the en-US run of the same journey (table-driven over both locales) |
| E2 | Start a draft, then `ThemeChoiceIntent` with resolution `mermaids` from spoken "sirenas" | One `saveDraft` call with theme `mermaids`; Spanish saved reply |
| E3 | `ReactToStoryIntent` resolved `love` from "me encanta"; `WishStoryIntent` resolved `space`; `WishFromStorytellerIntent` resolved `Aunt Whitney` from "tía Whitney" | Same backend calls and receipts as en-US; Spanish confirmations naming the canonical storyteller |
| E4 | Catch-all Spanish: "quiero una historia sobre el mar", "envíale una historia a Ana", "cómo añado créditos", "pon la de Ignacio" | Wish confirm, handoff (name not repeated), credits help, title playlist command with title `Ignacio`; no draft write |
| E5 | No locale; `fr-FR`; `es-MX` | English, English, Spanish (SS1) |
| E6 | `ER_SUCCESS_NO_MATCH` theme "dinosaurios" | Raw value sent; Spanish unsupported-theme prompt on the backend's `unsupported_theme` (SS3) |
| E7 | Catalog completeness | `tsc` fails if any `Messages` key is missing in es-ES (type test); a test asserts no es-ES string contains `demo`, `fixture`, `simulation` or `prototype`, like the English rule (`handler.test.ts:34`) |
| E8 | Proactive event payload | Both `en-US` and `es-ES` attributes (SS10) |

## Batch eligibility

- Unit A `[batch-eligible]`: steps 1 and 7's proactive-events part (`packages/shared`, `proactive-events.ts`).
- Unit B: steps 2–7's handler, audio and progressive work, with one owner. It depends on Unit A's export.

## Exit

Independent review, repair, simplify, the full local gate, and the Owner's review of every Spanish string in `messages.ts`. Record deviations and evidence in `docs/plans/2026-10-07-alexa-skill-spanish-locale-notes.md`.
