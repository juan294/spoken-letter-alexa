import { defineConfig } from "vitest/config";

// One root runner; every workspace package is a project so `pnpm test` at the root
// and `pnpm -F <pkg> test` inside a package run the same suites.
export default defineConfig({
  test: {
    projects: ["packages/*", "infra", "amazon"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["packages/*/src/**/*.ts", "infra/lib/**/*.ts"],
      exclude: ["**/*.test.ts", "**/*.d.ts"],
    },
  },
});
