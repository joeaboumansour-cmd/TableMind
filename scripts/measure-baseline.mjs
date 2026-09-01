#!/usr/bin/env node
// =============================================
// Bundle baseline — report, and optionally record
//
// Step 0.3 of docs/PERF-REFACTOR-PLAN.md; the recorded file is what 0.4's
// budget gate enforces against.
//
//   npm run baseline            print the current numbers
//   npm run baseline -- --json  print them as JSON
//   npm run baseline:update     RECORD them as the new budget
//
// Recording is a separate, deliberate command. Bundles growing is sometimes
// correct — a new feature genuinely costs bytes — but it must be a decision
// somebody makes, not something that happens quietly because the gate
// re-baselined itself on every run.
// =============================================

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { measureBuild, toRecord, buildExists, MISSING_BUILD_MESSAGE, ROOT } from "./lib/measure-build.mjs";

if (!buildExists()) {
  console.error("\n[baseline] FAIL\n" + MISSING_BUILD_MESSAGE + "\n");
  process.exit(1);
}

const m = measureBuild();
const kb = (n) => (n / 1024).toFixed(1).padStart(7);

console.log("\nFIRST LOAD JS PER ROUTE  (gzipped / raw KB, chunk count)\n");
console.log(`  ${"route".padEnd(22)} ${"gzip".padStart(7)} ${"raw".padStart(7)}  chunks`);
console.log(`  ${"-".repeat(22)} ${"-".repeat(7)} ${"-".repeat(7)}  ------`);
for (const r of [...m.routes].sort((a, b) => b.gz - a.gz)) {
  console.log(
    `  ${r.route.padEnd(22)} ${kb(r.gz)} ${kb(r.raw)}  ${String(r.chunks).padStart(4)}` +
      (r.missing ? `  ⚠ ${r.missing} missing` : "")
  );
}
console.log(`\n  shared by all routes:  ${kb(m.shared.gz)} gz / ${kb(m.shared.raw)} raw  (${m.shared.chunks} chunks)`);

if (m.precache) {
  const p = m.precache;
  console.log(`\nPRECACHE  ${p.entries} entries, ${(p.raw / 1024 / 1024).toFixed(2)} MB raw (${p.counted} sized, ${p.absent} not on disk)\n`);
  for (const [ext, v] of Object.entries(p.byExt).sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 10)) {
    console.log(`  ${ext.padEnd(6)} ${String(v.files).padStart(4)} files  ${(v.bytes / 1024).toFixed(1).padStart(9)} KB`);
  }
} else {
  console.log("\nPRECACHE  public/sw.js not found — run `npm run build`.");
}

if (process.argv.includes("--json")) {
  console.log("\n" + JSON.stringify(toRecord(m), null, 2));
}

if (process.argv.includes("--update")) {
  const out = resolve(ROOT, "docs/perf-baseline.json");
  const record = {
    ...toRecord(m),
    recordedAt: new Date().toISOString().slice(0, 10),
    units: "bytes",
    note:
      "Budget baseline enforced by scripts/verify-budgets.mjs. Regenerate with " +
      "`npm run build && npm run baseline:update`. NOTE: `npm run dev` overwrites " +
      ".next, so always rebuild before recording.",
  };
  writeFileSync(out, JSON.stringify(record, null, 2) + "\n");
  console.log(`\n[baseline] recorded ${record.routes.length} routes to docs/perf-baseline.json`);
}
