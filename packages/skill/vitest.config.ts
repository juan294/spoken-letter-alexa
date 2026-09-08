import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "skill",
    include: ["src/**/*.test.ts"],
    environment: "node",
    env: { LOG_LEVEL: "warn" },
  },
});
