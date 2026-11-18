import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end and accessibility checks against the production build, served statically
 * (no API, so AI is off: the app must work fully without it). External requests (map tiles,
 * fonts) are blocked in the tests so results don't depend on the network.
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 45_000,
  fullyParallel: true,
  // The map is WebGL in a software renderer; a few workers keep runs fast without starving each other.
  workers: 3,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: "http://localhost:4174",
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npx vite preview --port 4174 --strictPort",
    url: "http://localhost:4174",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
