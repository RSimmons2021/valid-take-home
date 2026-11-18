import { type Page, expect } from "@playwright/test";

export const PLAN = "/#/sf-bay?p=home-repair&w=home_retail.1,home_trades.-1,homes.1,moving.1,nightlife.-1,single.2&n=8&r=1.5&min=25";

/**
 * Block third-party requests (tiles, glyphs) and the AI API, so tests are deterministic,
 * offline-safe and free. (`vite preview` proxies /api to a local AI server if one is running;
 * the suite must not depend on that.)
 */
export async function offlineExtras(page: Page) {
  await page.route(/^https?:\/\/(?!localhost)/, (route) => route.abort());
  await page.route(/\/api\//, (route) => route.abort());
}

/** Open a plan as a returning visitor (welcome and tour already seen). */
export async function openPlan(page: Page, url = PLAN) {
  await offlineExtras(page);
  await page.addInitScript(() => {
    localStorage.setItem("catchment.welcomed", "1");
    localStorage.setItem("catchment.toured", "1");
  });
  await page.goto(url);
  await expect(page.locator(".pinrow").first()).toBeVisible({ timeout: 40_000 });
  // Dismiss guidance if a build shows it anyway.
  for (let i = 0; i < 2; i++) {
    if (await page.locator("dialog[open], .tour__note").count()) await page.keyboard.press("Escape");
  }
  await expect(page.locator("dialog[open], .tour__note")).toHaveCount(0);
}
