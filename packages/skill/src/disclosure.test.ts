import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, test } from "vitest";

const README = readFileSync(path.resolve(import.meta.dirname, "../../../README.md"), "utf8");

/** F10 (staged demo plan D2): the repository says which steps of the video are staged. */
test("the README's video section names every staged step", () => {
  const section = README.split("## What the video shows")[1]?.split("\n## ")[0] ?? "";
  expect(section).not.toBe("");
  for (const step of ["Credits", "Listener and saved wish", "Story conversation", "Recording", "Music and sound effects", "Send"]) {
    expect(section).toMatch(new RegExp(`\\| ${step} \\| Staged:`));
  }
  expect(section).toMatch(/\| Creation progress \| Real: .*DynamoDB/);
});
