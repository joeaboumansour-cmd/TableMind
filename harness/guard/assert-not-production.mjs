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

/**
 * Hosts the harness must never touch. Additions only, never removals.
 *
 * BOTH entries stay. The database moved Seoul -> Ireland on 2026-09-01
 * (docs/REGION-MIGRATION.md) and this constant was not updated with it, so for
 * a day the guard named only the ABANDONED project: it would have printed
 * "ok — target is slxqufndzuuetykqmtfa.supabase.co" and allowed a full
 * seed-and-mutate run against the database serving live stores, with neither
 * HARNESS_ALLOW_PRODUCTION_HOST nor HARNESS_STORE_ID required.
 *
 * That is the failure this file's own header warns about, arrived at from the
 * inside: a guard whose hardcoded list goes stale is a guard that depends on
 * configuration being correct after all. Found by the exploratory tester on
 * 2026-09-02 (bug-0003) by reading the project ref out of the deployed
 * client bundle and comparing it against this set.
 *
 * **If the database ever moves again, add the new host HERE in the same commit
 * as the move** — and leave the old one, because a stale env file pointed at a
 * decommissioned project is its own kind of bad run.
 */
export const PRODUCTION_HOSTS = new Set([
  "slxqufndzuuetykqmtfa.supabase.co", // PRODUCTION — Ireland (eu-west-1), current
  "xflmpowmxcuiqxzhuqbl.supabase.co", // PRODUCTION — Seoul, pre-2026-09-01
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
    // The owner directed the harness at the main project on 2026-08-30, on the
    // grounds that it has no real clients — a survey agreed: 5 stores and 118
    // transactions is demo volume, not a live book of business.
    //
    // That is allowed, but only as a CONSCIOUS act and only CONFINED to one
    // tenant. Two keys are required rather than one because they refuse two
    // different mistakes, and either alone still ends in a bad run:
    //
    //   HARNESS_ALLOW_PRODUCTION_HOST  — "I know which database this is"
    //   HARNESS_STORE_ID               — "and the harness stays inside here"
    //
    // The second is the one doing the real work. Every table in this schema is
    // store-scoped, so a dedicated store_id is the only thing standing between
    // a seed run and the other stores' catalogues.
    const allow = readVar("HARNESS_ALLOW_PRODUCTION_HOST", envFile);
    const storeId = readVar("HARNESS_STORE_ID", envFile);

    if (allow?.value !== "yes") {
      fail([
        `${host} is the main project database.`,
        `It was picked up from ${found.from}.`,
        "",
        "The harness seeds and mutates: it writes products, rings up sales,",
        "and opens and closes cash shifts. None of it is recoverable.",
        "",
        "To run against it anyway, set BOTH in .env.test:",
        "  HARNESS_ALLOW_PRODUCTION_HOST=yes",
        "  HARNESS_STORE_ID=<a store_id the harness owns exclusively>",
      ]);
    }

    if (!storeId?.value) {
      fail([
        "HARNESS_ALLOW_PRODUCTION_HOST=yes, but HARNESS_STORE_ID is unset.",
        "",
        "Allowing the host does not by itself make a run safe — an unconfined",
        "harness would seed straight across the other tenants, which is the",
        "outcome this guard exists to prevent, reached by a different door.",
        "Refusing.",
      ]);
    }

    console.warn("");
    console.warn("  ##########################################################");
    console.warn("  #  RUNNING AGAINST THE MAIN PROJECT DATABASE             #");
    console.warn("  ##########################################################");
    console.warn(`  host   ${host}`);
    console.warn(`  store  ${storeId.value}`);
    console.warn("");
    console.warn("  Writes must stay inside that store_id. Nothing but the");
    console.warn("  harness's own scoping protects the other tenants.");
    console.warn("");
    return host;
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
