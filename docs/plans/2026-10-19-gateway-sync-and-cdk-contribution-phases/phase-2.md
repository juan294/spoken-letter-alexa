# Phase 2: release the gateway fix and confirm demo playback (Owner gates)

- Workstream A. Entry condition: Phase 1 accepted and integrated into `develop`. The tree is clean.
- Owner gates in this phase: `pnpm run deploy` (AWS mutation). Pushing `develop`/`main` to `origin` is optional here and is also gated. Ask once for the whole phase and name each action.

## Steps (docs/release.md A4)

1. Candidate: merge `develop` into `main` locally, then record `git rev-parse main` with a clean tree.
2. Local gate on `main`: `python3 .rpi/scripts/rpi-verify.py`.
3. Read-only preview: `pnpm -F infra exec cdk diff SpokenLetterAlexaGateway --profile archy`. The expected changes are one new IAM policy on the custom resource role and a new physical id for `SynchronizeTarget`. Stop and report anything else, such as a `Gateway` or `GatewayTarget` replacement.
4. Deploy (Owner authorization): `pnpm build`, then `pnpm run deploy` with the context already in `infra/cdk.context.json`.
5. `/healthz` reports the deployed commit, then run `node scripts/verify-deploy.mjs` (`ASSERT_P95=0` from Spain).
6. `pnpm -F infra verify:gateway` exits 0, and the target shows a `lastSynchronizedAt` later than the deploy.
7. Demo check: on `https://alexa.spokenletter.com/demo`, ask for the story about the snail (it has artwork). Confirm that it plays. Read `/aws/lambda/sla-alexa-api` for a `mode:"demo"` turn with `"played":true` and record the line in the notes.

## If step 6 fails (stuck state S1 or S3)

- Record the printed `statusReasons` verbatim.
- If the reason still names `secretsmanager:GetSecretValue` for the custom resource role, check the deployed policy with `aws iam get-role-policy` on that role, then repair locally (back to Phase 1 rules) and ask again before a second deploy.
- If the reason names a different principal or action, stop and report it. Research unresolved question 1 is then answered and the plan needs an amendment.
- Last-resort recovery, with separate Owner authorization: run `synchronize-gateway-targets` under the Owner's admin principal. This restores the demo until the next deploy. Record it as a deviation.

## Acceptance

- Automated: `verify-deploy.mjs` and `verify:gateway` exit 0, with output in the notes.
- Manual: the demo plays a story with artwork, and the log line is recorded.
- Notes: a Phase 2 handoff with the deployed commit, deploy time (CEST), the target's `lastSynchronizedAt` and the evidence above.
