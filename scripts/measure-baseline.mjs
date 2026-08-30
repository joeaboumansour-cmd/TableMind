#!/usr/bin/env node
// =============================================
// Bundle baseline measurement
//
// Step 0.3 of docs/PERF-REFACTOR-PLAN.md, and the input to the budget gates in
// 0.4. Reports, per route, the JavaScript a first visit must download before
// the page is interactive — plus the total precache the service worker makes
// every device fetch on every deploy.
//
// WHY IT READS THE PRERENDERED HTML rather than a manifest: Next 16 no longer
// emits `app-build-manifest.json`, and stopped printing the Size / First Load
// JS columns the older build output had. The prerendered HTML in
// .next/server/app/*.html is a better source anyway — it is literally what the
// browser receives, so the chunk list is the real one rather than a manifest's
// description of it.
//
// Route groups like (shell) are absent from these paths, exactly as they are
// absent from the URL.
//
// Sizes are reported gzipped as well as raw because gzip is what crosses the
// wire, and the ratio varies enough between chunks that raw bytes rank routes
// differently from how a shop actually experiences them.
// =============================================

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { resolve, join } from "node:path";

const ROOT = process.cwd();
const APP_DIR = resolve(ROOT, ".next/server/app");
const STATIC_DIR = resolve(ROOT, ".next/static");
const SW_PATH = resolve(ROOT, "public/sw.js");

if (!existsSync(APP_DIR)) {
  console.error("\n[baseline] FAIL: .next/server/app not found.");
  console.error("    Run `npm run build` first — and note that `npm run dev`");
  console.error("    overwrites .next, so a dev session invalidates these numbers.\n");
  process.exit(1);
}

const gzipCache = new Map();

/** Raw and gzipped size of one /_next/static/… asset. */
function assetSize(url) {
  const rel = url.replace(/^\/_next\/static\//, "").split("?")[0];
  const file = join(STATIC_DIR, rel);
  if (gzipCache.has(file)) return gzipCache.get(file);
  let out = { raw: 0, gz: 0, missing: true };
  try {
    const buf = readFileSync(file);
    out = { raw: buf.length, gz: gzipSync(buf).length, missing: false };
  } catch {
    // A referenced asset that is not on disk is worth surfacing, not hiding.
  }
  gzipCache.set(file, out);
  return out;
}

/**
 * Every JS asset a first load of this HTML pulls.
 *
 * Both `<script src>` and `<link href>` preloads count: Next emits the entry
 * chunks as scripts and the rest as preloads, and the browser fetches both
 * before the page is usable. Deduped, because a chunk listed twice is
 * downloaded once.
 */
function firstLoadAssets(html) {
  const urls = new Set();
  for (const m of html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g)) {
    if (m[1].endsWith(".js")) urls.add(m[1]);
  }
  return [...urls];
}

/** Walk .next/server/app for prerendered routes. */
function findRoutes(dir, prefix = "") {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findRoutes(p, `${prefix}/${entry.name}`));
    else if (entry.name.endsWith(".html")) {
      const base = entry.name.replace(/\.html$/, "");
      const route =
        base === "index" ? `${prefix}/` : `${prefix}/${base}`;
      out.push({ route: route.replace(/\/+/g, "/"), file: p });
    }
  }
  return out;
}

const routes = findRoutes(APP_DIR)
  .filter((r) => !r.route.startsWith("/_")) // _not-found, _global-error
  .sort((a, b) => a.route.localeCompare(b.route));

const measured = routes.map(({ route, file }) => {
  const assets = firstLoadAssets(readFileSync(file, "utf8"));
  let raw = 0, gz = 0, missing = 0;
  for (const a of assets) {
    const s = assetSize(a);
    raw += s.raw; gz += s.gz; if (s.missing) missing++;
  }
  return { route, chunks: assets.length, raw, gz, missing, assets };
});

// Chunks present on EVERY route are the shared baseline every page pays.
// Isolating it is what makes a per-route number actionable: shrinking a route
// that is 95% framework is wasted effort, and this is how you see that.
const shared = measured.length
  ? measured[0].assets.filter((a) => measured.every((m) => m.assets.includes(a)))
  : [];
const sharedSize = shared.reduce(
  (acc, a) => { const s = assetSize(a); return { raw: acc.raw + s.raw, gz: acc.gz + s.gz }; },
  { raw: 0, gz: 0 }
);

const kb = (n) => (n / 1024).toFixed(1).padStart(7);

console.log("\nFIRST LOAD JS PER ROUTE  (gzipped / raw KB, chunk count)\n");
console.log(`  ${"route".padEnd(22)} ${"gzip".padStart(7)} ${"raw".padStart(7)}  chunks`);
console.log(`  ${"-".repeat(22)} ${"-".repeat(7)} ${"-".repeat(7)}  ------`);
for (const m of [...measured].sort((a, b) => b.gz - a.gz)) {
  console.log(
    `  ${m.route.padEnd(22)} ${kb(m.gz)} ${kb(m.raw)}  ${String(m.chunks).padStart(4)}` +
      (m.missing ? `  ⚠ ${m.missing} missing` : "")
  );
}
console.log(`\n  shared by all routes:  ${kb(sharedSize.gz)} gz / ${kb(sharedSize.raw)} raw  (${shared.length} chunks)`);

// ---- precache ---------------------------------------------------------------
// What every device downloads on every deploy, and what a shop must already
// hold for the app to open during an outage.
if (existsSync(SW_PATH)) {
  const sw = readFileSync(SW_PATH, "utf8");
  const urls = [...sw.matchAll(/url:\s*"([^"]+)"/g)].map((m) => m[1]);
  let raw = 0, counted = 0, absent = 0;
  const byExt = new Map();
  for (const u of urls) {
    const clean = u.split("?")[0];
    const candidates = clean.startsWith("/_next/static/")
      ? [join(STATIC_DIR, clean.replace("/_next/static/", ""))]
      : [join(ROOT, "public", clean)];
    let size = null;
    for (const c of candidates) { try { size = statSync(c).size; break; } catch {} }
    if (size == null) { absent++; continue; }
    raw += size; counted++;
    const ext = (clean.match(/\.([a-z0-9]+)$/i)?.[1] ?? "other").toLowerCase();
    const cur = byExt.get(ext) ?? { n: 0, bytes: 0 };
    byExt.set(ext, { n: cur.n + 1, bytes: cur.bytes + size });
  }
  console.log(`\nPRECACHE  ${urls.length} entries, ${(raw / 1024 / 1024).toFixed(2)} MB raw (${counted} sized, ${absent} not on disk)\n`);
  for (const [ext, v] of [...byExt.entries()].sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 10)) {
    console.log(`  ${ext.padEnd(6)} ${String(v.n).padStart(4)} files  ${(v.bytes / 1024).toFixed(1).padStart(9)} KB`);
  }
} else {
  console.log("\nPRECACHE  public/sw.js not found — run `npm run build`.");
}

if (process.argv.includes("--json")) {
  console.log("\n" + JSON.stringify(
    { routes: measured.map(({ assets, ...r }) => r), shared: { chunks: shared.length, ...sharedSize } },
    null, 2
  ));
}
