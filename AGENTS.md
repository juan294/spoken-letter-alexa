# Project: Spoken Letter for Alexa+

Public companion repository to the private `juan294/spoken-letter` app, built for the
Amazon App Dev 2026 hackathon, Alexa+ track and AWS Builder mini challenge.
Deadline: Friday 2026-10-23 12:00 PT. Licence MIT. Add-on locale `en-US`.

It will contain a dual-era MCP server (2026-07-28 spec served with `legacy: 'stateless'`
so Alexa+'s 2025-era client connects), an OAuth 2.1 authorization server (PKCE S256,
client_credentials, RFC 8414 and RFC 9728 metadata, no DCR), a simulated Alexa+ client
on AWS (Strands Agents, Bedrock, Transcribe, Polly), and the Amazon packaging path.
Deployed with CDK at `alexa.spokenletter.com`.

## Boundaries (read first)

- **The private repository is frozen until 2026-09-30 and is out of scope for this repo.**
  Never add `juan294/spoken-letter` as a remote here, never open a PR against it, never
  create this repository as a worktree of it. The private checkout at `../spoken-letter`
  is read-only reference material for this session.
- **Phase 3 is the only cross-repo work.** It runs in a separate session inside
  `../spoken-letter` after the freeze lifts on 2026-10-01. Until then, this repo stubs
  the bridge with fixtures and a mocked endpoint.
- **First push is an Owner gate.** The GitHub repository does not exist yet. Work in
  this local `git init` directory until the Owner says "push"; then
  `gh repo create juan294/spoken-letter-alexa --public --license mit`. It is public from
  the first push (Open Source mini challenge requirement).

## Non-negotiables carried over from the private repository

- **Dual-era MCP.** Alexa+ sends `initialize` with `protocolVersion: "2025-03-26"`; the
  Local Inspector sends `2025-06-18`. Never set `legacy: 'reject'`.
