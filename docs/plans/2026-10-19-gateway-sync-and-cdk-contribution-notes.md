# Gateway sync repair and aws-cdk contribution: implementation notes

## Entry (2026-10-19)

- The Owner invoked `/rpi-implement` on the plan with "All phases, no stopping. When you're done, merge to develop and prune your tree. Push and release at the end." This authorizes continuation across phase boundaries, the release (`develop` -> `main`, `pnpm run deploy`) and the push. The plan's Owner reviews of the upstream issue/PR text (Phase 4) and of the Devpost diff (Phase 5) stay as review points.
- Base: `develop` `4b756c9` (the plan commit on top of the plan's stated base `37e6c65`), clean tree.
- `graphify_local` failed to connect this session, so structure came from direct reads.

## Deviations

- **Phase 3 disk precondition.** Plan said: stop if `df -h /Users/juan` reports less than 40 GiB available. Found: 14 GiB available (`df`), APFS container free space 22.1 GB (`diskutil info /`), 2026-10-19 05:3x CEST. Chose: the Owner decided "Lean run with guard": a blobless clone, build only what `aws-cdk-lib` needs, and a watcher that stops a heavy step below 5 GiB. Why: Workstream B is the Open Source entry; the guard keeps the machine from filling up. No cache or Docker data is deleted.
- **Phase 1 credential dependency.** Plan said: add `@aws-sdk/credential-provider-node` to `infra` for `defaultProvider`. Found: `@aws-sdk/client-bedrock-agentcore-control` already brings the default chain. Chose: `new BedrockAgentCoreControlClient({ region, profile })` and its `config.credentials` sign the gateway calls and read the secret (`infra/scripts/verify-gateway.ts`). Why: one dependency fewer and a smaller lockfile change.
- **Phase 1 lockfile.** Adding `@aws-sdk/client-bedrock-agentcore-control` 3.1127.0 made pnpm re-resolve shared transitive packages to the versions the other 3.1127.0 clients already use (for example `@aws-sdk/core` 3.977.9 -> 3.978.1, `@smithy/core` 3.33.3 -> 3.35.0, `@aws-sdk/types` 3.974.5 -> 3.974.6). The API Lambda bundle therefore changes on the next deploy. The full local gate (including the Playwright smoke) ran on the new resolution.
- **Phase 1 dependency scope (review F4).** The re-resolution also applies to the runtime clients in the API bundle (DynamoDB, Polly, S3, Transcribe, Bedrock). The Phase 2 deploy therefore ships new API Lambda code (new SDK core patch versions) in addition to the IAM and sync changes. The read-only `cdk diff` confirms it: `SpokenLetterAlexaApi` `Api` code changes, and `SpokenLetterAlexaSimulator` `Fixtures` changes its source zip.
- **Phase 1 hand-written sync statement (simplify, altitude 1).** Plan said: keep the existing `GetWorkloadAccessToken` statement. Chose: keep only `GetWorkloadAccessToken` on the two workload-identity ARNs; `GetResourceOauth2Token` on the token vault moved to `provider.grantUse`, which grants it on `token-vault/default`, `.../oauth2credentialprovider` and the provider ARN (checked in the synthesized template). Why: one owner for the token-vault and secret grants, and no second literal of the provider name.
- **Phase 1 agent import.** `packages/agent/package.json` gains a `./sigv4-fetch` subpath export so the check script does not load the agent runtime barrel (Strands, Polly, Transcribe) or pull it into the infra typecheck.

## Phase 1: grant, sync revision, `verify:gateway` (local)

**Assignment.** Parent-only implementation in worktree `/Users/juan/code/spoken-letter-alexa-gw`, branch `fix/gateway-sync`, base `develop` `4b756c9`. Phase 3 ran in parallel as a separate assignment in `/Users/juan/code/aws-cdk` (no shared files).

**Changes.**
- `infra/lib/gateway-stack.ts`: `provider.grantUse(sync).applyBefore(sync)` (D2); `SYNC_REVISION = 2` in the physical id `${gatewayId}:sync:${bundleHash}:r2` (D3); names from `GATEWAY_NAME` and `TARGET_NAME`.
- `infra/lib/gateway-check.ts` (pure) and `infra/scripts/verify-gateway.ts` (I/O): `pnpm -F infra verify:gateway` (D4). It polls while the target is `SYNCHRONIZING`, `CREATING` or `UPDATING` (5 s, `VERIFY_TIMEOUT_S`, default 120), compares property and `required` paths of every tool's input and output schemas, fails on missing or extra tools and on an empty server list, and prints the status reasons and the recovery command.
- `infra/test/stacks.test.ts`, `infra/test/gateway-check.test.ts`, fixtures `infra/test/fixtures/{gateway,server}-tools-2026-10-19.json` (read-only `tools/list` snapshots taken 2026-10-19 through the gateway with SigV4 and on the public `/mcp` with an m2m token; schemas only).
- `docs/release.md`: `verify:gateway` after Deploy 3 in A3a, in the "After every deploy" paragraph, and in A4 step 5.

**TDD evidence.**
- `stacks.test.ts`: both new tests failed first ("expected [] to have a length of 1"; the physical id lacked `:r2`). A mutation check (revision 1, no `applyBefore`) failed both again, so `applyBefore` is what adds the `DependsOn`.
- `gateway-check.test.ts`: against a stub module, 6 of 7 failed (the READY-ok case passes on a stub by design). The review-driven tests failed first: stale cached tool, empty server list, `CREATING`/`UPDATING`; the NaN-timeout test hung the pre-fix code (unbounded loop), and the run was stopped after 120 s.

**Live, read-only.** `AWS_PROFILE=archy pnpm -F infra verify:gateway` against the current deployment exits 1 with `FAIL: target BL0QFT4T2E is SYNCHRONIZE_UNSUCCESSFUL`, the three missing `artUrl` paths (`outputSchema.properties.artUrl`, `...stories.items.properties.artUrl`, `...story.anyOf[0].properties.artUrl`), the live `GetSecretValue` reason and the recovery command. `VERIFY_TIMEOUT_S=abc` exits 1 with "timeout must be a finite, non-negative number".

**`cdk diff SpokenLetterAlexaGateway --profile archy`** (before simplify; it also uploads templates to the bootstrap bucket for change sets): gateway stack adds `AWS679f53fac002430cb0da5b7982bd2287ServiceRoleDefaultPolicyD28E1A5E` (token vault use and `secretsmanager:GetSecretValue`/`DescribeSecret` on `bedrock-agentcore-identity!*`), changes the `SynchronizeTarget` physical id to `:sync:<hash>:r2` (may be replaced, as on every bundle change) and adds `DependsOn` entries. No `Gateway` or `GatewayTarget` change. Core and Edge: no differences. Api: Lambda code. Simulator: fixtures zip.

**Review (independent, fresh context).** No blocker or major.
- F1 unbounded poll on an invalid `VERIFY_TIMEOUT_S`: resolved (guard plus test).
- F2 `JSON.parse` error could quote the secret: resolved (fixed message).
- F3 stale cached tools and an empty server list passed: resolved (tests).
- F4 lockfile scope: resolved by recording it above.
- F5 only property names and `required` are compared: rejected for this phase; the plan's contract is property sets, and the fixtures show the gateway keeps `anyOf` order.
- F6 uncaught errors and first-frame SSE parsing: resolved (`FAIL:` line, frame chosen by `id`).
- F7 fixed profile and region in the recovery command: resolved in simplify (the script passes its profile and region).
- F8 `CREATING`/`UPDATING` failed at once: resolved (test).
- F9 release doc "after every deploy": resolved.
- F10 stale class docstring: resolved.

**Simplify (four angles: reuse, simplification, efficiency, altitude).** Applied: `./sigv4-fetch` subpath import; gateway URL from `GetGateway`; shared name constants; gateway and server tool lists fetched in parallel; `lastSynchronizedAt` on the target instead of a side variable; `timedOut` removed (derivable); one in-progress predicate; map and set lookups; a poll test helper with `test.each`; the trimmed IAM statement. Skipped: deriving the revision from a hash of the policy (D3 chose an explicit constant); an MCP SDK client for `tools/list` (new infra dependency for a check script); one shared SSE helper across `verify-deploy.mjs`, `e2e-link.mjs` and this script (outside the diff); moving the timeout check into the script (it guards the pure poller's bound); `SyncCheck.ok` removal and stack-test helper refactors (cosmetic).

**Gate.** `python3 .rpi/scripts/rpi-verify.py` in the worktree after simplify: PASS, 5 checks (typecheck, lint, test with 948 tests, cdk-synth, e2e with 8 Playwright tests).

**Integration.** `fix/gateway-sync` fast-forwarded into `develop` at `cf45bc4`. The worktree stays until the end of the run (Phase 5 removes it).

## Phase 2: release and demo playback

- **Authorization.** The Owner's "Push and release" in the entry instruction covers the deploy; the deploy ran in this phase so the later phases build on a working demo.
- **Candidate.** `main` fast-forwarded to `develop` `cf45bc4` (`git rev-parse main` = `cf45bc466e3c7ffe141e26b6c6b8a6b6f16f4a3f`), clean tree. The gate in the primary checkout passed: `python3 .rpi/scripts/rpi-verify.py`, 5 checks.
- **Preview.** `cdk diff --all --profile archy` showed the expected gateway changes: the new default policy on the custom resource role, the trimmed custom resource policy, the `:r2` physical id and the `DependsOn` entries. There was no `Gateway` or `GatewayTarget` change. Lambda code changed in Api, Skill (`Skill`, `NotificationWorker`, `NotificationSender`) and the Simulator fixtures from the SDK patch re-resolution. Core, Edge and Observability showed no differences.
- **Deploy.** `pnpm build`, then `pnpm run deploy --require-approval never` (the IAM widening was reviewed in the preview, and the shell has no TTY for the approval prompt). It ran 2026-10-19 06:15:33 to 06:19:55 CEST, and all seven stacks succeeded (Core, Edge and Observability had no changes).
- **Checks.**
  - `/healthz`: `{"ok":true,"name":"spoken-letter","version":"0.1.0"}`. The body has no commit field.
  - `pnpm -F infra verify:gateway`: exit 0, "target BL0QFT4T2E is READY and the cached tool schemas match the server". `lastSynchronizedAt` is 2026-10-19T04:19:40Z (06:19:40 CEST), later than the deploy start.
  - `node scripts/verify-deploy.mjs` with `M2M_SECRET` and `ASSERT_P95=0`: all checks passed. Latency from Spain: p50 362 ms, p95 530 ms, p99 533 ms (n=20).
- **Demo.** A demo session through the same public endpoints the `/demo` page calls was checked: `POST /agent/session {"mode":"demo"}`, then `POST /agent/turn` "Play the story about the snail". The turn returned "Now playing Ignacio the snail, told by Aunt Whitney." with `play.id` `st_ignacio_the_snail`, an audio URL and `artUrl`. The `/aws/lambda/sla-alexa-api` log line was: `{"time":"2026-10-19T04:20:59.669Z","level":"info","event":"agent_turn","mode":"demo","tools":["spoken-letter___list_family_stories:2236.8ms","spoken-letter___get_family_story:406.3ms"],"played":true,...}`. The browser page itself was not driven; its client calls these endpoints.
- **Stuck states.** S1 and S3 did not occur. The grant alone was enough, which answers research unresolved question 1 for this deployment.
