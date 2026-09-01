// =============================================
// Visual snapshots (Phase 1.5).
//
// SEPARATE CONFIG AND SEPARATE COMMAND, on purpose. These are the
// high-maintenance part of the harness: they legitimately break on every
// intentional UI change. Keeping them out of the default run means an
// intentional redesign is one deliberate `--update-snapshots`, not a wall of
// red on unrelated work — which is what the plan's Phase 9 branch A asks for
// anyway, so it may as well be true from the start.
//
// Three viewports, matching the plan: mobile 375, tablet 768, desktop 1440.
// =============================================

import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.HARNESS_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: ".",
  outputDir: "../../.playwright-artifacts",
  snapshotPathTemplate: "{testDir}/__screenshots__/{projectName}/{arg}{ext}",

  timeout: 90_000,
  expect: {
    // A few pixels of antialiasing difference is not a UI change. Too tight a
    // threshold here is the classic way a visual suite becomes noise people
    // learn to ignore.
    toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: "disabled", scale: "css" },
  },

  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],

  use: {
    baseURL: BASE_URL,
    // Deterministic rendering: no caret blink, no transitions mid-capture.
    trace: "retain-on-failure",
    screenshot: "off",
  },

  projects: [
    { name: "desktop-1440", use: { ...devices["Desktop Chrome"], channel: "chrome", viewport: { width: 1440, height: 900 } } },
    { name: "tablet-768",  use: { ...devices["Desktop Chrome"], channel: "chrome", viewport: { width: 768, height: 1024 } } },
    { name: "mobile-375",  use: { ...devices["Desktop Chrome"], channel: "chrome", viewport: { width: 375, height: 812 } } },
  ],
});
