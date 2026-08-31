#!/usr/bin/env node
// =============================================
// Phase 1.7 — does the net actually catch anything?
//
//   npm run harness:mutation
//
// "A net that has never caught anything is not known to work." This
// deliberately breaks one §1 invariant at a time, runs the suite that should
// notice, and asserts that it FAILS. A mutation that survives is a hole.
//
// ── SAFETY ───────────────────────────────────────────────────────────────────
// Every mutation edits a file under src/ and is reverted in a `finally`, from
// the ORIGINAL TEXT held in memory — not by `git checkout`, so an unrelated
// uncommitted change cannot be destroyed by a revert.
//
// It refuses to start unless the working tree is clean, so a crash mid-run
// leaves a diff that is obviously this script's and trivially recoverable, and
// it re-checks cleanliness at the end.
// ─────────────────────────────────────────────────────────────────────────────
//
// Only the FAST suites are used (unit, and contract where the invariant is
// server-side). A mutation run that took twenty minutes would never be run.
// =============================================

import { readFileSync, writeFileSync } from "node:fs";
import { execSync, spawnSync } from "node:child_process";
import { resolve } from "node:path";

const ROOT = process.cwd();

/**
 * Each mutation names the invariant it breaks and the suite that must notice.
 *
 * `find` must appear EXACTLY ONCE in the file — an ambiguous match would
 * silently mutate the wrong thing and prove nothing.
 */
const MUTATIONS = [
  {
    id: "money-rounding",
    invariant: "#2 — rounding happens at the cart total only",
    file: "src/lib/utils/format.ts",
    find: "return Math.round(amount / LL_ROUND_UNIT) * LL_ROUND_UNIT;",
    replace: "return Math.round(amount);",
    suite: "unit",
    why: "If rounding stops snapping to 5,000 LL, customers are charged amounts no Lebanese till can take.",
  },
  {
    id: "wrong-exchange-rate",
    invariant: "#3 — SELL_RATE when the customer pays, RETURN_RATE when money goes back",
    file: "src/lib/utils/format.ts",
    find: "export const RETURN_RATE = 89000;",
    replace: "export const RETURN_RATE = 90000;",
    suite: "unit",
    why: "Collapsing the spread silently gives away the store's margin on every USD transaction.",
  },
  {
    id: "sellable-strict-equality",
    invariant: "#16 — isSellable is `!== 'ingredient'`, never `=== 'sellable'`",
    file: "src/lib/products/kind.ts",
    find: 'return product.kind !== "ingredient";',
    replace: 'return product.kind === "sellable";',
    suite: "unit",
    why: "A device whose IndexedDB predates migration 030 would show an EMPTY catalogue on the busiest screen in the app.",
  },
  {
    id: "modifiers-empty-collapsed-to-null",
    invariant: "#17 — [] and null mean different things to the kitchen board",
    file: "src/lib/pos/lineItems.ts",
    find: "modifiers: item.modifiers ?? null,",
    // NOT `|| null`. An empty array is TRUTHY in JavaScript, so `[] || null`
    // is `[]` and `??` and `||` behave identically for this field — that
    // mutation changed nothing and "survived" for a reason that said nothing
    // about the net. This is the real shape of the bug the invariant guards
    // against: emptiness treated as absence.
    replace: "modifiers: item.modifiers?.length ? item.modifiers : null,",
    suite: "unit",
    why: "Collapsing [] to null makes the kitchen board treat a menu line as an ordinary retail sale, so the ticket never appears.",
  },
  {
    id: "reconcile-deletes-on-partial-evidence",
    invariant: "#8 — deletion requires positive proof the ID set is complete",
    file: "src/lib/products/refresh.ts",
    find: "  if (fetchedIdCount !== liveCount) {",
    replace: "  if (false && fetchedIdCount !== liveCount) {",
    suite: "unit",
    why: "This is the 1,000-row truncation bug: the local catalogue is wiped and re-pulled forever.",
  },
  {
    id: "stock-decrement-per-unit-rounding",
    invariant: "#9 — integerise ONCE at the whole line, never per unit",
    file: "src/lib/pos/lineItems.ts",
    find: "add(m.ingredient_product_id, Math.round(m.ingredient_qty * m.count * item.quantity));",
    replace: "add(m.ingredient_product_id, Math.round(m.ingredient_qty) * m.count * item.quantity);",
    suite: "unit",
    why: "Per-unit rounding compounds: 2.5g x 4 becomes 12g instead of 10g, and ingredient counts drift every sale.",
  },
  {
    id: "permissions-truthy",
    invariant: "#21/#23 — a permission is granted only on the literal boolean true",
    file: "src/lib/auth/permissions.ts",
    find: "perms[key] = source[key] === true;",
    replace: "perms[key] = !!source[key];",
    suite: "unit",
    why: 'A stored "false" string, or any truthy junk, would grant the pricing permission.',
  },
];

