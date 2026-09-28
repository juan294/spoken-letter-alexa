import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "infra",
    include: ["test/**/*.test.ts"],
    environment: "node",
    testTimeout: 60_000,
    // CDK template setup can exceed Vitest's 10 s default under shared CI or local load.
    hookTimeout: 60_000,
  },
});