- **Child safety.** No child account, voice, or data on this path. Only stories with
  `status === "downloaded"` (the Owner's deliberate delivery) are exposed. The stored
  Recipient first name never leaves the private repository (ADR 0013). Demo scripts show
  the parent asking Alexa, never a child.
- **AWS Builder.** Every AWS service in the stack does real work, is called in code, and
  is documented in the README and friction log.
- **Simplicity.** One CI workflow (typecheck, lint, test, CDK synth) and one deploy
  command. No release gates.
- **Language.** Submission materials in English; add-on locale `en-US`.

## Plan and research

- Main plan: `docs/plans/2026-09-03-alexa-plus-mcp-add-on.md`; phases in
  `docs/plans/2026-09-03-alexa-plus-mcp-add-on-phases/phase-0.md` to `phase-8.md`.
- Research: `docs/research/2026-09-03-alexa-plus-hackathon-mcp-add-on.md` and
  `docs/research/2026-08-17-alexa-plus-device-playback-integration.md`.
- These are copies. The originals are committed in the private repository on the local
  branch `docs/alexa-plus-plan`. Edit the copies here; sync back after the freeze.
- Adoption record: `docs/plans/2026-09-08-rpi-adoption.md`.
- Implementation notes and deviations:
  `docs/plans/2026-09-03-alexa-plus-mcp-add-on-notes.md` (per-phase handoffs).

## Stack (fixed by the plan, created in Phase 0)

- pnpm workspaces, Node 24, TypeScript 6 (strict, `noUncheckedIndexedAccess`, NodeNext),
  ESLint flat config (ESLint 10, same contract as 9), vitest, AWS CDK (`aws-cdk-lib` 2.x).
- Packages: `packages/mcp-server` (Phase 1), `packages/oauth` (Phase 2),
  `packages/agent` and `packages/simulator` (Phase 5), `packages/app` (composed server and
  entry points, D12), `packages/shared` (Phase 0),
  `infra/` CDK app (Phase 0 skeleton, Phase 6 stacks), `amazon/` packaging (Phase 7),
  `fixtures/audio/` (Phase 1).
- Pinned: `@modelcontextprotocol/server`, `/hono`, `/node` 2.0.0; `hono` 4.x; `zod` 4.x;
  `@strands-agents/sdk` 1.16.0. Reasons go in `docs/decisions/0001-dependency-pins.md`.
- AWS account `106403001709`, region `us-east-1`, CLI profile `archy`, Route53 zone
  `Z066897727OCGC5BEA1V8` (`spokenletter.com.`).

## Verification

The complete local gate, declared in `.rpi/policy.json` and run by
`python3 .rpi/scripts/rpi-verify.py`:

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm -F infra synth
```

Run checks sequentially, never as parallel Bash calls. The same four commands are the
single CI job `verify` in `.github/workflows/verify.yml`.

## Git and deployment topology

- Two branches. `develop` is the default local branch and the integration branch:
  all implementation lands there first. `main` is the production branch; a release is a
  local fast-forward or merge `develop -> main` followed by `pnpm deploy`. No branch
  protection in September (solo, fast iteration); Phase 8 adds one required check,
  `verify`, on `main` before submission. (Owner decision 2026-09-08; the plan's
  single-branch text is superseded.)
- No remote until the Owner says "push". After that: `origin` is
  `github.com/juan294/spoken-letter-alexa`, public from the first push.
- Conventional commits: `feat|fix|test|refactor|chore|docs(scope): description`.
- Deploy is `pnpm deploy` (CDK) from the Owner's machine with profile `archy`. There is
  no deploy from CI in September and no Vercel anywhere in this project. `cdk bootstrap`
  and the first `cdk deploy` happen in Phase 6.
- Release procedure: `docs/release.md` (Wave A checklist, not a gate).

## Documentation locations

- `docs/research/`, `docs/plans/`, `docs/decisions/` are tracked.
- `docs/friction-log.md` and `docs/product-feedback.md` (Phase 0) are hackathon
  deliverables and are tracked.
- `docs/agents/` agent reports stay local (public repository, Rule 70) and are ignored.
- Agent-facing tool design uses `rpi-tool-design` before the first tool-related plan
  change; the tool contract lives in `packages/shared/src/contract/agent-tools.ts`
  (vendored from the private repository).

<!-- rpi:push-accountability:start -->
# Push Accountability

Keep working branches and worktrees local. Finish applicable tests, coverage,
typechecks, lint, build and deployment preflight locally, resolve failures,
and integrate completed work locally into the documented integration branch.
Inspect workflow and deployment triggers before the single authorized push of
that completed branch. Never create Vercel Preview deployments or publish
working branches/PRs for experimentation. If an integration push would create a
Preview, stop before pushing and use only a documented, non-destructive bypass.
Production publication remains separately and explicitly authorized. Read-only
inspection of existing runs and deployments is allowed.

Commit or preserve intended changes before pulling; never pull through a dirty
tree. After an authorized push, inspect every expected workflow for the exact
pushed commit. Diagnose failures from existing logs and reproduce/fix locally.
Report the failed remote result; do not trigger reruns or a fix-and-repush loop.
A new remote action needs authorization after the complete local gates pass.
<!-- rpi:push-accountability:end -->
<!-- rpi:rpi-details:start -->
# RPI Details

## Context Management

- Each RPI phase should be its own conversation.
  Preserve their acceptance boundaries unless the user explicitly authorizes
  continuation; a continuation instruction does not remove verification.
- Use `/clear` between unrelated tasks.
  Use `/compact` when context is heavy but the task continues.
- Handoffs record objective, approved scope, base/current commit and worktree,
  findings, decisions, check evidence and tested identity, deviations, risks and
  next phase. On resume, verify actual files, refs and evidence validity before
  relying on the handoff; compaction never grants new authority.
- Subagents are context control mechanisms --
  they search/read in their window and return only distilled results.
- Research and planning happen against the integration branch.
  Implementation happens in worktrees or temporary branches.

## Rules for All Phases

- Read controlling instructions/contracts and directly mentioned files completely.
  Inspect implementation to the depth needed; reuse valid prior reads.
- In `rpi-research`, document what exists without improvement recommendations.
  Use the separate `rpi-assess` workflow for evaluative research and alternatives.
- Every code reference must include file:line.
- Delegate only useful bounded independent assignments within this phase.
  A narrow task may stay with the parent. State objective, permitted actions,
  owned files, evidence/output, resource budget and terminal condition for each
  assignment. Missing required results remain coverage gaps until resolved.
- Never write documents with placeholder values.
- Exhaust all tools before suggesting manual steps --
  check CLI tools, shell commands, MCP servers, and file tools
  before escalating to the user.

## Rules for Implementation

- Follow the atomic loop:
  implement -> independent review -> repair -> simplify -> verify.
  The native simplify command or Codex helper catches code reuse, quality, and efficiency issues
  that the plan-compliance reviewer does not check.
- Independent batch work stays local, one owner per file set/worktree and one
  integration owner. Never use a batch mode that automatically publishes PRs.
  Keep at most three simultaneous implementers; use fewer when the task or
  available resources do not justify three.
- Run ALL automated verification after each phase.
- Stop after each phase for acceptance unless the user explicitly authorizes
  continuation. Finish all authorized phase work before that gate.
- If a technical discovery invalidates the plan contract, record the adjustment
  and explain the impact before dependent work; ask only for a required new decision.

## Pre-Release Workflow

`rpi-pre-launch` -> `rpi-remediate` -> `rpi-update-docs` -> `rpi-release`

After `rpi-pre-launch`, include a simplify pass for reuse, quality and
efficiency. Track its findings with the other audit results; resolve security
and infrastructure findings through the same review, repair and verification
loop. Preserve all required audit domains regardless of staffing.

Resolve every confirmed actionable finding before acceptance. Reject false
positives with evidence. Strategic findings needing a new architectural decision
receive explicit local dispositions and owner review; external issue creation
requires authorization. Never silently discard a finding.

## Testing Philosophy

Prefer automated verification.
Manual only for: sudo, hardware, new installs, visual-only.
Use deterministic linting/formatting tools. Preserve TDD for behavioral code
changes. Run all required phase/final gates locally, sequentially with failure
aggregation; a later success cannot erase an earlier failure. Reuse evidence
only for unchanged tested inputs, never as a substitute for an invalidated gate.
<!-- rpi:rpi-details:end -->
<!-- rpi:rule-map:start -->
## Conditional rule access

Before acting on a matching task/path, read the installed rule body below.
The installation manifest records the selected components and exact mappings.
This root map applies even when a session starts at the repository root and
later edits a nested directory; it is an instruction contract, not a native
Codex glob loader. Sessions started inside a subproject also read their actual
root-to-current-directory instruction chain. Preserve project-specific overrides.

| Task or path | Required resource | Essential constraint |
| --- | --- | --- |
| Deployment, CI, release or infrastructure configuration | `.rpi/rules/deployment-safety.md` | Local gates first; no Vercel Preview; production needs authorization. |
| SQL, Supabase migrations, schema, data access or database tests | `.rpi/rules/supabase.md` | Reset/test locally; privileges and RLS are distinct; remote targets need authorization. |
| Behavioral changes, tests, fixtures and validation | `.rpi/rules/testing.md` | TDD for behavioral code; every required check must run and pass. |
| WebMCP, MCP tools, tool registration or agent-facing interfaces | `.rpi/rules/webmcp.md` | Validate on the server; isolate unstable browser APIs and test caller recovery. |

If a required component is missing, report the exact missing path and run the
read-only installation check before proceeding with dependent work. Never
invent a successful read or silently treat an incomplete install as healthy.
<!-- rpi:rule-map:end -->
