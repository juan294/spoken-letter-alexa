import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "agent",
    include: ["src/**/*.test.ts"],
    environment: "node",
    testTimeout: 60_000,
    env: { LOG_LEVEL: "warn" },
  },
});
