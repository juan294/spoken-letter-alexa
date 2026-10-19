# Plan: gateway sync repair and the aws-cdk MCP protocol versions contribution

- Date: 2026-10-19. Repository `spoken-letter-alexa`, branch `develop`, base commit `37e6c65` (research commit; tree clean).
- Research: `docs/research/2026-10-19-gateway-sync-and-upstream-contributions.md` (accepted as the baseline; cited as R§n below).
- Deadline: Devpost entry editable until 2026-10-23 12:00 PT (21:00 CEST).
- Phase files: `docs/plans/2026-10-19-gateway-sync-and-cdk-contribution-phases/phase-1.md` to `phase-5.md`.
- Implementation notes (created in Phase 1): `docs/plans/2026-10-19-gateway-sync-and-cdk-contribution-notes.md`.

## Objective

1. **Workstream A (AWS Builder).** The public demo at `alexa.spokenletter.com/demo` plays a story through Bedrock, Strands and AgentCore Gateway again. Future deploys re-synchronize the gateway target, and a failed sync is visible to the person who deploys.
2. **Workstream B (Open Source).** An upstream `aws/aws-cdk` pull request adds `MCP_2025_11_25` and `MCP_2026_07_28` to `MCPProtocolVersion` in `aws-cdk-lib/aws-bedrockagentcore`, with a unit test, a README update and an integration test. The Devpost Open Source fields point at it.

## Decisions (accepted)

| ID | Decision | Source |
| --- | --- | --- |
| D1 | Open Source mini challenge targets one upstream PR to `aws/aws-cdk` ("CDK only"). No Strands PR: #3431 and #4363 already cover it (R§2.1). | Owner, 2026-10-19 |
| D2 | The sync custom resource gets its secret access through the L2's own `provider.grantUse(sync)`, applied before the custom resource runs. This reproduces the gateway service role's grant, including the wildcard `bedrock-agentcore-identity!*` that the L2 uses for a token ARN (R§1.2). A hand-written statement with the live secret ARN is rejected: the suffix `-f64cc41a-qCwtqn` is service-generated and changes if the provider is replaced. | Planning, from `node_modules/.../identity/oauth2-credential-provider.js` `grantUse` |
| D3 | The sync re-runs on any change to its own permissions through a `SYNC_REVISION` constant in the custom resource's physical id, next to the bundle hash (`infra/lib/gateway-stack.ts:92`). A deploy that only changes IAM would otherwise not sync again (R§1.4). | Planning |
| D4 | Sync failure becomes visible through a post-deploy check, `pnpm -F infra verify:gateway`, plus a release step. It reads the target status and compares the gateway's cached tool schemas with the server's. A Provider-framework custom resource that waits for `READY` was rejected for this deadline: it adds a Lambda handler and makes a failed sync roll back the whole stack update. | Planning, trade-off below |
| D5 | The gateway's protocol versions stay at the service default. Supported versions are fixed when the gateway is created unless the account is enabled for version updates (R§2.2). Changing them could replace the gateway and its URL four days before the deadline. | Planning |
| D6 | The CDK change keeps the construct's default (`[MCP_2025_03_26]`, upstream `gateway.ts:454`, `gateway.ts:1027`) unchanged. Only new constants and the "latest" docstring move. The deprecated alpha module is not touched (PR #39313 deprecates it). | Planning |
| D7 | The CDK integration snapshot comes from a real deploy in account `106403001709`, so the PR does not ask maintainers to run it. The deploy also proves that the service accepts both strings, which R§2.3 left open. | Planning; Owner gate at execution |

### Options considered

