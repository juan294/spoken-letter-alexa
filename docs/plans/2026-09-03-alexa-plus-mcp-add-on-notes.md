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

## Phase 0 review

Independent reviewer (fresh context, read-only) on commit `3ec3628`: APPROVED, no blocker
or major findings. F0-1 (contract header comment), F0-2 (ESLint 10 wording, now D5),
F0-4 (secret test asserts `GenerateSecretString`), F0-5 (denylist reasons pinned) were
applied in the Phase 1 commit. F0-3 (KMS alias `alias/sla-jwt` follows phase-6.md while
phase-0.md calls the key `sla-jwt-signing`; the description carries that name) is
recorded here as the resolution. F0-6 (push, ACM) and F0-7 (Kiro) are Owner gates and D3.

## Phase 1 handoff

Objective: `packages/mcp-server`, dual-era MCP server with three read-only tools, fixture
provider, bearer stub, protocol and latency tests (phase-1.md).

Delivered:

- `src/provider/{types,fixtures}.ts`: the ADR 0013 boundary type, `FixtureProvider`
  (newest first, one-hour audio URL), catalog parser that drops unknown keys.
- `src/tools/{schemas,list,get,suggest,index}.ts`: `TOOL_METADATA` (passes the vendored
  contract), spoken summaries under 300 characters, `resource_link` on
  `get_family_story`, per-subject `SuggestionMemory` ring, tool errors as
  `isError` results with `structuredContent.error` in the plan's failure classes.
- `src/auth.ts` (constant-time dev-token gate, RFC 9728 challenge), `src/server.ts`
  (`createMcpHandler`, legacy default, never `'reject'`), `src/http.ts` (`createApp`),
  `src/local.ts` (`:4310`, static `fixtures/audio`), `src/lambda.ts` (`streamHandle`),
  `src/metrics.ts` (`withLatencyMetric`, EMF envelope when `EMF_NAMESPACE` is set).
- Tests: `provider/fixtures.test.ts`, `tools/index.test.ts`, `protocol.test.ts` (raw
  HTTP fixtures for 2025-03-26, 2025-06-18, 2025-11-25, modern `server/discover` and
  `tools/call`, GET 405, 401 challenge, PRM), `latency.test.ts` (p95 < 250 ms, p99 <
  400 ms, distribution printed).
- `fixtures/README.md`, `scripts/add-fixture-story.mjs`; shared logger gained
  `LOG_LEVEL`.

Checks on the Phase 1 commit (see the log): `pnpm typecheck` pass (3 packages);
`pnpm lint` pass; `pnpm test` pass, 8 files, 57 tests; `pnpm -F infra synth` pass.
TDD: all four new suites ran red (module missing) before implementation; the
`WWW-Authenticate` assertion was narrowed to the `resource_metadata` parameter (D6).

Manual criterion: the local server was started with a scratch catalog (a 2-second
`ffmpeg` tone, not committed) and `curl` returned the three tools' results, the 401
challenge and the MP3 with `content-type: audio/mpeg` (session evidence, 2026-09-08
15:02 local). The Owner's own recordings are still to be added per `fixtures/README.md`.

Next phase entry condition: none for Phase 2 (independent). Phase 4 needs Phase 2's
verifier and the Phase 3 bridge (out of scope here).

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

### D5. ESLint 10 instead of "ESLint 9 flat" (Phase 0)

- Plan said: ESLint 9 flat config.
- Found: ESLint 10.10.0 is current and `typescript-eslint` 8.70 targets it; the flat
  config contract is the same.
- Chose: pin ESLint 10; `AGENTS.md` wording updated.
- Why: routine version correction, recorded per Phase 0 review F0-2.

### D6. `WWW-Authenticate` shape (Phase 1)

- Plan said: the 401 header is exactly `Bearer resource_metadata="..."`.
- Found: the SDK's `bearerAuthChallengeResponse` emits `error="invalid_token"`,
  `error_description` and then `resource_metadata` (RFC 6750 plus RFC 9728).
- Chose: keep the SDK shape; assert the `resource_metadata` parameter and the error code.
- Why: spec-conformant and produced by the same helper Phase 4's `requireBearerAuth`
  uses; hand-building the header would diverge from the SDK for no gain.

### D7. Tool `ctx.http.authInfo` (Phase 1)

- Plan said: `subjectFromAuth(ctx)` reads the bearer from the tool context.
- Found: the v2 SDK exposes pass-through auth under `ctx.http.authInfo`; the subject is
  stored by the gate in `authInfo.extra.subject`.
- Chose: `subjectFromAuth` reads that path; Phase 2's JWT gate writes the same key.
- Why: routine API correction.
