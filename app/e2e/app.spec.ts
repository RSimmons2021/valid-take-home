import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { offlineExtras, openPlan } from "./helpers";

test("first-time visitors can safely wait for data and complete the tour", async ({ page }) => {
  await offlineExtras(page);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/data/index.json", async (route) => {
    await pending;
    await route.continue();
  });
  await page.goto("/");
  try {
    await expect(page.getByRole("button", { name: "About the data" })).toBeDisabled();
    await page.keyboard.press("e");
    await expect(page.getByText("Loading Overture data")).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  } finally {
    release();
  }
  const welcome = page.getByRole("dialog", { name: "Welcome to Catchment" });
  await expect(welcome).toBeVisible({ timeout: 40_000 });
  await welcome.getByRole("button", { name: /San Francisco & Oakland/ }).click();
  const note = page.locator(".tour__note");
  await expect(note).toBeVisible();
  const steps = Number((await note.locator(".tour__count span").textContent())?.replace(/\D/g, ""));
  for (let k = 1; k < steps; k++) await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Start planning" }).click();
  await expect(note).toHaveCount(0);
});

test("buyers can replan for a business and export the resulting locations", async ({ page }) => {
  await openPlan(page);
  const pinNames = page.locator(".pinrow__name");
  const firstPin = await pinNames.first().innerText();
  await page.getByRole("radio", { name: "Pet care" }).click();
  await expect(page).toHaveURL(/p=pet-care/);
  await expect(page).toHaveTitle(/Pet care in San Francisco & Oakland/);
  await expect(pinNames).toHaveCount(8);
  await expect(pinNames.first()).not.toHaveText(firstPin);

  await page.getByRole("button", { name: "Export plan" }).click();
  const exportDialog = page.getByRole("dialog", { name: "Export plan" });
  await expect(exportDialog.getByRole("button", { name: /Copy [1-9]\d* ZIPs/ })).toBeEnabled();
  await exportDialog.getByRole("tab", { name: /Radius pins/ }).click();
  await expect(exportDialog.getByRole("button", { name: "Copy 8 lines" })).toBeEnabled();
  const editorCsv = exportDialog.getByRole("button", { name: "Download Editor CSV" });
  await expect(editorCsv).toBeDisabled();
  await exportDialog.getByRole("textbox", { name: "Campaign name in Google Ads Editor" }).fill("Bay Area, Pet care");
  const [csv] = await Promise.all([page.waitForEvent("download"), editorCsv.click()]);
  const lines = (await readFile(await csv.path(), "utf8")).trim().split("\n");
  expect(lines).toHaveLength(9);
  expect(lines[0]).toBe("Campaign,Location");
  expect(lines[1]).toMatch(/^"Bay Area, Pet care",\(1\.5mi:37\.\d{6}:-122\.\d{6}\)$/);
  await exportDialog.getByRole("tab", { name: /Lift test/ }).click();
  await expect(exportDialog.getByRole("button", { name: "Copy test ZIPs" })).toBeEnabled();
  await expect(exportDialog.getByRole("button", { name: "Copy control ZIPs" })).toBeEnabled();
});

test("pins stay anchored to the map, and the legend spotlights a kind of block", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
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

test("⌘K runs commands and ⌘Z undoes them", async ({ page }) => {
  await openPlan(page);
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

test("an incomplete share link recovers to a working plan", async ({ page }) => {
  await openPlan(page, "/#/%");
  await expect(page).toHaveURL(/#\/sf-bay\?/);
  await expect(page.getByRole("button", { name: "Export plan" })).toBeEnabled();
});

test("phone users can export and find sharing without horizontal scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openPlan(page);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await expect(page.getByRole("button", { name: "Export plan" })).toBeInViewport({ ratio: 1 });
  }
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("combobox").fill("copy link");
  await expect(page.getByRole("option", { name: /Copy link to this plan/ })).toBeVisible();
});
