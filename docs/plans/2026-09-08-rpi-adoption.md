# Plan: cc-rpi v2 adoption for spoken-letter-alexa

Date: 2026-09-08
Status: Executed in the same session (see "Result" at the end).
Request: `/adopt fully for this project`. Bootstrap answers come from
`docs/plans/2026-09-03-alexa-plus-mcp-add-on-phases/phase-0.md` section 2.
Source: local checkout `/Users/juan/code/cc-rpi` at version 2.0.2, commit `c4ef2ee`.
Target: `/Users/juan/code/spoken-letter-alexa` (local `git init`, no remote, 2 commits).

## 1. Already aligned, preserved as-is

- `CLAUDE.md` starter with the Boundaries block, plan pointers and the five
  non-negotiables (dual-era MCP, child safety, AWS Builder, simplicity, language).
- `docs/plans/` with the main plan plus `phase-0.md` to `phase-8.md`, and
  `docs/research/` with two research documents. Curated artifacts, kept verbatim.
- `.gitignore` with `node_modules/`, `dist/`, `cdk.out/`, `.env*`, `*.pem`, `.DS_Store`.
- `.summon` workspace config (`layout=standard-rpi`), untouched.
- No `<important if>` blocks, no legacy `.claude/commands/`, no v1 sync metadata:
  nothing to migrate, no ownership ambiguity.

## 2. Gaps and choices, by impact

| Priority | Gap | Decision |
| --- | --- | --- |
| HIGH | No `AGENTS.md` (shared facts for Claude and Codex) | Create with verified project facts; engine appends managed RPI blocks |
| HIGH | `CLAUDE.md` mixes shared facts with Claude notes and says "replace via /bootstrap" | Rewrite lean: `@AGENTS.md` import plus Claude-only guidance |
| HIGH | No `.claude/` at all: no skills, rules, hooks, settings | Engine direct install, harness `both`, route `direct` |
| HIGH | No `.rpi/` manifest, policy, scripts | Engine install plus hand-written `.rpi/policy.json` |
| MEDIUM | `.claude/settings.local.json`, `.rpi/local/`, `docs/agents/` not ignored | Add to `.gitignore` (public repo: Rule 70 keeps agent reports local) |
| MEDIUM | No README | Write a short README (title, purpose, status, verification, licence); Phase 0 expands it |
| MEDIUM | No release verification document | `docs/release.md`: Wave A as a checklist, not a gate (phase-0 section 2) |
| LOW | No `docs/decisions/` | Phase 0 creates `0001-dependency-pins.md`; nothing to add now |
| LOW | No pre-commit hook, no CI, no LICENSE, no package.json | Phase 0 deliverables, out of adoption scope |
| SKIP | Scheduled agents, `docs/agents/` | Not used (phase-0 section 2) |
| SKIP | E2E Pro Waves B to H | Simplicity constraint; recorded as N/A in `docs/release.md` |
| OPT-IN | Agent Teams | Left off; new installs do not activate it (native-policy.md) |

## 3. Adaptation conflicts

- **v1 command names in the plan documents.** The plan files say `/bootstrap`,
  `/implement`, `/batch`, `/design`. cc-rpi 2.0.2 direct route installs namespaced
  skills (`/rpi-implement`, `/rpi-plan`, ...) and adds no aliases on new installs.
  The plan copies are not rewritten; `CLAUDE.md` carries the name map.
- **Bootstrap versus adopt.** Phase 0 says `/bootstrap`. The repository already holds
  instructions and curated docs, so `rpi-adopt` is the correct lifecycle workflow.
  Outcome is identical: the same components, selected with phase-0's answers.
- **Managed settings include Vercel entries.** The managed `permissions.ask` and
  `deny` lists mention `vercel`/`vc`. This project deploys with CDK, never Vercel.
  The entries are inert and are kept unchanged to avoid manifest drift.
- **`supabase` rule installs by default.** Rules are not domain-filtered. The rule is
  path-scoped (`supabase/**`, `**/*.sql`, `**/migrations/**`) and inert here.
- **Verification commands exist before the code.** `.rpi/policy.json` declares the
  plan's fixed gate (`pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm -F infra synth`).
  Phase 0 makes them runnable; until then `rpi-verify.py` reports failure, which is the
  truthful state.

## 4. Harness, route, domains, invocation names

- Harnesses: `both` (Claude Code 2.1.263, Codex CLI 0.153.4 verified locally).
- Route: `direct` (conditional domain selection is required; the Claude plugin
  route cannot exclude domains).
