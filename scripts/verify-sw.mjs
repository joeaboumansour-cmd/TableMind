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
 * Isolate the generated `app-shell` route's options object.
 *
 * The worker is minified onto one line, so a bare /maxAgeSeconds/ test over the
 * whole file would match the twenty other caches that legitimately expire. We
 * need to look at THIS rule's options and nothing else.
 *
 * Workbox emits roughly:
 *   new e.NetworkFirst({cacheName:"app-shell",networkTimeoutSeconds:3,
 *                       plugins:[new e.ExpirationPlugin({maxEntries:64})]})
 *
 * Returns null when the rule is absent.
 */
function appShellOptions(sw) {
  const marker = /cacheName:\s*"app-shell"/.exec(sw);
  if (!marker) return null;

  // Walk forward from the cacheName to the end of the enclosing options
  // object by counting braces, so nested plugin objects are included and the
  // next rule is not.
  const start = marker.index;
  let depth = 1; // we start inside the options object
  for (let i = start; i < sw.length; i++) {
    const c = sw[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return sw.slice(start, i);
    }
  }
  return sw.slice(start); // unbalanced — hand back what we have
}

/**
 * Every URL in the generated precache manifest.
 *
 * Workbox emits it as `precacheAndRoute([{revision:"…",url:"/…"}, …])` inside
 * the minified worker, so the urls are recoverable with a plain scan — there
 * is nothing else in the file shaped like `url:"…"`.
 */
function precachedUrls(sw) {
  return [...sw.matchAll(/url:\s*"([^"]+)"/g)].map((m) => m[1]);
}

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
  {
    name: "the `app-shell` navigation rule exists",
    test: (sw) => appShellOptions(sw) !== null,
    why: [
      "This is the rule that lets the POS cold-open with no internet. It is a",
      "custom runtimeCaching entry in next.config.ts matching",
      "`sameOrigin && request.mode === 'navigate'` with cacheName 'app-shell'.",
      "Without it, navigations fall through to the default `pages` rule, whose",
      "24-hour expiration means the app stops opening after a day offline.",
    ].join("\n    "),
  },
  {
    name: "`app-shell` never expires (no maxAgeSeconds)",
    test: (sw) => {
      const opts = appShellOptions(sw);
      return opts !== null && !/maxAgeSeconds/.test(opts);
    },
    why: [
      "A maxAgeSeconds on the app shell IS the app's offline shelf life.",
      "Workbox's ExpirationPlugin treats an entry past its age as a miss and",
      "deletes it, so the POS would open on day 1 of an outage and fail on",
      "day 2 — the exact scenario this app is built for. Stale HTML is not a",
      "risk here: NetworkFirst always prefers the network, so a stale shell is",
      "only ever served when there is no network. Use maxEntries alone.",
    ].join("\n    "),
  },
  {
    name: "the precache manifest excludes source maps",
    test: (sw) => !precachedUrls(sw).some((u) => u.endsWith(".map")),
    why: [
      "workboxOptions.exclude in next.config.ts REPLACES next-pwa's defaults",
      "the same way runtimeCaching does — supplying a custom array without",
      "re-listing /\\.map$/, the .woff2 rule and /^manifest.*\\.js$/ silently",
      "adds megabytes of source maps to every install and every SW update.",
      "Re-add the three default entries alongside whatever you were adding.",
    ].join("\n    "),
  },
  {
    name: "the PDF exporter is NOT precached",
    test: (sw) => !precachedUrls(sw).some((u) => u.includes("pdf-export")),
    why: [
      "html2pdf.js + jsPDF + html2canvas is ~918KB — 22% of the whole",
      "precache — and serves one Download button on /receipt/[id], the public",
      "page a CUSTOMER opens from a receipt QR. The till never loads it and it",
      "cannot work offline anyway. It is excluded by the /pdf-export/ entry in",
      "workboxOptions.exclude, which only matches because the splitChunks group",
      "in nextConfig.webpack gives it a stable name. Losing either half puts",
      "the megabyte back.",
    ].join("\n    "),
  },
  {
    name: "the charting stack is NOT precached",
    test: (sw) => !precachedUrls(sw).some((u) => u.includes("charts")),
    why: [
      "recharts + victory-vendor + d3 is ~345KB, and EVERY screen that draws a",
      "chart gets its data from the network — the cash page's register",
      "performance from get_register_performance, the analytics panel from",
      "/api/transactions/analytics. Offline there is nothing to plot, so",
      "precaching the plotting library costs every device 345KB at INSTALL,",
      "and holds it on a disk that also holds queued sales, while buying a",
      "shop nothing. Runtime caching picks it up on first use, which is",
      "necessarily online.",
      "",
      "Same two-part mechanism as the PDF exporter: the /charts/ entry in",
      "workboxOptions.exclude only matches because the `charts` splitChunks",
      "group in nextConfig.webpack gives it a stable name. Losing either half",
      "puts it back.",
      "",
      "NOTE this is deliberately NOT the same call as ZXing, which is 560KB,",
      "also behind next/dynamic, and stays precached: mobile is camera-first",
      "and scanning offline is core to the product.",
    ].join("\n    "),
  },
  {
    name: "the iOS launch screens are NOT precached",
    test: (sw) => !precachedUrls(sw).some((u) => u.includes("/splash/")),
    why: [
      "The 15 apple-touch-startup-image files are 864KB, of which any one",
      "device uses exactly ONE — and iOS shows the startup image BEFORE the",
      "web app runs, so the service worker is not alive to serve it and has no",
      "say in the matter. Precaching them is pure waste on every install.",
      "They are excluded by `!splash/**/*` in publicExcludes — note",
      "publicExcludes, NOT workboxOptions.exclude, which only filters WEBPACK",
      "assets and never sees files copied out of public/. Putting it in the",
      "wrong one silently does nothing, which is how this check earned its",
      "place.",
    ].join("\n    "),
  },
  {
    name: "`app-shell` falls back to cache quickly (networkTimeoutSeconds)",
    test: (sw) => {
      const opts = appShellOptions(sw);
      return opts !== null && /networkTimeoutSeconds:\s*\d+/.test(opts);
    },
    why: [
      "Without a network timeout, NetworkFirst waits for the browser's own",
      "timeout (30-90s) before consulting the cache. This app's signature",
      "failure is wifi associated with no upstream, where the request hangs",
      "rather than failing fast — so the till freezes on launch instead of",
      "opening from cache. Set networkTimeoutSeconds in next.config.ts.",
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
