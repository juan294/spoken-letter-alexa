# Phase 3 — Interaction model, slot types and manifest copy

Everything Amazon's servers need, in one phase, so there is one Owner-gated `ask deploy`
rather than two. **Every model change goes through `packages/skill/src/model/generate.ts`
and `pnpm -F skill generate` — the committed `en-US.json` is drift-checked by a test
(D-U1). Never hand-edit it.**

## 1. Playback intents

`skill.json` declares the `AUDIO_PLAYER` interface. `BUILT_IN_INTENTS` in `generate.ts`
lists six built-ins and none of the playback ones. Add:

`AMAZON.NextIntent`, `AMAZON.PreviousIntent`, `AMAZON.StartOverIntent`,
`AMAZON.RepeatIntent`, `AMAZON.LoopOnIntent`, `AMAZON.LoopOffIntent`,
`AMAZON.ShuffleOnIntent`, `AMAZON.ShuffleOffIntent`, plus `AMAZON.YesIntent` and
`AMAZON.NoIntent`.

Handling in `packages/skill/src/handler.ts`, alongside the existing Pause/Resume/Stop
block at line 130:

| Intent | Behaviour |
| --- | --- |
| `AMAZON.NextIntent` | same as `NextStoryIntent` — the agent picks the next story |
| `AMAZON.PreviousIntent` | replay the previous story from the session, or "That was the first one" |
| `AMAZON.StartOverIntent` | re-issue the current token's play directive at offset 0 |
| `AMAZON.RepeatIntent` | same as StartOverIntent |
| `AMAZON.LoopOn/Off`, `ShuffleOn/Off` | acknowledge without changing behaviour: "I play family stories one at a time." Do not silently ignore them — a skill that answers nothing reads as broken |
| `AMAZON.YesIntent` / `NoIntent` | answer the question the previous turn asked; see Phase 4 section 2 |

`StartOverIntent` and `RepeatIntent` reuse `decodeStreamToken` exactly as
`AMAZON.ResumeIntent` does at `handler.ts:136`, with offset 0 instead of the reported one.

**Routing note.** `next one` and `another one` are already `NextStoryIntent` samples.
`AMAZON.NextIntent` will compete for them. Keep both and route them to identical
behaviour — do not remove the samples to resolve the ambiguity, because `NextStoryIntent`
is the intent the generator binds to `suggest_next_story` and removing its samples would
break the tool-to-intent mapping the generator enforces.

## 2. A storyteller slot type that matches real speech

`PlayStoryIntent.storyteller` is `AMAZON.FirstName`. Every fixture story is by
"Aunt Whitney"; `AMAZON.FirstName` is built for "Whitney".

Replace it with a custom slot type `StorytellerName`, generated from the catalog:

```
@ storytellerType(stories) -> ModelSlotType
ctx: fixtures/stories.json via the generator
pre: at least one story
do:
  1. collect distinct storyteller strings
  2. for each, emit value = full string ("Aunt Whitney")
  3. add synonyms: bare first name, and each kinship prefix form
  4. sort for deterministic output (the drift test compares bytes)
fx: interactionModel.languageModel.types gains one entry
risk: a storyteller absent from the catalog no longer matches — CatchAllIntent covers it
```

This requires `InteractionModel.languageModel.types` to stop being `never[]` in
`generate.ts:12`. The generator currently derives everything from `TOOL_METADATA`; it now
also needs the catalog, so `generateInteractionModel` takes `{ training, stories }` and
`generate-cli.ts` loads `fixtures/stories.json` through the existing
`parseFixtureCatalog` (`packages/mcp-server/src/provider/fixtures.ts:37`) rather than
parsing it again.

Keep a slot-value-agnostic path: the agent already resolves names fuzzily against the
catalog, so an unmatched storyteller reaching `CatchAllIntent` still works.

## 3. De-conflict the two `AMAZON.SearchQuery` intents

`PlayStoryIntent.title` and `CatchAllIntent.text` are both `AMAZON.SearchQuery`, and the
carriers overlap: `i want to {text}` against `i want to hear {title}`, and `can you {text}`
against everything.

Remove from `CATCH_ALL_SAMPLES` the carriers that begin a play request — `i want to {text}`,
`i would like to {text}`, `i'd like to {text}` — and keep the intent-neutral ones (`to`,
`please`, `can you`, `could you`, `would you`, and the four `ask/tell spoken letter`
forms). The comment at `generate.ts:100` already states the design rule that every carrier
is intent-neutral; these three violate it.

