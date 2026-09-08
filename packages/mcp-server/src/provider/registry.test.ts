import { describe, expect, test } from "vitest";

import { FixtureProvider } from "./fixtures.ts";
import { HttpProvider } from "./http.ts";
import { createProviderResolver } from "./registry.ts";

const fixtures = new FixtureProvider({ stories: [], publicBaseUrl: "http://localhost:4310" });
const http = new HttpProvider({ base: "https://spokenletter.com", secret: "test-bridge-secret-not-a-real-credential" });

describe("createProviderResolver", () => {
  test("fixtures mode serves every subject from the fixtures", () => {
    const resolve = createProviderResolver({ mode: "fixtures", fixtures, http });
    expect(resolve("demo")).toBe(fixtures);
    expect(resolve("svc:alexa-m2m")).toBe(fixtures);
    expect(resolve("uid_1")).toBe(fixtures);
  });

  test("auto mode routes demo and service subjects to fixtures and real subjects to the bridge", () => {
    const resolve = createProviderResolver({ mode: "auto", fixtures, http });
    expect(resolve("demo")).toBe(fixtures);
    expect(resolve("svc:alexa-m2m")).toBe(fixtures);
    expect(resolve("uid_1")).toBe(http);
  });

  test("auto mode without a bridge falls back to fixtures with a warning", () => {
    const resolve = createProviderResolver({ mode: "auto", fixtures, http: null });
    expect(resolve("uid_1")).toBe(fixtures);
  });
});
