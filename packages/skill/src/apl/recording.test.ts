import { describe, expect, test } from "vitest";

import { CREATE_MESSAGES } from "../create-messages.ts";
import { estimatedPages, readMs, recordingCommands, teleprompterDatasource, TELEPROMPTER_TOKEN } from "./recording.ts";
import teleprompter from "./teleprompter.json" with { type: "json" };

type Node = Record<string, unknown>;
const nodes = (value: unknown): Node[] => {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (value && typeof value === "object") return [value as Node, ...Object.values(value).flatMap(nodes)];
  return [];
};
type Command = { type: string; componentId?: string; property?: string; value?: unknown; delay?: number; distance?: number; commands?: Command[] };
const flatten = (commands: Command[]): Command[] => commands.flatMap((command) => [command, ...flatten(command.commands ?? [])]);

const SEVENTY_WORDS = Array.from({ length: 70 }, (_, index) => (index % 7 === 0 ? "storyteller" : "word")).join(" ");

describe("teleprompter.json (SS12: validated locally before ask deploy)", () => {
  const components = nodes(teleprompter.mainTemplate);
  const ids = new Set(components.map((node) => node.id).filter((id) => typeof id === "string"));

  test("is an APL document with one main template item and the payload parameter", () => {
    expect(teleprompter.type).toBe("APL");
    expect(teleprompter.version).toMatch(/^\d{4}\.\d$/);
    expect(teleprompter.mainTemplate.parameters).toEqual(["payload"]);
    expect(teleprompter.mainTemplate.items).toHaveLength(1);
  });

  test("every component the commands address exists, and the script scrolls", () => {
    for (const command of flatten(recordingCommands(SEVENTY_WORDS))) {
      if (command.componentId) expect(ids, command.componentId).toContain(command.componentId);
    }
    expect(components.find((node) => node.id === "scriptScroll")?.type).toBe("ScrollView");
    expect(components.find((node) => node.id === "countdown")?.type).toBe("Text");
  });

  test("the Done button sends exactly the done event", () => {
    const button = components.find((node) => node.type === "TouchWrapper");
    expect(button?.onPress).toEqual([{ type: "SendEvent", arguments: ["done"] }]);
  });

  test("every payload binding is supplied by the datasource", () => {
    const datasource = teleprompterDatasource("Read me.");
    const bound = [...JSON.stringify(teleprompter).matchAll(/\$\{payload\.teleprompter\.(\w+)\}/g)].map((match) => match[1]);
    expect(bound.length).toBeGreaterThan(0);
    for (const key of bound) expect(Object.keys(datasource.teleprompter), key).toContain(key);
    expect(datasource.teleprompter).toMatchObject({ script: "Read me.", doneLabel: CREATE_MESSAGES.doneLabel, recordingLabel: CREATE_MESSAGES.recordingLabel });
  });
});

describe("recordingCommands", () => {
  test("counts 3, 2, 1 a second apart, hides the overlay, shows the indicator, then scrolls", () => {
    const steps = flatten(recordingCommands(SEVENTY_WORDS));
    expect(steps[0]?.type).toBe("Sequential");
    const sequence = steps.slice(1);
    expect(sequence.slice(0, 5)).toEqual([
      { type: "SetValue", componentId: "countdown", property: "text", value: "3" },
      { type: "SetValue", componentId: "countdown", property: "text", value: "2", delay: 1000 },
      { type: "SetValue", componentId: "countdown", property: "text", value: "1", delay: 1000 },
      { type: "SetValue", componentId: "countdownOverlay", property: "display", value: "none", delay: 1000 },
      { type: "SetValue", componentId: "recordingIndicator", property: "opacity", value: 1 },
    ]);
    expect(sequence.slice(5).every((step) => step.type === "Scroll" && step.componentId === "scriptScroll")).toBe(true);
  });

  test("the scroll ends at about the D8 read time and covers all but the last page", () => {
    const scrolls = flatten(recordingCommands(SEVENTY_WORDS)).filter((step) => step.type === "Scroll");
    const elapsed = scrolls.reduce((sum, step) => sum + (step.delay ?? 0), 0);
    expect(readMs(SEVENTY_WORDS)).toBe(25_000);
    expect(Math.abs(elapsed - readMs(SEVENTY_WORDS))).toBeLessThanOrEqual(1000);
    const distance = scrolls.reduce((sum, step) => sum + (step.distance ?? 0), 0);
    expect(distance).toBeCloseTo(estimatedPages(SEVENTY_WORDS) - 1, 5);
  });

  test("a script that fits on one page does not scroll", () => {
    expect(estimatedPages("A short line.")).toBeLessThanOrEqual(1);
    expect(flatten(recordingCommands("A short line.")).some((step) => step.type === "Scroll")).toBe(false);
  });

  test("the token is the teleprompter's", () => {
    expect(TELEPROMPTER_TOKEN).toBe("teleprompter");
  });
});
