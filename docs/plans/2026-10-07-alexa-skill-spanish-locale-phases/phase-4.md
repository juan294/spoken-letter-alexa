# Phase 4: Spanish rehearsal and release

Entry: Phase 3 accepted. Revalidate `develop`, the deployed artifact identities (skill and API Lambda code hashes, development model) and the Alexa+ state of the account.

## Local rehearsal (no authorization needed)

Extend `session-recovery.integration.test.ts`'s in-process harness (real handler, real HTTP client, Hono routes, in-memory stores, `ScriptedModel`) with es-ES journeys:

| ID | Journey | Required result |
| --- | --- | --- |
| R1 | Launch → "qué hay de nuevo" → "pon mis historias" → pause → resume → siguiente | All speech Spanish; the playlist token continues; titles verbatim |
| R2 | "vamos a crear una historia" → fallback → "sirenas" → "lee mi borrador" | One receipt with theme mermaids; Spanish outline readback |
| R3 | "quiero una historia sobre el espacio" → sí; reaction prompt → "me encanta" | One wish and one reaction receipt; Spanish confirmations |
| R4 | "envíale una historia a Ana"; "cómo añado créditos" | Handoff and credits help; the name is absent from replies, logs and storage |
| R5 | The same session file run with en-US requests | Byte-identical to the current English journeys |

## Release checklist (each step needs its own Owner authorization)

1. Merge accepted phases into `develop` locally, then into `main` per `docs/release.md`.
2. `pnpm run deploy` (CDK). The API must deploy before or with the skill Lambda (SS4). Read back both Lambda code hashes against the local bundles.
3. `pnpm -F @spoken-letter-alexa/skill run deploy` (`ask deploy`). Read back both locales' models from Amazon and the development enablement (HTTP 204). Discard the ASK CLI's reformatting of `skill.json`.
4. Device acceptance with the office Echo Show 5 in Spanish (Spain) and Alexa+ on, the parent speaking. Run R1–R4 by voice. Record the time, the language of each reply and the matching `skill_turn` lines. Then switch the device to English with Alexa+ off (or use the console simulator) and run "open spoken letter" → "what's new" as the English regression.
5. Record evidence and any deviation in the notes and the friction log.

## Manual acceptance criteria

- Every reply in R1–R4 is Spanish. Any English reply is listed with its source (skill, backend or LLM).
- No child name or raw speech appears in logs.
- The English regression passes unchanged.

## Exit

The Owner accepts the device evidence. The English Alexa+ path remains tracked in case 65226985 and is not closed by this phase.
