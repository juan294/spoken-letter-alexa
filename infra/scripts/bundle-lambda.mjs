#!/usr/bin/env node
// `pnpm -F infra build` (part of root `pnpm build`): bundle packages/app/src/lambda-entry.ts
// with the esbuild API into infra/dist/lambda, install ffmpeg-static for the Lambda's
// linux/arm64 target next to it, and copy the fixture catalog. ApiStack ships this
// directory as the function asset. Done here rather than through NodejsFunction because
// pnpm's bin shim runs esbuild's native binary through Node, which fails.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as esbuild from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const outDir = path.resolve(here, "../dist/lambda");
const entry = path.join(repoRoot, "packages/app/src/lambda-entry.ts");

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

await esbuild.build({
  entryPoints: [entry],
  outfile: path.join(outDir, "index.mjs"),
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  mainFields: ["module", "main"],
  sourcemap: true,
  minify: false,
  // The ffmpeg binary is installed below for linux/arm64; everything else is inlined.
  external: ["ffmpeg-static"],
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: "warning",
});

// ffmpeg-static downloads the binary for npm_config_platform/arch at install time.
writeFileSync(path.join(outDir, "package.json"), JSON.stringify({ name: "sla-lambda", private: true, type: "module" }, null, 2));
execFileSync("npm", ["install", "--no-save", "--no-package-lock", "--no-audit", "--no-fund", "--omit=dev", "ffmpeg-static@5.3.0"], {
  cwd: outDir,
  stdio: "inherit",
  env: { ...process.env, npm_config_platform: "linux", npm_config_arch: "arm64" },
});

// Phase 9: the classic-skill Lambda (infra/lib/skill-stack.ts), a plain handler with no
// binaries and no fixtures.
const skillOutDir = path.resolve(here, "../dist/skill");
const skillEntry = path.join(repoRoot, "packages/skill/src/lambda.ts");
rmSync(skillOutDir, { recursive: true, force: true });
mkdirSync(skillOutDir, { recursive: true });
await esbuild.build({
  entryPoints: [skillEntry],
  outfile: path.join(skillOutDir, "index.mjs"),
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  mainFields: ["module", "main"],
  sourcemap: true,
  minify: false,
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: "warning",
});
writeFileSync(path.join(skillOutDir, "package.json"), JSON.stringify({ name: "sla-skill-lambda", private: true, type: "module" }, null, 2));

const fixtures = path.join(repoRoot, "fixtures");
mkdirSync(path.join(outDir, "fixtures"), { recursive: true });
if (existsSync(path.join(fixtures, "stories.json"))) cpSync(path.join(fixtures, "stories.json"), path.join(outDir, "fixtures/stories.json"));

console.log(
  JSON.stringify({
    event: "lambda_bundled",
    outDir,
    entry: path.relative(repoRoot, entry),
    ffmpeg: existsSync(path.join(outDir, "node_modules/ffmpeg-static/ffmpeg")),
    skill: { outDir: skillOutDir, entry: path.relative(repoRoot, skillEntry) },
  }),
);
