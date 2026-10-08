#!/usr/bin/env node
// Pulls a delivered story straight from production into the fixtures, with read-only calls
// under the Owner's gcloud credentials (staged demo plan, phase 2). It replaces the manual
// export in fixtures/README.md.
//
//   node scripts/pull-fixture-story.mjs --list
//   node scripts/pull-fixture-story.mjs <storyDocId> --storyteller "<display name>" [--id st_<slug>]
//   node scripts/pull-fixture-story.mjs <storyDocId> --as-take <script-file> --variant <plain|effects|music|both>[,…] [--name <slug>]
//
// The story read uses a field mask of title, status, mix, icon, delivery time and space only:
// never recipient, sender or content fields (ADR 0013). Only a story the Owner delivered
// (`status == "downloaded"`) with its current final mix (`mixStatus == "ready"`) is pulled.
// Output names only the title and id, so the Owner can check for a child's name.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { registerStory } from "./add-fixture-story.mjs";

const PROJECT = "spoken-letter";
const DOCS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const MEDIA_BUCKET = "gs://spoken-letter-media";
const ADD_DEMO_TAKE = path.join(import.meta.dirname, "add-demo-take.mjs");
const VARIANTS = ["plain", "effects", "music", "both"];

export const STORY_FIELDS = ["title", "status", "finalMixRef", "mixStatus", "iconRef", "downloadedAt", "spaceId"];
const LIST_FIELDS = ["title", "downloadedAt", "finalMixDurationSeconds"];

/** The fixtures/README.md card: the 16×16 icon, hard-edged, on the brand's ink and lamplight ground. */
const ART_RECIPE = (icon) => [
  "-size", "480x480", "radial-gradient:#3A3247-#2E2738",
  "(", "-size", "480x480", "xc:none", "-fill", "rgba(228,164,92,0.30)", "-draw", "circle 240,240 240,110", "-blur", "0x40", ")",
  "-compose", "over", "-composite",
  "(", icon, "-filter", "point", "-resize", "320x320", ")", "-gravity", "center", "-compose", "over", "-composite",
  "-depth", "8", "-strip",
];

/** A Firestore REST value as plain JSON. */
function plain(field) {
  if (!field) return undefined;
  if ("integerValue" in field) return Number(field.integerValue);
  return field.stringValue ?? field.timestampValue ?? field.doubleValue;
}

const firestore = ({ fetch, token }, url, init = {}) => fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers } });

/** `gs://` source for a story's storage ref; anything outside a story folder is refused. */
export function mediaSource(ref) {
  if (!/^spaces\/[A-Za-z0-9_-]+\/stories\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(ref) || ref.split("/").includes("..")) {
    throw new Error(`unexpected storage ref: ${ref}`);
  }
  return `${MEDIA_BUCKET}/${ref}`;
}

/** Delivered stories for the Owner to choose from: id, title, delivery date and duration only. */
export async function listStories(deps) {
  const response = await firestore(deps, `${DOCS}:runQuery`, {
    method: "POST",
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "stories" }],
        where: { fieldFilter: { field: { fieldPath: "status" }, op: "EQUAL", value: { stringValue: "downloaded" } } },
        select: { fields: LIST_FIELDS.map((fieldPath) => ({ fieldPath })) },
      },
    }),
  });
  if (!response.ok) throw new Error(`stories query: HTTP ${response.status}`);
  const rows = await response.json();
  return rows.filter((row) => row.document).map(({ document }) => ({
    id: document.name.split("/").at(-1),
    title: plain(document.fields?.title),
    downloadedAt: plain(document.fields?.downloadedAt),
    durationSeconds: Math.round(plain(document.fields?.finalMixDurationSeconds) ?? 0),
  }));
}

async function deliveredStory(deps, docId) {
  if (!/^[A-Za-z0-9_-]+$/.test(docId)) throw new Error(`not a story id: ${docId}`);
  const mask = STORY_FIELDS.map((field) => `mask.fieldPaths=${field}`).join("&");
  const response = await firestore(deps, `${DOCS}/stories/${docId}?${mask}`);
  if (!response.ok) throw new Error(`story ${docId}: HTTP ${response.status}`);
  const story = Object.fromEntries(Object.entries((await response.json()).fields ?? {}).map(([key, field]) => [key, plain(field)]));
  if (story.status !== "downloaded") throw new Error(`story ${docId}: status is ${story.status}, not downloaded`);
  if (story.mixStatus !== "ready") throw new Error(`story ${docId}: mixStatus is ${story.mixStatus}, not ready`);
  if (!story.finalMixRef) throw new Error(`story ${docId}: no finalMixRef`);
  return story;
}

