# Phase 1: theme recognition and contextual recovery

Entry: Owner accepts the main plan and authorizes implementation. Revalidate `develop`, existing handlers/model, and the prior no-name and no-unintended-draft tests. This phase fixes F1–F4 locally; it does not establish Amazon recognition.

## Implementation

1. Add `ThemeChoiceIntent`, `drafttheme: DemoTopic`, sample `{drafttheme}` in the generator. Keep `theme: AMAZON.SearchQuery` on the existing start/theme intents and their carrier samples. Use a distinct slot name to preserve the cross-intent type invariant (`packages/skill/src/model/generate.test.ts:100`). Reuse the existing DemoTopic values and synonyms unchanged; the draft backend remains the validator (`packages/agent/src/demo-drafts.ts:97`). Do not widen the shared wish vocabulary in this repair. Regenerate with `pnpm -F @spoken-letter-alexa/skill generate`.
2. Add explicit start paraphrases “let's make a story,” “I would like to create a story,” and “I'd like to make a story,” with optional “about {theme}” forms where they do not introduce conflicting carrier samples. Preserve “let's create a bedtime story” as a theme question. Treat these as designed test phrases, not recovered historical speech.
3. Route the new bare-topic intent only when `demoFlow === draft`. Outside that state, explain how to start creation and make no write. Continue to accept existing ThemeIntent and explicitly recognized catch-all theme answers inside draft state (`packages/skill/src/handler.ts:443`). Never infer a theme from fallback or from playback text containing a theme.
4. Let question helpers accept a flow-specific reprompt. Draft asks/reprompts give theme examples; reaction uses like/love/no; wish uses yes/no. Keep user-visible wording brief and consistent with existing copy constraints.
5. Separate help from fallback. In a valid active flow, both return matching guidance and explicitly return validated session attributes. First fallback repeats the relevant question; the second and subsequent consecutive fallback uses an explicit example and says cancel is available. Bound `fallbackCount` to string values `1` or `2`, consistent with current session attribute typing; reset it on recognized progress. With no active flow, offer a short action menu, then exact example commands after repeated fallback.
6. Validate and rebuild returned session attributes rather than copying the request map. Allow only draft/reaction/wish flow, a bounded fallback counter, canonical wish topic, and a catalog-backed adult storyteller. Malformed wish state returns guidance to start a wish; do not let a yes confirm unknown data. Explicit playback/help/handoff task switches clear obsolete draft state. Cancellation and a no answer while collecting a draft theme clear active state without saving.
7. Map draft errors to fixed recovery copy. Unsupported themes ask again; unavailable/failed writes retain theme entry; limit reached offers latest-draft readback or later retry. Keep backend validation, receipt checks, request IDs, and storage unchanged (`packages/agent/src/routes.ts:303`; `packages/skill/src/agent-client.ts:151`).

```text
@ handleThemeOrFallback(request, validatedFlow) -> AlexaResponse
ctx: generatedModel, existingAgentClient, boundedSessionAttributes
pre: authenticated skill envelope; backend remains the draft validator
do:
  1. validate flow and allowed attributes
  2. parse recognized theme or recovery intent
  3. lookup existing draft action only for explicit creation or active theme entry
  4. emit matching question, reprompt, and bounded next state
br: fallback -> ask without saving; topic outside draft -> explain creation entry
fail: unsupported or unavailable -> disclose no save and show a usable next command
risk: global bare-topic intent can alter recognition; require Amazon regression rehearsal
```

## Behavioral oracles

Write failing tests first in `handler.test.ts` and `model/generate.test.ts`. Carry response session attributes into each next request, use distinct request IDs for distinct turns, and assert reprompt text as well as first speech.

| ID | Input journey | Required result |
| --- | --- | --- |
| S1 | Start → ThemeChoiceIntent(`mermaids`); repeat for `space` and a supported synonym | Theme prompt and matching reprompt; one draft save with actual selected theme; saved response after receipt |
| S2 | Start → existing ThemeIntent(`about` slot value); explicit start with theme | Existing paths still save correctly; generated carriers and phrase-slot types retained |
| S3 | Start → fallback → fallback → valid theme | No writes on fallbacks; preserved draft state; second recovery gives “about mermaids”; one save on the final turn |
| S4 | Bare topic without draft state, with reaction/wish state, or after reopening | No draft write; appropriate current-flow or creation-entry guidance |
| S5 | Start → cancel/no; start → explicit playback; start → named-listener handoff | No new draft; cancellation or task switch does not retain obsolete draft state; names never repeated |
| S6 | Missing theme; unsupported theme; backend failure; then valid theme | Actionable theme prompt/reprompt and successful later completion; no saved claim on failed turn |
| S7 | Pending reaction/wish → fallback/help → valid choice | Matching reprompt; safe attributes returned; existing confirmed action succeeds, no accidental draft |
| S8 | Unknown flow, arbitrary extra attributes, invalid counter/topic/storyteller | Attributes discarded or normalized; no raw value echoed; no confirmed write from invalid state |
| S9 | Draft limit error | No saved claim; read-latest/later guidance; no immediate-retry promise |

Generator tests assert the new list slot, no bare SearchQuery sample, declared placeholders, stable slot types, safe phrasing, and exact generated-file drift. Mutation checks: removing draft gating must fail S4; dropping session attributes must fail S3; restoring playback reprompt must fail S1/S7; saving on fallback must fail S3. Preserve existing safeguards at `packages/skill/src/handler.test.ts:197` and the prior pending-draft playback regression.

## Work unit and verification

One unit owns handler, generator, generated model, and their tests. These changes share state semantics, so no independent implementation batch is justified. Optional independent review is read-only and does not own files. Follow independent review → repair → simplify → full sequential `python3 .rpi/scripts/rpi-verify.py`. No Amazon/model publishing is part of this gate.

Automated acceptance: S1–S9 and existing tests pass on a named candidate, model drift is zero, all five local gates pass. Manual acceptance is deferred to the exact-candidate ASK/Echo matrix in Phase 3. Stop for Owner Phase 1 acceptance unless explicit continuation has been granted. Record source identity, red/green results, review findings, simplify findings, and remaining device uncertainty in the notes.

## Local acceptance, 2026-10-01

- [x] S1–S9 automated oracles, independent review and repairs, and simplify completed.
- [x] Full default sequential gate passed on candidate `84cff45`: typecheck, lint, 541 tests, CDK synth, and eight E2E cases. Exact digests, earlier failures, review dispositions, and the integrated identity are in [notes](../2026-10-01-alexa-session-friction-notes.md).
- [ ] Amazon/Echo acceptance: NOT RUN for this repair; separate publication/deployment authorization and device observation remain required.

The Owner authorized continuation through all local phases and local integration, so no intermediate stop was taken.
