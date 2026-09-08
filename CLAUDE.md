# Claude Code integration

Shared project facts, the Boundaries block, the non-negotiables and the RPI policy live
in `AGENTS.md`, imported below. Read that import completely before acting.

## Native workflow names

This project uses the cc-rpi 2.0.2 direct route. Use the namespaced skills:
`/rpi-research`, `/rpi-plan`, `/rpi-implement`, `/rpi-validate`, `/rpi-status`,
`/rpi-pre-launch`, `/rpi-remediate`, `/rpi-release`. Native `/plan` is a mode, not the
RPI artifact workflow. Claude retains native `/simplify`. Rule bodies with path mappings
load through `.claude/rules/`.

The plan documents under `docs/plans/` predate v2 and use the old names. Map them:

| Plan text | Use |
| --- | --- |
| `/bootstrap` | Done on 2026-09-08 through `rpi-adopt` |
| `/implement <plan>` | `/rpi-implement <plan>` |
| `/batch` | Local worktrees inside `/rpi-implement`; never a mode that publishes PRs |
| `/design` | The design artifacts referenced by the plan live in the private repository |

## Session rules

- Model and effort inherit the session choice unless an explicitly selected supported
  profile overrides them. Invocation visibility is not permission or a sandbox. Native
  hook registration, trust and observed execution are separate.
- The private checkout at `../spoken-letter` is read-only reference; the Boundaries in
  `AGENTS.md` govern every cross-repo action.
- Push, `gh repo create`, and any AWS mutation are Owner gates. Local commits are fine.

<!-- rpi:claude-import:start -->
@AGENTS.md
<!-- rpi:claude-import:end -->
