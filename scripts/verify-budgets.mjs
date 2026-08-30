#!/usr/bin/env node
// =============================================
// Performance budget verification
//
// Step 0.4 of docs/PERF-REFACTOR-PLAN.md, and one of the PERMANENT gates that
// survives Phase 9 whatever happens to the harness. It is the main reason the
// speed the refactor buys does not quietly leak away afterwards.
//
// Runs as part of `npm run build`, in the same shape as verify-sw.mjs.
//
// It asserts two things against the recorded baseline in
// docs/perf-baseline.json:
//
//   1. No route's First Load JS grew.
//   2. Total precache did not grow.
//
// A THIRD budget — serial API round trips per route — is deliberately NOT here
// yet. Measuring it needs a browser driving a signed-in session, which arrives
// with the Phase 1 harness; putting a fake version in now would be a gate that
// asserts nothing. Baseline for when it lands (store daoud, 2,280 products):
// /pos, /pos/products, /pos/cash and /transactions each issue 4 API calls at
// depth 2; /checkout issues 1. The known defect to catch is the reconcile
// id-set fetch running serially behind the catalogue delta pull.
//
// WHY A TOLERANCE EXISTS: gzip output can differ by a few bytes across zlib
// and Node versions, and a gate that goes red on a Node upgrade is a gate
// people start ignoring — which the plan explicitly warns about. The tolerance
// is protection against that noise, NOT an allowance for growth. Real growth
// is approved by re-recording the baseline on purpose:
//
//     npm run build && npm run baseline:update
// =============================================

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { measureBuild, buildExists, MISSING_BUILD_MESSAGE, ROOT } from "./lib/measure-build.mjs";

/** Noise absorption only. See the header. */
const TOLERANCE = 0.01; // 1%

const BASELINE_PATH = resolve(ROOT, "docs/perf-baseline.json");

if (!buildExists()) {
  console.error("\n[verify-budgets] FAIL\n" + MISSING_BUILD_MESSAGE + "\n");
  process.exit(1);
}

if (!existsSync(BASELINE_PATH)) {
  console.error("\n[verify-budgets] FAIL: docs/perf-baseline.json is missing.");
  console.error("    Record one with `npm run build && npm run baseline:update`.\n");
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
const current = measureBuild();

const byRoute = new Map(baseline.routes.map((r) => [r.route, r]));
const kb = (n) => (n / 1024).toFixed(1);
const pct = (cur, base) => (((cur - base) / base) * 100).toFixed(1);

const failures = [];
const newRoutes = [];

for (const cur of current.routes) {
  const base = byRoute.get(cur.route);
  if (!base) { newRoutes.push(cur); continue; }
  const limit = base.gz * (1 + TOLERANCE);
  if (cur.gz > limit) {
    failures.push({
      what: `route ${cur.route}`,
      detail: `First Load JS ${kb(cur.gz)} KB gz vs baseline ${kb(base.gz)} KB (+${pct(cur.gz, base.gz)}%)`,
    });
  }
}

// A route in the baseline that no longer exists is fine — routes get removed.
// A route that is NEW is also fine, but it is reported so its cost is seen
// rather than silently absorbed into the next re-baseline.
for (const r of newRoutes) {
  console.log(`[verify-budgets] note  new route ${r.route} at ${kb(r.gz)} KB gz (not yet budgeted)`);
}

if (baseline.precache && current.precache) {
  const limit = baseline.precache.raw * (1 + TOLERANCE);
  if (current.precache.raw > limit) {
    failures.push({
      what: "precache total",
      detail:
        `${(current.precache.raw / 1024 / 1024).toFixed(2)} MB vs baseline ` +
        `${(baseline.precache.raw / 1024 / 1024).toFixed(2)} MB (+${pct(current.precache.raw, baseline.precache.raw)}%)`,
    });
  }
}

const checked = current.routes.length - newRoutes.length;
console.log(
  `[verify-budgets] ${failures.length ? "FAIL" : "ok  "}  ${checked} routes + precache against ${baseline.recordedAt ?? "recorded"} baseline`
);

if (failures.length) {
  console.error("\n[verify-budgets] Performance budget exceeded:\n");
  for (const f of failures) console.error(`  ✗ ${f.what}\n    ${f.detail}\n`);
  console.error("This blocks the build on purpose. Either find the regression, or —");
  console.error("if the growth is intended and worth it — record it deliberately:\n");
  console.error("    npm run build && npm run baseline:update\n");
  process.exit(1);
}
