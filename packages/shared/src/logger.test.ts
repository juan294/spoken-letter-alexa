import { afterEach, describe, expect, test, vi } from "vitest";

import { log } from "./logger.ts";

describe("log", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("writes one JSON line per event to stdout with level, event and fields", () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    log.info("mcp_ready", { port: 4310 });
    log.warn("slow_tool", { tool: "list_family_stories", ms: 512 });
    log.error("mcp_error", { message: "boom" });

    expect(write).toHaveBeenCalledTimes(3);
    const lines = write.mock.calls.map((call) => String(call[0]));
    for (const line of lines) expect(line.endsWith("\n")).toBe(true);
    const parsed = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(parsed[0]).toMatchObject({ level: "info", event: "mcp_ready", port: 4310 });
    expect(parsed[1]).toMatchObject({ level: "warn", event: "slow_tool", tool: "list_family_stories", ms: 512 });
    expect(parsed[2]).toMatchObject({ level: "error", event: "mcp_error", message: "boom" });
    expect(typeof parsed[0]?.time).toBe("string");
  });

  test("survives unserialisable fields", () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => {
      log.info("cyclic", { cyclic });
    }).not.toThrow();
    expect(String(write.mock.calls[0]?.[0])).toContain('"event":"cyclic"');
  });
});
