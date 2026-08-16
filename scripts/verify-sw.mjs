#!/usr/bin/env node
// =============================================
// Service worker build verification
//
// public/sw.js is GENERATED at build time and gitignored, so it is never
// reviewed and cannot drift in a diff — it drifts silently when next.config.ts
// changes without a rebuild. That has now bitten this project twice (see
// docs/AUDIT-2026-08.md P0-7), both times taking out offline behaviour in a
// way nothing in the test suite could catch.
//
// This asserts the two runtime-caching rules the app's offline promise depends
// on actually made it into the generated worker.
// =============================================

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const SW_PATH = resolve(process.cwd(), "public/sw.js");

/**
 * Each check names what breaks if the rule is missing, so a CI failure is
 * self-explanatory to whoever hits it.
 */
const CHECKS = [
  {
    name: "/api/health is NetworkOnly",
    test: (sw) => /NetworkOnly/.test(sw) && /api\/health/.test(sw),
    why: [
      "The connectivity heartbeat probes /api/health to detect real internet",
      "access. If the service worker is allowed to cache it, the app serves a",
      "cached 200 forever: offline banners never appear and sync never fires",
      "on reconnect. Requires the /api/health rule in next.config.ts.",
    ].join("\n    "),
  },
  {
    name: "HTML navigations are cached (default `pages` runtime rule)",
    test: (sw) => /cacheName:\s*"pages"/.test(sw),
    why: [
      "HTML is deliberately NOT precached (it would freeze users on stale",
      "content), so the default `pages` NetworkFirst rule is the ONLY thing",
      "that caches documents. Without it the POS cannot open with no internet.",
      "Usually means `extendDefaultRuntimeCaching: true` was dropped from",
      "next.config.ts, which makes a custom runtimeCaching array REPLACE all",
      "19 defaults instead of extending them.",
    ].join("\n    "),
  },
];

if (!existsSync(SW_PATH)) {
  console.error("\n[verify-sw] FAIL: public/sw.js does not exist.");
  console.error("    Run `npm run build` first — the worker is generated at build time.\n");
  process.exit(1);
}

const sw = readFileSync(SW_PATH, "utf8");
const failures = CHECKS.filter((c) => !c.test(sw));

for (const check of CHECKS) {
  console.log(`[verify-sw] ${failures.includes(check) ? "FAIL" : "ok  "}  ${check.name}`);
}

if (failures.length > 0) {
  console.error("\n[verify-sw] Generated service worker is missing required rules:\n");
  for (const f of failures) {
    console.error(`  ✗ ${f.name}\n    ${f.why}\n`);
  }
  console.error("Fix next.config.ts and rebuild. Do not ship this worker.\n");
  process.exit(1);
}

console.log("[verify-sw] Service worker OK.");
