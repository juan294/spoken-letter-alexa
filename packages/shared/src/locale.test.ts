import { describe, expect, test } from "vitest";

import { resolveLocale } from "./locale.ts";

describe("resolveLocale", () => {
  test.each([
    [undefined, "en-US"],
    ["", "en-US"],
    ["en-US", "en-US"],
    ["en-GB", "en-US"],
    ["fr-FR", "en-US"],
    ["es-ES", "es-ES"],
    ["es-MX", "es-ES"],
    ["es-US", "es-ES"],
    ["ES-es", "es-ES"],
    ["est-EE", "en-US"],
  ])("%s resolves to %s", (input, expected) => {
    expect(resolveLocale(input)).toBe(expected);
  });
});
