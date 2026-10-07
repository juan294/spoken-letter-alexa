import { describe, expect, test } from "vitest";

import { MESSAGES, type Messages } from "./messages.ts";

/** Every catalog line, with templates rendered against neutral sample values. */
function lines(messages: Messages): string[] {
  return Object.values(messages).map((entry: string | ((...args: never[]) => string)) =>
    typeof entry === "function" ? (entry as (...args: string[]) => string)("Sample Title", "Sample Teller") : entry);
}

describe("skill message catalogs", () => {
  test("es-ES declares exactly the en-US keys", () => {
    expect(Object.keys(MESSAGES["es-ES"]).sort()).toEqual(Object.keys(MESSAGES["en-US"]).sort());
  });

  test("a catalog missing a key does not type-check", () => {
    const { launch: _omitted, ...withoutLaunch } = MESSAGES["es-ES"];
    // @ts-expect-error -- `launch` is required on every locale's catalog
    const incomplete: Messages = withoutLaunch;
    expect(incomplete).not.toHaveProperty("launch");
  });

  test("no line names implementation terms in either locale", () => {
    for (const locale of ["en-US", "es-ES"] as const) {
      for (const line of lines(MESSAGES[locale])) {
        expect(line).not.toMatch(/\b(?:demo|fixture|simulation|prototype|name-free)\b/i);
        expect(line.trim()).not.toBe("");
      }
    }
  });

  test("no es-ES line is an untranslated copy of its en-US line", () => {
    const english = lines(MESSAGES["en-US"]);
    lines(MESSAGES["es-ES"]).forEach((line, index) => {
      expect(line).not.toBe(english[index]);
    });
  });

  test("templated Spanish lines keep catalog names and titles verbatim", () => {
    const es = MESSAGES["es-ES"];
    expect(es.reactionFor("The owl who forgot how to hoot")).toContain("The owl who forgot how to hoot");
    expect(es.wishConfirm("mermaids", "Aunt Whitney")).toContain("Aunt Whitney");
    expect(es.wishConfirm("mermaids", "Aunt Whitney")).toMatch(/sirenas/);
    expect(es.wishConfirm("space")).not.toMatch(/ de \?|undefined/);
    expect(es.readBy("Grandpa Juan")).toBe("leída por Grandpa Juan");
  });
});
