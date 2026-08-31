// =============================================
// Playwright configuration — E2E golden flows (Phase 1.4).
//
// THREE PLATFORM PROFILES, because invariant #24 says desktop, iOS and Android
// are all first-class and a win on one that regresses another is not a win.
//
//   desktop  Blink, keyboard-first. The Pro till: ALT+1..9 lanes, wedge scanner.
//   android  Blink at a phone viewport with touch. Where frame rate is won.
//   ios      WebKit. NOT Chromium at a small size — every browser on iOS is
//            required to use WebKit, so testing "Chrome mobile" would test an
//            engine no iPhone in a Lebanese shop is running.
//
// Runs against a PRODUCTION build (`npm run start`). `next dev` compiles on
// demand, so the first hit on each route pays multi-second compilation and the
// suite would measure the compiler rather than the app.
// =============================================

import { defineConfig, devices } from "@playwright/test";

// No import.meta here: Playwright loads its config through CJS, so
// `import.meta.url` is a syntax error. Paths below are relative to THIS file,
// which is how Playwright resolves testDir and outputDir anyway.
const BASE_URL = process.env.HARNESS_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: ".",
  outputDir: "../../.playwright-artifacts",
  // Real HTTP and a remote database on every step.
  timeout: 60_000,
  expect: { timeout: 10_000 },

  // Serial. Every profile drives the SAME fixture store, so parallel workers
  // would race on stock quantities and on the single open cash shift. The
  // suite's budget is 5 minutes, which serial comfortably meets.
  workers: 1,
  fullyParallel: false,

  // Zero tolerance for flake (Phase 1 maintainability rule): a retry would
  // hide exactly the intermittency that rule exists to surface.
  retries: 0,
  forbidOnly: !!process.env.CI,

  reporter: [["list"]],

  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },

  projects: [
    // `channel: "chrome"` drives the Google Chrome already installed on this
    // machine instead of a Playwright-managed Chromium build. Same Blink
    // engine, no multi-hundred-megabyte download, and it matches the browser
    // standard the plan mandates for desktop and Android (§1) — so this is
    // arguably the more honest target, not merely the cheaper one.
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        channel: "chrome",
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: "android",
      use: {
        ...devices["Pixel 7"],
        channel: "chrome",
      },
    },
    {
      name: "ios",
      use: {
        // WebKit, and installed-PWA-shaped: no URL bar, 375x812.
        ...devices["iPhone 13"],
      },
    },
  ],
});
