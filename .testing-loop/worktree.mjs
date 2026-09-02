#!/usr/bin/env node
// A private checkout for one coder, so a fix under construction can never be
// what the tester is exploring on :3000.
//
//   node .testing-loop/worktree.mjs create --bug bug-0001
//   node .testing-loop/worktree.mjs remove --bug bug-0001
//   node .testing-loop/worktree.mjs list
//
// The tree carries NO node_modules: sitting under <repo>/.worktrees/, it
// resolves the repo's own by ancestry. Free, and it means the gate runs
// against exactly the dependency set main has. See create() for the hazard
// that the obvious alternative — junctioning it in — turned out to carry.
import { execFileSync } from "node:child_process";
import { existsSync, copyFileSync, mkdirSync, lstatSync, readdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const TREES = resolve(ROOT, ".worktrees");
// Ports the tester re-tests against. Slot n serves the nth concurrent fix.
const PORTS = [3001, 3002];

const rest = process.argv.slice(3);
const arg = (n) => {
  const i = rest.indexOf("--" + n);
  return i === -1 ? undefined : rest[i + 1];
};
const git = (...a) => execFileSync("git", a, { cwd: ROOT, encoding: "utf8" }).trim();

function list() {
  return git("worktree", "list", "--porcelain")
    .split("\n\n")
    .map((b) => {
      const path = (b.match(/^worktree (.+)$/m) || [])[1];
      const branch = (b.match(/^branch refs\/heads\/(.+)$/m) || [])[1];
      return { path, branch };
    })
    .filter((w) => w.branch && w.branch.startsWith("fix/"));
}

function create(bug) {
  const branch = "fix/" + bug;
  const dir = resolve(TREES, bug);

  if (existsSync(dir)) {
    console.log(JSON.stringify({ ok: true, reused: true, dir, branch, port: portFor(bug) }));
    return;
  }
  mkdirSync(TREES, { recursive: true });

  // Branch off the CURRENT main, not off whatever the last fix left behind.
  const base = git("rev-parse", "HEAD");
  git("worktree", "add", "-b", branch, dir, base);

  // NO node_modules here, and deliberately so.
  //
  // The worktree sits at <repo>/.worktrees/<bug>, so Node's resolver and npm's
  // PATH both walk UP and find <repo>/node_modules on their own. A per-tree
  // install would be minutes and hundreds of megabytes for a tree that lives
  // for one fix.
  //
  // The first version junctioned it instead, and that was a genuine hazard:
  // `git worktree remove --force` follows the reparse point and deletes
  // through it, which destroyed the real node_modules/.bin once. Resolution by
  // ancestry costs nothing and cannot be walked into.

  // Gitignored, so the worktree does not get them, and nothing runs without
  // them. .env.test carries the harness confinement the gate depends on.
  for (const f of [".env.local", ".env.test"]) {
    if (existsSync(resolve(ROOT, f))) copyFileSync(resolve(ROOT, f), resolve(dir, f));
  }

  console.log(JSON.stringify({ ok: true, reused: false, dir, branch, base, port: portFor(bug) }));
}

/** Stable per bug, so a re-test always aims at the same place. */
function portFor(bug) {
  const open = list().map((w) => w.branch.replace("fix/", ""));
  const i = open.indexOf(bug);
  return PORTS[(i === -1 ? open.length : i) % PORTS.length];
}

function remove(bug) {
  const dir = resolve(TREES, bug);
  const nm = resolve(dir, "node_modules");

  // A worktree must never contain a node_modules that git could delete
  // THROUGH — `git worktree remove --force` follows a junction and has already
  // taken out the real node_modules/.bin once. A link is therefore a hard
  // refusal, not something to force past.
  //
  // A real directory here is usually just a tool cache: vitest writes
  // node_modules/.vite next to wherever it runs. Dot-entries only means no
  // package was ever installed, so it is safe to delete outright — and it is a
  // real directory, so deleting it cannot reach anything outside the tree.
  if (existsSync(nm)) {
    if (lstatSync(nm).isSymbolicLink()) {
      throw new Error(
        "refusing to remove " + dir + ":\n" +
          "  node_modules there is a link, and git would delete through it.\n" +
          "  Unlink it by hand, then re-run."
      );
    }
    const packages = readdirSync(nm).filter((e) => !e.startsWith("."));
    if (packages.length) {
      throw new Error(
        "refusing to remove " + dir + ":\n" +
          "  it has a real node_modules with " + packages.length + " packages in it.\n" +
          "  Delete it yourself if that is intended, then re-run."
      );
    }
    rmSync(nm, { recursive: true, force: true });
  }

  git("worktree", "remove", "--force", dir);
  try {
    git("branch", "-D", "fix/" + bug);
  } catch {
    /* branch already merged or gone */
  }
  console.log(JSON.stringify({ ok: true, removed: dir }));
}

const cmd = process.argv[2];
try {
  if (cmd === "create") create(arg("bug"));
  else if (cmd === "remove") remove(arg("bug"));
  else if (cmd === "list") console.log(JSON.stringify(list(), null, 2));
  else {
    console.log("usage: worktree.mjs create|remove|list --bug <id>");
    process.exit(1);
  }
} catch (e) {
  console.error("[worktree] " + (e.stderr || e.message));
  process.exit(1);
}
