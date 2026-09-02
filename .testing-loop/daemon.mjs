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
// TWO MODES:
//
//   default   deterministic only — replay the locks, run the unit suite,
//             notice failures, prove it is alive. Zero tokens, forever.
//
//   --agent   additionally shells out to `claude -p` when, and ONLY when,
//             there is a bug sitting in "delegated". That is what closes the
//             gap above: a bug you drag into "Fix it" gets a coder within one
//             interval instead of waiting for someone to talk to Claude.
//             No delegated work, no call, no tokens.
//
// WHAT NEITHER MODE CAN DO: run an exploratory charter, or hand re-test a fix.
// Both drive the Browser pane, which only exists inside an interactive Claude
// session. Those still need you at the keyboard.
//
//   node .testing-loop/daemon.mjs [--interval 300] [--base URL] [--agent]
import { execSync } from "node:child_process";
import { writeFileSync, existsSync, renameSync, appendFileSync, readFileSync } from "node:fs";
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
// Opt-in. Without it the watchdog is purely deterministic and costs nothing.
const AGENT = argv.includes("--agent");

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

/**
 * Where the Claude CLI lives.
 *
 * Resolved explicitly rather than trusting PATH: the first thing on PATH here
 * was a broken `claude.exe` stub inside an unrelated npm package, which fails
 * with "not a valid application for this OS platform" and would have looked
 * like an auth problem.
 */
const CLAUDE =
  process.env.TESTING_LOOP_CLAUDE ??
  resolve(process.env.APPDATA ?? "", "npm", "claude.cmd");

const digest = () => JSON.parse(execSync("node .testing-loop/cli.mjs state", { cwd: ROOT, encoding: "utf8" }));

/** How many fixes are already in flight. */
const openCoders = () =>
  JSON.parse(execSync("node .testing-loop/worktree.mjs list", { cwd: ROOT, encoding: "utf8" })).length;

async function agentTick() {
  const state = digest();
  const out = { ran: false, locked: [], dispatched: null };

  // Deterministic: a verified bug with a lock already written just needs the
  // ratchet run. No judgement, so no model.
  for (const line of state.known) {
    const id = line.split(" ")[0];
    const bug = JSON.parse(execSync(`node .testing-loop/cli.mjs show --id ${id}`, { cwd: ROOT, encoding: "utf8" }));
    if (bug?.status !== "verified") continue;
    try {
      execSync(`node .testing-loop/ratchet.mjs lock --bug ${id}`, { cwd: ROOT, stdio: "pipe" });
      out.locked.push(id);
      log(`tick ${tick}  locked ${id}`);
    } catch {
      log(`tick ${tick}  ${id} is verified but its lock does not pass here — left alone`);
    }
  }

  const cfg = JSON.parse(readFileSync(resolve(ROOT, ".testing-loop/config.json"), "utf8"));
  const max = cfg.budget?.maxCoderConcurrency ?? 1;
  const target = state.delegated[0];
  if (!target) return out;
  if (openCoders() >= max) {
    log(`tick ${tick}  ${state.delegated.length} delegated, but ${openCoders()}/${max} coders busy`);
    return out;
  }

  log(`tick ${tick}  dispatching coder for ${target.id} via claude -p`);
  execSync(`node .testing-loop/cli.mjs move --id ${target.id} --to fixing --note "dispatched by watchdog"`, { cwd: ROOT, stdio: "pipe" });
  execSync(`node .testing-loop/worktree.mjs create --bug ${target.id}`, { cwd: ROOT, stdio: "pipe" });

  const prompt = [
    `Invoke the \`bug-coder\` skill and follow it exactly. Fix ${target.id}.`,
    `Your worktree is .worktrees/${target.id} (branch fix/${target.id}). Read the bug with:`,
    `node .testing-loop/cli.mjs show --id ${target.id}`,
    `Run .testing-loop commands from the repo root; make every source edit inside the worktree.`,
    `Prove it with: node .testing-loop/gate.mjs --dir .worktrees/${target.id} --full  (must exit 0)`,
    `Then commit inside the worktree only, and hand back with:`,
    `node .testing-loop/cli.mjs move --id ${target.id} --to needs-verify --note "<one line>"`,
    `If the gate fails, leave it at fixing, do not commit, and say what failed.`,
  ].join(" ");

  // --permission-mode acceptEdits, NOT --dangerously-skip-permissions: file
  // edits go through unattended (that is the point), but the confinement that
  // matters is elsewhere anyway — the coder works in a throwaway worktree, the
  // gate refuses the deny-list, and nothing here can merge or push.
  execSync(`"${CLAUDE}" -p "${prompt.replace(/"/g, '\\"')}" --permission-mode acceptEdits`, {
    cwd: ROOT,
    stdio: "pipe",
    encoding: "utf8",
    timeout: 15 * 60 * 1000,
  });

  out.ran = true;
  out.dispatched = target.id;
  log(`tick ${tick}  coder finished for ${target.id}`);
  return out;
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

  // 3. The autonomous half, and it is OPT-IN (`--agent`).
  //
  // Two things happen here, and only one of them costs anything:
  //
  //   - Locking a `verified` bug is deterministic, so the daemon just runs the
  //     ratchet. No model involved.
  //   - Dispatching a coder to a `delegated` bug needs judgement, so it shells
  //     out to `claude -p`. THIS is what closes the gap that made the loop
  //     feel broken: a bug dragged into "Fix it" sat untouched for eighteen
  //     minutes because the only thing that could act on it was a Claude
  //     session nobody was talking to.
  //
  // The agent is invoked ONLY when there is delegated work. No work, no call,
  // no tokens — which is the whole reason a loop that never stops is
  // affordable.
  //
  // It cannot explore and it cannot hand re-test a fix: both drive the Browser
  // pane, which lives in an interactive session. Those still need you.
  let agent = { enabled: AGENT, ran: false };
  if (AGENT) {
    try {
      agent = { ...agent, ...(await agentTick()) };
    } catch (e) {
      log(`tick ${tick}  agent errored: ${e.message}`);
      agent.error = e.message;
    }
  }

  writeHeartbeat({
    alive: true,
    tick,
    agent,
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