- Visibility (D4): (a) verify script and release step, about 2 hours, no runtime change, failure shown after deploy. (b) A Provider-framework `isComplete` poller, about 5 hours, failure shown during deploy, with rollback side effects and a new Lambda to test. Chosen: (a). The decisive factor is risk to a live stack this week.
- Grant (D2): `grantUse` (one line, the L2's own scoping) or an explicit statement on the live ARN (exact, but brittle). Chosen: `grantUse`.
- Re-sync (D3): a revision in the physical id (deterministic, tested by synth) or a manual `synchronize-gateway-targets` after every IAM change (relies on someone remembering). Chosen: the revision; manual sync stays as the documented fallback.

## Phases

| Phase | Scope | Owner gate | Target date |
| --- | --- | --- | --- |
| 1 | A: grant, sync revision, `verify:gateway` check, release step, tests (worktree off `develop`) `[batch-eligible]` with Phase 3 | none (local) | 2026-10-19 |
| 2 | A: release `develop` to `main`, deploy, run checks, confirm demo playback | deploy (and push, if wanted) | 2026-10-20 |
| 3 | B: aws-cdk clone, constants, unit test, README, integ test source (outside this repo) `[batch-eligible]` with Phase 1 | none (local) | 2026-10-20 |
| 4 | B: integ deploy and snapshot, fork, issue, PR | integ deploy; fork, issue and PR creation | 2026-10-21 |
| 5 | A+B: friction log, README, Devpost fields, push `develop` | Devpost edit; push | 2026-10-21 to 2026-10-22 |

Phases 1 and 3 share no files or outputs (different repositories). They can run in parallel local worktrees, with this session as the integration owner. Acceptance stays sequential: Phase 2 needs Phase 1, Phase 4 needs Phase 3, and Phase 5 needs Phases 2 and 4. 2026-10-23 is buffer.

## Success criteria

### Automated

- Phase 1: `python3 .rpi/scripts/rpi-verify.py` passes (typecheck, lint, test, CDK synth). New tests in `infra/test/stacks.test.ts` and `infra/test/gateway-check.test.ts` fail before the change and pass after it.
- Phase 2: `pnpm -F infra verify:gateway` exits 0 against the live gateway; `node scripts/verify-deploy.mjs` passes.
- Phase 3: the aws-cdk `aws-bedrockagentcore` gateway unit tests pass, the rosetta README check passes, and lint/`eslint` for the package passes, with output recorded in the notes.
- Phase 4: `integ-runner` deploys and destroys the new integration test, and the snapshot is committed. Upstream CI on the PR is green, or every failure is reported (not rerun).

### Manual

- Phase 2: a story with artwork (`st_ignacio_the_snail` or `st_mauricio_the_bull`) plays on `alexa.spokenletter.com/demo`, and the API log shows `mode:"demo"` with `"played":true`.
- Phase 4: the Owner reviews the PR text before it is published.
- Phase 5: the Owner reviews the Devpost diff before it is saved.

## Stuck states and recovery

| State | Who sees it, and what | How it ends | Proving test |
| --- | --- | --- | --- |
| S1. Target `SYNCHRONIZE_UNSUCCESSFUL` after deploy (for example, the grant is still insufficient; R unresolved question 1) | Demo visitors: no playback. Deployer: `verify:gateway` prints `FAIL`, the status, every `statusReasons` entry, and the manual recovery command | Deployer follows the printed step: read the reason, fix and redeploy, or run the printed `synchronize-gateway-targets` with an admin principal | `gateway-check.test.ts`: an unsuccessful target yields a failure that contains the reasons and the recovery command |
| S2. Target still `SYNCHRONIZING` | Deployer: `verify:gateway` polls (bounded), then prints "still synchronizing after N s" and the rerun command | Rerun the check; it ends at S1 or success | `gateway-check.test.ts`: the poll stops at the bound and reports the state |
| S3. Target `READY` but the cached schemas differ from the server's (the 2026-09-10 drift, R§1.3) | Deployer: `FAIL` naming each tool and the missing or extra output properties | Sync and rerun the check (the printed command) | `gateway-check.test.ts`: the cached schema without `artUrl` against the server schema with `artUrl` yields a failure that names `artUrl` |
| S4. CloudFormation reports the sync custom resource as `UPDATE_COMPLETE` while the async sync fails (R§1.2) | Today nobody sees it. After the change, the deployer is told by the release step | `docs/release.md` A4 includes `verify:gateway` after every deploy | Phase 1 check: `rg -n "verify:gateway" docs/release.md` returns the A3a and A4 lines |
| S5. The integ deploy fails and leaves a stack | Agent and Owner: `integ-runner` exits non-zero | Agent lists the stacks it created (name prefix from the integ test, created after the run started) and asks the Owner before deleting only those | Phase 4 check: `aws cloudformation list-stacks` shows no live stack with the integ prefix after the run |
| S6. Upstream PR not reviewed before the deadline | Judges: an open, unmerged PR | No action needed; the rules accept unmerged PRs (research summary) | Phase 5: the Devpost text says "open pull request" |

## Consumer sweep

The change alters the sync custom resource's permissions and physical id, and adds a script. No shared runtime type, cache format or fixture changes.

- Command: `rg -n "SynchronizeTarget|Custom::SlaSynchronizeGatewayTarget|bundleHash|GetWorkloadAccessToken" infra packages scripts docs/release.md --glob '!**/node_modules/**' --glob '!**/cdk.out/**'`
- `infra/lib/gateway-stack.ts:85-114`: changed in Phase 1.
- `infra/lib/api-stack.ts:42`, `:82` (`bundleHash` producer): read-only use, unchanged.
- `infra/test/stacks.test.ts:284-299`: extended in Phase 1.
- `docs/release.md` A3a and A4: changed in Phase 1.
- `scripts/verify-deploy.mjs`: unchanged. It checks the public server, and the gateway check is a separate script because it needs AWS credentials.
- `packages/agent/src/sigv4-fetch.ts`: reused by the new check, unchanged.

## Out of scope

- A Strands PR or review (D1).
- Changing the live gateway's `supportedVersions` (D5).
- Adopting `MCPProtocolVersion.of(...)` in this repository: it has no effect without D5.
- The `aws-bedrock-agentcore-alpha` module (D6).

## Risks

- The grant alone may not fix the sync (R unresolved question 1). Phase 2 then follows S1. As a last resort, the Owner can run a manual sync with admin credentials, which restores the demo until the next deploy.
- Local resources: `df` reported 13 GiB available on 2026-10-19 05:32 CEST, and the Owner reports 195 GB free (likely including purgeable space). Phase 3 begins with a free-space check and stops if less than 40 GiB is reported available. No cache or Docker data is deleted.
- Building aws-cdk-lib takes a long time (estimated 30 to 90 minutes, inferred). Phase 3 starts early so it is not on the critical path.
- Upstream CI can fail for reasons unrelated to the change. The PR does not need to merge to count.

## Handoff

- Approved scope: this plan, once accepted. The user authorized research and planning on 2026-10-19. Implementation needs `/rpi-implement` on this plan.
- Base: `develop` `37e6c65`, `/Users/juan/code/spoken-letter-alexa`. aws-cdk work happens in `/Users/juan/code/aws-cdk`, a new clone created in Phase 3.
- Owner gates: deploy (Phase 2), integ deploy (Phase 4), fork, issue and PR creation (Phase 4), Devpost edit (Phase 5), and any push.
- Evidence limits: the rejection text for the demo failure was not observed (R§1.3). The service's acceptance of `2025-11-25` and `2026-07-28` is untested until Phase 4.
