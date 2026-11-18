import { stat } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { openPlan } from "./helpers";

/**
 * The heaviest flow (a second WebGL map, then video encoding on a software renderer), so it
 * runs on its own after the other tests (see playwright.config.ts) instead of starving them.
 * The AI API is blocked, so this is the no-AI path: scripts from the data, real places only.
 */
test("Autopilot builds a kit without AI, previews videos and downloads them", async ({ page }) => {
  test.setTimeout(120_000);
  await openPlan(page);
  await page.keyboard.press("a");
  const dialog = page.getByRole("dialog", { name: "Autopilot" });
  await expect(dialog.getByText("AI isn't connected here")).toBeVisible();
  // $300 funds two pins at $5 a day and exercises trimming the original eight.
  await dialog.getByLabel(/Monthly budget/).fill("300");
  await expect(dialog.getByText("this funds 2 of your 8 pins")).toBeVisible();
  await dialog.getByRole("button", { name: "Build my campaign" }).click();
  await expect(dialog.getByRole("heading", { name: /ready for review/ })).toBeVisible({ timeout: 90_000 });
  await expect(page).toHaveURL(/n=2&/);
  await expect(dialog.locator(".kit__pin")).toHaveCount(2);
  await expect(dialog.locator(".runstep--error")).toHaveCount(0);
  await expect(dialog.getByText("from the data").first()).toBeVisible();
  await test.step("enlarge a video and return to its thumbnail", async () => {
    const thumbnail = dialog.getByRole("button", { name: /Enlarge video for/ }).first();
    const preview = page.getByRole("dialog", { name: /Video preview for/ });
    const canvas = preview.locator("canvas");
    const thumbnailWidth = await thumbnail.evaluate((element) => element.getBoundingClientRect().width);

    await thumbnail.click();
    await expect(preview).toBeVisible();
    await expect(canvas).toBeInViewport({ ratio: 1 });
    await expect.poll(() =>
      canvas.evaluate((element) => (element as HTMLCanvasElement).getContext("2d")?.getImageData(0, 0, 1, 1).data[3] ?? 0),
    ).toBeGreaterThan(0);
    expect(await canvas.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(thumbnailWidth * 2);
    await preview.getByRole("button", { name: "Pause video" }).click();
    await expect(preview.getByRole("button", { name: "Resume video" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".film-preview")).toHaveCount(0);
    await expect(thumbnail).toBeFocused();

    await page.setViewportSize({ width: 390, height: 844 });
    await thumbnail.press("Enter");
    await expect(canvas).toBeInViewport({ ratio: 1 });
    await preview.getByRole("button", { name: "Close video preview" }).click();
    await expect(page.locator(".film-preview")).toHaveCount(0);
    await expect(thumbnail).toBeFocused();
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  // the kit document and a real video file
  const [kit] = await Promise.all([page.waitForEvent("download"), dialog.getByRole("button", { name: "Campaign kit .md" }).click()]);
  expect(kit.suggestedFilename()).toMatch(/-kit\.md$/);
  const [video] = await Promise.all([page.waitForEvent("download", { timeout: 60_000 }), dialog.locator(".kit__pin").first().getByRole("button", { name: "Download video" }).click()]);
  expect(video.suggestedFilename()).toMatch(/pin-1\.(mp4|webm)$/);
  const { size } = await stat(await video.path());
  expect(size).toBeGreaterThan(20_000);
  // one click puts the plan back
  await dialog.getByRole("button", { name: "Undo Autopilot" }).click();
  await expect(page).toHaveURL(/n=8&/);
});
