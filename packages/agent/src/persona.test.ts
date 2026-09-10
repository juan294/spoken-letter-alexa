import { describe, expect, test } from "vitest";

import { ALEXA_PERSONA, personaWithCatalog } from "./persona.ts";

describe("personaWithCatalog", () => {
  test("returns the plain persona when there is no catalog", () => {
    expect(personaWithCatalog(undefined)).toBe(ALEXA_PERSONA);
    expect(personaWithCatalog("")).toBe(ALEXA_PERSONA);
  });

  test("composes the catalog after ALEXA_PERSONA, with every story title present", () => {
    const catalog = ["st_owl: The owl who forgot how to hoot by Grandpa Juan, 3m4s", "st_lighthouse: A lighthouse for Mateo by Grandpa Juan, 4m1s"].join("\n");
    const prompt = personaWithCatalog(catalog);
    expect(prompt.startsWith(ALEXA_PERSONA)).toBe(true);
    expect(prompt).toContain("The owl who forgot how to hoot");
    expect(prompt).toContain("A lighthouse for Mateo");
    expect(prompt).toContain("skip list_family_stories and call get_family_story");
  });
});
