// =============================================
// Build measurement — the shared source of truth
//
// Used by BOTH `scripts/measure-baseline.mjs` (which reports and records) and
// `scripts/verify-budgets.mjs` (which enforces). One implementation, because
// a gate that measures differently from the reporter is a gate that fails for
// reasons nobody can reproduce.
//
// WHY IT READS PRERENDERED HTML: Next 16 no longer emits
// `app-build-manifest.json`, and no longer prints the Size / First Load JS
// columns older versions did. The HTML in `.next/server/app/*.html` is what
// the browser is actually handed, so its chunk list is the real one rather
// than a manifest's description of one.
//
// Route groups like (shell) are absent from these paths, exactly as they are
// absent from the URL.
// =============================================

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { resolve, join } from "node:path";

export const ROOT = process.cwd();
const APP_DIR = resolve(ROOT, ".next/server/app");
const STATIC_DIR = resolve(ROOT, ".next/static");
const SW_PATH = resolve(ROOT, "public/sw.js");

export function buildExists() {
  return existsSync(APP_DIR);
}

export const MISSING_BUILD_MESSAGE =
  "  .next/server/app not found. Run `npm run build` first.\n" +
  "  Note `npm run dev` overwrites .next, so a dev session invalidates these numbers.";

const sizeCache = new Map();

function assetSize(url) {
  const rel = url.replace(/^\/_next\/static\//, "").split("?")[0];
  const file = join(STATIC_DIR, rel);
  if (sizeCache.has(file)) return sizeCache.get(file);
  let out = { raw: 0, gz: 0, missing: true };
  try {
    const buf = readFileSync(file);
    out = { raw: buf.length, gz: gzipSync(buf).length, missing: false };
  } catch {
    // Referenced but absent — surfaced, never silently treated as zero.
  }
  sizeCache.set(file, out);
  return out;
}

/**
 * Every JS asset a first load pulls.
 *
 * `<script src>` and `<link href>` preloads both count: Next emits entry
 * chunks as scripts and the rest as preloads, and the browser fetches both
 * before the page is usable. Deduped — a chunk listed twice downloads once.
 */
function firstLoadAssets(html) {
  const urls = new Set();
  for (const m of html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g)) {
    if (m[1].endsWith(".js")) urls.add(m[1]);
  }
  return [...urls];
}

function findRoutes(dir, prefix = "") {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findRoutes(p, `${prefix}/${entry.name}`));
    else if (entry.name.endsWith(".html")) {
      const base = entry.name.replace(/\.html$/, "");
      const route = base === "index" ? `${prefix}/` : `${prefix}/${base}`;
      out.push({ route: route.replace(/\/+/g, "/"), file: p });
    }
  }
  return out;
}

/** Total bytes the service worker makes every device fetch on every deploy. */
function measurePrecache() {
  if (!existsSync(SW_PATH)) return null;
  const sw = readFileSync(SW_PATH, "utf8");
  const urls = [...sw.matchAll(/url:\s*"([^"]+)"/g)].map((m) => m[1]);
  let raw = 0, counted = 0, absent = 0;
  const byExt = {};
  for (const u of urls) {
    const clean = u.split("?")[0];
    const candidate = clean.startsWith("/_next/static/")
      ? join(STATIC_DIR, clean.replace("/_next/static/", ""))
      : join(ROOT, "public", clean);
    let size = null;
    try { size = statSync(candidate).size; } catch { absent++; continue; }
    raw += size; counted++;
    const ext = (clean.match(/\.([a-z0-9]+)$/i)?.[1] ?? "other").toLowerCase();
    byExt[ext] = byExt[ext] ?? { files: 0, bytes: 0 };
    byExt[ext].files++; byExt[ext].bytes += size;
  }
  return { entries: urls.length, raw, counted, absent, byExt };
}

/** The full picture: per-route first-load JS, the shared chunk, and precache. */
export function measureBuild() {
  const routes = findRoutes(APP_DIR)
    .filter((r) => !r.route.startsWith("/_"))
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

  // Chunks on EVERY route are the shared baseline every page pays. Isolating
  // it is what makes a per-route number actionable — shrinking a route that is
  // mostly framework is wasted effort, and this is how that becomes visible.
  const shared = measured.length
    ? measured[0].assets.filter((a) => measured.every((m) => m.assets.includes(a)))
    : [];
  const sharedSize = shared.reduce(
    (acc, a) => { const s = assetSize(a); return { raw: acc.raw + s.raw, gz: acc.gz + s.gz }; },
    { raw: 0, gz: 0 }
  );

  return {
    routes: measured,
    shared: { chunks: shared.length, ...sharedSize },
    precache: measurePrecache(),
  };
}

/**
 * Strip the asset lists — what gets committed as the recorded baseline.
 *
 * The per-route chunk URLs are hashed and change on every build, so committing
 * them would make `docs/perf-baseline.json` churn on every commit and bury the
 * numbers that actually matter in diff noise.
 */
export function toRecord(m) {
  return {
    routes: m.routes.map((r) => ({
      route: r.route, chunks: r.chunks, raw: r.raw, gz: r.gz, missing: r.missing,
    })),
    shared: m.shared,
    precache: m.precache
      ? { entries: m.precache.entries, raw: m.precache.raw, counted: m.precache.counted }
      : null,
  };
}
