import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "infra",
    include: ["test/**/*.test.ts"],
    environment: "node",
    testTimeout: 60_000,
  },
});
