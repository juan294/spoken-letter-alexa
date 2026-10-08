# Phase 4: real conversation and script

**Entry.** Phase 3 is accepted. Revalidate `develop`, `packages/agent/src/demo-drafts.ts:138-150` (the Strands pattern), `packages/app/src/bootstrap.ts:87`, `packages/skill/src/progressive.ts` and the Phase 3 modules. Work in a worktree off `develop`.

**Outcome.** In the `conversation` stage, Bedrock asks up to three short follow-up questions about characters, place and details, then says it's ready. Bedrock then writes a script within the fixture's word budget. The script is shown on screen and read aloud. The adult can give feedback ("make it a little shorter", "add a dragon"), which Bedrock applies, or approve it. Outputs are cached per D6.

## Implementation

1. **Agent: `POST /agent/demo/create/turn`** `{answer}`.
   - Append the answer to `notes` (at most 6 notes, each at most 300 characters).
   - Call a Strands `Agent` with structured output `{question?: string (≤ 160 chars), ready: boolean}` and a system prompt. The prompt says: one gentle question at a time; no real-world personal data; at most three questions; `ready` when there is enough for a short bedtime story for the named listener. Only the listener's fixture first name is given to the model.
   - Cache by `gen_<sha256("turn" + normalized notes)>`.
   - **Fallback (SS3):** the fixed question list, by note count.
2. **Agent: `POST /agent/demo/create/script`** `{feedback?}`.
   - Structured output `{title (≤ 60 chars), script}`. The script must stay within `scriptWords` ± 15%; enforce this after generation and retry once with the count stated.
   - Input: notes, the listener's first name, the previous script and the feedback.
   - Cache by `gen_<sha256("script" + normalized notes + feedback chain)>`. Store `script`, `title` and an incremented `scriptVersion` on the record, with stage `script`.
   - Keep `maxTokens` at 600 (`bootstrap.ts:87`). A 70-word script fits.
3. **Generation cache** `gen_*` in `sla-demo-state`, 30-day TTL, storing only the output. Use GetItem before the model call and PutItem after.
4. **Skill:**
   - **Conversation stage:** route any answer to `/create/turn`. That covers `CatchAllIntent` text, `ThemeIntent`, `ThemeChoiceIntent` and the new `StoryDetailIntent` (`AMAZON.SearchQuery` `detail`, with carrier phrases such as "it's about {detail}", "there's a {detail}", "make it {detail}", "she is {detail}", "he is {detail}", "the {detail}", "a {detail}", "i want {detail}"). Speak the returned question; on `ready`, go straight to `/create/script`.
   - **Script stage:** render `apl/script.json` (title, a scrollable script, hint chips "Make it shorter", "Sounds good") and read the script aloud. `ScriptFeedbackIntent` ("make it {feedback}", "can you make it {feedback}", "add {feedback}", "change {feedback}") calls `/create/script` with the feedback. "Sounds good", "that's perfect" or `AMAZON.YesIntent` approve, and the stage becomes `recording`, with the prompt "Say 'record story' when you're ready to record, and 'Alexa, the end' when you finish."
   - Use `scheduleProgressiveResponse` ("Writing your script…") for the script call. The script call keeps the 7-second budget; on timeout, SS4.
5. **Carrier collision:** add the new carriers to `assertNoCarrierCollision` (`generate.ts:204`) checks against `PlayStoryIntent` samples.

```text
@ scriptRoute(device, feedback?) -> {title, script, scriptVersion}
ctx: Bedrock via Strands, creation store, generation cache
pre: record.stage in {conversation(ready), script}
do:
  1. compute cache key from normalized notes + feedback chain
  2. lookup cache; on miss invoke model with structured output
  3. validate word budget; retry once on violation
  4. write cache (output only) and record(stage=script, version+1)
fail: model error/timeout -> 503 create_script_failed (skill speaks SS4)
risk: ASR variation changes the key -> new script; rehearsal must use filming lines
```

## Behavioral oracles

Write failing tests first. Use `ScriptedModel` from `packages/agent/src/test-support.ts` for model responses.

| ID | Case | Required result |
| --- | --- | --- |
| G1 | Three answers, the model asks two questions then `ready` | The questions are spoken in order; the script is produced after `ready`; stage `script` |
| G2 | The same notes twice (two devices) | The second run makes no model call (cache hit) and gets the identical script |
| G3 | Feedback "a little shorter" | The model receives the previous script and the feedback; `scriptVersion` 2; the new script is shown and read |
| G4 | The model returns 120 words for a 70-word budget | One retry; if still over, the script is trimmed at a sentence boundary under budget + 15% |
| G5 | The model throws in a turn | The fixed question for that note count; the stage advances (SS3) |
| G6 | The model throws or times out in the script call | SS4 line; the prior script stays; "try again" succeeds |
| G7 | Two `FallbackIntent`s in `conversation` | Escalating example lines (SS8) |
| G8 | Approve | Stage `recording` and the record prompt |
| G9 | Privacy | Logs contain no answer, note, script or name text (log capture asserts); the cache item has no input fields |
| G10 | Generator | The new carriers pass the collision check and the denylist test; es-ES byte-identical |

## Batch eligibility

- Unit A `[batch-eligible]`: steps 1–3 (`packages/agent`).
- Unit B `[batch-eligible]`: steps 4–5 (`packages/skill`, generator). It works against the shared schemas and a fake client.

## Exit

Independent review, repair, simplify and the full local gate. The Owner reviews the prompts and copy. Run one local rehearsal against real Bedrock (`pnpm dev` with profile `archy`; read-only model invocation only) and record the script output in local `docs/agents/` without names.
