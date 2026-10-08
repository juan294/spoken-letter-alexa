# Staged demo flow: implementation notes

## Planning handoff (2026-10-08)

**Objective:** the plan at `docs/plans/2026-10-08-alexa-staged-demo-flow.md`.

**Scope:**
- Owner decisions D1–D4 were given in session on 2026-10-08: English only, staged on the skill with disclosure, takes and mixes from the real app, spike first.
- No implementation, deploy or push is authorized.

**Base:** `develop` `c2c8316`, clean tree, worktree `/Users/juan/code/spoken-letter-alexa`.

**Inputs:**
- Jordan's device findings, the former private-repo issues #2256 and #2257, which were deleted there at the Owner's request after a verbatim copy. The copy is local and gitignored: `docs/agents/2026-10-08-jordan-device-issues.md`.
- Amazon docs check (summary in memory `project-demo-recording-strategy`).
- Two read-only search assignments:
  - **Creation flow map.** Objective: map the create path. Permitted: read-only `packages/skill`, `packages/agent`. Output: a file:line report. Result: received.
  - **APL, infra and fixture consumers.** Objective: the APL, infra and fixture consumer sweep. Permitted: read-only. Output: a file:line report. Result: received.
  - Citations were spot-checked by the parent against `c2c8316`.

**Evidence:**
- Throwaway worktree spike, a fourth story by a second storyteller: 717 of 718 tests passed. The only failure was `mock-journeys.test.ts` expecting Mauricio as newest. The worktree and branch were removed.
- No other tests ran for these planning-only files.

**Open items** (none blocks plan acceptance):
- Phase 2 needs the Owner's story picks (from `pull-fixture-story.mjs --list`), with consent and no-child-name confirmations. The MP3s are pulled by script, not exported by hand.
- Phase 6 needs Jordan's script.
- `graphify_local` failed to connect this session, so structure came from direct reads.

**Next:** Owner acceptance of the plan, then Phase 1 authorization.
