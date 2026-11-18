import AxeBuilder from "@axe-core/playwright";
import { type Page, expect, test } from "@playwright/test";

const PLAN = "/#/sf-bay?p=home-repair&w=home_retail.1,home_trades.-1,homes.1,moving.1,nightlife.-1,single.2&n=8&r=1.5&min=25";

/** Block third-party requests (tiles, glyphs) so tests are deterministic and offline-safe. */
async function offlineExtras(page: Page) {
  await page.route(/^https?:\/\/(?!localhost)/, (route) => route.abort());
}

/** Open a plan as a returning visitor (welcome and tour already seen). */
async function openPlan(page: Page, url = PLAN) {
  await offlineExtras(page);
  await page.addInitScript(() => {
    localStorage.setItem("catchment.welcomed", "1");
    localStorage.setItem("catchment.toured", "1");
  });
  await page.goto(url);
  await expect(page.locator(".pinrow").first()).toBeVisible({ timeout: 20_000 });
  // Dismiss guidance if a build shows it anyway.
  for (let i = 0; i < 2; i++) {
    if (await page.locator("dialog[open], .tour__note").count()) await page.keyboard.press("Escape");
  }
}

test("a first-time visitor is welcomed and walked through the app", async ({ page }) => {
  await offlineExtras(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Find the neighbourhoods worth paying for." })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("dialog", { name: "Welcome to Catchment" }).getByRole("button", { name: /San Francisco & Oakland/ }).click();
  const note = page.locator(".tour__note");
  await expect(note).toBeVisible();
  const steps = Number((await note.locator(".tour__count span").textContent())?.replace(/\D/g, ""));
  for (let k = 1; k < steps; k++) await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Start planning" }).click();
  await expect(note).toHaveCount(0);
});

test("choosing a business rescores, replans and updates the link", async ({ page }) => {
  await openPlan(page);
  await page.getByRole("radio", { name: "Pet care" }).click();
  await expect(page).toHaveURL(/p=pet-care/);
  await expect(page.locator(".pinrow")).toHaveCount(8);
  await expect(page).toHaveTitle(/Pet care in San Francisco & Oakland/);
});

test("pins stay anchored to the map, and the legend spotlights a kind of block", async ({ page }) => {
  await openPlan(page);
  // MapLibre positions each anchor absolutely; if CSS ever overrides that, pins stack in
  // page flow and drift off their circles (a real bug, found by eye).
  const anchors = page.locator(".pin-anchor");
  await expect(anchors).toHaveCount(8);
  const positions = await anchors.evaluateAll((els) => els.map((el) => getComputedStyle(el).position));
  expect(new Set(positions)).toEqual(new Set(["absolute"]));
  // Pins and rows light up together.
  await page.locator(".pinrow").nth(2).hover();
  await expect(page.locator(".pin--hot")).toHaveText("3");
  // A legend click keeps the spotlight on; a second click releases it.
  const key = page.getByRole("button", { name: /Avoided nearby/ });
  await key.click();
  await expect(key).toHaveAttribute("aria-pressed", "true");
  await key.click();
  await expect(key).toHaveAttribute("aria-pressed", "false");
});

test("export offers ZIPs, radius lines and a balanced lift test", async ({ page }) => {
  await openPlan(page);
  await page.getByRole("button", { name: "Export plan" }).click();
  await expect(page.locator(".ziptable tbody tr").first()).toBeVisible();
  await page.getByRole("tab", { name: /Radius pins/ }).click();
  await expect(page.locator(".export__code")).toContainText("mi:37.");
  await page.getByRole("tab", { name: /Lift test/ }).click();
  await expect(page.locator(".balance tbody tr")).toHaveCount(3);
  await expect(page.locator(".quality")).toHaveText(/design/);
});

test("⌘K runs commands and ⌘Z undoes them", async ({ page }) => {
  await openPlan(page);
  await page.locator(".map").click({ position: { x: 700, y: 400 } });
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox").fill("radius 3");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/r=3&/);
  await page.keyboard.press("Control+z");
  await expect(page).toHaveURL(/r=1\.5&/);
  await expect(page.locator(".toast")).toContainText("Undid radius change");
});

test("learn from results finds a change in simulated data", async ({ page }) => {
  await openPlan(page);
  await page.getByRole("button", { name: "Learn from results" }).click();
  await page.getByRole("button", { name: "Try simulated results" }).click();
  await expect(page.getByText("The simulation's hidden truth")).toBeVisible();
  await expect(page.locator(".fitbar")).not.toHaveCount(0);
});

for (const theme of ["light", "dark"] as const) {
  test(`no serious accessibility violations (${theme})`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem("catchment.theme", t), theme);
    await openPlan(page);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      // The WebGL canvas and the third-party map attribution aren't ours to fix.
      .exclude(".maplibregl-canvas")
      .exclude(".maplibregl-ctrl-attrib")
      .analyze();
    const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
  });
}