Add a generator assertion, tested in `generate.test.ts`: no `CatchAllIntent` carrier prefix
may be a prefix of any `PlayStoryIntent` sample. That turns this class of bug into a test
failure rather than a live mis-route.

## 4. Utterances people actually use

Add to `PlayStoryIntent`:
`play a short story`, `play something short`, `play a bedtime story`,
`play something for bedtime`, `play that again`, `play it again`,
`play the story {storyteller} recorded`, `what did {storyteller} send`.

Add to `WhatIsNewIntent`:
`what did {storyteller} send me`, `who sent a story`, `what do you have`.

Every added sample must pass `utteranceAllowed` (`generate.ts:135`): lowercase alphabet
only, no child words, no `record|audio` fragment, nothing from `CLASS_C_DENYLIST`. Note
that `play the story {storyteller} recorded` **fails** that filter on `record` — use
`play the story {storyteller} made` instead, and let the test catch it if not.

## 5. Manifest copy

`skill.json` advertises stories that do not exist:

- `examplePhrases`: `"Alexa, ask spoken letter to play the story Grandpa sent"`
- `testingInstructions`: `"play the story Grandpa sent"`

Replace both with phrasings drawn from the actual catalog. `examplePhrases` is a fixed
three-entry array Amazon shows in the store listing, so generate it alongside the model
rather than hand-maintaining a fourth copy of the same string. The spoken copy inside the
Lambda is Phase 4 section 4.

## 6. `ask validate` — discharging D-U4's first claim

Run `ask validate` (or `ask smapi submit-skill-validation`) against the regenerated model
before the Owner deploys, and record the outcome in section 8 **whichever way it lands**.
The claim under test: that certification requires the playback intents when `AUDIO_PLAYER`
is declared. If validation does not object, say so plainly here and correct the
friction-log entry's severity — the intents are still worth adding for the "next" case,
but the certification framing would be wrong.

## 7. Files

| File | Change | Unit |
| --- | --- | --- |
| `packages/skill/src/model/generate.ts` | built-ins, slot type, carrier fix, samples, `types` | A |
| `packages/skill/src/model/generate-cli.ts` | load the catalog | A |
| `packages/skill/src/model/generate.test.ts` | carrier-prefix assertion, slot type, drift | A |
| `packages/skill/skill-package/interactionModels/custom/en-US.json` | regenerated output | A |
| `packages/skill/skill-package/skill.json` | example phrases, testing instructions | A |
| `packages/skill/src/handler.ts` | new intent cases | B |
| `packages/skill/src/handler.test.ts` | one case per new intent | B |

A and B are `[batch-eligible]`. One integration owner; no working-branch push, no PR.

## 8. Acceptance

**Automated.** Full gate, sequential. New tests must include:

- the generated model contains all ten added built-in intents
- `StorytellerName` carries every catalog storyteller with its bare-first-name synonym
- no `CatchAllIntent` carrier prefix is a prefix of any `PlayStoryIntent` sample
- every added sample passes `utteranceAllowed`
- the committed `en-US.json` matches the generator byte for byte (existing drift test)
- `handler` answers `AMAZON.StartOverIntent` with a play directive at offset 0
- `handler` answers `AMAZON.LoopOnIntent` with speech, not an empty response

**`ask validate` result.** Not run. `ask validate`/`ask smapi submit-skill-validation`
checks whatever model is already deployed to the skill at the target stage — it cannot
validate this session's regenerated, undeployed `en-US.json`. Deploying it
(`ask deploy --target skill-metadata`) is the Owner-gated manual step below; D-U4's first
claim stays undischarged until the Owner runs `ask deploy` and then `ask validate`.

**Manual, Owner.** `pnpm -F skill generate`, review the model diff, then
`ask deploy --target skill-metadata` (per `docs/plans/…-notes.md`; not `--ignore-hook`).
Then on the Echo:

1. `play the story aunt whitney sent` — matches the storyteller slot
2. `next` while a story is playing — advances
3. `start over` — restarts the same story
4. `shuffle on` — gets a real answer, not silence
5. `i want to hear martina` — reaches `PlayStoryIntent`, not `CatchAllIntent` (confirm in
   the Phase 1 telemetry, which logs both `requestType` and `intent`)

## 9. Handoff

**Next.** Phase 4. Carry forward: the `ask validate` outcome and any friction-log
correction it forces, plus whether utterance 5 routed correctly — if `CatchAllIntent` still
wins it, the carrier fix was insufficient and Phase 4 must not assume clean routing.
