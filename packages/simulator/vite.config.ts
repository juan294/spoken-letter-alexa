import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Served at /demo/ (S3 origin under /demo/* in AWS). Locally everything under the agent,
// OAuth, MCP, metadata, fixture and dev routes is proxied to the Hono app on :4310.
const AGENT_ORIGIN = process.env.AGENT_ORIGIN ?? "http://localhost:4310";
const PROXIED = ["/agent", "/oauth", "/mcp", "/.well-known", "/fixtures", "/dev"];

export default defineConfig({
  base: "/demo/",
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: Object.fromEntries(PROXIED.map((prefix) => [prefix, { target: AGENT_ORIGIN, changeOrigin: false }])),
  },
  preview: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
