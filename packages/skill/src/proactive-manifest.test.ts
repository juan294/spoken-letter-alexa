import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, test } from "vitest";

const manifest = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../skill-package/skill.json"), "utf8")) as { manifest: Record<string, unknown> };

describe("Proactive Events manifest", () => {
  test("publishes only MessageAlert and directs subscription events to the worker", () => {
    expect(manifest.manifest.permissions).toEqual([{ name: "alexa::devices:all:notifications:write" }]);
    expect(manifest.manifest.events).toEqual({
      publications: [{ eventName: "AMAZON.MessageAlert.Activated" }],
      subscriptions: [{ eventName: "SKILL_PROACTIVE_SUBSCRIPTION_CHANGED" }],
      endpoint: { uri: "arn:aws:lambda:us-east-1:106403001709:function:sla-alexa-notifications" },
    });
  });

  test("labels wishes, reactions, updates and opt-in notifications as fixture development features", () => {
    const publishing = manifest.manifest.publishingInformation as { locales: { "en-US": { description: string } }; testingInstructions: string };
    expect(publishing.locales["en-US"].description).toMatch(/fixture wishes and reactions/i);
    expect(publishing.locales["en-US"].description).toMatch(/opt-in development notification/i);
    expect(publishing.testingInstructions).toMatch(/fixture wishes, reactions, and updates/i);
    expect(publishing.testingInstructions).not.toMatch(/live delivery/i);
  });
});
