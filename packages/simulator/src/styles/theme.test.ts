// Parity between `theme.css` and the vendored token file (ADR 0002). Every CSS custom
// property declared in theme.css must map to exactly one token and carry its resolved
// value, and every token in the projected sets must be present, so the projection can
// drift in neither direction.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { flattenTokens, resolveToken } from "@spoken-letter-alexa/shared/brand";
import { describe, expect, it } from "vitest";

const stylesDir = import.meta.dirname;
const themeCss = readFileSync(join(stylesDir, "theme.css"), "utf8");

/** `--name: value;` pairs inside a stylesheet (comments stripped). */
function cssVariables(css: string): Map<string, string> {
  const out = new Map<string, string>();
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const match of stripped.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    out.set(match[1]!, match[2]!.trim());
  }
  return out;
}

/** The projection contract: CSS variable name -> token path. */
function expectedVariables(): Map<string, string> {
  const expected = new Map<string, string>();
  const add = (name: string, path: string) => {
    const previous = expected.get(name);
    if (previous && resolveToken(previous) !== resolveToken(path)) {
      throw new Error(`variable ${name} maps to ${previous} and ${path} with different values`);
    }
    expected.set(name, previous ?? path);
  };
  const set = (setPath: string, prefix: string) => {
    for (const key of Object.keys(flattenTokens(setPath))) add(`${prefix}${key.replaceAll(".", "-")}`, `${setPath}.${key}`);
  };
  set("global.color", "--");
  set("semantic.color", "--");
  add("--font-heading", "semantic.typography.heading");
  add("--font-sans", "semantic.typography.body");
  add("--font-mono", "semantic.typography.mono");
  set("global.fontSizes", "--text-");
  set("global.fontWeights", "--weight-");
  set("global.letterSpacing", "--tracking-");
  set("global.borderRadius", "--radius-");
  add("--radius", "global.borderRadius.pill");
  set("global.boxShadow", "--shadow-");
  set("global.spacing", "--space-");
  set("component.nowPlaying", "--now-playing-");
  set("component.voiceIdeation", "--voice-");
  return expected;
}

describe("theme.css projects the vendored tokens", () => {
  const declared = cssVariables(themeCss);
  const expected = expectedVariables();

  it("declares the core variables", () => {
    for (const name of ["--cream", "--evening-ink", "--lamplight", "--font-heading", "--radius", "--shadow-panel"]) {
      expect(declared.has(name), name).toBe(true);
    }
  });

  it("gives every declared variable the value of its token", () => {
    for (const [name, value] of declared) {
      const path = expected.get(name);
      expect(path, `${name} is not a projected token`).toBeDefined();
      expect(value, name).toBe(resolveToken(path!));
    }
  });

  it("projects every token of the covered sets", () => {
    const missing = [...expected.keys()].filter((name) => !declared.has(name));
    expect(missing).toEqual([]);
  });

  it("keeps the pill radius as the default radius", () => {
    expect(declared.get("--radius")).toBe("100px");
  });
});

describe("component stylesheets carry no literal colours, fonts or micro type", () => {
  const cssFiles = readdirSync(stylesDir)
    .filter((file) => file.endsWith(".css") && file !== "theme.css")
    .map((file) => [file, readFileSync(join(stylesDir, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "")] as const);

  it("has at least one component stylesheet", () => {
    expect(cssFiles.length).toBeGreaterThan(0);
  });

  it.each(cssFiles)("%s uses variables only", (_file, css) => {
    expect(css).not.toMatch(/#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})(?![0-9a-f])/i);
    expect(css).not.toMatch(/\b(?:rgb|rgba|oklch|hsl)\s*\(/i);
    expect(css).not.toMatch(/\b(?:Newsreader|Mulish|Menlo|SF Mono)\b/);
    for (const match of css.matchAll(/font-size\s*:\s*([^;]+);/g)) {
      const literal = /^(\d+(?:\.\d+)?)px$/.exec(match[1]!.trim());
      if (literal) expect(Number(literal[1]), match[0]).toBeGreaterThanOrEqual(11);
    }
  });
});
