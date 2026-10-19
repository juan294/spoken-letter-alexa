# Phase 1: gateway sync grant, re-sync trigger and the post-deploy check (local)

- Workstream A. Worktree off `develop` (base `37e6c65`), for example `../spoken-letter-alexa-gw` on branch `fix/gateway-sync`. `[batch-eligible]` with Phase 3 (no shared files).
- Read first: `infra/lib/gateway-stack.ts` (whole file), `infra/test/stacks.test.ts:240-300`, `docs/release.md` A3a and A4, research R§1.
- TDD: write each test in step order, see it fail, then implement.

## 1. Sync custom resource can read the Identity secret (D2)

Test first (`infra/test/stacks.test.ts`, inside the gateway `describe`): the policy attached to the sync custom resource's role, `AWS679f53fac002430cb0da5b7`, contains `secretsmanager:GetSecretValue` on `arn:aws:secretsmanager:<region>:<account>:secret:bedrock-agentcore-identity!*`. That policy must be a dependency of `Custom::SlaSynchronizeGatewayTarget`, so it exists before the sync runs.

```
@ GatewayStack sync wiring
ctx: aws-cdk-lib 2.268.0 OAuth2CredentialProvider.grantUse, AwsCustomResource
pre: provider and sync constructed as today (gateway-stack.ts:38-53, :94-113)
do:
  1. compute grant = provider.grantUse(sync) (L2 adds token-vault USE perms + secret read)
  2. write grant.applyBefore(sync) (the policy exists before onCreate/onUpdate runs)
  3. keep the existing GetWorkloadAccessToken statement (not covered by grantUse)
fx: one more IAM policy on the singleton CR role; template annotation warning (wildcard secret) as on the gateway role
risk: grantUse also adds CompleteResourceTokenAuth; harmless for client_credentials
```

`AwsCustomResource` implements `iam.IGrantable` in 2.268.0 (`custom-resources/lib/aws-custom-resource/aws-custom-resource.d.ts:386`, `grantPrincipal` at `:396`), so `grantUse(sync)` targets its singleton role.

## 2. Sync re-runs when its permissions change (D3)

Test first: the custom resource's physical id has the form `${gatewayId}:sync:${bundleHash}:r${SYNC_REVISION}`. The test asserts that the `r2` suffix appears in `Create` and `Update`.

- Add `const SYNC_REVISION = 2;` next to the custom resource. The comment says: bump it when the sync's permissions or parameters change, because the bundle hash covers only code changes.
- Append it to `physicalResourceId` (`infra/lib/gateway-stack.ts:92`). The next deploy then calls `SynchronizeGatewayTargets` again, even with an unchanged bundle.

## 3. Post-deploy gateway check (D4)

Files:
- `infra/lib/gateway-check.ts`: pure logic, no I/O.
- `infra/test/gateway-check.test.ts`: unit tests.
- `infra/scripts/verify-gateway.ts`: I/O wrapper.
- `infra/package.json`: script `verify:gateway` (`tsx scripts/verify-gateway.ts`) and dependencies. Pin exact versions that match the existing `@aws-sdk/*` 3.1127.0 family: `@aws-sdk/client-bedrock-agentcore-control`, the credential provider already used by `packages/app` (`defaultProvider`), and `@spoken-letter-alexa/agent` (`workspace:*`) for `createSigV4Fetch`.

```
@ checkGatewaySync(target, gatewayTools, serverTools, prefix) -> { ok, failures[] }
ctx: none (pure)
pre: target = GetGatewayTarget output; tools = tools/list results
do:
  1. validate target.status === READY (else failure with status + every statusReasons entry + recovery command)
  2. lookup each server tool as `${prefix}${name}` in gatewayTools (missing -> failure)
  3. compute property-name sets per object level of inputSchema and outputSchema (properties, required)
  4. emit failure per tool naming each missing/extra property path (e.g. outputSchema.properties.artUrl)
br: no failures -> ok true
```

```
@ verify-gateway.ts (CLI) -> exit 0 | 1
ctx: AWS (profile from env), gateway URL and ids from CloudFormation outputs or the target API, public /mcp, Secrets Manager sla/oauth-clients (m2mSecret, never printed)
do:
  1. lookup gateway + target ids (ListGateways name sla-alexa, ListGatewayTargets name spoken-letter)
  2. retry GetGatewayTarget while SYNCHRONIZING (every 5 s, up to VERIFY_TIMEOUT_S, default 120)
  3. parse tools/list via SigV4 fetch on the gateway; tools/list on the public /mcp with an m2m token
  4. emit checkGatewaySync result; print each failure and the recovery command
fail: still SYNCHRONIZING at the bound -> exit 1 with "still synchronizing after N s" and the rerun command
```

The recovery command printed for S1 and S3 is `aws bedrock-agentcore-control synchronize-gateway-targets --gateway-identifier <id> --target-id-list <id> --profile archy --region us-east-1`, followed by a rerun of `pnpm -F infra verify:gateway`.

Unit tests (`gateway-check.test.ts`). Each test fails before step 3 is implemented:
- `READY` with matching schemas returns `ok`.
- `SYNCHRONIZE_UNSUCCESSFUL` with the live status reason (from R§1.2) returns a failure that contains the reason text and `synchronize-gateway-targets` (S1).
- The cached `get_family_story` schema from R§1.3 (no `artUrl`), compared with a server schema that has `artUrl`, returns a failure that names `outputSchema.properties.artUrl` (S3).
- A missing prefixed tool returns a failure.
- The poll bound (S2): extract the wait loop as a pure helper that takes an injected `getTarget` and clock, and test that it stops at the bound and reports `SYNCHRONIZING`.

## 4. Release step (S4)

- `docs/release.md` A3a: after "Deploy 3", add `pnpm -F infra verify:gateway`. Add one line: CloudFormation reports the sync as complete before the gateway has synchronized, so only this check shows the result.
- `docs/release.md` A4 step 5: add `verify:gateway` to the probes.

## 5. Notes file

Create `docs/plans/2026-10-19-gateway-sync-and-cdk-contribution-notes.md` with a Phase 1 handoff. Record the base and head commits, the worktree, test evidence, any deviations, and the synth diff of `SpokenLetterAlexaGateway` (`pnpm -F infra exec cdk diff SpokenLetterAlexaGateway` is read-only against AWS; run it if credentials are present and record the output).

## Acceptance

- Automated: `python3 .rpi/scripts/rpi-verify.py` passes in the worktree. The new tests failed before their implementation; record the failing run in the notes. `rg -n "verify:gateway" docs/release.md` shows the A3a and A4 lines.
- Review loop: an independent review against this phase, then repair, then `/simplify`, then re-verify.
- Integration: fast-forward `fix/gateway-sync` into `develop` locally. No push.
- Stop for Owner acceptance before Phase 2.
