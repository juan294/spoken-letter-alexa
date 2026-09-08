# Spoken Letter for Alexa+

Public companion repository to the private Spoken Letter app, built for the Amazon App
Dev 2026 hackathon (Alexa+ track and AWS Builder mini challenge). It will hold a
dual-era MCP server, an OAuth 2.1 authorization server, a simulated Alexa+ experience on
AWS, and the Amazon add-on packaging path, deployed with CDK at `alexa.spokenletter.com`.

Status: repository scaffold only. Phase 0 of the plan adds the monorepo, CI, CDK
skeleton and licence. See `docs/plans/2026-09-03-alexa-plus-mcp-add-on.md`.

## Requirements

- Node.js 24, pnpm
- AWS CLI with the deploy profile (Phase 6 onward)
- Python 3.11 or newer for the cc-rpi lifecycle scripts under `.rpi/`

## Verification

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm -F infra synth
```

The same four commands run as the single `verify` job in CI. The complete local gate is
declared in `.rpi/policy.json` and run by `python3 .rpi/scripts/rpi-verify.py`.

## Working in this repository

Agent workflow follows cc-rpi (Research, Plan, Implement, Validate). Shared project
facts and boundaries are in `AGENTS.md`; Claude Code reads them through `CLAUDE.md`.
Release procedure: `docs/release.md`.

## Licence

MIT. The `LICENSE` file is added in Phase 0.
