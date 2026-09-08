import { describe, expect, test } from "vitest";
import { z } from "zod";

import { readEnv } from "./env.ts";

describe("readEnv", () => {
  test("parses the declared keys from the supplied source", () => {
    const env = readEnv(
      { PORT: z.coerce.number().int(), NAME: z.string() },
      { PORT: "4310", NAME: "spoken-letter" },
    );
    expect(env).toEqual({ PORT: 4310, NAME: "spoken-letter" });
  });

  test("throws once with every missing key name and never the values", () => {
    expect(() =>
      readEnv(
        { SECRET: z.string().min(1), OTHER: z.string(), PRESENT: z.string() },
        { PRESENT: "sensitive-value" },
      ),
    ).toThrow(/SECRET.*OTHER|OTHER.*SECRET/);
    try {
      readEnv({ SECRET: z.string().min(8), PRESENT: z.string() }, { PRESENT: "sensitive-value", SECRET: "short" });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message).toContain("SECRET");
      expect(message).not.toContain("short");
      expect(message).not.toContain("sensitive-value");
    }
  });

  test("applies defaults and optional keys", () => {
    const env = readEnv({ MODE: z.enum(["fixtures", "auto"]).default("fixtures"), OPT: z.string().optional() }, {});
    expect(env).toEqual({ MODE: "fixtures" });
  });
});
