# Phase 3: aws-cdk change, local (outside this repository)

- Workstream B. Working copy: `/Users/juan/code/aws-cdk`, a new clone of `https://github.com/aws/aws-cdk` (branch `main`). The research looked at HEAD `1f752b6`; record the actual HEAD in the notes. Work on the local branch `feat/bedrockagentcore-mcp-protocol-versions`. `[batch-eligible]` with Phase 1.
- No fork, remote push, issue or PR in this phase. Nothing is installed globally. Use `npx yarn@1.22.22` (the repository pins `yarn@1.22.22` in `packageManager`; `yarn` is not on PATH, and `corepack enable` would change global shims).
- Read first: `CONTRIBUTING.md` (whole), `packages/aws-cdk-lib/aws-bedrockagentcore/lib/gateway/protocol.ts`, the `aws-bedrockagentcore` README section on gateway protocol configuration, `test/agentcore/gateway/gateway-coverage.test.ts` around the `of()` test (`:1292`), and one existing gateway integration test in `packages/@aws-cdk-testing/framework-integ/test/aws-bedrockagentcore/test/agentcore/gateway/`.

## 0. Preconditions

- `df -h /Users/juan` must report at least 40 GiB available. If it does not, stop and report the number. Do not delete caches or Docker data.
- Node 24 is present (`node -v`). Check the Node range in aws-cdk's `package.json` `engines` and record it.

## 1. Clone and build

- `git clone https://github.com/aws/aws-cdk /Users/juan/code/aws-cdk` (full clone; the later fork push needs history).
- `npx yarn@1.22.22 install --frozen-lockfile`, then `npx lerna run build --scope=aws-cdk-lib` (CONTRIBUTING). Run long steps in the background and record the time each took.

## 2. Change (TDD)

Test first in `gateway-coverage.test.ts`, next to the `of()` test:
- `GatewayProtocol.mcp({ supportedVersions: [MCPProtocolVersion.MCP_2025_11_25, MCPProtocolVersion.MCP_2026_07_28] })` renders `ProtocolConfiguration.Mcp.SupportedVersions: ['2025-11-25', '2026-07-28']`.
- The default gateway still renders `['2025-03-26']` (D6 guard). Add this test only if no existing test already asserts the default; otherwise cite that test in the notes.

Then `protocol.ts`:

```
@ MCPProtocolVersion (enum-like class)
pre: members MCP_2025_06_18, MCP_2025_03_26, of(value) as on main (protocol.ts:60-74)
do:
  1. write MCP_2026_07_28 = new MCPProtocolVersion('2026-07-28') with the "latest version" docstring
  2. write MCP_2025_11_25 = new MCPProtocolVersion('2025-11-25')
  3. write MCP_2025_06_18 docstring -> "MCP version 2025-06-18" (no longer the latest)
fx: no default change; no validation added
```

- README: in the gateway protocol section, list the supported constants and show `supportedVersions` with the new ones. Add one sentence that the service fixes supported versions at gateway creation unless the account is enabled for MCP version updates, and link the AgentCore developer guide page `gateway-target-MCPservers.html`. Keep README examples rosetta-compilable.
- Integration test source: a new `integ.gateway-mcp-protocol-versions.ts` in the gateway integ directory. It declares a minimal `Gateway` with `GatewayProtocol.mcp({ supportedVersions: [MCP_2025_11_25, MCP_2026_07_28] })` and IAM auth, inside `IntegTest`. Follow the closest existing gateway integ test for its stack shape and assertions. The snapshot is produced in Phase 4, not here.

## 3. Local checks

- `cd packages/aws-cdk-lib && npx yarn@1.22.22 test aws-bedrockagentcore/test/agentcore/gateway`, using the pattern documented in CONTRIBUTING. Record the exact command used and its result.
- Lint for the package (the CONTRIBUTING lint command) and rosetta: `/bin/bash ./scripts/run-rosetta.sh` (or the narrower documented form).
- Coverage: patch coverage of at least 95% (CONTRIBUTING). Record the number if the tooling reports it locally; otherwise record that Codecov will report it on the PR.
- Commit locally with the title `feat(bedrockagentcore): add MCP protocol versions 2025-11-25 and 2026-07-28`.

## Acceptance

- The new unit test failed before the `protocol.ts` change and passes after it, with both runs recorded.
- Rosetta and lint pass.
- The diff touches only `protocol.ts`, the README, `gateway-coverage.test.ts` and the new integ test file. Record `git diff --stat main` in the notes.
- Notes: a Phase 3 handoff with the aws-cdk HEAD, branch and local commit, build and test timings, and deviations.
- Stop for Owner acceptance before Phase 4.
