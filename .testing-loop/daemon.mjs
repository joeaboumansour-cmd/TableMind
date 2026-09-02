#!/usr/bin/env node
// The watchdog — the part of the loop that genuinely never stops.
//
// WHY THIS EXISTS, and it is not the design anyone wanted:
//
// Both in-session schedulers were tried and both silently failed here.
// `ScheduleWakeup` registered a wakeup and reported success; it never fired.
// `CronCreate` registered a recurring job that `CronList` still showed
// afterwards; it never fired either. They are the same in-session mechanism,
// which only runs while the REPL is idle, and a delegated bug sat untouched
// for eighteen minutes while the loop was believed to be running.
//
// A plain OS process has no such dependency. It ticks whether Claude is
// thinking, idle, or closed.
//
// WHAT IT CANNOT DO, stated plainly so nobody mistakes it for the whole loop:
// it cannot run exploratory charters (those drive the Browser pane, which
// lives in the Claude session) and it cannot dispatch a coder. It does the
// deterministic half — replay the locks, notice regressions, prove it is
// alive — and that half needs no tokens at all.
//
//   node .testing-loop/daemon.mjs [--interval 300] [--base http://localhost:3000]
import { execSync } from "node:child_process";
import { writeFileSync, existsSync, renameSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { getBug } from "./lib/store.mjs";

const ROOT = process.cwd();
const HEARTBEAT = resolve(ROOT, ".testing-loop/heartbeat.json");
const LOG = resolve(ROOT, ".testing-loop/daemon.log");
const STOP = resolve(ROOT, ".testing-loop/STOP");

const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf("--" + n);
  return i === -1 ? d : argv[i + 1];
};
const INTERVAL = Number(arg("interval", 300)) * 1000;
const BASE = arg("base", "http://localhost:3000");

const now = () => new Date().toISOString();
function log(line) {
  const s = `[${now().slice(11, 19)}] ${line}`;
  console.log(s);
  try {
    appendFileSync(LOG, s + "\n");
  } catch {}
}

/** Atomic, because the dashboard reads this while we write it. */
function writeHeartbeat(obj) {
  const tmp = HEARTBEAT + ".tmp";
  writeFileSync(tmp, JSON.stringify(obj, null, 2));
  renameSync(tmp, HEARTBEAT);
}

function run(cmd, env = {}) {
  try {
    const out = execSync(cmd, {
      cwd: ROOT,
      stdio: "pipe",
      encoding: "utf8",
      env: { ...process.env, ...env },
    });
    return { ok: true, out };
  } catch (e) {
    return { ok: false, out: ((e.stdout || "") + (e.stderr || "")).slice(-4000) };
  }
}

/** Is anything actually serving? A corpus run against a dead port proves nothing. */
async function serverUp(base) {
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 3000);
    await fetch(base, { signal: c.signal });
    clearTimeout(t);
    return true;
  } catch {
    return false;
  }
}

let tick = 0;

async function once() {
  tick += 1;
  const started = now();

  // 1. Pure logic. No server, no secrets, ~2s. Always runnable.
  const unit = run("npm run harness:unit");
  const unitCount = (unit.out.match(/Tests\s+(\d+) passed/) || [])[1] ?? "?";
  log(`tick ${tick}  unit: ${unit.ok ? `${unitCount} passed` : "FAILED"}`);

  // 2. The regression corpus, but only against something that answers.
  let corpus = { ok: null, out: "", skipped: true };
  let failingLocks = [];
  if (await serverUp(BASE)) {
    corpus = run(
      "npx playwright test --config harness/e2e/playwright.config.ts --project=desktop harness/e2e/regressions",
      { HARNESS_BASE_URL: BASE }
    );
    corpus.skipped = false;
    const passed = (corpus.out.match(/(\d+) passed/) || [])[1] ?? "0";
    const failed = (corpus.out.match(/(\d+) failed/) || [])[1] ?? "0";
    log(`tick ${tick}  corpus @ ${BASE}: ${passed} passed, ${failed} failed`);

    // NAME the failing locks; do not file anything.
    //
    // The first version filed a `critical` regression per failure and got both
    // halves wrong. It created a NEW bug rather than reopening the one whose
    // spec failed — and `fingerprint()` normalises digits, so "bug-0002
    // regression spec failing" and "bug-0004 …" collapsed to the same key and
    // every failure deduped into one wrong record.
    //
    // The deeper error was filing at all. A lock is written and verified
    // against the fix's own BRANCH, so it fails on `main` until that branch is
    // merged — which is not a regression, it is "not merged yet". Screaming
    // "critical" at the expected state is how a board stops being read.
    //
    // So: report the fact, attribute it to the right bugs, and let a human or
    // a tick decide. The dashboard turns the corpus indicator red either way.
    if (!corpus.ok) {
      const failing = [...new Set([...corpus.out.matchAll(/(bug-\d+)\.spec\.ts/g)].map((m) => m[1]))];
      const unmerged = failing.filter((id) => (getBug(id) || {}).status === "closed");
      failingLocks = failing;
      log(
        `tick ${tick}  locks failing on ${BASE}: ${failing.join(", ") || "(unattributed)"}` +
          (unmerged.length ? `  — all closed, so most likely not merged into this target yet` : "")
      );
    }
  } else {
    log(`tick ${tick}  corpus skipped — nothing serving ${BASE}`);
  }

  writeHeartbeat({
    alive: true,
    tick,
    startedAt: started,
    finishedAt: now(),
    nextRunAt: new Date(Date.now() + INTERVAL).toISOString(),
    intervalSeconds: INTERVAL / 1000,
    base: BASE,
    unit: { ok: unit.ok, tests: unitCount },
    corpus: corpus.skipped
      ? { skipped: true, reason: `nothing serving ${BASE}` }
      : {
          ok: corpus.ok,
          passed: Number((corpus.out.match(/(\d+) passed/) || [])[1] ?? 0),
          failed: Number((corpus.out.match(/(\d+) failed/) || [])[1] ?? 0),
          failingLocks,
        },
  });
}

async function main() {
  log(`watchdog up — every ${INTERVAL / 1000}s, corpus target ${BASE}`);
  log(`stop with: touch .testing-loop/STOP`);
  for (;;) {
    if (existsSync(STOP)) {
      log("STOP file present — watchdog exiting");
      writeHeartbeat({ alive: false, stoppedAt: now(), reason: "STOP file" });
      process.exit(0);
    }
    try {
      await once();
    } catch (e) {
      // Never die on a bad tick. A watchdog that exits on the first surprise
      // is the thing it is supposed to protect against.
      log(`tick ${tick} errored: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, INTERVAL));
  }
}

main();
