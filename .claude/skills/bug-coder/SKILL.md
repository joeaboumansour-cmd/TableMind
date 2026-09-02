---
name: bug-coder
description: Fix one bug from the testing-loop ledger inside its own git worktree, then pass the deterministic gate. Load when assigned a bug id to fix, dispatched by the testing loop, or working in .worktrees/. Triggers on - fix bug-, bug-coder, worktree fix, testing loop coder, delegated bug fix, gate.mjs.
---

# Bug coder — one bug, one worktree

You have been given a bug id and a worktree path. Fix **that bug** and nothing
else, then prove it. You are one of several agents working at once; the tester
is still selling on `:3000` and must not be disturbed.

## Where you work

**Everything happens inside your worktree.** It is a real checkout of `main` on
branch `fix/<bug-id>` with no `node_modules` of its own — it resolves the
repo's by ancestry, so `npm run …` works normally from inside it.

Never edit the main tree. Never `git checkout`, `merge`, `rebase`, `push`, or
touch another worktree.

## Start by reading the bug

```bash
node .testing-loop/cli.mjs show --id bug-0007
```

`repro` is how it was found, `invariant` names the rule it breaks, and
`evidence.arithmetic` usually carries the exact numbers. **Reproduce it in the
source before you change anything.** If you cannot find the defect the report
describes, say so and move the bug back — do not invent a plausible fix.

Read `CLAUDE.md` for the area you are touching. It is authoritative here and
several root-level docs are not.

## What you may not touch

`gate.mjs` enforces this and will fail you:

```
harness/guard/**      supabase/migrations/**      .env*
scripts/verify-*.mjs  .testing-loop/**
```

These are the things a bad fix could use to disable its own supervision. If a
bug genuinely needs a migration, **stop and say so** — that is a human's call.

These are allowed but never auto-accepted, and a human reads them before they
land: `src/lib/utils/format.ts`, `src/lib/stores/cartStore.ts`,
`src/lib/sync/engine.ts`, `src/lib/auth/**`.

## The bar for the fix

- **Smallest change that fixes the reported defect.** No refactoring on the
  way past, no drive-by cleanups, no reformatting.
- **Never weaken a store-scoping filter, an auth check, or a rounding rule to
  make something work.** That is the standing rule in `CLAUDE.md` §11 and it
  outranks closing your bug.
- Match the surrounding code's style, comment density and idiom.
- If the real defect is that `CLAUDE.md` and the code disagree, **fix the
  document, not working code** — and say which you chose and why.

## Prove it

```bash
node .testing-loop/gate.mjs --dir .worktrees/bug-0007 --full
```

`--full` includes `npm run build`, which carries `verify:sw`,
`verify:budgets` and `verify:invariants`. It must exit **0**. It also reports
`needsHumanReview` — expect that to be non-empty if you touched money, cart,
sync or auth, and note it in your report.

Then commit **inside the worktree only**:

```bash
git -C .worktrees/bug-0007 add -A
git -C .worktrees/bug-0007 commit -m "fix(bug-0007): <what changed>"
```

Then hand it back for a human re-test:

```bash
node .testing-loop/cli.mjs move --id bug-0007 --to needs-verify --note "<one line>"
```

## Report back

Short. What the defect actually was, the smallest thing you changed, the gate
result, and anything you noticed but deliberately did **not** fix. Do not claim
it is fixed — a tester re-tests it by hand on your port, and only then does a
regression spec get written. If the gate did not pass, say that plainly and
leave the bug at `fixing`.
