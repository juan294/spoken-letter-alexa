# Phase 4: integration snapshot, fork, issue and pull request (Owner gates)

- Workstream B. Entry condition: Phase 3 accepted. The branch `feat/bedrockagentcore-mcp-protocol-versions` is committed locally in `/Users/juan/code/aws-cdk`.
- Owner gates in this phase, each named when asking:
  1. The integ deploy into account `106403001709` (creates and destroys one CloudFormation stack with one AgentCore gateway).
  2. `gh repo fork aws/aws-cdk --remote` under `juan294`.
  3. Opening one issue.
  4. Pushing the branch to the fork and opening the PR.
- The Owner reviews the issue and PR text before they are published.

## 1. Integration snapshot (D7, stuck state S5)

- Record the time, then run the integ runner for the new test with deploy and snapshot update, using the CONTRIBUTING command form. Use the `archy` profile and `us-east-1`. No `--dry-run`, and no snapshot edited by hand.
- If CloudFormation rejects `2026-07-28` or `2025-11-25`, record the error verbatim. Drop only the rejected constant from the change and from Phase 3's tests and README, re-run Phase 3's checks, record the deviation, and continue.
- Afterwards, `aws cloudformation list-stacks` must show no live stack whose name has the integ test's prefix and was created after the recorded time. If one remains, ask the Owner before deleting it. Delete only that stack.
- Commit the snapshot directory. Amend or add a commit, keeping one logical change.

## 2. Issue

Open one issue on `aws/aws-cdk`, with the Owner's approval of the text. Content:
- Title: `(bedrockagentcore): MCPProtocolVersion is missing 2025-11-25 and 2026-07-28`.
- Body:
  - the current members (upstream `protocol.ts:60-74`);
  - the AgentCore developer guide statement listing four supported versions (URL, retrieved 2026-10-19);
  - the `of()` workaround;
  - a note that a PR follows.

## 3. Pull request

- Fork with `gh repo fork aws/aws-cdk --remote=true`. Push the branch to the fork and enable "allow edits by maintainers".
- Title: `feat(bedrockagentcore): add MCP protocol versions 2025-11-25 and 2026-07-28`. Body: motivation, `Closes #<issue>`, what changed, tests (unit and integ, deployed in our account), README. Follow the repository's PR template, and keep the text short and factual. The Owner reviews the final text before `gh pr create`.
- After opening: read the PR's checks for the exact head SHA. Report failures from the existing logs. Do not rerun them or push repeated fixes without new authorization (AGENTS.md Push Accountability).

## Acceptance

- The integ deploy and destroy succeeded, and the snapshot is committed.
- The issue URL and PR URL are recorded in the notes, with the PR head SHA and its check results (green, or every failure reported).
- No leftover integ stack.
- Notes: a Phase 4 handoff.
