#!/usr/bin/env node
// Converts take MP3s to the SSML <audio> format (MP3, 48 kbps, 24 kHz, mono) with ffmpeg and
// registers them in fixtures/takes/manifest.json under the script they read (staged demo
// plan D7). A new script needs all four mixes; the same file may stand in for several. A
// registered script (matched ignoring case and punctuation) can replace any of its mixes.
// Usage: node scripts/add-demo-take.mjs --name <slug> --script "<text>" \
//          --plain <mp3> --effects <mp3> --music <mp3> --both <mp3> \
//          [--start <seconds>] [--duration <seconds>] [--spike]
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { findTake, normalizeScript, parseTakesManifest, TAKE_VARIANTS } from "../packages/shared/src/takes.ts";

const fail = (message, code = 2) => {
  console.error(message);
  process.exit(code);
};

const options = {};
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 1) {
  const key = args[i];
  if (key === "--spike") options.spike = true;
  else options[key.replace(/^--/, "")] = args[(i += 1)];
}

const { name, script, start, duration } = options;
if (!name || !/^[a-z0-9_-]+$/.test(name)) fail("--name must be lowercase letters, digits, _ or -");
if (!script?.trim()) fail("--script is required: the text the take reads");
for (const [flag, value] of [["--start", start], ["--duration", duration]]) {
  if (value !== undefined && !(Number(value) >= 0)) fail(`${flag} must be a number of seconds`);
}
const given = TAKE_VARIANTS.filter((variant) => options[variant] !== undefined);
if (given.length === 0) fail("pass at least one of --plain, --effects, --music, --both");
for (const variant of given) if (!existsSync(options[variant])) fail(`missing file for --${variant}: ${options[variant]}`);

const takesDir = path.resolve("fixtures/takes");
const manifestPath = path.join(takesDir, "manifest.json");
const manifest = existsSync(manifestPath) ? parseTakesManifest(JSON.parse(readFileSync(manifestPath, "utf8"))) : { takes: [] };
const existing = findTake(manifest, script);
if (!existing && given.length < TAKE_VARIANTS.length) {
  fail("a new script needs --plain, --effects, --music and --both (the same file may be passed for several)");
}

// One converted file per distinct input, named after the first mix that uses it.
const outputs = new Map();
const files = { ...existing?.files };
for (const variant of given) {
  const input = path.resolve(options[variant]);
  if (!outputs.has(input)) outputs.set(input, `${name}_${variant}.mp3`);
  files[variant] = outputs.get(input);
}

const entry = { script: existing?.script ?? script.trim(), files, ...((options.spike || existing?.spike) && { spike: true }) };
const takes = manifest.takes
  .filter((take) => normalizeScript(take.script) !== normalizeScript(script))
  .map((take) => (options.spike ? { script: take.script, files: take.files } : take));
const next = parseTakesManifest({ takes: [...takes, entry] });

mkdirSync(takesDir, { recursive: true });
for (const [input, file] of outputs) {
  execFileSync("ffmpeg", [
    "-v", "error", "-y",
    ...(start !== undefined ? ["-ss", start] : []),
    "-i", input,
    ...(duration !== undefined ? ["-t", duration] : []),
    "-map_metadata", "-1", "-vn",
    "-codec:a", "libmp3lame", "-b:a", "48k", "-ar", "24000", "-ac", "1",
    path.join(takesDir, file),
  ], { stdio: ["ignore", "ignore", "inherit"] });
}
writeFileSync(manifestPath, `${JSON.stringify(next, null, 2)}\n`);
console.log(`registered ${given.join(", ")} for "${entry.script.slice(0, 60)}" in ${manifestPath}`);
