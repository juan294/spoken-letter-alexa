# ADR 0001: Dependency pins

Date: 2026-09-08. Status: accepted. In-major refresh on 2026-10-23 (see the table; held packages carry the reason).

Every dependency is pinned to an exact version. Registry versions were checked with
`npm view <pkg> version` on 2026-09-08. The reasons below are the ones that matter for
the hackathon; everything else follows "latest stable at pin time".

| Package | Version | Reason |
| --- | --- | --- |
| `@modelcontextprotocol/server` | 2.3.1 | The v2 SDK implements the 2026-07-28 spec and, by default (`legacy: 'stateless'`), also answers the 2025-era `initialize` handshake that Alexa+ sends at `protocolVersion: "2025-03-26"`. This is the dual-era requirement from the research (section 5). Never set `legacy: 'reject'`. |
| `@modelcontextprotocol/hono` | 2.0.0 | Hono adapter matching the server package; one Hono app serves `/mcp`, OAuth and the agent API locally and on Lambda. |
| `@modelcontextprotocol/node` | 2.0.0 | Node runtime helpers for the same SDK generation. |
| `@modelcontextprotocol/client` | 2.0.0 | Test-side and agent-side MCP client from the same generation. The plan's fallback (`@modelcontextprotocol/sdk` 1.30.0 for the Strands transport) is only pulled in if Phase 5 hits the type mismatch listed in the risks table. |
| `hono` | 4.13.7 | Held below 4.13.8+: later 4.13.x deprecates `hono/aws-lambda` (`streamHandle`), which fails the `no-deprecated` lint rule until `packages/app/src/lambda.ts` moves to `@hono/aws-lambda`. Works unchanged on Node, Lambda (`hono/aws-lambda`, `RESPONSE_STREAM`) and in tests via `app.request()`. |
| `zod` | 4.6.7 | Latest 4.x. The MCP SDK v2 and the vendored agent-tool contract both use `z.toJSONSchema`, which only exists in zod 4. |
| `@strands-agents/sdk` | 1.16.0 | Held at the plan's version. 1.21.0 depends on `@modelcontextprotocol/client` 2.x, whose version-negotiation probe sends 2026-07-28 without the `MCP-Protocol-Version` header and fails 56 agent and skill tests (checked 2026-10-23). Version named in the plan; the agent loop, `BedrockModel`, `McpClient` and structured output. Its `McpClient` takes an MCP SDK **1.x** transport, which is why `@modelcontextprotocol/sdk` 1.30.0 is pinned next to it (the plan's risk-table fallback, now the normal path). |
| `@modelcontextprotocol/sdk` | 1.32.1 | `StreamableHTTPClientTransport` for the agent's MCP client only; the server stays on v2. |
| `ffmpeg-static` | 5.3.0 | Converts the browser's WebM/Opus utterance to 16 kHz PCM for Transcribe streaming; the only dependency allowed to run a postinstall besides esbuild. |
| `react` / `react-dom` / `@vitejs/plugin-react` / `vite` | 19.3.1 / 19.3.1 / 6.1.2 / 8.3.4 | The simulator SPA. |
| `@testing-library/react` / `jest-dom` / `user-event` / `jsdom` | 16.3.3 / 7.0.1 / 14.6.8 / 30.1.3 | Simulator state-transition tests. |
| `esbuild` (infra) | 0.28.2 | Bundles `packages/app/src/lambda-entry.ts` through the JS API in `infra/scripts/bundle-lambda.mjs` (pnpm's bin shim cannot run esbuild's native binary, so `NodejsFunction` is not used). |
| `@playwright/test` | 1.64.1 | Simulator smoke at 390 and 1280 px against the in-app mock transport. |
| `aws-cdk-lib` / `aws-cdk` | 2.273.0 / 2.1146.0 | Latest 2.x library and CLI at pin time. |
| `constructs` | 10.8.1 | Peer of `aws-cdk-lib`. |
| `@aws-sdk/client-*`, `@aws-sdk/lib-dynamodb` | 3.1153.0 | One version across every AWS SDK v3 client so `aws-sdk-client-mock` mocks line up. |
| `aws-sdk-client-mock` | 4.1.0 | Mocks the DynamoDB document client and KMS in the store and signer tests. |
| `jose` | 6.2.13 | JWT verification (`jwtVerify`, local and remote JWKS) and JWK export/thumbprints. Signing is done by hand over the `Signer` interface so KMS and the local key share one path. |
| `typescript` | 6.0.3 | The plan says TypeScript 6. TypeScript 7 (the native compiler) is published but `typescript-eslint` 8.70 and `tsx` are validated against 6.x; strict, `noUncheckedIndexedAccess`, NodeNext. |
| `typescript-eslint` / `eslint` / `@eslint/js` | 8.72.0 / 10.13.0 / 10.0.1 | ESLint 9-style flat config (ESLint 10 keeps the same flat-config contract) with the strict type-checked preset. |
| `vitest` | 5.0.5 | Root runner with `test.projects` (the `vitest.workspace.ts` file named in the plan was removed in vitest 4; the projects array is the replacement). |
| `tsx` | 4.23.15 | Runs `infra/bin/app.ts` for `cdk synth` and the local dev servers without a build step. |
| `@types/node` | 26.6.5 | Matches Node 24 APIs used (`fetch`, `crypto.subtle`, web streams). |

## Workspace conventions that follow from the pins

- Packages export TypeScript sources directly (`"exports": { ".": "./src/index.ts" }`).
  Vitest, tsx and esbuild consume them as-is; nothing is compiled to `dist/` except the
  Lambda bundle and the simulator SPA. `tsconfig.base.json` sets
  `allowImportingTsExtensions` so imports carry `.ts` extensions, which Node 24's native
  type stripping also accepts.
- pnpm 11 enforces a minimum release age. Packages younger than that window at install
  time are listed under `minimumReleaseAgeExclude` in `pnpm-workspace.yaml`; the list is
  generated by pnpm and reviewed, not hand-edited.
- `esbuild` is the only dependency allowed to run a postinstall script (`allowBuilds`).
