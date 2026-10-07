# Phase 2: es-ES interaction model and manifest

Entry: Phase 1 accepted. Revalidate `generate.ts`, `generate-cli.ts`, `generate.test.ts`, `deploy.mjs` and `skill.json`. This phase produces artifacts for `ask deploy`. It does not publish them.

## Implementation

1. Parameterize the generator by locale (D8). `MODEL_PATHS: Record<SkillLocale, string>`. Per-locale tables cover the tool-intent samples, catch-all carriers, the custom intents' samples, built-ins (shared), `DemoTopic` and `ReactionChoice` synonyms on English canonical values (D4), kinship synonym forms, child words, denylist fragments and the utterance alphabet. The en-US tables are the current literals, moved unchanged.
2. Write Spanish samples for every intent in the en-US model, with the same slots. Examples: `qué hay de nuevo`, `qué historias tengo`, `pon una historia`, `pon la historia que mandó {storyteller}`, `pon {title}`, `siguiente historia`, `vamos a crear una historia`, `crea una historia sobre {theme}`, `sobre {theme}`, `lee mi borrador`, `quiero una historia sobre {wishtopic}`, `me {choice} esa historia`, `mis novedades`, `pon mis historias`, `ponla otra vez`, `pon mis historias nuevas`, `pon las historias de {storyteller}`, `empieza la lista desde el principio`. `AppHandoffIntent` keeps `{listeneralias}` with Spanish carriers. The catch-all carriers are Spanish and intent-neutral (`por favor {text}`, `puedes {text}`, `pide a spoken letter que {text}`).
3. `storytellerSlotType(stories, locale)`: es-ES adds `tía {name}`, `tita {name}`, `abuela {name}`, `abuelo {name}`, `mamá {name}`, `papá {name}` according to the English kinship word, plus the bare name (D2). The canonical value stays the catalog string.
4. The Spanish alphabet is `a-zñáéíóúü0-9 {}'`. `normaliseUtterance` lowercases and folds by locale. `utteranceAllowed(sample, locale)` applies that locale's alphabet, child words and denylist. The en-US path keeps today's checks, plus the shared `CLASS_C_DENYLIST`.
5. `generate-cli.ts` writes both model files. It writes en-US `examplePhrases` as today and es-ES `examplePhrases` (`Alexa, abre spoken letter`, `Alexa, pide a spoken letter que ponga la historia que mandó {first storyteller}`, `Alexa, pide a spoken letter qué hay de nuevo`) into `skill.json`, which gains the es-ES locale block and `distributionCountries: ["US", "ES"]`. Write `skill.json` preserving its current formatting; the ASK CLI's own reformatting is not committed.
6. `deploy.mjs` checks that both model files and both locales' icon URIs exist. Its final hint names both device languages.
7. Run `pnpm -F @spoken-letter-alexa/skill generate`. Commit `interactionModels/custom/es-ES.json`. The probe's hand-written file and `es-es-probe.test.ts` are not carried over.

## Behavioral oracles

| ID | Check | Required result |
| --- | --- | --- |
| M1 | en-US drift (existing test, unmodified) | Byte-identical to the committed file |
| M2 | es-ES drift | The committed es-ES file equals the generator output; the failure message names the generate command (SS8) |
| M3 | Intent parity | es-ES declares exactly the en-US intent names, with the same slot names and types |
| M4 | Safety | Every es-ES sample passes `utteranceAllowed(sample, "es-ES")`; a table test rejects each Spanish child word and denylist fragment; the existing English safety tests pass unmodified |
| M5 | Validators | `assertNoCarrierCollision` and `assertSlotsDeclared` run on both locales (SS9) |
| M6 | Slot values | es-ES `DemoTopic`, `ReactionChoice` and `StorytellerName` canonical values equal en-US; the Spanish synonyms are present |
| M7 | Manifest | es-ES locale present; `examplePhrases` match the generator; `distributionCountries` is `["US","ES"]`; the en-US block is unchanged |
| M8 | Deploy dry run | `pnpm -F @spoken-letter-alexa/skill run deploy --dry-run` passes |

## Batch eligibility

A single unit (one generator file and its outputs). Not batch-eligible.

## Exit

Independent review, repair, simplify, the full local gate and Owner acceptance. After acceptance, delete the local branch `probe/es-es-locale` and its worktree. Its evidence is already recorded in the research document.
