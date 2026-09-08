import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { brand, flattenTokens, resolveToken } from "./index.ts";

// SHA-256 of juan294/spoken-letter `design/tokens.json` at copy time (2026-09-08).
// A change in the source requires re-copying the file and updating this pin (ADR 0002).
const SOURCE_SHA256 = "9c7a6b4323775b699730803bd9897d0e9ed2e867996cf7e6ffa16b7f5ad15a50";

describe("vendored brand tokens", () => {
  test("the token file is byte-identical to the source at copy time", () => {
    const bytes = readFileSync(path.join(import.meta.dirname, "tokens.json"));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(SOURCE_SHA256);
  });

  test("resolves literals and aliases", () => {
    expect(resolveToken("global.color.cream")).toBe("#F7F1E7");
    expect(resolveToken("semantic.color.background")).toBe("#F7F1E7");
    expect(resolveToken("semantic.color.primary")).toBe("#E4A45C");
    expect(() => resolveToken("global.color.nope")).toThrow(/unknown token|no value/);
  });

  test("flattens a set with aliases resolved", () => {
    const colors = flattenTokens("semantic.color");
    expect(colors.background).toBe("#F7F1E7");
    expect(colors["surface-inverse"]).toBe("#2E2738");
    const radii = flattenTokens("global.borderRadius");
    expect(radii.pill).toBe("100px");
  });

  test("the brand shortcuts match the token file", () => {
    expect(brand).toEqual({
      cream: "#F7F1E7",
      eveningInk: "#2E2738",
      lamplight: "#E4A45C",
      clayRose: "#C8826F",
      displayAccent: "#B07A4F",
      fontDisplay: "Newsreader, Georgia, 'Times New Roman', serif",
      fontBody: "Mulish, system-ui, -apple-system, sans-serif",
      fontMono: "ui-monospace, 'SF Mono', Menlo, monospace",
      radiusPill: "100px",
      radiusLg: "24px",
    });
  });
});
