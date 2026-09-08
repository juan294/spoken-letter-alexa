import { defineConfig, devices } from "@playwright/test";

// Smoke against the in-app mock transport (VITE_AGENT_MOCK=1): no agent server, no AWS.
// Two viewports because jsdom cannot see responsive layout (phase 5, section 4).
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:5173/demo/",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "phone-390", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } } },
    { name: "desktop-1280", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
  ],
  webServer: {
    command: "pnpm exec vite --port 5173 --strictPort",
    url: "http://localhost:5173/demo/",
    reuseExistingServer: !process.env.CI,
    env: { VITE_AGENT_MOCK: "1" },
    timeout: 60_000,
  },
});
