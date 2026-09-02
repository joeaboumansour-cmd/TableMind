// The bug ledger. Files on disk, one JSON per bug, because the tester, the
// dashboard and the orchestrator are three separate processes and a file is
// the only thing all three can read without a running service.
import { readFileSync, writeFileSync, readdirSync, existsSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import { fingerprint } from "./fingerprint.mjs";

const ROOT = resolve(process.cwd(), ".testing-loop");
const BUGS = resolve(ROOT, "bugs");

export const STATUSES = [
  "open",         // found, awaiting your triage
  "delegated",    // you dragged it to Fix
  "fixing",       // a coder subagent owns it
  "needs-verify", // coder says done; tester must re-test by hand
  "verified",     // tester confirmed by hand; ratchet writes the spec
  "closed",       // spec in the corpus and passing
  "reopened",     // re-test failed; back to the coder
  "wontfix",      // real, not worth fixing
  "not-a-bug",    // reproduced and the app was right; the report was wrong
];

/**
 * Statuses that leave the board.
 *
 * They keep their FINGERPRINT, which is the point: the tester will observe
 * this behaviour again on the next charter over the same screen, and the
 * ledger must recognise it and stay quiet. Deleting the record instead would
 * re-file the same card every night.
 *
 * `closed` is not here. A closed bug is one a regression spec holds shut, so
 * seeing it again is a real regression and must come back loudly — see the
 * reopen branch in report().
 */
const OFF_BOARD = ["closed", "wontfix", "not-a-bug"];

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

/** Atomic: the dashboard reads this directory while the tester writes to it. */
function writeJson(p, obj) {
  const tmp = p + ".tmp";
  writeFileSync(tmp, JSON.stringify(obj, null, 2));
  renameSync(tmp, p);
}

export function listBugs() {
  if (!existsSync(BUGS)) return [];
  return readdirSync(BUGS)
    .filter((f) => f.endsWith(".json"))
    .map((f) => readJson(resolve(BUGS, f)))
    .sort((a, b) => (b.lastSeen ?? "").localeCompare(a.lastSeen ?? ""));
}

const bugPath = (id) => resolve(BUGS, id + ".json");
export const getBug = (id) => (existsSync(bugPath(id)) ? readJson(bugPath(id)) : null);

/**
 * Record a finding. Returns {action, id}.
 *
 * A matching fingerprint does NOT create a second record and does NOT return
 * the bug body -- it bumps a counter and stops. That is the token lever: a
 * defect the tester trips over nightly costs one line of disk after the first
 * time it is seen, instead of re-entering an agent context every run.
 */
export function report(finding) {
  const fp = fingerprint(finding);
  const now = new Date().toISOString();
  const all = listBugs();
  const existing = all.find((b) => b.fingerprint === fp);

  if (existing) {
    existing.seenCount = (existing.seenCount ?? 1) + 1;
    existing.lastSeen = now;
    let action = "duplicate";
    // Seeing a CLOSED bug again means the ratchet spec did not actually hold.
    if (existing.status === "closed") {
      existing.status = "reopened";
      existing.history.push({ at: now, event: "regressed-after-close" });
      action = "regression";
    }
    writeJson(bugPath(existing.id), existing);
    return { action, id: existing.id };
  }

  const id = "bug-" + String(all.length + 1).padStart(4, "0");
  const bug = {
    id,
    fingerprint: fp,
    status: "open",
    seenCount: 1,
    firstSeen: now,
    lastSeen: now,
    severity: "medium",
    ...finding,
    history: [{ at: now, event: "found", charter: finding.charter ?? null }],
  };
  writeJson(bugPath(id), bug);
  return { action: "created", id };
}

export function move(id, status, note) {
  if (!STATUSES.includes(status)) throw new Error("unknown status: " + status);
  const bug = getBug(id);
  if (!bug) throw new Error("no such bug: " + id);
  bug.status = status;
  bug.history.push({ at: new Date().toISOString(), event: status, note: note ?? null });
  writeJson(bugPath(id), bug);
  return bug;
}

/**
 * The ONLY thing the orchestrator reads each tick. Counts and one-line
 * summaries on purpose -- a tick that reads bug bodies is a tick that costs
 * real tokens for nothing.
 */
export function digest() {
  const bugs = listBugs();
  const by = (s) => bugs.filter((b) => b.status === s);
  const brief = (b) => ({ id: b.id, title: b.title, severity: b.severity });
  return {
    at: new Date().toISOString(),
    counts: Object.fromEntries(STATUSES.map((s) => [s, by(s).length])),
    // Work the orchestrator must act on THIS tick.
    delegated: by("delegated").map(brief),
    needsVerify: by("needs-verify").map(brief),
    reopened: by("reopened").map(brief),
    // The known-bug list the tester consults so it never re-reports.
    known: bugs
      .filter((b) => !OFF_BOARD.includes(b.status))
      .map((b) => b.id + " [" + b.class + "] " + b.title),
    // Settled records the tester should NOT investigate again. Titles only —
    // enough to recognise the behaviour, cheap enough to carry every tick.
    settled: bugs
      .filter((b) => OFF_BOARD.includes(b.status))
      .map((b) => b.id + " [" + b.status + "] " + b.title),
  };
}
