#!/usr/bin/env node
// The ratchet. A Playwright spec is written ONLY after a bug has been fixed
// and confirmed by hand, so the corpus is entirely known-real defects and
// carries no speculative maintenance. It only ever grows, and replaying it
// costs nothing.
//
//   node .testing-loop/ratchet.mjs lock --bug bug-0001 [--base http://localhost:3001]
//   node .testing-loop/ratchet.mjs run  [--base http://localhost:3000]
//   node .testing-loop/ratchet.mjs corpus
import { execSync } from "node:child_process";
import { existsSync, readdirSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getBug, move } from "./lib/store.mjs";

const ROOT = process.cwd();
// Inside harness/e2e so the existing config picks it up with no new config and
// no second Playwright install.
const DIR = resolve(ROOT, "harness/e2e/regressions");
const CONFIG = "harness/e2e/playwright.config.ts";

const rest = process.argv.slice(3);
const arg = (n) => {
  const i = rest.indexOf("--" + n);
  return i === -1 ? undefined : rest[i + 1];
};

const specFor = (bug) => resolve(DIR, bug + ".spec.ts");

/**
 * A unit test that names this bug counts as its lock.
 *
 * Matching on the bug id INSIDE the file rather than on a filename convention:
 * a pure-logic lock belongs in a file named after the thing it protects
 * (guard-hosts.test.ts), not after the ticket, and it may sit alongside other
 * cases in that file.
 */
function unitLockFor(bug) {
  const dir = resolve(ROOT, "harness/unit");
  if (!existsSync(dir)) return null;
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".test.ts"))) {
    const p = resolve(dir, f);
    if (readFileSync(p, "utf8").includes(bug)) return p;
  }
  return null;
}
const rel = (p) => p.replace(ROOT + "\\", "").replace(ROOT + "/", "").replace(/\\/g, "/");

/**
 * Desktop profile only. The three-platform sweep is what `harness:e2e` is for;
 * a ratchet that took 3x as long would stop being run after every fix, and a
 * gate nobody runs is not a gate.
 */
function play(target, base) {
  const env = { ...process.env, HARNESS_BASE_URL: base };
  execSync(
    ["npx playwright test", "--config " + CONFIG, "--project=desktop", target].join(" "),
    { cwd: ROOT, stdio: "inherit", env }
  );
}

function lock(bug, base) {
  const b = getBug(bug);
  if (!b) throw new Error("no such bug: " + bug);
  if (b.status !== "verified") {
    throw new Error("bug is '" + b.status + "', not 'verified'. The tester must confirm the fix by hand first.");
  }
  // A lock is EITHER an e2e spec or a unit test, and the unit one is better
  // whenever the defect is reachable without a browser — free forever, runs on
  // every push, no server to point at. bug-0003 was a stale constant in the
  // production guard: locking that behind Playwright would have been absurd.
  //
  // This mirrors harness/README.md's own table: put the case at the cheapest
  // tier that can actually catch it.
  const spec = specFor(bug);
  const unitSpec = unitLockFor(bug);

  if (!existsSync(spec) && !unitSpec) {
    throw new Error(
      "no lock for " + bug + ". Write the regression case first — it must FAIL on the\n" +
        "original bug and pass on the fix. Either:\n" +
        "  " + rel(specFor(bug)) + "        (browser flow)\n" +
        "  harness/unit/<name>.test.ts  mentioning " + bug + "   (pure logic — preferred)"
    );
  }

  let lock;
  if (unitSpec) {
    // No server, no base URL, nothing to point at.
    execSync("npx vitest run --config harness/vitest.config.mts " + rel(unitSpec), {
      cwd: ROOT,
      stdio: "inherit",
    });
    lock = rel(unitSpec);
  } else {
    // Against the fix's own server (:3001) while it is still a branch, so a
    // spec is never locked in on evidence from a tree nobody has verified.
    play(rel(spec), base);
    lock = rel(spec);
  }

  move(bug, "closed", "regression lock passing: " + lock);
  console.log(JSON.stringify({ ok: true, bug, lock, status: "closed" }));
}

function corpus() {
  if (!existsSync(DIR)) return [];
  return readdirSync(DIR).filter((f) => f.endsWith(".spec.ts"));
}

const cmd = process.argv[2];
try {
  mkdirSync(DIR, { recursive: true });
  if (cmd === "lock") lock(arg("bug"), arg("base") ?? "http://localhost:3001");
  else if (cmd === "run") {
    const specs = corpus();
    if (!specs.length) {
      console.log(JSON.stringify({ ok: true, specs: 0, note: "corpus empty — nothing locked yet" }));
    } else {
      play("harness/e2e/regressions", arg("base") ?? "http://localhost:3000");
      console.log(JSON.stringify({ ok: true, specs: specs.length }));
    }
  } else if (cmd === "corpus") console.log(JSON.stringify(corpus(), null, 2));
  else {
    console.log("usage: ratchet.mjs lock|run|corpus");
    process.exit(1);
  }
} catch (e) {
  console.error("[ratchet] " + (e.stderr?.toString() || e.message));
  process.exit(1);
}
