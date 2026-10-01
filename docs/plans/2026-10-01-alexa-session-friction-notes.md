# Alexa session friction handoff

## Planning state, 2026-10-01

The Owner authorized planning after a read-only September 30 session review. The plan and three phase files were written on `develop` in `/Users/juan/code/spoken-letter-alexa`, source baseline `be03dd1a7ca82368a8e45a5b7b472649a5ae49fd`. No implementation branch/worktree, code edit, commit, push, model publication, deployment, notification send, or private-repository change was performed for this planning task.

F1–F4 cover contextual recognition/recovery and prompt consistency. F5 covers safe presence/result diagnostics. F6 records successful playback and sparse latency observations with no speculative optimization. The selected design adds a custom bare-topic intent while retaining phrase-slot carriers; it preserves only validated session state and keeps raw values out of logs. The public MCP and agent route contracts remain unchanged.

The primary live evidence came from CloudWatch logs and the fetched deployed skill source map, with the AWS artifact identity recorded in the main plan. Logs show four fallbacks among nine intent requests, two immediate creation starts with no draft backend request, one listing, and one confirmed playback start. Missing-theme behavior is an inference; redacted null slot values cannot establish it. Exact failed speech and spoken replies are unavailable. Owner-recalled wording is optional additional regression input, not a prerequisite for the known fixes.

Graphify was queried through the repository's own graph using its read-only CLI because the MCP query tool was not exposed. Direct reads confirmed relevant behavior and the consumer list. Amazon primary documentation was checked for phrase-slot restrictions, custom slot validation, session attributes, and reprompts. Prior implementation notes establish that raw speech suppression is deliberate; new diagnostics must preserve it.

Planning artifacts require link/path and diff validation only. Product gates were not run and no product outcome is claimed. The next action is Owner review of [the main plan](2026-10-01-alexa-session-friction.md), followed by explicit implementation authorization. Phase 1 starts only after revalidating actual refs/files. Per-phase stops apply unless the Owner explicitly grants continuation; external actions retain separate authorization boundaries.

## Authorization and implementation entry

The Owner invoked `/rpi-implement` on this plan, then authorized all phases without intermediate stops, local merge into `develop`, and task worktree pruning. External publication and device operations keep the separate boundaries in Phase 3. Entry verified `develop` at `be03dd1a7ca82368a8e45a5b7b472649a5ae49fd`; only the untracked planning artifacts belonged to this task. Their originals remain preserved in the integration checkout until byte comparison at merge. Worktree: `/Users/juan/code/spoken-letter-alexa-session-friction`, branch `fix/alexa-session-friction`. No private checkout is modified.

Graphify's read-only CLI queried the repository's own `graphify-out` link before source tracing; the MCP tool is unavailable. The structural result located the handler, model, client, routes, and observability consumers. Current source reads confirmed the baseline.

## Phase 1 implementation

F1–F4 are repaired locally. `ThemeChoiceIntent` uses the distinct custom `drafttheme` slot; supported explicit-start paraphrases retain SearchQuery carriers. Draft entry is gated; fallback never writes; validated state survives contextual recovery. Returned state contains only allowed fields, canonical wish data, and the bounded fallback counter. Fixed error copy distinguishes unsupported themes, backend unavailability, and the draft limit. Explicit task switches and cancellation clear obsolete state.

Red tests: the initial focused run had 20 failures and 85 passes; repaired handler/model tests reached 111 passes before the final wish-carrier repair. Further review regressions failed before their fixes. Four executed mutations were killed: removing draft gating, dropping recovery attributes, restoring the playback reprompt, and writing on fallback. Exact operational logs are retained locally outside tracked deliverables.

Independent reviewer `review_phase1` found wish-entry reprompt gaps, a bare-reaction prompt/model mismatch, invalid-wish restart guidance, and missing explicit-start/reopen/handoff/counter-reset coverage. All were repaired. Re-review identified the missing-topic wish's bare-theme command as unusable without wish state; it now gives the full supported wish-start carrier. These changes preserve the shared wish vocabulary and public contracts.

The required `codex-simplify` pass inspected reuse (shared question/recovery helpers), quality (state reconstruction and fixed copy), and efficiency (bounded state and catalog lookups). No additional refactor was justified. The first full gate passed all five checks, but subsequent review repairs invalidate that candidate's receipt; the final Phase 1 gate must pass before Phase 2 entry. Amazon routing and Echo behavior remain UNVERIFIED.

## Deviations

- Plan said reaction guidance uses like/love/no. Found the interaction model declares reaction carrier phrases, with no bare like/love sample. Chose supported “I like it”/“I love it”/“no” reprompts, preserving recognition scope and avoiding a second prompt/model mismatch.
- Plan said matching wish reprompts. Found a missing-topic wish has no validated confirmation state, so a bare-topic reply cannot continue it. Chose a complete supported wish-start command until canonical wish state exists.

Phase 1 final-gate attempt on `241f7c807c1f4e0e07899317c605471210dcf0ea` retained failures: lint rejected an untyped mock-call read, and an existing wish-copy regression required the theme question. Both were repaired by explicit call assertions and retaining the question followed by the usable wish-start command. Typecheck, synth, and all eight E2E cases passed in that attempt; the aggregate result remains failed and its receipt is retained.
