#!/usr/bin/env node
// `pnpm -F skill deploy` (phase-9.md section 4). Owner gate: creates or updates the
// development-stage skill under the Amazon developer account configured with `ask configure`.
//
// 1. Confirms the endpoint ARN in skill-package/skill.json is the SkillStack function
//    (fixed name `sla-alexa-skill`) and that the function exists in the account.
// 2. Runs `ask deploy` (skill manifest and the generated en-US interaction model; the
//    Lambda is CDK-managed, so no skill infrastructure is deployed by ASK).
// 3. Records the skill id in infra/cdk.context.json as `sla:skillId` and asks for one
//    more `pnpm deploy`, which locks the invoke permission to that id; the first run's
//    manifest validation fails until that permission exists, so run this script twice.
//
//   pnpm -F skill deploy            # real run
//   pnpm -F skill deploy --dry-run  # checks only
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, "..");
const repoRoot = path.resolve(pkgRoot, "../..");
const dryRun = process.argv.includes("--dry-run");
const profile = process.env.AWS_PROFILE ?? "archy";
const region = "us-east-1";
const FUNCTION_NAME = "sla-alexa-skill";
const EXPECTED_ARN = `arn:aws:lambda:${region}:106403001709:function:${FUNCTION_NAME}`;

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

const manifestPath = path.join(pkgRoot, "skill-package/skill.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const uri = manifest.manifest?.apis?.custom?.endpoint?.uri;
if (uri !== EXPECTED_ARN) fail(`skill.json endpoint is ${uri}; expected ${EXPECTED_ARN} (SkillStack)`);
console.log(`ok: skill.json endpoint is ${EXPECTED_ARN}`);

const modelPath = path.join(pkgRoot, "skill-package/interactionModels/custom/en-US.json");
if (!existsSync(modelPath)) fail("interaction model missing: run pnpm -F skill generate");
console.log("ok: interaction model present");

const version = spawnSync("ask", ["--version"], { encoding: "utf8" });
if (version.status !== 0) fail("ASK CLI not found: npm i -g ask-cli, then `ask configure` (Owner gate)");
console.log(`ok: ask-cli ${version.stdout.trim()}`);

const fn = spawnSync("aws", ["lambda", "get-function", "--function-name", FUNCTION_NAME, "--region", region, "--profile", profile, "--query", "Configuration.FunctionArn", "--output", "text"], { encoding: "utf8" });
if (fn.status !== 0) fail(`${FUNCTION_NAME} not found in ${region} with profile ${profile}: run pnpm deploy first (SkillStack)`);
if (fn.stdout.trim() !== EXPECTED_ARN) fail(`function ARN is ${fn.stdout.trim()}, expected ${EXPECTED_ARN}`);
console.log("ok: SkillStack function exists");

if (dryRun) {
  console.log("dry run: skipping ask deploy");
  process.exit(0);
}

// On the first run the skill is created but the manifest can fail validation: the Skill
// Management API checks that the Lambda's resource policy already allows
// alexa-appkit.amazon.com, and that permission only exists once sla:skillId is set. The
// skill id is recorded either way so the next `pnpm deploy` adds the permission and a
// second `pnpm -F skill deploy` completes the manifest.
const deploy = spawnSync("ask", ["deploy", "--ignore-hook"], { cwd: pkgRoot, stdio: "inherit" });

const statesPath = path.join(pkgRoot, ".ask/ask-states.json");
if (!existsSync(statesPath)) fail("ask deploy left no .ask/ask-states.json; read the skill id from the developer console and pass -c sla:skillId=<id> to pnpm deploy");
const states = JSON.parse(readFileSync(statesPath, "utf8"));
const skillId = states.profiles?.default?.skillId;
if (typeof skillId !== "string" || !skillId.startsWith("amzn1.ask.skill.")) fail(`no skill id in ${statesPath}`);

const contextPath = path.join(repoRoot, "infra/cdk.context.json");
const context = existsSync(contextPath) ? JSON.parse(readFileSync(contextPath, "utf8")) : {};
const firstTime = context["sla:skillId"] !== skillId;
context["sla:skillId"] = skillId;
writeFileSync(contextPath, `${JSON.stringify(context, null, 2)}\n`);
console.log(JSON.stringify({ event: "skill_deployed", skillId, askExit: deploy.status, context: path.relative(repoRoot, contextPath) }));
if (deploy.status !== 0 || firstTime) {
  console.log("Next: pnpm deploy (SkillStack locks lambda:InvokeFunction to this skill id and sets SKILL_ID), then pnpm -F skill deploy again to finish the manifest.");
  process.exit(deploy.status === 0 ? 0 : 2);
}
console.log("Skill manifest and model deployed. Enable testing in the developer console (Test tab, Development) and use a device on the same account set to en-US.");
