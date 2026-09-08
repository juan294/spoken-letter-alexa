# Project: Spoken Letter for Alexa+

Public companion repository to the private `juan294/spoken-letter` app, built for the
Amazon App Dev 2026 hackathon, Alexa+ track and AWS Builder mini challenge.
Deadline: Friday 2026-10-23 12:00 PT.

This file is a starter. Phase 0 of the plan replaces it through `/bootstrap`; keep the
"Boundaries" section verbatim when it does.

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

## Plan

- `docs/plans/2026-09-03-alexa-plus-mcp-add-on.md` (main plan) and
  `docs/plans/2026-09-03-alexa-plus-mcp-add-on-phases/phase-0.md` to `phase-8.md`.
- Research: `docs/research/2026-09-03-alexa-plus-hackathon-mcp-add-on.md`,
  `docs/research/2026-08-17-alexa-plus-device-playback-integration.md`.
- These are copies. The originals are committed in the private repository on the local
  branch `docs/alexa-plus-plan`. Edit the copies here; sync back after the freeze.
- Next step: `/implement docs/plans/2026-09-03-alexa-plus-mcp-add-on.md`, Phase 0.

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
