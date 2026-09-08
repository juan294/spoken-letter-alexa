import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "amazon",
    include: ["*.test.ts"],
    environment: "node",
  },
});
