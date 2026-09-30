import { describe, expect, test } from "vitest";

import { nativeCountEvidence } from "./count-evidence.ts";

describe("nativeCountEvidence: only Strands' own success line proves a Bedrock CountTokens result", () => {
  test("a native-count line carrying the same total verifies the count", () => {
    expect(nativeCountEvidence(1586, ["total_tokens=<1586> | native token count"])).toEqual({ verified: true });
  });

  test("a native-count line for a different total does not", () => {
    expect(nativeCountEvidence(2708, ["total_tokens=<1586> | native token count"])).toEqual({ verified: false, reason: "no native token count was logged" });
  });

  test("a logged fallback is not verified and is the reason given", () => {
    const fallback = "model_id=<us.anthropic.claude-haiku-4-5-20251001-v1:0> | model does not support CountTokens, caching for future calls, falling back to estimation";
    expect(nativeCountEvidence(2708, [fallback])).toEqual({ verified: false, reason: fallback });
  });

  test("silence is not verification: Strands skips a remembered model, and warns about AccessDenied once per process", () => {
    expect(nativeCountEvidence(2708, [])).toEqual({ verified: false, reason: "no native token count was logged" });
  });
});
