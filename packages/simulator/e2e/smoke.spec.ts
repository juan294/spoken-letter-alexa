import { expect, test } from "@playwright/test";

// The keyboard fallback against the in-app mock: the parent asks, the fixture story plays.
// Both viewport projects (390 and 1280 px) run this file.

test("the parent asks by keyboard and the fixture story reaches the Now Playing panel", async ({ page }) => {
  await page.goto("./");

  await expect(page.getByTestId("wordmark")).toContainText("Spoken");
  await expect(page.getByTestId("simulation-notice")).toContainText(/push-to-talk/i);
  await expect(page.getByTestId("status-chip")).toHaveText("Idle");
  await expect(page.getByRole("img", { name: "Crescent moon" })).toBeVisible();
  await expect(page.locator(".mode-chip")).toHaveText("Demo mode");

  await page.getByRole("textbox", { name: "Ask Alexa by keyboard" }).fill("Alexa, play the story Grandpa sent");
  await page.getByRole("button", { name: "Send", exact: true }).click();

  const panel = page.getByTestId("now-playing");
  await expect(page.getByTestId("now-playing-title")).toHaveText("The owl who forgot how to hoot");
  await expect(panel).toContainText("Grandpa Juan");
  await expect(panel).toContainText("3:04");
  await expect(page.getByTestId("status-chip")).toHaveText("Playing");
  await expect(page.getByRole("progressbar", { name: "Story progress" })).toBeVisible();

  // Nothing overflows horizontally at either width.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByTestId("status-chip")).toHaveText("Paused");
  await page.getByRole("button", { name: "Resume" }).click();
  await expect(page.getByTestId("status-chip")).toHaveText("Playing");

  await page.getByRole("button", { name: /Under the hood/ }).click();
  const rows = page.getByTestId("under-the-hood").getByRole("listitem");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("list_family_stories");
  await expect(rows.first().locator(".tool")).toHaveAttribute("title", "spoken-letter___list_family_stories");
});
