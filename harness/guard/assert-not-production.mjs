#!/usr/bin/env node
// =============================================
// Production database guard — the harness's seatbelt
//
// `npm run dev` on this repo has always pointed at the LIVE Supabase project
// serving paying stores. The characterization harness SEEDS and MUTATES the
// database it is given: it writes products, rings up sales, opens and closes
// cash shifts. Pointed at production for one run it would corrupt real shops'
// takings, and there is no undo.
//
// So the rule from the refactor plan (docs/PERF-REFACTOR-PLAN.md, P-1) is a
// hard `process.exit(1)` on a hostname match, not a comment asking nicely.
//
// TWO DESIGN PROPERTIES, both deliberate:
//
//   1. It FAILS CLOSED. An unset or unparseable Supabase URL is refused, not
//      waved through. "I could not tell" must never read as "it is safe" —
//      that is the failure mode that would let a misconfigured CI job through.
//
//   2. The blocked host is HARDCODED. A guard that depends on configuration
//      being correct is not a guard, because the thing it protects against is
//      configuration being wrong. The env var below only ever ADDS hosts.
//
// The project ref is not a secret — it is baked into NEXT_PUBLIC_SUPABASE_URL
// and ships in every client bundle to every till. Committing it here leaks
// nothing that is not already public, and buys a guard that cannot be
// disarmed by an empty .env file.
// =============================================

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/** Hosts the harness must never touch. Additions only, never removals. */
const PRODUCTION_HOSTS = new Set([
  "xflmpowmxcuiqxzhuqbl.supabase.co", // PRODUCTION — paying stores
]);

/** Extra hosts to block, comma-separated. Cannot unblock the set above. */
const EXTRA_HOSTS = new Set(
  (process.env.HARNESS_BLOCKED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
);

/**
 * Read a var from the process env, falling back to an env FILE.
 *
 * The harness is run both by npm scripts (which load nothing automatically)
 * and by Playwright/Vitest configs (which may load a file). Checking both
 * means the guard sees the same value the harness will actually connect with,
 * rather than an empty process.env that would look reassuringly absent.
 */
function readVar(name, envFile) {
  if (process.env[name]) return { value: process.env[name], from: "process.env" };
  if (envFile && existsSync(envFile)) {
    const line = readFileSync(envFile, "utf8")
      .split("\n")
      .find((l) => l.trim().startsWith(`${name}=`));
    if (line) {
      const v = line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
      if (v) return { value: v, from: envFile };
    }
  }
  return null;
}

function fail(lines) {
  console.error("\n[harness-guard] REFUSED TO RUN\n");
  for (const l of lines) console.error(`  ${l}`);
  console.error("\n  The harness writes to the database it is given. See P-1 in");
  console.error("  docs/PERF-REFACTOR-PLAN.md for how to point it at staging.\n");
  process.exit(1);
}

/**
 * Throws (exits 1) unless the configured Supabase URL is a known-safe,
 * non-production host. Returns the hostname it approved.
 */
export function assertNotProduction({ envFile = resolve(process.cwd(), ".env.test") } = {}) {
  const found = readVar("NEXT_PUBLIC_SUPABASE_URL", envFile);

  if (!found) {
    fail([
      "NEXT_PUBLIC_SUPABASE_URL is not set.",
      `Checked process.env and ${envFile}.`,
      "",
      "Refusing on an absent value rather than assuming it is harmless —",
      "an unset variable is exactly what a misconfigured runner looks like.",
    ]);
  }

  let host;
  try {
    host = new URL(found.value).hostname.toLowerCase();
  } catch {
    fail([`NEXT_PUBLIC_SUPABASE_URL is not a valid URL (from ${found.from}).`]);
  }

  if (PRODUCTION_HOSTS.has(host)) {
    fail([
      `${host} is the PRODUCTION database.`,
      `It was picked up from ${found.from}.`,
      "",
      "This host serves paying stores. The harness seeds and mutates data;",
      "one run against it would corrupt real sales with no way back.",
    ]);
  }

  if (EXTRA_HOSTS.has(host)) {
    fail([
      `${host} is blocked by HARNESS_BLOCKED_HOSTS.`,
      `It was picked up from ${found.from}.`,
    ]);
  }

  console.log(`[harness-guard] ok — target is ${host} (via ${found.from})`);
  return host;
}

// Run directly (`node harness/guard/assert-not-production.mjs`) as well as
// being imported by the harness own setup files. Comparing basenames avoids
// the file:// vs Windows-path mismatch that import.meta.url comparisons hit.
import { basename } from "node:path";
if (process.argv[1] && basename(process.argv[1]) === "assert-not-production.mjs") {
  assertNotProduction();
}
