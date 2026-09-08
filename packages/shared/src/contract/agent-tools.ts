// Vendored from juan294/spoken-letter `src/lib/agent-tools/contract.ts` on 2026-09-08.
// Intentional differences, all without runtime effect: `CLASS_C_DENYLIST` is exported so
// this repository's test can pin it by value; `ZodType<unknown>` is written `ZodType`;
// `annotations` and `safetyClass` accept an explicit `undefined` because this workspace
// compiles with `exactOptionalPropertyTypes`; two statements are reformatted.
import { z, type ZodType } from "zod";

export const AGENT_TOOL_BUDGETS = {
  name: 30,
  description: 500,
  parameterDescription: 150,
  output: 1500,
} as const;

export const SAFETY_CLASSES = ["read", "draft-write"] as const;

export type SafetyClass = (typeof SAFETY_CLASSES)[number];

export const CLASS_C_DENYLIST = [
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

export type AgentToolMetadata = {
  name: string;
  description: string;
  inputSchema: ZodType;
  annotations?:
    | {
        readOnlyHint?: boolean;
        destructiveHint?: boolean;
      }
    | undefined;
  safetyClass?: SafetyClass | undefined;
};

function propertyDescriptions(schema: unknown): string[] {
  if (Array.isArray(schema)) return schema.flatMap(propertyDescriptions);
  if (!schema || typeof schema !== "object") return [];

  const record = schema as Record<string, unknown>;
  const descriptions: string[] = [];
  if (record.properties && typeof record.properties === "object") {
    for (const property of Object.values(record.properties)) {
      if (!property || typeof property !== "object") continue;
      const description = (property as Record<string, unknown>).description;
      if (typeof description === "string") descriptions.push(description);
    }
  }
  for (const child of Object.values(record)) {
    descriptions.push(...propertyDescriptions(child));
  }
  return descriptions;
}

export function assertAgentToolMetadata(tool: AgentToolMetadata, label: string): string[] {
  const diagnostics: string[] = [];
  const report = (message: string) => diagnostics.push(`${label}: ${message}`);

  if (!/^[a-z][a-z0-9_]*$/.test(tool.name)) {
    report(`name ${JSON.stringify(tool.name)} must be lowercase snake_case`);
  }
  if (tool.name.length > AGENT_TOOL_BUDGETS.name) {
    report(`name is ${tool.name.length} characters; maximum is ${AGENT_TOOL_BUDGETS.name}`);
  }
  if (tool.description.length > AGENT_TOOL_BUDGETS.description) {
    report(
      `description is ${tool.description.length} characters; maximum is ${AGENT_TOOL_BUDGETS.description}`,
    );
  }

  for (const description of propertyDescriptions(z.toJSONSchema(tool.inputSchema))) {
    if (description.length > AGENT_TOOL_BUDGETS.parameterDescription) {
      report(
        `parameter description is ${description.length} characters; maximum is ${AGENT_TOOL_BUDGETS.parameterDescription}`,
      );
    }
  }

  for (const denied of CLASS_C_DENYLIST) {
    if (tool.name.includes(denied.fragment)) {
      report(`name contains ${JSON.stringify(denied.fragment)}; ${denied.reason}`);
    }
  }

  if (typeof tool.annotations?.readOnlyHint !== "boolean") {
    report("annotations must include a boolean readOnlyHint");
  } else {
    if (tool.safetyClass !== undefined && tool.annotations.readOnlyHint !== (tool.safetyClass === "read")) {
      report(`readOnlyHint is inconsistent with safetyClass ${tool.safetyClass}`);
    }
    if (tool.annotations.readOnlyHint && tool.annotations.destructiveHint) {
      report("readOnlyHint and destructiveHint cannot both be true");
    }
  }

  return diagnostics;
}
