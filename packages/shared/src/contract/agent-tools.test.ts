import { describe, expect, test } from "vitest";
import { z } from "zod";

import {
  AGENT_TOOL_BUDGETS,
  CLASS_C_DENYLIST,
  assertAgentToolMetadata,
  type AgentToolMetadata,
} from "./agent-tools.ts";

// Pinned by value to `src/lib/agent-tools/contract.ts` in juan294/spoken-letter (the
// private repository). A change on either side must be re-vendored deliberately.
const PRIVATE_REPO_DENYLIST = [
  "send",
  "download",
  "checkout",
  "credit",
  "voucher",
  "purchase",
  "pay",
  "recipient",
  "delete",
  "remove",
  "admin",
  "yoto",
  "approve",
  "narration",
  "record",
  "upload",
  "audio",
  "member",
  "space",
  "invite",
] as const;

const VALID_METADATA: AgentToolMetadata = {
  name: "valid_tool",
  description: "A valid agent tool.",
  inputSchema: z.object({ value: z.string() }),
  annotations: { readOnlyHint: true },
  safetyClass: "read",
};

describe("vendored agent tool contract", () => {
  test("publishes the fixed budgets", () => {
    expect(AGENT_TOOL_BUDGETS).toEqual({
      name: 30,
      description: 500,
      parameterDescription: 150,
      output: 1500,
    });
  });

  test("pins the twenty denylisted fragments to the private repository's list", () => {
    expect(CLASS_C_DENYLIST.map((entry) => entry.fragment)).toEqual([...PRIVATE_REPO_DENYLIST]);
    expect(CLASS_C_DENYLIST).toHaveLength(20);
    for (const entry of CLASS_C_DENYLIST) expect(entry.reason.length).toBeGreaterThan(0);
  });

  test("accepts valid metadata", () => {
    expect(assertAgentToolMetadata(VALID_METADATA, "valid")).toEqual([]);
  });

  test.each([
    { field: "name format", metadata: { ...VALID_METADATA, name: "Invalid-Tool" }, expected: "lowercase snake_case" },
    { field: "name length", metadata: { ...VALID_METADATA, name: `a${"x".repeat(30)}` }, expected: "name is 31 characters" },
    {
      field: "description length",
      metadata: { ...VALID_METADATA, description: "x".repeat(501) },
      expected: "description is 501 characters",
    },
    {
      field: "required annotation",
      metadata: { ...VALID_METADATA, annotations: undefined },
      expected: "annotations must include a boolean readOnlyHint",
    },
    {
      field: "denylisted fragment",
      metadata: { ...VALID_METADATA, name: "send_story" },
      expected: 'name contains "send"',
    },
    {
      field: "inconsistent safety class",
      metadata: { ...VALID_METADATA, safetyClass: "draft-write" as const },
      expected: "readOnlyHint is inconsistent with safetyClass draft-write",
    },
    {
      field: "contradictory hints",
      metadata: { ...VALID_METADATA, annotations: { readOnlyHint: true, destructiveHint: true } },
      expected: "readOnlyHint and destructiveHint cannot both be true",
    },
  ])("reports an invalid $field", ({ metadata, expected }) => {
    expect(assertAgentToolMetadata(metadata, "synthetic")).toContainEqual(expect.stringContaining(expected));
  });

  test("finds nested parameter-description budget violations", () => {
    const diagnostics = assertAgentToolMetadata(
      {
        ...VALID_METADATA,
        inputSchema: z.object({
          nested: z.object({ deep: z.string().describe("d".repeat(151)) }),
        }),
      },
      "nested",
    );
    expect(diagnostics).toContainEqual(expect.stringContaining("parameter description is 151 characters"));
  });
});
