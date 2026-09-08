# Implementation notes: Alexa+ MCP add-on

Companion to `2026-09-03-alexa-plus-mcp-add-on.md`. Per-phase handoffs (objective, scope,
candidate, checks, findings, next entry conditions) and the `## Deviations` register.
Curated history: entries are appended, not rewritten.

## Session facts (2026-09-08)

- Request: `/rpi-implement docs/plans/2026-09-03-alexa-plus-mcp-add-on.md`, all phases,
  continuation explicitly authorized by the Owner ("All phases at once. Don't stop").
- Owner decisions during the session: `develop` is the default local and integration
  branch, `main` is production only; all implementation happens in a git worktree on a
  `feat/` branch and is merged into `develop` locally before any push.
- Worktree: `/Users/juan/code/spoken-letter-alexa-implement`, branch
  `feat/alexa-plus-add-on`, base commit `39b0e50` on `develop`.
- Boundaries in force: no push (Owner gate), no AWS mutation (Owner gate), no work in the
  private repository (frozen until 2026-09-30; Phase 3 out of scope here).

## Phase 0 handoff

Objective: repository bootstrap, licence, CI, CDK skeleton, seed docs (phase-0.md).

Delivered (all local, worktree above):

- `LICENSE` (MIT, Juan Gonzalez 2026), root `package.json`, `pnpm-workspace.yaml`,
  `tsconfig.base.json`, `eslint.config.mjs`, `vitest.config.ts`.
- `packages/shared`: `readEnv` (throws with key names only), `log` (JSON lines),
  vendored `contract/agent-tools.ts` with the denylist pinned by value in its test.
- `infra/`: `bin/app.ts`, `lib/core-stack.ts` (DynamoDB `sla-oauth` with TTL on
  `expiresAt`, KMS RSA_2048 `alias/sla-jwt`, Secrets Manager `sla/bridge`),
  `test/core-stack.test.ts`, `cdk.json`.
- `.github/workflows/verify.yml`: one job, four commands, Node 24, no deploy.
- `docs/decisions/0001-dependency-pins.md`, `docs/friction-log.md`,
  `docs/product-feedback.md`, README rewritten.

Checks (candidate: worktree tree at the Phase 0 commit, see the git log):

| Check | Command | Result |
| --- | --- | --- |
| typecheck | `pnpm typecheck` | pass (shared, infra) |
| lint | `pnpm lint` | pass, 0 problems |
| test | `pnpm test` | pass, 4 files, 20 tests |
| synth | `pnpm -F infra synth` | pass, `SpokenLetterAlexaCore.template.json` emitted |

TDD: every suite was run red first (module missing) and then green; see the session's
Phase 0 commit for the paired test and implementation files.

Not done, Owner gates: `gh repo create` and first push; ACM certificate request
(read-only check: no certificate in `us-east-1` under profile `archy` on 2026-09-08).
Not done, unavailable tooling: Kiro Crew (friction log).

Next phase entry condition: none beyond the four green checks. Phase 1 and Phase 2 are
independent and both depend only on Phase 0.

## Deviations

### D1. Branch topology (session, before Phase 0)

- Plan said: one branch, `main`, integration and production.
- Found: Owner instruction mid-session to make `develop` the default local branch and
  to work in worktrees.
- Chose: `develop` = integration, `main` = production, worktree `feat/alexa-plus-add-on`.
  `AGENTS.md`, `docs/release.md`, `.rpi/policy.json` updated in commit `39b0e50`.
- Why: Owner decision.

### D2. `vitest.workspace.ts` (Phase 0)

- Plan said: `vitest.workspace.ts` at the root.
- Found: vitest 5 (pinned) removed workspace files; `test.projects` in `vitest.config.ts`
  is the replacement.
- Chose: root `vitest.config.ts` with `projects: ["packages/*", "infra"]`.
- Why: routine tooling correction, same behaviour.

### D3. Kiro Crew draft (Phase 0)

- Plan said: Kiro Crew generates the first draft of `core-stack.ts` and its test; record
  the session in the friction log.
- Found: no Kiro binary on the machine; not installable from this account.
- Chose: wrote the stack and test by hand from the plan; recorded the absence in the
  friction log and README.
- Why: tool unavailable; the deliverable (stack plus test) does not depend on it.

### D4. Phase 3 (private repository) is out of scope for this run

- Plan said: Phase 3 is batch-eligible alongside 1, 2 and 7.
- Found: `AGENTS.md` Boundaries: the private repository is frozen until 2026-09-30 and
  Phase 3 runs in a separate session inside `../spoken-letter` after 2026-10-01.
- Chose: skip Phase 3 here; Phase 4 stubs the bridge with a mocked endpoint and fixtures.
- Why: repository boundary; not a decision this session can take.
