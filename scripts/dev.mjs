#!/usr/bin/env node
// `pnpm dev` / `pnpm dev:offline`: the Hono server (MCP, OAuth, agent) on :4310 and the
// simulator (Vite) on :5173 with its proxy, in one terminal. Ctrl-C stops both.
import { spawn } from "node:child_process";

const offline = process.env.AGENT_OFFLINE === "1";
const env = { ...process.env, DEV_ROUTES: process.env.DEV_ROUTES ?? "1", AGENT_OFFLINE: offline ? "1" : (process.env.AGENT_OFFLINE ?? "0") };

const children = [
  spawn("pnpm", ["-F", "@spoken-letter-alexa/app", "dev"], { stdio: "inherit", env }),
  spawn("pnpm", ["-F", "@spoken-letter-alexa/simulator", "dev"], { stdio: "inherit", env }),
];

const stop = (signal) => {
  for (const child of children) child.kill(signal);
};
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
for (const child of children) {
  child.on("exit", (code) => {
    stop("SIGTERM");
    process.exitCode = code ?? 0;
  });
}
console.log(JSON.stringify({ event: "dev_started", server: "http://localhost:4310", simulator: "http://localhost:5173/demo/", offline }));
