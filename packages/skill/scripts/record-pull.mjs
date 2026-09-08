#!/usr/bin/env node
// `pnpm -F skill record:pull` (phase-9.md section 3, recording mode). Reads the
// `utterance_recorded` log lines the skill Lambda writes while RECORD_UTTERANCES=1 and
// appends the new phrasings to skill-package/training/en-US.jsonl for the next
// `pnpm -F skill generate`. The Owner reviews the file before committing it; it holds the
// parent's phrasings only (no child speaks on this path) and no transcript is shown to anyone.
//
//   pnpm -F skill record:pull                 # last 7 days
//   pnpm -F skill record:pull --since=24h     # h, d or an ISO timestamp
import { CloudWatchLogsClient, FilterLogEventsCommand } from "@aws-sdk/client-cloudwatch-logs";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, "..");
const LOG_GROUP = "/aws/lambda/sla-alexa-skill";
const file = path.join(pkgRoot, "skill-package/training/en-US.jsonl");

function sinceMs(argument) {
  const value = argument?.split("=")[1] ?? "7d";
  const match = /^(\d+)([hd])$/.exec(value);
  if (match) return Date.now() - Number(match[1]) * (match[2] === "h" ? 3_600_000 : 86_400_000);
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw new Error(`--since must be like 24h, 7d or an ISO timestamp; got ${value}`);
  return parsed;
}

const startTime = sinceMs(process.argv.find((argument) => argument.startsWith("--since=")));
const client = new CloudWatchLogsClient({ region: "us-east-1" });

const existing = new Set(existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line).text) : []);
const found = [];
let nextToken;
do {
  const page = await client.send(new FilterLogEventsCommand({ logGroupName: LOG_GROUP, startTime, filterPattern: '{ $.event = "utterance_recorded" }', nextToken }));
  for (const event of page.events ?? []) {
    try {
      const line = JSON.parse(event.message ?? "");
      if (typeof line.text === "string" && line.text.trim()) found.push({ text: line.text.trim(), locale: line.locale ?? "en-US", at: new Date(event.timestamp ?? Date.now()).toISOString() });
    } catch {
      // Not a JSON line; skip it.
    }
  }
  nextToken = page.nextToken;
} while (nextToken);

const fresh = found.filter((entry) => !existing.has(entry.text) && existing.add(entry.text));
if (fresh.length > 0) {
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, `${fresh.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
}
console.log(JSON.stringify({ event: "utterances_pulled", logGroup: LOG_GROUP, since: new Date(startTime).toISOString(), found: found.length, appended: fresh.length, file: path.relative(pkgRoot, file) }));
if (fresh.length > 0) console.log("Review the file, then: pnpm -F skill generate && pnpm -F skill test");
