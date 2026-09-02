# .testing-loop/

A continuous exploratory tester, a bug board you triage by dragging, and a
regression ratchet. Started and stopped by you; between those two moments it
does not wait for input.

## The shape

| Plane | What it is | Token cost |
|---|---|---|
| **Tester** | the main Claude session under `/loop`, driving the Browser pane by hand — see `.claude/skills/exploratory-tester/SKILL.md` | the real cost, bounded per charter |
| **Dashboard** | `npm run loop:dashboard` → http://localhost:4000, live over SSE | **0** |
| **Coder** | background subagent in a git worktree, serving on :3001 | only on your delegation |
| **Ratchet** | a Playwright spec written *after* a fix verifies, then replayed forever | **0** |

Playwright is not the test engine here. It is the ratchet: a spec is written
only once a bug has been confirmed fixed, so the corpus is entirely
known-real defects and carries no speculative maintenance.

## Run it

```bash
npm run loop:dashboard     # the board, at :4000
npm run loop:state         # the digest the orchestrator reads each tick
npm run loop:bugs          # one line per finding
npm run loop:next          # which hot path gets tested next, and why
```

The app must be running (`goldensquirrel-dev` in `.claude/launch.json`).

Start the loop itself by asking for it — the orchestrator runs the
`testing-loop-tick` skill on a self-paced `/loop`, 120s while a fix is in
flight and up to 1800s when idle.

**Stopping:** say so, or `touch .testing-loop/STOP`. Every tick checks for that
file, so it stops even if nobody is at the keyboard. Delete it before starting
again.

### What actually drives a tick — read this before believing the loop is running

Ticks are driven by a **session-only cron job** (`CronCreate`, currently every
10 minutes at :04/:14/:24/…). Three properties matter, and the first two were
learned by getting them wrong:

1. **`ScheduleWakeup` did not fire in this environment.** It registered the job
   and reported success, twice, and neither wakeup arrived — a delegated bug
   sat untouched for eighteen minutes while the loop was believed to be
   running. A recurring cron gives repeated chances to fire instead of one
   missed shot; a one-shot that misses is simply lost.
2. **Jobs only fire while the REPL is idle.** A tick cannot start mid-turn, so
   a long turn pushes ticks back.
3. **The job dies with the session** and auto-expires after 7 days. It is not
   written to disk. Restarting Claude means re-arming it.

The one trigger that is always reliable is **you sending any message** — the
next turn runs a tick. So: never report that the loop is running on the
strength of having scheduled something. Check `CronList`, and check whether the
board actually moved.

## Under a fix

```bash
npm run loop:worktree create --bug bug-0007   # branch fix/bug-0007, serves :3001
npm run loop:gate -- --dir .worktrees/bug-0007 --full
npm run loop:ratchet lock --bug bug-0007      # only after a hand re-test
npm run loop:worktree remove --bug bug-0007
```

A worktree carries **no `node_modules`**. Sitting under `.worktrees/`, it
resolves the repo's by ancestry — free, and the gate then runs against exactly
the dependency set `main` has.

> Do not "optimise" that by junctioning `node_modules` into the tree. It was
> built that way first: `git worktree remove --force` follows the junction and
> deletes *through* it, which destroyed the real `node_modules/.bin`. `remove`
> now refuses outright if it finds a link there.

## The gate is what the loop trusts

`gate.mjs` is deterministic, and "the coder says it is done" is not a state
anything acts on. It checks, in order: nothing in the deny-list was touched;
`typecheck`; `harness:unit`; and with `--full`, `npm run build` — which carries
`verify:sw`, `verify:budgets` and `verify:invariants`.

It separately reports `needsHumanReview` for `format.ts`, `cartStore.ts`,
`sync/engine.ts` and `auth/**`. Those are allowed, but never auto-closed
however green the run is.

## The bug state machine

```
open ──drag──► delegated ──► fixing ──► needs-verify ──► verified ──► closed
                               ▲                              │
                               └───────── reopened ◄──────────┘
```

`open → delegated` is the only edge you drive, and it is a drag on the board.
Every other edge is driven by the tester or the coder. Re-filing a `closed`
bug flips it to `reopened` automatically — that means the ratchet spec did not
actually hold, which is worth knowing loudly.

## Containment

`npm run dev` points at the **live** Supabase project. The only thing keeping
an unattended tester off real stores is that it signs in as the harness tenant
and nothing else:

- `session.mjs` is the *only* way the tester authenticates, and it can only
  produce a session for `HARNESS_STORE_ID`.
- No credential is ever typed, so none reaches a screenshot or an evidence file.
- `/admin` is off-limits — it is the one surface that is not store-scoped.
- The coder cannot touch `harness/guard/**`, `supabase/migrations/**`, `.env*`,
  `scripts/verify-*.mjs`, or this directory, never pushes, and never merges.
  Merging to `main` is always a human action.

## Why the dedupe matters more than it looks

`cli.mjs report` fingerprints a finding and, on a match, bumps a counter and
returns — it does not return the bug body. A defect the tester trips over
nightly therefore costs one line of disk after the first sighting, instead of
re-entering an agent's context on every run. That single property is most of
what makes a loop that never stops affordable.

Keep values *out* of `signature`. "cart total not a multiple of 5000" is a
stable identity; "total was 137,250" files the same bug again tomorrow.
