import { defineConfig } from "vitest/config";

// Two projects: the SPA components run under jsdom; the theme parity test and the
// design ESLint rules are plain Node. Playwright (`e2e/*.spec.ts`) is never part of
// `vitest run`; it has its own `test:e2e` script.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "simulator",
          include: ["src/**/*.test.tsx"],
          environment: "jsdom",
          setupFiles: ["src/test/setup.ts"],
        },
      },
      {
        test: {
          name: "simulator-node",
          include: ["src/**/*.test.ts", "eslint-rules/**/*.test.ts"],
          environment: "node",
        },
      },
    ],
  },
});
