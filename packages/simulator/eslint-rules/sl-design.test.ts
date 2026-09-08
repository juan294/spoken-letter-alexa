import { RuleTester } from "eslint";
import tsParser from "@typescript-eslint/parser";
import { describe, it } from "vitest";
import plugin from "./sl-design.mjs";

const tester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    ecmaVersion: 2024,
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

describe("sl-design/no-hex-in-style", () => {
  it("flags literal colours in style objects, template styles and <style> tags", () => {
    tester.run("no-hex-in-style", plugin.rules["no-hex-in-style"], {
      valid: [
        { code: `<div style={{ color: "var(--evening-ink)", background: "var(--lamplight)" }} />` },
        { code: `<a href="#main-content" />` },
        { code: `const s = { color: \`var(--cream)\`, border: "1px solid var(--border)" };` },
        { code: `const id = "#abc123";` },
        { code: `<div style={{ background: "color-mix(in srgb, var(--lamplight) 30%, transparent)" }} />` },
      ],
      invalid: [
        { code: `<div style={{ color: "#2E2738" }} />`, errors: [{ messageId: "hexInStyle" }] },
        { code: `<div style={{ border: "1px solid #efe6d4" }} />`, errors: [{ messageId: "hexInStyle" }] },
        { code: `<div style={{ background: "rgba(228,164,92,.3)" }} />`, errors: [{ messageId: "hexInStyle" }] },
        { code: `<div style={{ color: "oklch(0.5 0.1 30)" }} />`, errors: [{ messageId: "hexInStyle" }] },
        { code: `<div style={{ background: \`linear-gradient(#fff, var(--cream))\` }} />`, errors: [{ messageId: "hexInStyle" }] },
        { code: `const s = { color: "#fff", fontSize: "var(--text-body)" }; <div style={s} />`, errors: [{ messageId: "hexInStyle" }] },
        { code: `const s: CSSProperties = { boxShadow: "0 1px 2px rgb(0 0 0 / 10%)" };`, errors: [{ messageId: "hexInStyle" }] },
        { code: `<style>{\`.x { color: #fff; }\`}</style>`, errors: [{ messageId: "hexInStyle" }] },
      ],
    });
  });
});

describe("sl-design/no-literal-font-family", () => {
  it("flags literal brand font names", () => {
    tester.run("no-literal-font-family", plugin.rules["no-literal-font-family"], {
      valid: [
        { code: `<span style={{ fontFamily: "var(--font-heading)" }} />` },
        { code: `const title = "Newsreader is our serif";` },
      ],
      invalid: [
        { code: `<span style={{ fontFamily: "Newsreader" }} />`, errors: [{ messageId: "literalFont" }] },
        { code: `<span style={{ fontFamily: "'Mulish', sans-serif" }} />`, errors: [{ messageId: "literalFont" }] },
        { code: `const s = { fontFamily: "ui-monospace, Menlo, monospace", color: "var(--cream)" };`, errors: [{ messageId: "literalFont" }] },
        { code: `<span style={{ fontFamily: \`Mulish\` }} />`, errors: [{ messageId: "literalFont" }] },
      ],
    });
  });
});

describe("sl-design/no-micro-font-size", () => {
  it("flags font sizes under 11px", () => {
    tester.run("no-micro-font-size", plugin.rules["no-micro-font-size"], {
      valid: [
        { code: `<span style={{ fontSize: "var(--text-micro)" }} />` },
        { code: `<span style={{ fontSize: 11 }} />` },
        { code: `<span style={{ fontSize: "11px" }} />` },
        { code: `<span style={{ fontSize: "clamp(15px, 1.9vw, 19px)" }} />` },
        { code: `const width = { size: 9 };` },
      ],
      invalid: [
        { code: `<span style={{ fontSize: 10 }} />`, errors: [{ messageId: "microFontSize" }] },
        { code: `<span style={{ fontSize: 10.5 }} />`, errors: [{ messageId: "microFontSize" }] },
        { code: `<span style={{ fontSize: "9px" }} />`, errors: [{ messageId: "microFontSize" }] },
        { code: `<span style={{ fontSize: "0.5625rem" }} />`, errors: [{ messageId: "microFontSize" }] },
        { code: `const s = { fontSize: 8, color: "var(--cream)" }; <b style={s} />`, errors: [{ messageId: "microFontSize" }] },
      ],
    });
  });
});
