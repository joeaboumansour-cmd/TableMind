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

### What actually drives a tick

**Neither in-session scheduler works here. Both were tried; both failed
silently.** `ScheduleWakeup` registered a wakeup and reported success — twice —
and neither fired. `CronCreate` registered a recurring job that `CronList`
still listed afterwards, and it never fired either. They are the same
mechanism, which only runs while the REPL is idle. A delegated bug sat
untouched for eighteen minutes while the loop was believed to be running, and
nothing on screen said otherwise.

So the work is split by **what actually needs Claude**:

| Half | Driver | Never stops? |
|---|---|---|
| Replay the locks, run the unit suite, notice failures, prove liveness | `npm run loop:watch` — a plain Node process | **yes**, genuinely |
| Exploratory charters, dispatching a coder, hand re-testing a fix | this Claude session | only while you are here |

The watchdog has no dependency on Claude being idle, focused, or even open. It
cannot explore — charters drive the Browser pane, which lives in the session —
and it cannot dispatch a coder. It does the deterministic half, which is also
the half that costs no tokens.

Full autonomy would need the Claude Code **CLI** installed so an external
process could run `claude -p` per tick. There is no usable `claude` binary on
this machine (the one on PATH is a broken stub inside an unrelated package), so
that route is closed until someone installs it.

**Liveness is visible, and that is the point.** The watchdog writes
`heartbeat.json` every tick and the dashboard shows `watchdog tick N · 12s ago
· unit 178 · corpus 3/3`, going grey and saying **stale** once two intervals
pass with no tick. The two dead schedulers were invisible precisely because
nothing showed their absence.

> Never report that the loop is running because scheduling returned success.
> Check the heartbeat, or check whether the board moved.

### A lock belongs on the same branch as its fix

`harness:unit` runs on **every push**. A unit lock authored in `main` while its
fix sits on a branch turns `main` red — and it did: the watchdog's tick 5
reported `unit: FAILED` about ninety seconds after `bug-0005`'s lock was
written into `main`.

That is the watchdog earning its keep, and also a rule:

- **Unit lock → commit it on the fix's branch**, so the two land together.
  `ratchet.mjs lock --bug X --dir .worktrees/X` runs it against that branch's
  source (it copies the lock in, runs, and restores the worktree's copy).
- **E2E lock → `harness/e2e/regressions/` in `main` is fine.** Those run
  nightly, not on push, so a red one does not block anyone. They will fail
  against `main` until the fix merges, which the watchdog reports as
  "not merged into this target yet".
- **A fix made directly on `main`** (like `bug-0003`'s guard) keeps its lock in
  `main`, and `ratchet.mjs lock` with no `--dir` is correct.

### The watchdog does not file bugs, on purpose

Its first version filed a `critical` regression for every failing spec, and got
it wrong twice over: it created a NEW record instead of reopening the bug whose
spec failed, and because `fingerprint()` normalises digits, `bug-0002 …` and
`bug-0004 …` collapsed to one key and every failure deduped into a single wrong
record.

The deeper mistake was filing at all. A lock is verified against the fix's own
**branch**, so it fails on `main` until that branch is merged — that is "not
merged yet", not a regression. A board that shouts CRITICAL at the expected
state is a board people stop reading. The watchdog now names the failing locks
in its log and heartbeat and leaves the judgement to a human or a tick.

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
