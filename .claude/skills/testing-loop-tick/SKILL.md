---
name: testing-loop-tick
description: One tick of the continuous testing loop — read the ledger digest, dispatch a coder to a delegated bug, re-test a fix, lock a verified fix behind a regression spec, or run the next exploratory charter. Load when running the testing loop, an orchestrator tick, or /loop over the tester. Triggers on - testing loop, orchestrator tick, loop tick, continuous testing, delegated bug, dispatch coder, run next charter.
---

# Testing loop — one tick

You are the orchestrator. One tick does **one thing**, then schedules the next.
Between the user's start and the user's stop, this never waits for input.

## Read exactly one thing

```bash
node .testing-loop/cli.mjs state
```

That digest is counts, one-line titles and the known-bug list. **Do not read
bug bodies, logs, or source during triage** — a tick that reads bug bodies
costs real tokens for nothing, and this tick may run all night.

## Priority — first match wins

**1. `reopened` is non-empty.** A re-test failed. Send the coder back with what
broke, via `SendMessage` to the existing agent if it is still alive (its
context is the fix), otherwise dispatch a fresh one as in step 3.

**2. `needsVerify` is non-empty.** A coder says it is done. Run the
`exploratory-tester` skill as a **re-test charter** against that fix's port
(`node .testing-loop/worktree.mjs list` for the tree; the port is in the create
output, 3001 for the first). The tester moves it to `verified` or `reopened`.

**3. `delegated` is non-empty** and fewer coders are running than
`config.json` → `budget.maxCoderConcurrency`. Dispatch one:

```bash
node .testing-loop/cli.mjs move --id bug-0007 --to fixing
node .testing-loop/worktree.mjs create --bug bug-0007
```

Then spawn a **background** subagent with the `bug-coder` skill, passing only
the bug id and the worktree path. It reads the bug itself. Do not spawn it in
the foreground — the tester must keep exploring while it works.

**4. A bug is `verified`.** Lock it:

```bash
node .testing-loop/ratchet.mjs lock --bug bug-0007 --base http://localhost:3001
```

This refuses without a spec at `harness/e2e/regressions/bug-0007.spec.ts`. If
there is none, write it first — it must **fail on the original bug and pass on
the fix**, or it locks nothing. Then remove the worktree and tell the user the
branch is ready to merge. **Never merge to `main` yourself.**

**5. Otherwise — explore.**

```bash
node .testing-loop/next-charter.mjs
```

`action: "run"` → run that charter with the `exploratory-tester` skill.
`action: "author"` → write the missing charter JSON first, modelled on
`001-dual-currency-sale.json`, then run it. Afterwards:

```bash
node .testing-loop/next-charter.mjs --record 001
node .testing-loop/next-charter.mjs --fail 001   # only if it found something
```

## Then schedule the next tick

`ScheduleWakeup`, adaptively — the point is that quiet ticks are nearly free
and busy ones are prompt:

| Situation | Delay |
|---|---|
| a coder is running, or a fix is waiting to be re-tested | **120s** |
| exploring, nothing pending | **600s** |
| nothing to do at all (no charters left to author, no bugs) | **1800s** |

Pass the same `/loop` input back each time. Stop only when the user says stop,
or when `.testing-loop/STOP` exists — check for it every tick and call
`ScheduleWakeup {stop: true}` if it is there.

## Rules

- **Never merge, never push, never delete a branch that has not been locked.**
- **One thing per tick.** Do not chain "dispatch a coder AND run a charter" —
  the next tick is 120 seconds away and a shorter tick is a cheaper tick.
- **A coder's own report is not evidence.** Only `gate.mjs` exiting 0 and the
  tester's hand re-test move a bug forward.
- If `gate.mjs` reports `needsHumanReview`, say so to the user by name and
  leave the bug at `needs-verify`. Money, the cart store, the sync engine and
  auth do not get auto-closed however green the checks are.
