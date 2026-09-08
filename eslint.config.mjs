// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";

import slDesign from "./packages/simulator/eslint-rules/sl-design.mjs";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/cdk.out/**",
      "**/coverage/**",
      "**/*.d.ts",
      ".rpi/**",
      ".claude/**",
      ".codex/**",
      ".agents/**",
      "packages/simulator/dist/**",
      "packages/simulator/playwright-report/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.mjs", "scripts/*.mjs", "infra/scripts/*.mjs"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      "no-console": ["error", { allow: ["error"] }],
      // The vendored contract and the plan use type aliases throughout.
      "@typescript-eslint/consistent-type-definitions": "off",
    },
  },
  {
    files: ["packages/simulator/src/**/*.{ts,tsx}"],
    plugins: { "sl-design": slDesign },
    rules: {
      "sl-design/no-hex-in-style": "error",
      "sl-design/no-literal-font-family": "error",
      "sl-design/no-micro-font-size": "error",
    },
  },
  {
    files: ["**/*.mjs", "**/*.js"],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        fetch: "readonly",
        Buffer: "readonly",
        performance: "readonly",
        AbortController: "readonly",
      },
    },
  },
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "scripts/**", "infra/scripts/**"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "no-console": "off",
    },
  },
);
