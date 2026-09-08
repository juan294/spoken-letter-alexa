import { describe, expect, it } from "vitest";
import { displayToolName, formatClock } from "./format.ts";

describe("displayToolName", () => {
  it("strips a gateway prefix", () => {
    expect(displayToolName("spoken-letter___get_family_story")).toBe("get_family_story");
    expect(displayToolName("gw___x___list_family_stories")).toBe("list_family_stories");
  });
  it("keeps a bare name", () => {
    expect(displayToolName("list_family_stories")).toBe("list_family_stories");
  });
});

describe("formatClock", () => {
  it("renders m:ss", () => {
    expect(formatClock(184)).toBe("3:04");
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(59.6)).toBe("0:59");
  });
  it("renders a dash for unknown durations", () => {
    expect(formatClock(null)).toBe("–:––");
    expect(formatClock(Number.NaN)).toBe("–:––");
  });
});