- Domains: `ci-workflow`, `deployment-safety`, `error-patterns`, `git-workflow`,
  `github-cli`, `macos-rules`, `multi-agent`, `shell-tools`, `systematic-debugging`,
  `webmcp`. Excluded: `python-rules` (TypeScript project), `supabase` (no Supabase).
  `webmcp` is included because the product is an MCP server with agent-facing tools
  (`packages/mcp-server/src/tools/` matches the rule's `**/tools/**` path).
- Native capabilities allowed: `config:claude-policy` (settings ask/deny plus the
  `guard-bash` and `verify-edit` hooks), `config:codex-hooks`, `resource:codex-permissions`.
- Invocation: Claude `/rpi-research`, `/rpi-plan`, `/rpi-implement`, `/rpi-validate`,
  `/rpi-status`; Codex `$rpi-research` and the native skill picker from `.agents/skills/`.
  Claude keeps native `/simplify`; Codex gets `codex-simplify`.

## 5. Ownership, recovery, verification, completion gates

- Ownership: `.rpi/manifest.json` records every engine-owned path with baseline bytes
  under `.rpi/baselines/`. Project-owned: `AGENTS.md` prose above the managed blocks,
  `CLAUDE.md` above the import block, `.rpi/policy.json`, `docs/**`, `README.md`,
  `.gitignore`.
- Recovery: the applied plan and transaction journal live under `.rpi/local/`
  (gitignored); `rpi-distribution.py rollback --journal` restores.
- Verification: engine `check` and `diagnose` exit 0; `.claude/skills/` and
  `.agents/skills/` list the selected components; `.claude/settings.json` parses;
  hooks are executable; `git status` shows only intended files.
- Completion: local commits only. No push (Owner gate), no remote, no CI.

## Result (2026-09-08)

Applied plan `.rpi/local/plans/2026-09-08-install.json` (status `ready`, 282 operations,
no conflicts, nothing retained). Journal under `.rpi/local/transactions/`.

Verified in this session:

- Engine `check`: `healthy`, exit 0. Engine `diagnose`: exit 0, no config issues, no
  drift, no missing resources. Managed root bytes 6571 of 8192.
- `.claude/skills/` and `.agents/skills/` each list the 16 workflow skills and the 10
  selected domains; Codex additionally has `codex-simplify`. `.claude/rules/` holds the
  four conditional rules; the two universal rules are managed blocks in `AGENTS.md`.
- `.claude/settings.json` parses; `PreToolUse` (guard-bash) and `PostToolUse`
  (verify-edit) are registered. The PreToolUse hook was observed executing live in the
  adopting session. Synthetic events: `ls`, `git status`, `python3` allowed; tag push,
  push to an undocumented remote, dirty-tree pull and `gh pr create` blocked with
  `BLOCKED / WHY / FIX` text. A parallel `pnpm test & pnpm lint` string is not blocked
  by this hook version; sequential verification stays an instruction rule.
- verify-edit exit 0 on `AGENTS.md`, `CLAUDE.md`, `README.md`, `docs/release.md` and
  this file.
- `python3 .rpi/scripts/rpi-verify.py` runs all four declared checks sequentially and
  reports `FAIL: 4 checks` because no `package.json` exists yet. This is the expected
  pre-Phase-0 state; evidence in `.rpi/local/verification.json` (ignored).

Not done, by design: LICENSE, package.json, CI workflow, pre-commit hook (Phase 0
deliverables); no push, no remote.

### Completion pass (same day, Owner asked for 100 percent)

- **Agent Teams enabled.** Owner decision: batch phases (1, 2, 3, 7) need it.
  `.claude/settings.json` gains `env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = "1"`, the
  form documented in cc-rpi `methodology/agent-design.md`. Engine `check` stays healthy
  after the edit (the engine preserves project-owned settings keys).
- **User-scope lifecycle skills installed.** `rpi-adopt`, `rpi-bootstrap`, `rpi-update`,
  `rpi-detach` in `~/.claude/skills/` and `~/.agents/skills/`, state under
  `~/.config/cc-rpi/installations/user`, engine check `healthy`. Future adoptions and
  updates use `/rpi-update` and `/rpi-adopt`, not the v1 commands.
- **v1 user commands preserved.** `~/.claude/commands/{adopt,bootstrap,update,detach}.md`
  are not byte-identical to any revision of cc-rpi `templates/commands/*.md`, so their
  ownership is unproven and the migration guide says preserve. They still work as
  explicit `/adopt`-style invocations but describe the v1 copy-files flow. Deleting them
  is an Owner decision.
- **Codex native discovery verified.** `codex debug prompt-input` from this directory
  renders the model-visible input; it contains the AGENTS.md project facts, the Boundaries
  block, the managed rule map, `.rpi/rules/testing.md`, and the skills `rpi-research`,
  `rpi-implement`, `codex-simplify` and `rpi-adopt`. Hook trust in Codex is granted
  natively on first use and was not exercised.
- **Codex project trust.** `~/.codex/config.toml` trusts `/Users/juan` and several
  siblings but has no entry for this directory yet; Codex asks on first launch here.

Next: `/rpi-implement docs/plans/2026-09-03-alexa-plus-mcp-add-on.md`, Phase 0.
