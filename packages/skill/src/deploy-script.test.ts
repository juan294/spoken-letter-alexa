import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { expect, test } from "vitest";

test("the deploy preflight rejects ASK CLI 1 before claiming success", () => {
  const binaries = mkdtempSync(path.join(tmpdir(), "sla-ask-cli-"));
  try {
    writeFileSync(path.join(binaries, "ask"), "#!/bin/sh\nprintf '1.4.2\\n'\n", { mode: 0o755 });
    writeFileSync(path.join(binaries, "aws"), "#!/bin/sh\nprintf 'arn:aws:lambda:us-east-1:106403001709:function:sla-alexa-skill\\n'\n", { mode: 0o755 });
    const result = spawnSync(process.execPath, [path.join(import.meta.dirname, "../scripts/deploy.mjs"), "--dry-run"], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${binaries}:${process.env.PATH ?? ""}` },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/^FAIL: ASK CLI 2\.x required/m);
  } finally {
    rmSync(binaries, { recursive: true, force: true });
  }
});

test("the deploy preflight reports a missing ASK CLI", () => {
  const binaries = mkdtempSync(path.join(tmpdir(), "sla-no-ask-cli-"));
  try {
    const result = spawnSync(process.execPath, [path.join(import.meta.dirname, "../scripts/deploy.mjs"), "--dry-run"], {
      encoding: "utf8",
      env: { ...process.env, PATH: binaries },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/^FAIL: ASK CLI 2\.x required/m);
  } finally {
    rmSync(binaries, { recursive: true, force: true });
  }
});
