# Phase 5: submission materials (Owner gates)

- Workstreams A and B. Entry condition: Phases 2 and 4 accepted (or Phase 2 accepted and Phase 4 stopped with a recorded reason. In that case only the A items apply, and the Open Source fields stay as they are).
- Repository changes in a worktree off `develop`, for example `docs/submission-oss`. Owner gates: the Devpost edit (outward-facing) and pushing `develop` to `origin`.

## 1. Friction log (`docs/friction-log.md`)

- Correct the `MCPProtocolVersion` note (`docs/friction-log.md:233-234`): the class has an `of(string)` escape hatch. Link the upstream PR. Update the summary row at `docs/friction-log.md:18` to match.
- New dated entry (2026-10-19), "AgentCore Gateway sync reports success before it fails". The format is the same as the existing entries: task, steps, expected, actual, severity, workaround, suggestion. Content:
  - `SynchronizeGatewayTargets` returns `SYNCHRONIZING`, and CloudFormation completes.
  - The target later fails with `GetSecretValue` denied for the caller's role.
  - The L2 grants the secret to the gateway role but not to a sync caller.
  - Evidence: R§1.2.
  - Suggestion: a waiter or an event on sync completion, plus an L2 `grantSync` or synchronization support that includes the secret read.
- Record the Phase 2 outcome (deploy time CEST, `verify:gateway` result, demo playback).

## 2. README

- In the "Amazon tools used" table, or the deploy section, add the `verify:gateway` check. Add a line linking the upstream aws-cdk PR as the project's open-source contribution. Keep the edits short.

## 3. Devpost (Owner gate; browser via Claude in Chrome, project 1245516)

- Show the Owner the exact text diff first. Edit the existing entry; never create a second one.
- Open Source fields:
  - Contribution URL: the aws-cdk PR URL.
  - Project repository URL: `https://github.com/juan294/spoken-letter-alexa`.
  - GitHub username: `juan294`.
  - Description: what was done (two constants, tests, README and a deployed integ test), how it works (the values render into `SupportedVersions` on the gateway's MCP configuration), and why it matters (CDK users can declare the MCP versions the service supports without the untyped `of()` escape hatch, including the version Alexa+ add-ons target). It is an open pull request, and the new repository remains the project itself.
- Friction log field: correct entry 9 to mention `of()`, add the sync entry from step 1, and keep the link to the full log.
- Testing link: unchanged. It works again after Phase 2.

## 4. Integrate and push

- Run the local gate `python3 .rpi/scripts/rpi-verify.py`. Fast-forward into `develop`. If `main` is released in this phase, merge `develop` into `main` (docs only).
- Push `develop` (and `main`, if changed) to `origin` with Owner authorization. Then check the `verify` workflow for the pushed SHA, and report failures without rerunning.
- Update the memory notes `project-devpost-submission` and `project-implementation-status` with the final state.

## Acceptance

- The Devpost entry shows the PR URL in the Open Source fields, confirmed by reading the saved page.
- The friction log and README changes are on `origin/develop`, and CI `verify` is green for that SHA.
- Notes: the final handoff, with every remaining risk.
