import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { parseTakesManifest } from "./takes.ts";

const SCRIPT = path.resolve(import.meta.dirname, "../../../scripts/add-demo-take.mjs");
const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0;
if (!hasFfmpeg) console.warn("add-demo-take tests skipped: ffmpeg and ffprobe are not on PATH");

function probe(file: string): Record<string, string> {
  const out = spawnSync("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_name,sample_rate,bit_rate,channels", "-of", "default=noprint_wrappers=1", file], { encoding: "utf8" });
  return Object.fromEntries(out.stdout.trim().split("\n").map((line) => line.split("=") as [string, string]));
}

describe.skipIf(!hasFfmpeg)("add-demo-take.mjs (R7)", () => {
  let cwd: string;
  let source: string;
  const run = (...args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: "utf8" });

  beforeAll(() => {
    cwd = mkdtempSync(path.join(tmpdir(), "sla-add-take-"));
    mkdirSync(path.join(cwd, "in"));
    source = path.join(cwd, "in", "source.mp3");
    // A 44.1 kHz stereo 128 kbps tone: nothing like the SSML audio format.
    const made = spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=6", "-ac", "2", "-ar", "44100", "-b:a", "128k", source]);
    expect(made.status).toBe(0);
  });

  afterAll(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  test("converts to MP3 at 48 kbps, 24000 Hz, mono and registers all four variants", () => {
    const result = run("--name", "owl", "--script", "Once upon a time, an owl.", "--start", "1", "--duration", "3", "--plain", source, "--effects", source, "--music", source, "--both", source, "--spike");
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    const manifest = parseTakesManifest(JSON.parse(readFileSync(path.join(cwd, "fixtures/takes/manifest.json"), "utf8")));
    expect(manifest.takes).toEqual([{ script: "Once upon a time, an owl.", files: { plain: "owl_plain.mp3", effects: "owl_plain.mp3", music: "owl_plain.mp3", both: "owl_plain.mp3" }, spike: true }]);
    const output = path.join(cwd, "fixtures/takes/owl_plain.mp3");
    expect(probe(output)).toEqual({ codec_name: "mp3", sample_rate: "24000", bit_rate: "48000", channels: "1" });
    const seconds = Number(spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", output], { encoding: "utf8" }).stdout);
    expect(seconds).toBeGreaterThan(2.8);
    expect(seconds).toBeLessThan(3.3);
  });

  test("replaces one variant of a registered script and keeps the others", () => {
    const result = run("--name", "owl", "--script", "ONCE upon a time an owl", "--music", source);
    expect(result.status).toBe(0);
    const manifest = parseTakesManifest(JSON.parse(readFileSync(path.join(cwd, "fixtures/takes/manifest.json"), "utf8")));
    expect(manifest.takes[0]?.files).toEqual({ plain: "owl_plain.mp3", effects: "owl_plain.mp3", music: "owl_music.mp3", both: "owl_plain.mp3" });
    expect(manifest.takes[0]?.script).toBe("Once upon a time, an owl.");
  });

  test("refuses a new script without all four variants, leaving the manifest untouched", () => {
    const before = readFileSync(path.join(cwd, "fixtures/takes/manifest.json"), "utf8");
    const result = run("--name", "fox", "--script", "A fox story.", "--plain", source);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/new script needs --plain, --effects, --music and --both/);
    expect(readFileSync(path.join(cwd, "fixtures/takes/manifest.json"), "utf8")).toBe(before);
  });

  test("refuses an unsafe name", () => {
    const result = run("--name", "../owl", "--script", "x", "--plain", source, "--effects", source, "--music", source, "--both", source);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/--name/);
  });
});
