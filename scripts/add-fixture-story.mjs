#!/usr/bin/env node
// Appends one entry to fixtures/stories.json, measuring the duration with ffprobe.
// Usage: node scripts/add-fixture-story.mjs fixtures/audio/<id>.mp3 --title "..." \
//          --storyteller "..." --delivered-at 2026-08-30T19:12:00Z
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const [, , file, ...rest] = process.argv;
const options = {};
for (let i = 0; i < rest.length; i += 2) options[rest[i]] = rest[i + 1];
const title = options["--title"];
const storyteller = options["--storyteller"];
const deliveredAt = options["--delivered-at"];

if (!file || !title || !storyteller || !deliveredAt) {
  console.error("usage: add-fixture-story.mjs <mp3> --title <t> --storyteller <s> --delivered-at <iso>");
  process.exit(2);
}
if (!existsSync(file)) {
  console.error(`missing file: ${file}`);
  process.exit(2);
}
const base = path.basename(file);
const id = base.replace(/\.mp3$/, "");
if (!/^[a-z0-9_-]+\.mp3$/.test(base)) {
  console.error("file name must be lowercase letters, digits, _ or -, ending in .mp3");
  process.exit(2);
}
const delivered = new Date(deliveredAt);
if (Number.isNaN(delivered.getTime())) {
  console.error("--delivered-at must be an ISO 8601 timestamp");
  process.exit(2);
}

const seconds = Number(
  execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], {
    encoding: "utf8",
  }).trim(),
);
if (!Number.isFinite(seconds) || seconds <= 0) {
  console.error("ffprobe did not return a duration");
  process.exit(1);
}

const catalogPath = path.resolve("fixtures/stories.json");
const catalog = existsSync(catalogPath) ? JSON.parse(readFileSync(catalogPath, "utf8")) : { stories: [] };
catalog.stories = catalog.stories.filter((story) => story.id !== id);
// Artwork is optional: the entry gains `art` only once fixtures/art/<id>.png exists
// (fixtures/README.md documents how that card is rendered).
const artName = `${id}.png`;
const hasArt = existsSync(path.resolve("fixtures/art", artName));
catalog.stories.push({
  id,
  title,
  storyteller,
  durationSeconds: Math.round(seconds),
  deliveredAt: delivered.toISOString(),
  file: base,
  ...(hasArt ? { art: artName } : {}),
});
writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`added ${id} (${Math.round(seconds)} s${hasArt ? ", with artwork" : ", no artwork"}) to ${catalogPath}`);