const SUITES = {
  unit: ["npx", ["vitest", "run", "--config", "harness/vitest.config.mts"]],
  contract: ["npx", ["vitest", "run", "--config", "harness/contract/vitest.config.mts"]],
};

function treeIsClean() {
  const out = execSync("git status --porcelain", { cwd: ROOT, encoding: "utf8" });
  return out.trim() === "";
}

/**
 * Put a file back, and do not give up quietly.
 *
 * A plain writeFileSync in a `finally` is not enough on Windows: the first run
 * of this script hit `UNKNOWN: unknown error` (a transient lock — an editor,
 * a watcher, or a virus scanner holding the handle) while restoring
 * lineItems.ts, and LEFT THE MUTATION IN THE WORKING TREE. A tool that breaks
 * code on purpose must be far more careful than that about putting it back.
 *
 * Retries, then falls back to `git checkout` of that ONE path, then shouts.
 */
function restore(path, original, id) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      writeFileSync(path, original);
      return true;
    } catch {
      // Busy-wait briefly; this is a lock, not a logic error.
      const until = Date.now() + 200 * attempt;
      while (Date.now() < until) { /* spin */ }
    }
  }
  try {
    execSync(`git checkout -- "${path}"`, { cwd: ROOT, stdio: "ignore" });
    console.error(`
[mutation] ${id}: write failed; restored via git checkout.`);
    return true;
  } catch {
    console.error(`
[mutation] !!! COULD NOT RESTORE ${path} after mutation "${id}".`);
    console.error(`[mutation] !!! RUN: git checkout -- ${path}`);
    return false;
  }
}

function runSuite(name) {
  const [cmd, args] = SUITES[name];
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", shell: true });
  return r.status === 0;
}

// ---- run --------------------------------------------------------------------

if (!treeIsClean()) {
  console.error("\n[mutation] REFUSING: the working tree is not clean.\n");
  console.error("  This script edits files under src/ and reverts them. Starting from a");
  console.error("  dirty tree makes it impossible to tell its changes from yours if it");
  console.error("  crashes. Commit or stash first.\n");
  process.exit(1);
}

console.log(`\n[mutation] ${MUTATIONS.length} invariants, each broken on purpose.\n`);

const results = [];

for (const m of MUTATIONS) {
  const path = resolve(ROOT, m.file);
  const original = readFileSync(path, "utf8");

  const occurrences = original.split(m.find).length - 1;
  if (occurrences !== 1) {
    results.push({ ...m, outcome: "SKIPPED", detail: `anchor found ${occurrences}x, need exactly 1` });
    console.log(`  SKIP  ${m.id} — anchor found ${occurrences}x (code moved?)`);
    continue;
  }

  try {
    writeFileSync(path, original.replace(m.find, m.replace));
    process.stdout.write(`  ...   ${m.id} (${m.suite})`);
    const passed = runSuite(m.suite);
    // The suite PASSING with a broken invariant is the failure we care about.
    const caught = !passed;
    results.push({ ...m, outcome: caught ? "CAUGHT" : "SURVIVED" });
    process.stdout.write(`\r  ${caught ? "CAUGHT  " : "SURVIVED"} ${m.id}${" ".repeat(30)}\n`);
  } finally {
    // Always, from the text held in memory. Falls back to git for this one
    // path only if the write cannot be made to stick.
    if (!restore(path, original, m.id)) process.exit(2);
  }
}

if (!treeIsClean()) {
  console.error("\n[mutation] WARNING: the tree is dirty after the run. Check `git diff`.\n");
}

// ---- report -----------------------------------------------------------------

const survived = results.filter((r) => r.outcome === "SURVIVED");
const caught = results.filter((r) => r.outcome === "CAUGHT");
const skipped = results.filter((r) => r.outcome === "SKIPPED");

console.log(`\n  caught ${caught.length}/${results.length - skipped.length}` +
            (skipped.length ? `, ${skipped.length} skipped` : ""));

if (survived.length) {
  console.error("\n[mutation] HOLES IN THE NET — these breakages went unnoticed:\n");
  for (const s of survived) {
    console.error(`  x ${s.id}`);
    console.error(`      invariant: ${s.invariant}`);
    console.error(`      cost:      ${s.why}\n`);
  }
  console.error("Add a test that fails on each, then re-run.\n");
  process.exit(1);
}

console.log("\n[mutation] Every deliberate breakage was caught.\n");
