import { describe, expect, test } from "vitest";

import { hasAlexaTriggerPermission } from "../scripts/alexa-policy.mjs";

function policy(statement: object): string {
  return JSON.stringify({ Version: "2012-10-17", Statement: [statement] });
}

describe("hasAlexaTriggerPermission", () => {
  test("accepts an exact Alexa service principal with invoke permission", () => {
    expect(hasAlexaTriggerPermission(policy({
      Effect: "Allow",
      Principal: { Service: "alexa-appkit.amazon.com" },
      Action: "lambda:InvokeFunction",
    }))).toBe(true);
  });

  test("rejects a hostname that only contains the Alexa service name", () => {
    expect(hasAlexaTriggerPermission(policy({
      Effect: "Allow",
      Principal: { Service: "evil-alexa-appkit.amazon.com" },
      Action: "lambda:InvokeFunction",
    }))).toBe(false);
  });

  test.each([
    { Effect: "Deny", Principal: { Service: "alexa-appkit.amazon.com" }, Action: "lambda:InvokeFunction" },
    { Effect: "Allow", Principal: { Service: "alexa-appkit.amazon.com" }, Action: "lambda:GetFunction" },
    { Effect: "Allow", Principal: { AWS: "alexa-appkit.amazon.com" }, Action: "lambda:InvokeFunction" },
  ])("rejects a statement without the complete permission contract", (statement) => {
    expect(hasAlexaTriggerPermission(policy(statement))).toBe(false);
  });

  test("rejects malformed policy output", () => {
    expect(hasAlexaTriggerPermission("not json")).toBe(false);
  });
});
