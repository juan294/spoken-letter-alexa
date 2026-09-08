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
  { fragment: "send", reason: "delivery stays human-owned" },
  { fragment: "download", reason: "delivery stays human-owned" },
  { fragment: "checkout", reason: "commerce mutates account state" },
  { fragment: "credit", reason: "credits are paid entitlements" },
  { fragment: "voucher", reason: "vouchers mutate entitlements" },
  { fragment: "purchase", reason: "commerce mutates account state" },
  { fragment: "pay", reason: "commerce mutates account state" },
  { fragment: "recipient", reason: "recipient data is outside the agent boundary" },
  { fragment: "delete", reason: "deletion mutates durable state" },
  { fragment: "remove", reason: "removal mutates durable state" },
  { fragment: "admin", reason: "administration is never agent-exposed" },
  { fragment: "yoto", reason: "Yoto delivery stays human-owned" },
  { fragment: "approve", reason: "approval stays human-owned" },
  { fragment: "narration", reason: "narration stays human-owned" },
  { fragment: "record", reason: "recording stays human-owned" },
  { fragment: "upload", reason: "audio upload stays human-owned" },
  { fragment: "audio", reason: "audio handling stays human-owned" },
  { fragment: "member", reason: "membership mutates account state" },
  { fragment: "space", reason: "family-space changes mutate account state" },
  { fragment: "invite", reason: "invites mutate membership state" },
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

  test("pins the twenty denylisted fragments and reasons to the private repository's list", () => {
    expect(CLASS_C_DENYLIST).toEqual(PRIVATE_REPO_DENYLIST);
    expect(CLASS_C_DENYLIST).toHaveLength(20);
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
