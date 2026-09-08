import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "oauth",
    include: ["src/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
    env: { LOG_LEVEL: "warn" },
  },
});
