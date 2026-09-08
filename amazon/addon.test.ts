// Validates `addon.json` against the shape Phase 7 fixes: required fields, the single
// en-US locale block, the MCP and OAuth endpoints, and the child-safety denylist over
// every user-facing string. Field names follow the quickstart where the research
// records them; the rest are listed in `addon-fields.md`.
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, test } from "vitest";
import { z } from "zod";

const ADDON_PATH = path.resolve(import.meta.dirname, "addon.json");
const BASE = "https://alexa.spokenletter.com";

const EXAMPLE_PHRASES = [
  "Alexa, ask Spoken Letter to play the story Grandma sent",
  "Alexa, what family stories are new in Spoken Letter",
  "Alexa, play the next family story",
];

/** Words that would present the add-on as a children's product. The listing is the parent's tool. */
const CHILD_TARGETING = [
  /\bkids?\b/i,
  /\bfor children\b/i,
  /\byour child can\b/i,
  /\bchild-friendly\b/i,
  /\blittle ones\b/i,
  /\bages?\s+\d/i,
  /\btoddlers?\b/i,
  /\bpreschool/i,
];

const localeSchema = z.object({
  name: z.literal("Spoken Letter"),
  summary: z.string().min(20).max(160),
  description: z.string().min(80),
  examplePhrases: z.tuple([z.literal(EXAMPLE_PHRASES[0]!), z.literal(EXAMPLE_PHRASES[1]!), z.literal(EXAMPLE_PHRASES[2]!)]),
  keywords: z.array(z.string().min(2)).min(3).max(30),
  privacyPolicyUrl: z.literal("https://spokenletter.com/privacy"),
  termsOfUseUrl: z.literal("https://spokenletter.com/terms"),
});

const addonSchema = z.object({
  name: z.literal("Spoken Letter"),
  type: z.literal("mcp"),
  distributionCountries: z.tuple([z.literal("US")]),
  locales: z.object({ "en-US": localeSchema }).strict(),
  mcp: z.object({
    endpoint: z.literal(`${BASE}/mcp`),
    transport: z.literal("streamable-http"),
    protocolVersion: z.literal("2025-11-25"),
  }),
  auth: z.object({
    type: z.literal("oauth2"),
    authorizationEndpoint: z.literal(`${BASE}/oauth/authorize`),
    tokenEndpoint: z.literal(`${BASE}/oauth/token`),
    scopes: z.literal("mcp:tools mcp:resources"),
    pkce: z.object({ required: z.literal(true), codeChallengeMethod: z.literal("S256") }),
    clientCredentials: z.object({
      tokenEndpoint: z.literal(`${BASE}/oauth/token`),
      tokenEndpointAuthMethod: z.literal("client_secret_basic"),
      scope: z.literal("mcp:service"),
    }),
  }),
});

const raw: unknown = JSON.parse(readFileSync(ADDON_PATH, "utf8"));

describe("amazon/addon.json", () => {
  test("matches the Phase 7 shape", () => {
    const result = addonSchema.safeParse(raw);
    expect(result.error?.issues ?? []).toEqual([]);
    expect(result.success).toBe(true);
  });

  test("distributes only to the US with a single en-US locale", () => {
    const addon = addonSchema.parse(raw);
    expect(addon.distributionCountries).toEqual(["US"]);
    expect(Object.keys(addon.locales)).toEqual(["en-US"]);
  });

  test("the OAuth block advertises PKCE S256 and the client_credentials service tier", () => {
    const addon = addonSchema.parse(raw);
    expect(addon.auth.pkce).toEqual({ required: true, codeChallengeMethod: "S256" });
    expect(addon.auth.clientCredentials.scope).toBe("mcp:service");
    expect(addon.auth.scopes.split(" ").sort()).toEqual(["mcp:resources", "mcp:tools"]);
  });

  test("no user-facing string targets children", () => {
    const locale = addonSchema.parse(raw).locales["en-US"];
    const strings = [locale.summary, locale.description, ...locale.examplePhrases, ...locale.keywords];
    for (const text of strings) {
      for (const pattern of CHILD_TARGETING) {
        expect(text, `"${text}" matches ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  test("the description presents a parent-operated family audio add-on", () => {
    const { description } = addonSchema.parse(raw).locales["en-US"];
    expect(description).toMatch(/\bparent\b/i);
    expect(description).toMatch(/\bfamily\b/i);
  });

  test("the denylist itself catches a child-targeting sentence", () => {
    const offending = "Bedtime stories for kids and little ones, ages 3 to 8.";
    expect(CHILD_TARGETING.filter((pattern) => pattern.test(offending))).toHaveLength(3);
  });
});
