# ADR 0002: Vendored brand tokens

Date: 2026-09-08. Status: accepted.

## Decision

`packages/shared/src/brand/tokens.json` is a verbatim copy of `design/tokens.json` from
the private Spoken Letter repository (Tokens Studio schema: `global`, `semantic`,
`component` sets). `packages/shared/src/brand/tokens.test.ts` pins the file's SHA-256 to
the value recorded at copy time:

| Copied | Source commit context | SHA-256 |
| --- | --- | --- |
| 2026-09-08 | `../spoken-letter` working tree, `design/tokens.json`, 60 650 bytes | `9c7a6b4323775b699730803bd9897d0e9ed2e867996cf7e6ffa16b7f5ad15a50` |

A change in the source requires re-copying the file and updating the pin in the same
commit. The public repository never edits the copy.

## Why

- The simulated Alexa+ client (Phase 5) is outside the private repository's Tailwind
  pipeline and must still style only through tokens (main plan, "Design system"). The
  copy gives it the atoms; the `Applications` export and `design/CLAUDE.md` give it the
  composition, which is ported by hand.
- The OAuth error page (Phase 2, D8) and any future rendered surface read the same file.
- A hash pin turns silent drift into a failing test.

## How the copy is consumed

- `packages/shared/src/brand/index.ts` exports `resolveToken(path)` (resolves
  `{global.color.cream}` aliases), `flattenTokens(setPath)` and a small `brand` object
  with the colours, fonts and radii the simulator's ink panel needs.
- `packages/simulator/src/styles/theme.css` projects the `global` and `semantic`
  colours, the three font families, the radii and the shadows as CSS variables; a
  parity test in the simulator asserts every variable's value against the token file so
  the projection cannot drift either.
- An ESLint rule copied in spirit from the private repository's `sl-design` rules blocks
  hex, `rgb()`/`oklch()` and literal font names in simulator source.
