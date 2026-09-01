// =============================================
// Benchmark runner — NOT part of the pass/fail suite.
//
// Its own config so `harness:e2e` never picks these up: a benchmark takes
// minutes, has no assertions worth failing on, and its numbers are the point.
// The projects mirror harness/e2e so a number is always attributable to a
// platform (invariant #24).
//
//   npm run harness:bench:till
// =============================================

import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.HARNESS_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: ".",
  outputDir: "../../.playwright-artifacts",
  timeout: 300_000,
  expect: { timeout: 10_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: BASE_URL, trace: "off", screenshot: "off", video: "off" },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], channel: "chrome", viewport: { width: 1440, height: 900 } },
    },
    { name: "android", use: { ...devices["Pixel 7"], channel: "chrome" } },
    { name: "ios", use: { ...devices["iPhone 13"] } },
  ],
});
