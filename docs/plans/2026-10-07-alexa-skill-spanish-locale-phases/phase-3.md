# Phase 3: backend localization

Entry: Phase 2 accepted. Revalidate `packages/agent/src/{routes,sessions,turn,persona,playlist,demo-updates,demo-drafts,schema,scripted-model}.ts` and `packages/skill/src/agent-client.ts`.

## Implementation

1. Transport (D6). `agent-client.ts` takes the locale from the handler and sends `locale` on session open (`device` mode), playlist, demo next, demo inbox, draft save and wish. `routes.ts` adds `locale: z.enum(["en-US","es-ES"]).optional()` to those schemas. An omitted value is treated as `en-US`. `AgentSession` stores `locale`. Device session open overwrites it with the request value (SS6).
2. Agent turns. `persona.ts` exports `languageLine(locale)`. es-ES returns "Always reply in Spanish (Spain), using tú. Keep story titles and storyteller names exactly as written." en-US returns nothing, so the en-US prompt stays byte-identical. The turn route passes `systemPrompt: personaWithCatalog(catalog) + languageLine(session.locale)` through the existing `TurnOptions.systemPrompt` hook. `FALLBACK_SAY` becomes per-locale. `ScriptedModel` returns its Spanish replies when the prompt carries the Spanish line.
3. `packages/agent/src/messages.ts` (D5): playlist replies (`playlist.ts:153-256`), update details and the wish/reaction confirmations (`demo-updates.ts:11-12`, `:136-140`, `:247`, `:278`), and the draft outline template with Spanish labels for the place, challenge and ending enums (`demo-drafts.ts:9-14`, `:125-127`). Fixture parsing keeps the English constants as the fixture contract (`demo-updates.ts:33`). `publicEvent` renders in the request locale.
4. `canonicalTheme(speech)` adds the Spanish patterns in the same table, so English and Spanish both resolve to the same seven themes. `toLocaleLowerCase("en-US")` becomes plain NFKC lowercase, which is locale-neutral for both. Playlist and storyteller matching keep their current behavior; the skill sends canonical storyteller names (Phase 1, D4).
5. The handler passes its resolved locale to every client call.

```text
@ POST /agent/session|playlist|demo/*(body) -> reply
ctx: zod schemas, session store, message catalogs
pre: locale optional; omitted -> en-US
do:
  1. validate body with optional locale
  2. lookup session; write locale on device session open
  3. compute reply text from messages[locale]
  4. emit unchanged response schema
br: older skill without locale -> en-US
risk: LLM may still answer in English; per-turn language line (SS5)
```

## Behavioral oracles

Existing route, playlist, demo, turn and bootstrap tests pass unmodified (default locale).

| ID | Journey | Required result |
| --- | --- | --- |
| B1 | Each localized route with `locale: "es-ES"` | The response's speech fields are in Spanish; status codes, ids and receipts equal the en-US run |
| B2 | Same routes with no `locale`, and with an extra unknown field | en-US text; no 400 (SS4) |
| B3 | Device session opened es-ES, then reopened en-US | The stored locale follows the latest open; the next turn's system prompt has (then lacks) the Spanish line (SS6, SS5) |
| B4 | es-ES turn with `ScriptedModel` | Spanish `say`; `FALLBACK_SAY` is Spanish when the model fails |
| B5 | `canonicalTheme` table | "sirenas" → mermaids, "estrellas" → space, "el mar" → ocean, "bosque" → forest, "perros" → animals, "amigos" → friendship, "hora de dormir" → bedtime; existing English rows unchanged; "dinosaurios" → null (SS3) |
| B6 | Draft saved es-ES, read es-ES; saved en-US, read es-ES | Spanish outline; stored English outline returned unchanged (SS7) |
| B7 | `agent-client.test.ts` | `locale` appears on exactly the D6 bodies |

## Batch eligibility

- Unit A `[batch-eligible]`: `playlist.ts` and its messages section, with tests.
- Unit B `[batch-eligible]`: `demo-updates.ts` and `demo-drafts.ts` and their messages sections, with tests.
- Unit C: the integration owner handles `routes.ts`, `sessions.ts`, `persona.ts`, `turn.ts`/schema, `scripted-model.ts`, `agent-client.ts` and the handler wiring. It depends on the signatures of A and B. Agree the signatures (`locale: SkillLocale` as the last parameter) before splitting. Use separate `messages.ts` sections or files per unit to avoid file overlap.

## Exit

Independent review, repair, simplify, the full local gate, and the Owner's review of every Spanish backend string and the language line.
