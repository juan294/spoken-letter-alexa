# Phase 0 — Repository bootstrap, licence, CI, CDK skeleton, DNS, first push

Public repository `juan294/spoken-letter-alexa`. No product code yet; everything later phases import lives here.

## Design-system note

Strictly non-visual: repository scaffold, CI, infrastructure skeleton, DNS. Zero rendered output. The whole-site mandate in the main plan governs Phases 3 and 5.

## 1. Create the repository (manual gate at push)

- `gh repo create juan294/spoken-letter-alexa --public --license mit --description "Spoken Letter for Alexa+: a dual-era MCP server, OAuth 2.1 authorization server, and simulated Alexa+ experience, built for the Amazon App Dev 2026 hackathon"` runs only after the Owner says "push" in the implementing session. Until then, work in a local directory `~/code/spoken-letter-alexa` with `git init`.
- `LICENSE` is the MIT text with `Copyright (c) 2026 Juan Gonzalez`. GitHub must detect it (Open Source mini challenge and Alexa+ track both check the root licence).
- Default branch `main`. Branch protection: none in September (solo, fast iteration); one `verify` required check is added in Phase 8 before submission so the badge is green.

## 2. cc-rpi bootstrap

Run `/bootstrap` from `~/.claude/commands/bootstrap.md` against the new directory with these answers: type "monorepo (TypeScript, AWS CDK)", name "Spoken Letter for Alexa+", stack as in the main plan. Install the always-on skills and `macos-rules`; copy `rpi-details.md`, `push-accountability.md`, `deployment-safety.md`, `testing.md` rules. `AGENTS.md` for Codex compatibility. Skip E2E Pro Waves C to H (simplicity constraint); adopt Wave A as a checklist in `docs/release.md`, not a gate. Scheduled agents are not used, so `docs/agents/` is not created.

`CLAUDE.md` must carry: the hackathon deadline, the dual-era rule ("never set `legacy: 'reject'`"), the child-safety invariants copied from the private repository (no child data, Owner delivery gate, no Recipient names), the AWS Builder rule ("every AWS service does real work and is documented"), and the pointer to the private repository's research and plan paths.

## 3. Monorepo layout (pnpm workspaces, Node 24, TypeScript 6, ESLint 9 flat, vitest)

```
package.json            workspaces: packages/*, infra ; scripts: typecheck, lint, test, synth, deploy, dev
pnpm-workspace.yaml
tsconfig.base.json      strict, noUncheckedIndexedAccess, module NodeNext
eslint.config.mjs
vitest.workspace.ts
packages/
  mcp-server/           Phase 1
  oauth/                Phase 2
  agent/                Phase 5
  simulator/            Phase 5
  shared/               Phase 0: logger, env parsing, contract rules, brand tokens (Phase 5 adds tokens)
infra/                  CDK app, Phase 0 skeleton, Phase 6 stacks
amazon/                 Phase 7
docs/                   research/, plans/, decisions/, friction-log.md, product-feedback.md, release.md
fixtures/audio/         Phase 1 (Juan's samples)
```

Pinned dependencies (exact versions, verified on npm 2026-09-03): `@modelcontextprotocol/server` 2.0.0, `@modelcontextprotocol/hono` 2.0.0, `@modelcontextprotocol/node` 2.0.0, `hono` latest 4.x, `zod` 4.x, `@strands-agents/sdk` 1.16.0, `aws-cdk-lib` latest 2.x, `@aws-sdk/client-*` 3.x. Record each in `docs/decisions/0001-dependency-pins.md` with the reason (dual-era support, Amazon client facts).

## 4. `packages/shared`

```ts
// src/env.ts — one parser per package uses this
export function readEnv<T extends Record<string, z.ZodTypeAny>>(shape: T): z.infer<z.ZodObject<T>>
// throws at startup with the missing key names; never logs values

// src/logger.ts — JSON lines to stdout; CloudWatch picks them up unchanged
export const log = { info(event: string, fields?: object), warn(...), error(...) }

// src/contract/agent-tools.ts — vendored from spoken-letter src/lib/agent-tools/contract.ts
export const AGENT_TOOL_BUDGETS = { name: 30, description: 500, parameterDescription: 150, output: 1500 }
export const CLASS_C_DENYLIST = [...]  // same 20 fragments
export function assertAgentToolMetadata(tool, label): string[]
// src/contract/agent-tools.test.ts pins the denylist to the private repo's list by value
```

## 5. CI: `.github/workflows/verify.yml`

One job `verify` on push and pull_request: pnpm install with frozen lockfile, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm -F infra synth`. Node 24. No deploy from CI in September (deploy is `pnpm deploy` from the Owner's machine with profile `archy`); Phase 8 may add a manual `workflow_dispatch` deploy if it costs under an hour.

## 6. CDK skeleton (`infra/`)

```ts
// infra/bin/app.ts
const app = new cdk.App();
new CoreStack(app, "SpokenLetterAlexaCore", { env: { account: "106403001709", region: "us-east-1" } });
// Phase 6 adds ApiStack, SimulatorStack, GatewayStack, ObservabilityStack

// infra/lib/core-stack.ts (Phase 0 content)
//   DynamoDB table `sla-oauth` (pk, sk, ttl attribute `expiresAt`, on-demand)
//   KMS key `sla-jwt-signing` (RSA_2048, SIGN_VERIFY)
//   Secrets Manager secret `sla/bridge` (placeholder value, rotated by hand in Phase 4)
```

`pnpm -F infra synth` must pass in CI. `cdk bootstrap` and the first `cdk deploy` of `CoreStack` happen in Phase 6, not here.

Kiro Crew: use it to generate the first draft of `infra/lib/core-stack.ts` and the CDK test (`infra/test/core-stack.test.ts` with `Template.fromStack` assertions). Record the session, the prompt, what it got right, and what was corrected in `docs/friction-log.md` under "Kiro Crew".

## 7. DNS and certificate (manual, `archy` profile)

- Route53 zone `Z066897727OCGC5BEA1V8` (`spokenletter.com.`), verified in account `106403001709`.
- `aws acm request-certificate --domain-name alexa.spokenletter.com --validation-method DNS --region us-east-1 --profile archy`, then add the validation CNAME. Region must be us-east-1 for CloudFront.
- No A/AAAA record yet; Phase 6's CDK creates the alias to the CloudFront distribution. Note the certificate ARN in `infra/cdk.context.json`.

## 8. Docs seeded

- `README.md`: name, one paragraph, architecture diagram from the main plan, "Amazon tools used" table (filled per phase), quick start, licence.
- `docs/friction-log.md`: dated entries from day one; first entries are the research findings (partner-only toolkit, US-only, en-US-only, undocumented audio playback, private CLI registry).
- `docs/product-feedback.md`: skeleton with one section per Amazon tool, API, or SDK used.

## Success criteria

Automated:
- `pnpm install && pnpm typecheck && pnpm lint && pnpm test && pnpm -F infra synth` green locally and in CI.
- `packages/shared/src/contract/agent-tools.test.ts` passes and pins the denylist.

Manual:
- Owner has said "push"; repository is public with the MIT licence detected on GitHub.
- ACM certificate for `alexa.spokenletter.com` is `ISSUED`.
- Kiro Crew session recorded in the friction log.
