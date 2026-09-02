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
import { existsSync, readdirSync, mkdirSync } from "node:fs";
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
  const spec = specFor(bug);
  if (!existsSync(spec)) {
    throw new Error(
      "no spec at " + rel(spec) + ".\nWrite the regression case first — it must FAIL on the original bug and pass on the fix."
    );
  }

  // Against the fix's own server (:3001) while it is still a branch, so a spec
  // is never locked in on evidence from a tree nobody has verified.
  play(rel(spec), base);

  move(bug, "closed", "regression spec passing: " + rel(spec));
  console.log(JSON.stringify({ ok: true, bug, spec: rel(spec), status: "closed" }));
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