const slug = (title) => title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48);

/** Pulls the final mix and artwork into fixtures/ under `root` and registers the story. */
export async function pullStory(deps, docId, { storyteller, id }) {
  const { run, probe, root = "." } = deps;
  const story = await deliveredStory(deps, docId);
  const storyId = id ?? `st_${slug(story.title)}`;
  if (!/^[a-z0-9_-]+$/.test(storyId)) throw new Error(`--id must be lowercase letters, digits, _ or -: ${storyId}`);

  const audio = path.join(root, "fixtures/audio", `${storyId}.mp3`);
  mkdirSync(path.dirname(audio), { recursive: true });
  run("gcloud", ["storage", "cp", mediaSource(story.finalMixRef), audio]);
  if (story.iconRef) {
    const scratch = mkdtempSync(path.join(tmpdir(), "sla-icon-"));
    try {
      const icon = path.join(scratch, "icon.png");
      run("gcloud", ["storage", "cp", mediaSource(story.iconRef), icon]);
      const art = path.join(root, "fixtures/art", `${storyId}.png`);
      mkdirSync(path.dirname(art), { recursive: true });
      run("magick", [...ART_RECIPE(icon), `PNG24:${art}`]);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
  registerStory({ root, file: audio, title: story.title, storyteller, deliveredAt: story.downloadedAt, probe });
  return { id: storyId, title: story.title };
}

/** Pulls the story's current final mix as one or more mixes of a demo take (phase 6, plan D3). */
export async function pullTake(deps, docId, { name, scriptFile, variant }) {
  const { run, root = "." } = deps;
  const variants = variant.split(",");
  if (variants.some((each) => !VARIANTS.includes(each))) throw new Error(`--variant must be one of ${VARIANTS.join(", ")} (comma-separated)`);
  const story = await deliveredStory(deps, docId);
  const scratch = mkdtempSync(path.join(tmpdir(), "sla-take-"));
  try {
    const mix = path.join(scratch, "final.mp3");
    run("gcloud", ["storage", "cp", mediaSource(story.finalMixRef), mix]);
    const script = readFileSync(scriptFile, "utf8").trim();
    run(process.execPath, [ADD_DEMO_TAKE, "--name", name ?? slug(story.title), "--script", script, ...variants.flatMap((each) => [`--${each}`, mix])], { cwd: root });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  const option = (flag) => {
    const index = args.indexOf(flag);
    return index === -1 ? undefined : args[index + 1];
  };
  const token = execFileSync("gcloud", ["auth", "print-access-token"], { encoding: "utf8" }).trim();
  const deps = {
    fetch: globalThis.fetch,
    token,
    run: (command, commandArgs, options = {}) => execFileSync(command, commandArgs, { stdio: ["ignore", "ignore", "inherit"], ...options }),
  };
  try {
    if (args[0] === "--list") {
      for (const story of await listStories(deps)) {
        console.log(`${story.id}  ${String(story.downloadedAt).slice(0, 10)}  ${story.durationSeconds}s  ${story.title}`);
      }
    } else if (args[0] && option("--as-take")) {
      await pullTake(deps, args[0], { name: option("--name"), scriptFile: option("--as-take"), variant: option("--variant") ?? "" });
      console.log(`registered the take from ${args[0]}`);
    } else if (args[0] && option("--storyteller")) {
      const { id, title } = await pullStory(deps, args[0], { storyteller: option("--storyteller"), id: option("--id") });
      console.log(`pulled ${id}: "${title}" (check the title and audio for a child's name before committing)`);
    } else {
      console.error("usage: pull-fixture-story.mjs --list | <storyDocId> --storyteller <name> [--id st_<slug>] | <storyDocId> --as-take <script-file> --variant <v>[,…] [--name <slug>]");
      process.exit(2);
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
