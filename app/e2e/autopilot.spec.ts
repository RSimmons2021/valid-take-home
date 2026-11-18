import { expect, test } from "@playwright/test";
import { openPlan } from "./helpers";

/**
 * The heaviest flow (a second WebGL map, then video encoding on a software renderer), so it
 * runs on its own after the other tests (see playwright.config.ts) instead of starving them.
 * The AI API is blocked, so this is the no-AI path: scripts from the data, real places only.
 */
test("Autopilot builds a reviewable campaign kit without AI, and its videos export", async ({ page }) => {
  test.setTimeout(120_000);
  await openPlan(page);
  await page.keyboard.press("a");
  const dialog = page.getByRole("dialog", { name: "Autopilot" });
  await expect(dialog.getByText("AI isn't connected here")).toBeVisible();
  // $450 a month feeds three pins at $5 a day: Autopilot trims the plan to fit
  await dialog.getByLabel(/Monthly budget/).fill("450");
  await expect(dialog.getByText("this funds 3 of your 8 pins")).toBeVisible();
  await dialog.getByRole("button", { name: "Build my campaign" }).click();
  await expect(dialog.getByRole("heading", { name: /ready for review/ })).toBeVisible({ timeout: 90_000 });
  await expect(page).toHaveURL(/n=3/);
  await expect(dialog.locator(".kit__pin")).toHaveCount(3);
  await expect(dialog.locator(".runstep--error")).toHaveCount(0);
  await expect(dialog.getByText("from the data").first()).toBeVisible();
  // the kit document and a real video file
  const [kit] = await Promise.all([page.waitForEvent("download"), dialog.getByRole("button", { name: "Campaign kit .md" }).click()]);
  expect(kit.suggestedFilename()).toMatch(/-kit\.md$/);
  const [video] = await Promise.all([page.waitForEvent("download", { timeout: 60_000 }), dialog.locator(".kit__pin").first().getByRole("button", { name: "Download video" }).click()]);
  expect(video.suggestedFilename()).toMatch(/pin-1\.(mp4|webm)$/);
  const { size } = await import("node:fs").then((fs) => video.path().then((p) => fs.statSync(p)));
  expect(size).toBeGreaterThan(20_000);
  // one click puts the plan back
  await dialog.getByRole("button", { name: "Undo Autopilot" }).click();
  await expect(page).toHaveURL(/n=8/);
});
