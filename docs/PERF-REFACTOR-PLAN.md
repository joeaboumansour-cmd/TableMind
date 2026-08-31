# Performance Refactor — Plan of Record

**Status:** AGREED, NOT STARTED · **Agreed with owner:** 2026-08-30 · **Author:** Claude

**Settled and not to be re-litigated by a future session:** the harness may be
kept if maintainable (§0) · desktop, iOS and Android are all first-class (§1
invariant 24) · Blink on desktop and Android, *installed from Safari* on iOS
(§1) · the work lives on `refactor/perf` against a staging environment, and
merges to `main` **per phase, shipped behind flags and canaried** rather than as
one big merge at the end (§4 Release model).

This is an **executable plan**. A future session is expected to open this file,
read [How to resume](#how-to-resume), pick the next unstarted step, do it, and
update the ledger. It is not a wishlist — every step has entry criteria, exit
criteria, and a place to record numbers.

> **Read [`CLAUDE.md`](../CLAUDE.md) first.** It is the ground truth for this
> repo and several root-level docs describe a different product entirely. This
> plan assumes everything in it.

---

## 0. The deal

**Goal:** a POS that is faster, **feels** faster still, survives weeks offline
without losing a sale, and reads as a native app — with a much better
architecture underneath, and **no change to what the cashier can do or what they
end up looking at**. Verified rather than hoped.

Four qualities. When two conflict, the higher one wins:

1. **Correct** — money, tenancy, offline durability. Never traded, for anything.
2. **Perceived fast** — what the cashier actually experiences at the counter.
3. **Measured fast** — what the numbers say.
4. **Native feel** — the app should not read as a website in a shell.

> **2 outranks 3 on purpose.** A sale that completes in 400 ms but shows a
> spinner for 300 of them feels worse than one that takes 900 ms and shows the
> QR code at 80. The cashier is the instrument we are optimising for; the
> stopwatch is only a proxy for them.

### The boundary this creates

"UI and functionality unchanged" needs a sharper edge now, because §Phase 5
deliberately changes the *order* things appear in:

- **UNCHANGED, and enforced by the harness:** what the app can do, what data it
  shows, what any screen looks like once it has settled, every number, every
  route, every control.
- **FAIR GAME, and the whole point of Phase 5:** *when* each part appears,
  what is shown while something is still arriving, and what work is moved off
  the path the user is waiting on.

The harness must be built to that boundary: **visual snapshots assert settled
states, never mid-load states.** A test that pins a spinner in place is a test
that forbids the improvement. See Phase 1.5.

---

### The business lens

Engineering metrics are a proxy. The thing the shop is actually buying is
**seconds off the queue** — how long a customer stands at the counter — and the
confidence that a day's takings cannot evaporate. Every decision in this plan
should be traceable to one of those two. A Lighthouse score is not a customer.

**1 · Spend the budget where the money is.** Not all screens deserve equal
effort, and pretending otherwise is how a refactor runs out of road:

| Tier | Screens | Standard |
|---|---|---|
| **1 — a customer is waiting and money is moving** | scan → cart → `/checkout` → receipt | Every millisecond is queue time. Optimise ruthlessly; nothing here may regress, ever. |
| **2 — the shift's rhythm** | `/pos/cash`, `/kitchen` | Fast enough that nobody plans around it. |
| **3 — back office, nobody is waiting at a counter** | `/pos/products`, `/transactions`, analytics, `/admin` | Correct and comfortable. A two-second report is fine. **Do not gold-plate these.** |

This is also permission to *stop*: effort spent making analytics 200 ms faster is
effort not spent on the scan path, and only one of those has a customer standing
in it.

**2 · Use the human's dead time, not the machine's idle time.** At a counter
there are two free windows: while the customer is finding their money, and while
they are taking their bag. That is where speculative work belongs. The moment a
cart has items, warm `/checkout` and generate the receipt token; the moment
payment is tendered, pre-render the QR. By the time anyone looks, it is already
there. (The reverse of what the app used to do: idle during the wait, then work
while everyone watched.)

**3 · Fill unavoidable waits with something the shop needs anyway.** A skeleton
is the *fallback*, not the goal. If a moment must take 800 ms, the better answer
is usually that the screen shows the change due in large type — which the
cashier has to read regardless — while the rest settles behind it. The wait
stops existing because the human is busy doing the next real thing.

**4 · Speak shop language, never infrastructure.** "Syncing", "offline queue",
"IndexedDB", "service worker" are our words, not theirs. A shop owner should read
*"Saved on this till"* and *"Sent to the office"*. Words that sound like a
malfunction make a working app feel broken, which is a performance problem
measured in support calls.

**5 · Durability is the product, so make it legible.** In a market with
unreliable power and internet, "keeps selling when the neighbour's till is dead"
is the pitch. That means Phase 6 is not only engineering: the owner should be
able to *see* that their offline sales are protected, and be told plainly and
unmissably when they are not. A guarantee nobody can observe is a guarantee
nobody pays for.

**6 · The waste has an invoice.** Vercel and Supabase bill for exactly what this
refactor removes: 918 KB × every device × every deploy, a serverless invocation
per heartbeat × every tab × every shop × all day, and round trips that were only
ever there because the code asked twice. Record the infra-cost delta alongside
the latency delta in Phase 9 — a refactor that pays for itself is a very
different conversation from one that only feels nicer.

> ### The line that must not be crossed
>
> Every trick above is about **ordering honest work**, never about
> **implying work that has not happened.** In an app that takes people's money:
>
> - Optimistic UI is fine **only** when it is backed by a durable local write
>   that has already succeeded — which is exactly why the receipt can appear
>   before the server has heard about the sale.
> - Never show a confirmation, a receipt, or a completed total for something
>   that could still fail silently.
> - Never animate fake progress. A progress bar that is not measuring anything
>   is a lie that will eventually cost a shop a day's takings and cost us the
>   account.
>
> **Perceived performance is a sequencing technique, not a persuasion
> technique.**

**What the owner agreed to (2026-08-30):**

- Vitest, Playwright or any other tooling may be added as a regression harness
  for this refactor.
- **The harness may be KEPT** if it turns out to be genuinely maintainable and
  useful for future features *(owner amendment, same day)*. Deleting it is the
  fallback, not the goal.
- No business/feature changes will be requested while this runs, so behaviour
  can be frozen and used as the specification.
- Regressions caught by the harness are acceptable. Regressions that reach a
  shop are not.

> **Build it as if it is staying.** That amendment is not a footnote — it is a
> design constraint from step one. A disposable harness and a durable one are
> different artifacts: a disposable one may be slow, brittle and undocumented
> because it only has to survive a few weeks. A durable one must be fast enough
> to run on every change, stable enough not to be ignored, and obvious enough
> that adding a case alongside a new feature is a two-minute job. **Assume it
> stays. Decide at Phase 9 with evidence.**

**One thing stated plainly, once.** "Bug-free" is not a state software reaches,
and if the harness goes, its guarantee goes with it. So the plan is built so
that what stands afterwards either way is a set of **permanent build-time
gates** — the `verify:*` script pattern already in this repo and already
accepted. Keeping the harness on top of those is strictly better, and is now the
expected outcome.

**The central idea:** behaviour is frozen, therefore **current behaviour is the
spec**. This is characterization testing. We record what the app does today,
then refactor freely until the recording still passes. That is what makes an
aggressive refactor safe without a permanent test suite.

---

## 1. Non-negotiable invariants

A refactor that forgets one of these does real damage to a real shop's money.
**Every step's review must check this list.** Each is load-bearing and each has
already broken production at least once.

### Money
1. **LL is the base currency.** USD is derived. `src/lib/utils/format.ts` is the
   only place conversion or rounding may live.
2. **Rounding happens at the cart total only** — `cartStore.getTotal()`. Never
   per line item.
3. **`SELL_RATE` when the customer pays; `RETURN_RATE` when money goes back.**
   Not interchangeable; the spread is the store's margin.
4. Product discount applies to the **base only**, never to add-ons.
5. `updateLine` clears the discount and resets `original_unit_price` — an
   overridden price *is* the price.

### Offline & sync
6. Queued **transactions** are never deleted on retry exhaustion — they are
   dead-lettered. Each is a completed sale whose money was taken.
7. Idempotency is `UNIQUE (store_id, transaction_number)` + the `23505` branch.
   Changing transaction-number generation breaks offline safety.
8. **Deletion requires positive proof.** `evaluateReconcile()` /
   `reconcileProductsCache()` must skip, never delete, on partial evidence.
9. `QueuedTransaction.stock_decrements` must be forwarded by the sync replay, or
   a queued menu sale decrements the menu item instead of its ingredients.
10. A sale is **never blocked** by cash-register state, stock level, or a failed
    lookup.
11. `occurred_at` on activity events is the client's clock at action time, never
    flush time.

### Service worker
12. `/api/health` stays `NetworkOnly`. `extendDefaultRuntimeCaching` stays true.
    `app-shell` keeps `networkTimeoutSeconds` and never gains `maxAgeSeconds`.
    `workboxOptions.exclude` must keep next-pwa's three defaults.
    `scripts/verify-sw.mjs` asserts all of this — **it must keep passing.**
13. A service-worker update must never land mid-task — `reloadGuard` +
    `hasAnyLaneItems`.

### Tenancy & data
14. Every query is scoped by **`store_id`**. Never `merchant_id`/`restaurant_id`.
15. Barcode lookups are store-scoped (`[store_id+barcode]`) — barcodes are not
    unique across tenants.
16. `isSellable()` is `kind !== 'ingredient'`, never `=== 'sellable'`.
17. `transaction_items.modifiers` uses `?? null`, never `|| null` — `[]` and
    `null` mean different things to the kitchen board.
18. `lineKey()` is the only way to address a cart line.
19. Aggregate in Postgres, never by summing a PostgREST select (1000-row cap).
20. `products.profit_percentage` is trigger-computed — never validate or reject
    a write on it.

### Auth
21. `resolveCaller()` returning null is always a 401 — never a fallback identity.
22. The in-flight dedup in `resolveCaller` must stay **in-flight only**. Making
    it a TTL cache delays revoking an employee on the path that governs cash.
23. Never weaken a store-scoping filter or a permission check to make something
    faster.

### Platform parity
24. **Desktop, iOS and Android are all first-class, together.** No step is DONE
    until it has been considered on all three. A win on one that regresses
    another is not a win. Baselines, budgets, E2E runs and visual snapshots are
    all captured per platform.

They are genuinely different machines, and the differences are load-bearing:

| Concern | iOS (installed) | Android (Chrome) | Desktop |
|---|---|---|---|
| Launch | **Cold WebView every time** — killed aggressively | Warm process, warm connection | Warm |
| Splash | Blank unless `apple-touch-startup-image` is supplied — **currently absent** | Manifest `background_color` + icon | Manifest |
| Storage eviction | 7-day clear for non-installed; **installed is exempt** → install IS the durability mechanism | Quota-based, origin evicted under pressure | Plentiful |
| `storage.persist()` | Granted for installed | Granted on engagement | Granted on install |
| Viewport | No URL bar; keyboard **floats over** (visual shrinks, layout does not) | URL bar retracts → both shrink | Stable |
| Scanner | Camera via Quagga2 | Camera via ZXing + `BarcodeDetector` | **Hardware wedge** via `SmartScanInput` |
| `backdrop-filter` | Cheap (WebKit composites well) | **Expensive** on mid-range — gated by `.low-power` | Fine |
| SW update checks | Rare; forced on foreground by `PWAUpdateListener` | Normal | Normal |
| Primary input | Touch + haptics | Touch + haptics | Keyboard — `ALT+1..9` lanes, Enter-to-submit |

Consequences the plan must respect: iOS pays every cost twice because every
launch is cold; Android is where frame rate is won or lost; desktop is where the
Pro till's keyboard flow must not be disturbed by anything done for touch.

#### Standardising the browser — what it does and does not buy

*(Owner offer, 2026-08-30: mandate Chrome as the PWA host on all three.)*

**Take it for desktop and Android. It does not apply to iOS, and assuming it
does would be a costly mistake.**

- **Desktop — yes, real win.** Collapses Chrome/Edge/Firefox/Safari-desktop into
  one Blink target. Visual snapshots stop being three-way, and the `.legacy`
  Windows-7 path already assumes Chromium, so this makes an existing assumption
  explicit rather than adding one.
- **Android — yes, but it is already true in practice.** Worth writing down so
  the harness profile is honest.
- **iOS — no, and it would probably hurt.** Every browser on iOS is required to
  use **WebKit**. Chrome on iOS is WKWebView wearing Chrome's interface — you
  get none of Blink's behaviour, none of its APIs, and none of its performance
  characteristics. The engine column in the table above does not change.
  Worse, **the Home Screen install is the thing that matters on iOS**, because
  installed web apps are exempt from the 7-day storage clear (Phase 6.1) and
  that exemption is what protects a week of queued sales. That install flow is
  Safari-centric and best-supported there. Routing iOS users through a
  third-party browser risks a worse install path in exchange for a rebrand.

**So the standard to enforce is:**

| Platform | Mandate |
|---|---|
| Desktop | Chrome or Edge (Blink), installed as a PWA |
| Android | Chrome, installed from the browser prompt |
| **iOS** | **Safari → Share → Add to Home Screen.** Not Chrome. The install, not the browser, is the requirement. |

Net effect on this plan: the harness drops from roughly five engine/platform
combinations to **three**, snapshots get materially more stable, and desktop may
rely on Blink-only APIs. **iOS keeps every one of its constraints**, including
the cold WebView launch, the floating keyboard, and Quagga2 for the camera.

---

## 2. Prerequisites (blocking)

### P-1 · A staging environment — **BLOCKING for everything**

*(Owner decision 2026-08-30: the refactor lives in staging until it is done and
tested.)*

> `npm run dev` on this repo reads and writes the **LIVE Supabase project**
> serving paying stores. Nothing in this plan may run until that is separated.

**Three pieces, all of which this project can already have cheaply:**

1. **A branch** — `refactor/perf`. All work lands here.
2. **A deployed origin** — Vercel already builds this app; a branch gets a
   preview deployment automatically. That preview *is* the staging app.
3. **Its own database** — in preference order: Supabase branching on the
   existing project; a second Supabase project seeded from
   `supabase/migrations/*` in order; or local `supabase start` (Docker). Note
   `008` is duplicated, so migration order must be verified.

**Why a separate origin matters more here than in a normal app.** Service
workers, Cache Storage, IndexedDB and `localStorage` are all **origin-scoped**.
A staging origin therefore gets its own precache, its own offline queue and its
own storage grant — so the Phase 6 durability drills are genuinely clean, and no
experiment can touch a real till's queued sales. It also means staging is a
truthful place to test PWA install and the service-worker update cycle, which a
localhost dev server is not.

**Staging data is seeded, never copied from production.** Real shops' sales are
real people's money and real employees' details. Use the Phase 1.1 fixtures.

**Deliverables:** `.env.staging` / `.env.test`, a documented switch, and a hard
guard in the harness that **refuses to run against the production Supabase
URL** — a `process.exit(1)` on a hostname match, not a comment asking nicely.

### P-2 · Migrations applied and confirmed

Before measuring anything, confirm against the real database:
- **`025_widen_money_columns`** — if unapplied, `DECIMAL(10,2)` caps at
  99,999,999.99 LL (~$1,111) and a larger basket throws on insert, prints a
  receipt anyway, and dead-letters. Check first.
- **`037_hot_path_performance`** — until applied, the batch stock decrement and
  the analytics aggregate both run their fallback path.

### P-3 · Baseline numbers exist

No step may claim an improvement without a before number. See Phase 0.

---

## 3. Phases

Each step is sized to fit comfortably in one session. **Do not batch steps.**

### Phase 0 — Ground truth

| # | Step | Exit criteria |
|---|---|---|
| 0.1 | Non-production database (P-1) | Harness can write; a guard refuses the prod URL |
| 0.2 | Field measurement via the existing activity pipeline | 4 timing events landing in `activity_logs` |
| 0.3 | Local trace baselines | Numbers recorded in the ledger |
| 0.4 | Budget gates | `verify:budgets` script exists and passes |

**0.2 — Field measurement.** Reuse `activity_logs`: it already has a closed
vocabulary, an offline buffer, an admin console and a kill switch. Add four
events to `src/lib/activity/types.ts`:

- `perf.boot` — navigation start → POS interactive, plus `wasColdStart`
- `perf.scan` — barcode resolved → line in cart
- `perf.sale` — payment confirmed → receipt painted
- `perf.route` — route change → paint

Every event carries **platform and display-mode** (`standalone` vs browser tab),
because the same number means different things on a cold iOS WebView and a warm
desktop Chrome, and because install state is what determines storage durability
on iOS (Phase 6.1).

Rules: fire-and-forget, never awaited, never on the money path's critical
section, and behind the existing `activity_logging` flag. This is the only
measurement that reflects real phones on real Lebanese connections, and it keeps
working after the harness is deleted.

**0.3 — Local baselines.** Record **per platform profile** (desktop / iOS /
Android — see invariant #24) and per route (`/pos`, `/checkout`,
`/transactions`, `/pos/products`, `/pos/cash`):
- First Load JS, total precache size
- Cold and warm boot to interactive, CPU-throttled 4× and network-throttled to
  Slow 4G
- Request count and **request depth** (longest serial chain) per screen
- Main-thread long tasks

**0.4 — Budget gates.** A `scripts/verify-budgets.mjs` in the same shape as
`verify-sw.mjs`, wired into `npm run build`. Asserts:
- total precache ≤ current + 0%
- First Load JS per route ≤ recorded baseline
- no route exceeds N serial round trips (measured by a Playwright har check)

**These gates are permanent and survive Phase 9.** They are the main reason the
speed does not quietly regress after the harness is gone.

---

### Phase 1 — The characterization net

The oracle. Everything after this depends on it. Nothing in Phase 2+ starts
until Phase 1 is green.

**Quarantine rule:** everything lives under `harness/` and nothing in `src/`
imports from it. One directory, one dependency block in `package.json`, one
script family (`npm run harness:*`). That keeps removal to a `git rm` of one
folder — and, more importantly now, keeps the harness from entangling itself
with application code if it stays.

**Maintainability rules — because it is expected to stay:**

- **Fast enough to actually run.** Pure-logic suite under 10s; full E2E under
  5 minutes. A suite people skip is worse than none, because it produces false
  confidence.
- **Zero tolerance for flake.** A test that fails intermittently gets fixed or
  deleted the same day. One flaky test teaches everyone to ignore red.
- **Fixtures are data, not code.** One seed file, fixed UUIDs, fixed clock. A
  new feature adds rows, never a new seeding mechanism.
- **One obvious place per concern**, so "where does my new test go" is never a
  question: `harness/unit/`, `harness/contract/`, `harness/e2e/`,
  `harness/visual/`, `harness/offline/`, `harness/fixtures/`.
- **`harness/README.md` is mandatory** and written for someone adding a feature,
  not for someone who built it: how to run one test, how to update a snapshot,
  how to add a case, how to seed a new table.
- **No test asserts on implementation detail.** Only on behaviour visible to a
  cashier or to an API caller. Otherwise the refactor fights its own net.
- **Never assert a mid-load state.** Snapshots and assertions capture *settled*
  screens only. Phase 5 exists to change what happens before a screen settles;
  a test that pins a spinner in place forbids the improvement. See §0's
  boundary.
- **Every E2E and visual suite runs three platform profiles** — desktop, iOS
  (mobile Safari emulation, 375×812) and Android (Chrome, mid-range CPU/network
  throttle). One `--project` per platform, one snapshot directory per platform.
  Parity is invariant #24; the harness is where it is enforced.
- **Visual snapshots are the high-maintenance piece** — they legitimately break
  on every intentional UI change. Keep them, but as their own opt-in command
  (`harness:visual`) and out of the default run, so an intentional redesign is
  one deliberate `--update-snapshots`, not a wall of red on unrelated work.

| # | Step | What it protects |
|---|---|---|
| 1.1 | Fixtures & seeding | Determinism for everything below |
| 1.2 | Pure-logic characterization (Vitest) | Money, cart, stock, permissions |
| 1.3 | API contract snapshots (Vitest) | Every server refactor in Phase 2 |
| 1.4 | E2E golden flows (Playwright) | The product actually working |
| 1.5 | Visual snapshots (Playwright) | "UI untouched" becomes enforceable |
| 1.6 | Offline/sync scenarios (Playwright) | The thing this app exists for |

**1.1 — Fixtures.** A deterministic seed: one store, ~2,500 products (mixed
LL/USD, some ingredients, some variants, some with recipes and combos), two
employees with different permissions, a register, a closed shift and an open
one, and ~300 transactions spanning a DST boundary in `Asia/Beirut`. Fixed UUIDs
and fixed timestamps — snapshots are worthless if the data moves.

**1.2 — Pure logic.** Highest value, zero flake. Characterize *current output*,
not what it "should" be:
`utils/format`, `stores/cartStore` (every mutation + `getTotal` + lanes +
rehydrate), `pos/lineItems` (`buildTransactionItems`, `buildStockDecrements`),
`pos/lineKey`, `pos/modifierSummary`, `cashShift.summariseShift`,
`analytics/profit`, `products/refresh.evaluateReconcile`,
`products/kind.isSellable`, `auth/permissions.parsePermissions`,
`features.mergeFeaturesWithDefaults`, `db/localDB.computeRetryBackoffMs`.

Include the ugly cases deliberately: a basket over $1,111, a USD-cost product, a
one-off line, a combo inside a combo, an ingredient scanned, `undefined` kind,
`[]` vs `null` modifiers, a lane parked with items.

**1.3 — API contracts.** For every route under `src/app/api/`: record
request → status + response shape against the seeded database. Include the
failure paths (401, 403, duplicate `23505`, missing RPC fallback). This is what
lets Phase 2 rewrite the server without fear.

**1.4 — E2E golden flows.** The eight that are the product:
1. Scan → cart → checkout → receipt, LL and USD tender, change correct
2. Menu item → modifier sheet → configured line → sale decrements ingredients
3. Two lanes: park one, serve another, resume, both totals correct
4. Unknown barcode → priced at till → sold as a one-off line
5. Cash: open shift, sell, adjust, close, variance correct
6. Inventory: search, edit price, bulk apply, delete a sold product
7. CSV import `replace_all` — catalogue replaced, **sales history intact**
8. Kitchen: paid order appears, moves through states, 409 on stale transition

**1.5 — Visual snapshots.** Playwright screenshots at three viewports (mobile
375, tablet 768, desktop 1440) for every screen and every dialog. This is what
turns "keep the UI as is" from a promise into a gate. Mask the clock and any
generated ids.

**1.6 — Offline scenarios.** The signature failures:
- Cold launch with the network down (must open from the app shell)
- Sell offline, reconnect, verify exactly one server row and one decrement
- Sell offline, sync two days later, verify `created_at` is the sale moment and
  the sale lands in the correct shift
- Flaky reconnect mid-flush: retries must not be consumed, nothing dead-letters
- Wifi associated with no upstream (the hang case), not just "offline"
- Two tabs flushing at once — the cross-tab lock holds

**Exit criteria for Phase 1:** all suites green, run in CI, and a deliberate
mutation test — break one invariant from §1 on purpose and confirm the harness
catches it. **A net that has never caught anything is not known to work.**

---

### Phase 2 — Server architecture

| # | Step | Expected win |
|---|---|---|
| 2.1 | Atomic sale RPC | Money path 3 waves → 1; closes P1-4 |
| 2.2 | One route kernel | Kills 3× duplicated auth plumbing |
| 2.3 | Generated DB types | Ends `database.ts` drift (P2-7) |
| 2.4 | Index & query audit with `EXPLAIN` | Removes remaining scans |
| 2.5 | Edge where possible | Cold-start removal on read paths |

**2.1** — one plpgsql function taking the whole sale as JSONB: insert
transaction, insert items, apply decrements, resolve the shift, all in one
statement and one round trip. Must preserve: `23505` idempotency, shift
resolution **by the sale's own `created_at`**, `?? null` modifier semantics, the
client-supplied `stock_decrements` taking priority over `items`, and never
failing a sale for cash-register or stock reasons. The existing multi-step path
stays as the fallback for a database without the migration.

**2.2** — `src/lib/auth/apiRoute.ts` already holds `bad()` and
`callerAndRead()`. Extend to a single kernel covering: env check, auth, section
permission, input validation, error contract, typed response. Every route under
`src/app/api/` adopts it. Removes the per-file `requireCaller` copies.

**2.4** — `EXPLAIN (ANALYZE, BUFFERS)` on every query the app issues against
seeded data at 10× current volume. Add what is missing, drop what is unused.
Migration 037 already removed four duplicate indexes on `transactions`; do the
same audit for `transaction_items`, `products`, `cash_shifts`, `activity_logs`.

---

### Phase 3 — Client data layer *(the structural one)*

**The problem:** TanStack was removed and nothing replaced it, so every screen
hand-rolls cache-then-revalidate inside `useEffect`. That is the root of the
duplicate fetches, the double renders, the "six overlapping state mechanisms"
(P2-4), and most of the boot burst.

**Not** reinstalling TanStack. A small purpose-built primitive that matches how
this app actually works:

- **Dexie/localStorage first, network second** — the existing "ALWAYS load cached
  first" rule, expressed once instead of fifteen times
- **Store-scoped keys** — tenancy in the cache key, structurally
- **Request dedup + in-flight sharing** across components
- **Offline-aware** — a failed revalidate keeps the cached value, never empties
- **Subscription-based** so two components share one fetch and one render

Migrate screens one at a time, each behind the Phase 1 net, each its own commit:
`/pos` → `/pos/products` → `/transactions` → `/pos/cash` → `/kitchen`.

---

### Phase 4 — Render layer

- Stable callbacks and real memo boundaries (`ProductRow` properly, not with a
  comparator that would serve stale closures)
- Virtualize the History list, reusing the grouped-virtualiser pattern from
  inventory
- Split the two ~1,900-line page components into container + presentational
- Capture React Profiler traces inside Playwright so render cost becomes a
  budget, not an opinion

---

### Phase 5 — Perceived performance *(the one the cashier feels)*

Quality #2 from §0. Some latency cannot be removed — a network round trip to
Beirut, a 3,000-row IndexedDB read, a camera warming up. This phase is about
never making a person **wait on it while looking at nothing**.

**The doctrine, in one line:** *show the thing they came for first; do the
bookkeeping behind it.*

The pattern is already proven in this codebase — `src/lib/pos/saleCompletion.ts`
makes the sale durable in IndexedDB (single-digit ms), paints the receipt and QR
immediately, and fires the server push with **no await**. It used to spinner for
the full 2-5s round trip and the QR carries nothing from the server, so that
wait bought nothing. **Phase 5 is that move, applied everywhere it applies.**

#### 5.1 · The wait register

Enumerate every point where the app can show a wait. For each: what is the user
actually waiting for, what is merely bookkeeping, and can they be separated?
Record it as a table in this file. Known candidates:

| Moment | Today | Target |
|---|---|---|
| Sale complete | QR first, push behind *(done)* | Also move receipt-token work, kitchen ticket, analytics invalidation behind it |
| Scan → line in cart | Local index instant; server fallback on miss shows a toast | Line appears optimistically on fallback too, reconciled or removed |
| Open checkout | Totals recompute before interactive | Keypad live immediately, totals settle behind |
| Open History | Cached rows instant *(done)*; profit blocks the card | Profit streams into its slot |
| Open Cash | Snapshot first *(done)*; analytics after *(done)* | Verify no regression |
| Save a product | Client id + cache write first *(done)* | Sheet closes instantly on every path, including the online one |
| Route change | Per-tab pending spinner *(done)* | View Transition where supported; no white flash |
| Boot | Catalogue from cache, sync behind *(done)* | Shell paints before the catalogue read completes |

#### 5.2 · Rules to apply

1. **Optimistic by default.** Anything already backed by a durable local write
   paints immediately and reconciles quietly: cart mutations, star toggles,
   quantity changes, price edits, shift open.
2. **Never spin for work nobody is waiting on.** If the result does not change
   what the user does next, it does not get a spinner.
3. **Delay-show, minimum-show.** No spinner under ~200 ms — a flash reads as
   *slower*. Once shown, hold it ~400 ms so it does not strobe.
4. **Skeletons match the settled layout exactly.** No reflow when data lands.
   Reserve space; the `tnum` rule for money already does this for digits.
5. **Feedback within one frame of every tap.** `.tap` (70 ms) exists; extend
   with haptics on commit actions and the existing scan sounds.
6. **Failure is quiet and reversible**, never a blocking modal, because the sale
   is already durable locally.

#### 5.3 · Native feel

- **iOS launch screens** — `apple-touch-startup-image` for the device sizes in
  use. Currently absent, so an installed iOS PWA shows **blank white** for the
  whole cold boot. This is a large part of "it takes a long time to open" and is
  close to free.
- View Transitions on route change where supported; graceful no-op elsewhere.
- `overscroll-behavior: contain` so the app does not rubber-band like a page.
- Preserved scroll position per route.
- No text selection or callout on controls.
- Desktop: keyboard flow untouched — `ALT+1..9`, Enter-to-submit, refocus after
  every scan. Nothing done for touch may disturb the wedge.

**Exit criteria:** the wait register has no row where a person waits on
bookkeeping; a settled-state visual diff across all three platforms is empty;
`perf.sale` and `perf.scan` field percentiles improved against the Phase 0
baseline.

---

### Phase 6 — Offline durability *(weeks, not hours)*

Quality #1. The requirement: **a shop can be offline for weeks, keep selling,
and lose nothing.** Most of the machinery exists; this phase proves it and
closes the gaps.

#### 6.1 · Make the storage grant real

`ensurePersistentStorage()` exists and asks. What matters is whether it is
actually granted on real devices, per platform:

- **iOS: installation IS the durability mechanism.** Safari clears
  script-writable storage after 7 days of no interaction for a site that is not
  installed. An installed PWA is exempt. So a device selling from a browser tab
  is one quiet week away from losing queued sales — the existing "Install the
  app to protect offline sales" warning is correct and must become
  *unmissable*, not a toast that can be dismissed and forgotten.
- **Android:** grant is engagement-based; verify and surface it.
- **Desktop:** granted on install.

Deliverable: a durability state visible to the shop and to the admin console —
granted or not, quota used, queued sales at risk.

#### 6.2 · Quota and eviction discipline

- `freeExpendableSpace()` already sheds the activity buffer first. Formalise the
  order: activity buffer → transaction history cache → product cache. **Queued
  sales are never shed.** Assert it.
- Check headroom before a bulk write (catalogue sync, CSV import) rather than
  discovering it mid-write.
- Detect a cleared origin on boot and re-seed rather than presenting an empty
  catalogue as if it were the truth.

#### 6.3 · The shelf-life drill

The app-shell cache has no `maxAgeSeconds` precisely so it survives an outage of
any length. **Prove it**, per platform, in the harness:

- Clock forwarded three weeks, network down: cold launch, sell, park a lane,
  close and reopen, sell again.
- Reconnect: everything syncs, `created_at` is the sale moment, sales land in
  the right shift, nothing dead-letters, stock decrements exactly once.
- Repeat with a mid-flush disconnect and with two tabs.

**Exit criteria:** the three-week drill passes on all three platforms, and the
"at risk" state is impossible to be in without the shop being told.

---

### Phase 7 — Bundle & delivery

- Enforce the per-route budgets from 0.4
- Route-level splitting; audit every import into `/pos` and `/checkout`
- The two barcode libraries (ZXing for Android/desktop, Quagga2 for iOS) — decide
  whether platform-conditional precaching is worth the complexity
- Precache tiering: what must survive an outage vs what may be fetched on demand.
  **The Arabic/extended font subsets stay precached** — a Lebanese shop with
  Arabic product names must not lose glyphs during an outage.

---

### Phase 8 — Scale

Target: a store with 20,000 products and 200,000 transactions, on all three platforms.

- Audit every PostgREST call for the 1000-row cap
- IndexedDB read strategy — the full catalogue read at boot is the largest
  main-thread block on a phone; consider a worker or an indexed partial read
- Cursor pagination everywhere it is missing
- Activity-log volume at 10× store count

---

### Phase 9 — Decide and consolidate

Steps 1 and 2 happen regardless; step 3 is a fork.

1. **Promote the permanent gates.** Budgets, the §1 invariants that are
   statically checkable, and the SW rules become `verify:*` scripts wired into
   `npm run build`. These stand whichever branch is taken.
2. **Record final numbers** against the Phase 0 baseline in the ledger.
3. **Decide, with evidence.** Judge the harness against the maintainability
   rules in Phase 1 — actual runtime, actual flake count over the refactor,
   whether adding a case was ever a chore. Then:

**Branch A — KEEP** *(expected)*
- Prune anything that flaked more than twice, or that asserts implementation
  detail rather than behaviour.
- Move `harness:visual` out of the default run.
- Finish `harness/README.md`, add a short "adding a feature" checklist.
- Wire the fast suites into CI on every push; the full run nightly and
  pre-release.
- Update `CLAUDE.md` §8 — it currently says there is deliberately no test suite,
  which would become false. Replace it with what the harness covers, what it
  does **not** (camera scanning, real hardware scanners, real payment
  behaviour), and the rule that a new feature ships with its case.

**Branch B — DELETE**
- Tag the commit first, so it is recoverable the way `744ad0d` holds the old
  suite.
- `git rm -r harness/`, remove the dependency block, the `harness:*` scripts and
  the CI job.
- Leave `CLAUDE.md` §8 as it stands, adding the tag to recover from.

4. Update `docs/AUDIT-2026-08.md` either way.

---

## 4. Working rules

- **One step per session.** Update the ledger before finishing.
- **One commit per step**, independently revertable, with the "what I verified"
  note the working agreement requires.
- **Numbers or it did not happen.** Every perf claim gets a before and after in
  the ledger, **per platform**.
- **No step is DONE on one platform.** Desktop, iOS and Android, every time
  (invariant #24). A win on one that regresses another is not a win.
- **Prefer removing the wait to hiding it.** Hiding is the fallback for latency
  that genuinely cannot be removed — not the first move.
- **Never weaken §1 to make something faster.** If a step needs an invariant
  relaxed, stop and ask.
- **Flag-gated canary** for anything touching money or sync: ship dark, enable
  for one store, watch the activity log for a day, then widen.

### Release model

The refactor lives on `refactor/perf`, continuously deployed to staging. But it
does **not** wait until Phase 9 to reach `main`, and that distinction is the
whole point of this section.

**Why not one big merge at the end.** A branch held open across nine phases is
the classic way a refactor dies: it drifts from `main`, the merge becomes an
event everyone fears, and every ounce of risk is concentrated into the single
moment when the least is known. It also destroys Phase 0 — field measurement
from real shops on real Lebanese connections is the only measurement that
counts, and a branch nobody runs produces none of it.

**What we do instead — merge per phase, release behind flags:**

1. A phase is built and proven on staging: full harness green on all three
   platform profiles, budgets met, the §1 invariant checklist reviewed.
2. That phase merges to `main` as its own set of revertable commits.
3. It reaches production **off** — behind a feature flag, or as a code path that
   is not yet enabled.
4. Canary: enable for one store. Watch `activity_logs` and the Phase 0 timing
   events for a day.
5. Widen. Or flip the flag off, which needs no deploy, because the flag system
   is admin-toggleable per store.

So production accumulates the refactor safely and observably, while the *work*
stays in staging until each piece is actually finished. That satisfies "nothing
half-done reaches a shop" without the big-bang.

**Keeping the branch honest:**

- `main` is effectively **frozen** for the duration — the owner has committed to
  no business changes, which is what makes a long-lived branch viable at all.
- Any production hotfix on `main` gets rebased into `refactor/perf` the same
  day.
- Rebase onto `main` at least weekly regardless. **Never let the branch fall
  more than two weeks behind.**
- Every merge to `main` is tagged, so any phase can be reverted on its own.

**What staging genuinely cannot prove.** Be honest about this rather than
discovering it later:

- **Real-device storage grants** — whether `persist()` is actually held on a
  specific iPhone or a specific cheap Android. Emulation cannot answer it.
- **Real network conditions** — Beirut latency, a shop's flaky DSL, a captive
  portal, wifi associated with no upstream.
- **Real scanning hardware** — the desktop wedge, and camera behaviour under
  shop lighting.

Those three are why the canary step exists and why the plan asks for real
devices (§7). "Completely tested in staging" is achievable for correctness; for
these three it is achievable only in a real shop, on one store, watched.
- **Golden diff for money changes**: run old and new against production-shaped
  data and compare outputs *before* switching.
- If a step turns out bigger than one session, split it in this file rather than
  rushing it.

---

## 5. How to resume

1. Read `CLAUDE.md`, then §1 and §4 of this file.
2. Open the ledger below; find the first row that is not `DONE`.
3. Check that row's entry criteria (usually: the previous phase is green).
4. Do exactly that step.
5. Run `npm run typecheck`, `npm run lint`, `npm run build`, and
   `npm run harness:all` if it exists yet.
6. Update the ledger row with status, the commit, and numbers.

---

## 6. Ledger

| Step | Status | Commit | Before | After | Notes |
|---|---|---|---|---|---|
| P-1 staging environment (branch + origin + DB) | DONE | | | | Branch + confined tenant on the main project. **Not a separate origin** — see caveat below |
| P-2 confirm 025 + 037 applied | DONE | | | | **Both applied.** Do NOT run 025 — see note below |
| 0.1 harness env switch + prod-URL guard | DONE | e8b8792 | | | Guard + `.env.test` + harness tenant. 6 guard cases verified |
| 0.2 field measurement events | DONE | | | | 4 events live through real ingest. Client emitters wired, not yet observed firing — see note |
| 0.3 local trace baselines | DONE | | see below | | Bundles + request structure + real API latency. CPU/network throttling unavailable — see caveats |
| 0.4 budget gates | DONE | | | | `verify:budgets` in `npm run build`. Permanent — survives Phase 9. API-depth budget deferred to Phase 1 |
| 1.1 fixtures & seeding | DONE | | | | 2,492 products / 300 txns. Determinism + tenant isolation both proven |
| 1.2 pure-logic characterization | DONE | | | | 130 tests, 8 files, <1s. Vitest 4.1.11 under `harness/` |
| 1.3 API contract snapshots | DONE | | | | 89 tests, ~47s. **Found audit P1-11** |
| 1.4 E2E golden flows | PARTIAL | | | | Flows 1-4 of 8, all THREE platforms. 22 pass / 20 skip / 0 fail in 1.2min. **Found audit P1-12** |
| 1.5 visual snapshots | NOT STARTED | | | | |
| 1.6 offline/sync scenarios | NOT STARTED | | | | |
| 1.7 mutation check of the net | NOT STARTED | | | | Prove it catches |
| 2.1 atomic sale RPC | NOT STARTED | | | | |
| 2.2 route kernel | NOT STARTED | | | | |
| 2.3 generated DB types | NOT STARTED | | | | |
| 2.4 index & query audit | NOT STARTED | | | | |
| 2.5 edge runtime pass | NOT STARTED | | | | |
| 3.1 data primitive | NOT STARTED | | | | |
| 3.2 migrate /pos | NOT STARTED | | | | |
| 3.3 migrate /pos/products | NOT STARTED | | | | |
| 3.4 migrate /transactions | NOT STARTED | | | | |
| 3.5 migrate /pos/cash + /kitchen | NOT STARTED | | | | |
| 4.1 memo boundaries | NOT STARTED | | | | |
| 4.2 History virtualization | NOT STARTED | | | | |
| 4.3 component split | NOT STARTED | | | | |
| 5.1 wait register | NOT STARTED | | | | Table lives in this file |
| 5.2 optimistic + spinner rules | NOT STARTED | | | | |
| 5.3 iOS launch screens | NOT STARTED | | | | Blank white boot today — cheap, big |
| 5.4 view transitions + scroll restore | NOT STARTED | | | | |
| 6.1 storage grant, per platform | NOT STARTED | | | | Install = durability on iOS |
| 6.2 quota & eviction order | NOT STARTED | | | | Queued sales never shed |
| 6.3 three-week shelf-life drill | NOT STARTED | | | | All three platforms |
| 7.1 route budgets enforced | NOT STARTED | | | | |
| 7.2 import audit /pos, /checkout | NOT STARTED | | | | |
| 7.3 precache tiering | NOT STARTED | | | | |
| 8.1 PostgREST cap audit | NOT STARTED | | | | |
| 8.2 IndexedDB read strategy | NOT STARTED | | | | |
| 8.3 pagination gaps | NOT STARTED | | | | |
| 9.1 promote permanent gates | NOT STARTED | | | | |
| 9.2 final numbers | NOT STARTED | | | | Per platform |
| 9.3 keep-or-delete decision | NOT STARTED | | | | Branch A expected; tag first either way |
| 9.4 update CLAUDE.md §8 + audit | NOT STARTED | | | | §8 becomes false if kept |

### P-2 finding — RESOLVED (2026-08-30)

**Both migrations are applied on production. No action needed, and one action
is now explicitly forbidden.**

**037** — all seven RPCs it depends on are live: `decrement_stock_batch`,
`get_transaction_analytics`, `get_shift_totals`, `get_register_performance`,
`get_unassigned_totals`, `maintain_activity_log_partitions`, and the older
`decrement_stock`. The batch decrement and the analytics aggregate are on
their fast paths, not their fallbacks.

**025** — confirmed by running its own pre-flight query in the SQL editor.
Every column matches the post-apply expectation exactly: `numeric(14,2)` on
`transactions.{subtotal,total_amount,amount_paid,change_given}`,
`transaction_items.{unit_price,total_price}` and
`products.{cost_price,selling_price}`, with `products.profit_percentage` at
`numeric(10,2)`.

> **Do not run 025.** It is already applied. Running it would take an
> ACCESS EXCLUSIVE lock and rewrite the three largest tables to no effect.
> The audit's P1-3 overflow (a basket over ~$1,111 dead-lettering after the
> money was taken) is **not** live on production.

**Two introspection methods were tried first and are both invalid.** Recorded
so nobody burns the time again — and because either one, believed, would have
reported a serious production money bug that does not exist:

1. *PostgREST's OpenAPI root (`GET /rest/v1/`) reports column `format`.* It
   reports every numeric column as bare `numeric`, including the nine above
   that are demonstrably `numeric(14,2)`. The field does not carry precision
   on this project. Read naively it says "025 was never applied" — the exact
   opposite of the truth.
2. *An over-range literal in a `WHERE` filter raises `22003`.* It does not.
   `cash_shifts.opening_ll`, known `DECIMAL(12,2)` from migration 021 and
   never touched by 025, accepts a 14-digit filter value happily. PostgREST
   does not cast filter literals to the column type, so the probe is vacuous
   and its "everything fits" result means nothing either way.

The lesson generalises past this step: **the REST API cannot answer schema
questions.** Anything about column types, constraints, indexes or triggers
needs the SQL editor, a direct Postgres connection, or a Management API
token. Phase 2.4's `EXPLAIN` work will need one of those three.

### 0.3 baseline — bundles (2026-08-30)

`npm run baseline` after `npm run build`. Committed to `docs/perf-baseline.json`
so 0.4 has something to compare against. Regenerate after every build;
**`npm run dev` overwrites `.next`, so a dev session invalidates these numbers**
— the script says so when it cannot find the build.

Next 16 no longer emits `app-build-manifest.json` and no longer prints the
Size / First Load JS columns, so this reads the **prerendered HTML** in
`.next/server/app/*.html` and sums the `/_next/static/*.js` it references.
That is what the browser is actually handed, which makes it a better source
than a manifest rather than a workaround for losing one.

**First Load JS, gzipped (raw), highest first:**

| Route | gzip KB | raw KB | chunks | Tier |
|---|---:|---:|---:|---|
| `/pos/products` | 356.7 | 1167.6 | 31 | 3 |
| **`/pos`** | **344.2** | **1120.9** | **29** | **1** |
| **`/checkout`** | **336.0** | **1080.8** | **30** | **1** |
| `/pos/cash` | 334.4 | 1088.6 | 29 | 2 |
| `/transactions` | 329.6 | 1067.6 | 28 | 3 |
| `/kitchen` | 322.5 | 1042.4 | 28 | 2 |
| `/barcodegen` | 317.4 | 1061.0 | 22 | — |
| `/admin/activity` | 310.7 | 1014.1 | 22 | 3 |
| `/admin` | 310.6 | 1016.6 | 23 | 3 |
| `/login` | 289.4 | 945.9 | 20 | — |
| `/admin/login` | 289.1 | 942.3 | 21 | 3 |
| `/admin/transactions` | 288.9 | 944.1 | 20 | 3 |
| `/` | 155.0 | 499.9 | 6 | — |

**Shared by every route: 155.0 KB gz / 499.9 KB raw across 6 chunks.**

**Precache: 119 entries, 3.28 MB raw** — 95 JS files (2909.5 KB), 11 woff2
(143.0 KB), 4 png (172.6 KB), 1 css (86.4 KB), 1 ico (41.4 KB), 2 json.

**Three things these numbers say that change where effort goes:**

1. **The shared baseline is 45% of `/pos`.** 155 of 344 KB is paid by every
   route including `/`, so at most ~190 KB of `/pos` is even addressable by
   route-level splitting. Phase 7 should attack the shared chunk first; a
   route-by-route diet caps out well before it feels like anything.
2. **The spread across routes is small — 289 to 357 KB, a 68 KB band.** Every
   screen carries nearly the same bundle, which is the signature of weak code
   splitting rather than genuinely heavy screens. `/admin/transactions`, which
   a cashier never opens, costs 84% of what `/pos` costs.
3. **§6's "918 KB" figure is wrong and should be retired.** Measured precache
   is **3.28 MB raw**. The infra-cost argument in the business lens is
   therefore understated by roughly 3.5×, not overstated — worth recomputing in
   Phase 9 from this number.

**Not done — needs a signed-in session:** cold/warm boot to interactive under
4× CPU and Slow 4G, request count and request depth per screen, and
main-thread long tasks. Every Tier 1 and Tier 2 screen is behind auth. The
`perf.*` events from 0.2 will supply the field version of these from real
devices, which is the better number anyway; local traces remain useful for
attributing a regression to a specific change.

### 1.4 E2E golden flows — PARTIAL (2026-08-31)

`npm run harness:e2e`. **12 passed, 4 skipped, 0 failed in ~21s** across
desktop and Android.

Flows 1 (scan → cart, total rounding), 3 (park a lane, serve another) and 4
(unknown barcode prompts) are covered, plus a session smoke file and a tenancy
check. Flows 2, 5, 6, 7 and 8 are still to write.

**Auth without a password.** `harness/e2e/fixtures.ts` constructs the session
directly — `goldensquirrel_user` plus the legacy `goldensquirrel_auth`, which
IS the `x-auth-data` tenancy header for every API call (omitting it reproduces
audit P1-10 exactly). Driving the login form would put a plaintext credential
(audit P0-4) into Playwright traces and CI logs, and would make forty tests
depend on one screen.

**No browser download was needed.** `channel: "chrome"` drives the Chrome
already installed, which is also the browser the plan mandates for desktop and
Android (§1) — so it is the more honest target, not just the cheaper one.

> ### Two things the suite exposed immediately
>
> 1. **The fixture barcodes were not barcode-shaped.** `looksLikeBarcode()` is
>    `/^[0-9]+$/` — "anything with a letter in it is somebody typing a product
>    name". `FIX000000001` therefore routed to **search**, not **scan**, so the
>    wedge path was never exercised. Fixture barcodes are now 13 digits in the
>    `2…` in-store range. Had I written the test around the search dropdown
>    instead, it would have passed while testing the wrong code path entirely.
> 2. **`/pos` has two layouts and the wedge only exists on one.** Mobile is
>    camera-first; `SmartScanInput` is the desktop Pro till. The three wedge
>    flows skip on Android via `requireWedge()`, which tests for **the absence
>    of the UI**, not a hardcoded project name — so it follows the layout if
>    that ever changes rather than silently skipping forever. Camera scanning
>    is named in §9.1 as something the harness does not cover; pretending
>    otherwise would read as coverage.

**Flow 2 (made-to-order) added, and iOS unblocked.** WebKit is installed, so
all three profiles run: **22 passed, 20 skipped, 0 failed in 1.2 minutes**. The
skips are the wedge and modifier flows on Android/iOS, which is honest — the
Pro till does not exist on a phone.

> ### Second finding — audit **P1-12**
>
> A menu item scanned **before the recipe cache loads** is sold as a plain
> line: no modifier sheet, `modifiers` NULL so the kitchen never sees a ticket,
> and the menu item's own meaningless stock decremented instead of its
> ingredients. Nothing errors.
>
> The window is small on a warm till but widest exactly when a device is new,
> cleared, or evicted — and a device offline on first launch has no recipes at
> all, so every menu item it sells that day takes this path.
>
> The root cause is a conflation: an absent cache and an absent recipe look
> identical. Belongs in **Phase 3**, where the data layer gains a real loading
> state. Recorded, not fixed.

**Two testing lessons worth keeping:**

1. **A cache landing in localStorage is not the same as React holding it.**
   `refreshRecipes()` writes storage and calls `setRecipes()` separately, so
   polling storage still races the state update. `openTill()` reloads after the
   cache arrives — deterministic, and exactly the state a real till is in on
   every launch after its first.
2. **`getByText` is not specific enough in this app.** A product name appears on
   the quick-grid tile *and* in the dialog heading, so a bare text locator hits
   Playwright's strict-mode violation. Scope to the dialog and match by role.

**A console error to chase:** every `/pos` load logs
`SyntaxError: Unexpected end of input` on desktop and Android, and
`Unexpected end of script` on iOS/WebKit — the same defect in two engines'
wording, so it is real rather than an artefact. Almost
certainly a `JSON.parse` of a truncated localStorage value. Recorded rather
than failed on — this is characterization — but it is a real defect and should
be tracked down.

**iOS is unblocked** (WebKit installed 2026-08-31), so invariant #24 is
satisfied for the flows written so far. The row stays PARTIAL because flows
5-8 — cash shift, inventory, CSV import, kitchen — are still to write.

### 1.3 API contract snapshots (2026-08-31)

`npm run harness:contract` — **89 tests in ~47s** against a production build
and the seeded store. Needs `npm run build && npm run start` first; `next dev`
compiles on demand and skews both timings and behaviour.

Three files: `auth.test.ts` (61 — every store route refuses anonymous,
malformed, no-store-id and unknown-store callers, and accepts the fixture
caller), `read-shapes.test.ts` (15 — response shape snapshots plus explicit
tenancy assertions on the rows themselves), `sale.test.ts` (13 — the money
path).

Snapshots record **shape, not values**. Literal values would break on every
re-seed and every generated id, and would then be updated reflexively until
they asserted nothing.

Invariants now pinned end-to-end: **#7** (same `transaction_number` twice
creates exactly one row, the duplicate is flagged, and stock is not
double-decremented), **#9** (client `stock_decrements` take priority and the
line's own product is NOT also decremented), **#10** (a sale succeeds with no
user, with no matching shift, and with stock at zero), **#17**, **#19**,
**#21**, **#23**, plus `created_at` clamping in both directions — a future
timestamp is pulled back, a past one is preserved, which is the audit P1-1 fix.

> ### The suite found a real money bug on its first run — audit **P1-11**
>
> `POST /api/transactions` returns **500** when `user_id` names a deleted
> `store_users` row (`23503` on `transactions_user_id_fkey`).
>
> A cashier rings sales offline → the employee leaves and an admin removes them
> (a **hard** delete) → the till reconnects → the insert violates the FK → the
> client reads 500 as an offline condition, retries, exhausts five attempts and
> **dead-letters** the sale. Money taken, sale never recorded.
>
> `ON DELETE SET NULL` protects sales already written; it does nothing for ones
> still in a device's queue. This contradicts **invariant #10** — shift
> resolution already degrades to a null `shift_id`, but the user reference does
> not degrade the same way.
>
> **Left unfixed on purpose.** Phase 1 freezes behaviour; the test pins the 500
> so Phase 2.1's atomic sale RPC cannot change it unnoticed in either
> direction. The fix (coerce an unresolvable `user_id` to null, as shift
> resolution already does) belongs with 2.1, which rewrites that insert anyway.
>
> This is also the answer to Phase 1's exit criterion — *"a net that has never
> caught anything is not known to work."* It caught something before 1.7 even
> ran.

**A fixture problem it also surfaced:** `GET /api/transactions` filters on
`store.transaction_retention_days`, so the March-2026 fixture sales were
outside the default window and the route returned `[]`. `seed.mjs` now sets
retention to 0 for the fixture store. Fixtures need dates spread enough to span
a DST boundary *and* need to stay readable; only a store that keeps everything
gets both.

### 1.2 pure-logic characterization (2026-08-31)

`npm run harness:unit` — **130 tests across 8 files in under a second**, no
database, no network, no DOM. Comfortably inside the 10s budget Phase 1 sets.

Covered: `utils/format`, `stores/cartStore` (mutations, totals, lanes,
one-offs, configured lines), `pos/lineItems`, `pos/lineKey`,
`products/kind`, `products/refresh.evaluateReconcile`,
`auth/permissions.parsePermissions`, `features.mergeFeaturesWithDefaults` +
preset completeness, and `db/localDB.computeRetryBackoffMs`.

Invariants now pinned by a test: **#2** (rounding at the total only — asserted
against what per-line rounding *would* have given), **#5** (`updateLine` resets
`original_unit_price` so no phantom discount is reported), **#8** (deletion
requires positive proof, including the 1,000-row truncation case), **#9**
(components decrement, not the menu item; integerised once at the line),
**#16** (`isSellable` defaults to sellable on a pre-030 `undefined` kind),
**#17** (`[]` survives as `[]`, never collapsed to null), **#18** (`lineKey`).

> **Three of my assumptions were wrong, and being wrong is the point.**
> Characterization only has value if it records reality:
>
> 1. **`addItem` REFUSES a repeat** — it returns `false` and leaves the
>    quantity alone. Scanning twice does not double a line; quantity only rises
>    via the manual "+". Documented in the code and deliberate.
> 2. **Lines are PREPENDED**, so `items[0]` is the newest.
> 3. **`CartLineModifier.state` is `'included' | 'removed' | 'extra'`** — there
>    is no `'kept'`. My first draft used `'kept'` and *passed*, because only
>    `'removed'` is special-cased. A test that passes for the wrong reason is
>    worse than one that fails, and typechecking the harness is what caught it.

`unit/setup.ts` supplies a memory `localStorage` (the cart store is a zustand
`persist` store) and nothing else — needing more of the browser is a signal a
"pure logic" test is reaching too far.

**Gates:** typecheck clean, lint unchanged from `main` at 207/77/130, budgets
green. The harness is typechecked by `npm run typecheck` because `tsconfig`
includes `**/*.ts` — worth keeping, since it is what caught the invalid state.

### 1.1 fixtures (2026-08-31)

`npm run harness:seed` / `harness:verify` / `harness:seed:down`.
`harness/README.md` is written and is the entry point for anyone adding a case.

**Contents:** 2,492 products (USD-priced, zero-cost, one above the old
`DECIMAL(10,2)` ceiling, discounted, a variant pair, 4 ingredients in grams, a
menu item, a combo), 5 categories, a 4-component recipe, 2 store users with
*different* permissions (one full, one `pos`-only — `inventory` is the pricing
permission and the till behaves materially differently without it), 1 register,
1 closed + 1 open shift, and 300 transactions / 592 line items spanning the
**2026-03-29 Beirut DST boundary**.

**Two properties were proven rather than assumed:**

1. **Determinism.** Every table was fingerprinted (SHA over ordered rows),
   re-seeded, and fingerprinted again — **byte-identical**. Ids are derived,
   prices come from a seeded PRNG, timestamps from fixed anchors. Without this
   every contract and visual snapshot in Phase 1 would be meaningless.
2. **Tenant isolation held.** After seeding, the other stores still have
   exactly their pre-existing **4,999 products, 118 transactions, 5 stores**.
   This is asserted in `verify.mjs` on every run, because the service-role key
   bypasses RLS and the harness's own filtering is the only thing enforcing it.

`verify.mjs` runs 17 assertions including the trigger-computed
`profit_percentage` (zero-cost → 0, no divide-by-zero; discounted row matches
the formula), the 150,000,000 LL price surviving, sales on both sides of the
DST boundary, and retail lines carrying `modifiers` NULL rather than `[]`.

> **PostgREST rejects a bulk insert whose objects differ in shape**
> ("All object keys must match") — it builds one multi-row INSERT with a fixed
> column list. `uniformKeys()` pads the union with nulls. Worth knowing before
> adding a column to only some fixture rows.

### 0.4 budget gates (2026-08-30)

`npm run verify:budgets`, wired into `npm run build` after `verify:sw`, in the
same shape. Enforces `docs/perf-baseline.json`:

- **No route's First Load JS grew.**
- **Total precache did not grow.**

Measurement lives in `scripts/lib/measure-build.mjs` and is shared by the
reporter and the gate — a gate that measures differently from the reporter
fails for reasons nobody can reproduce.

**Growth is allowed, but only deliberately.** A new feature legitimately costs
bytes; the gate does not re-baseline itself, so that cost has to be accepted by
a person:

```
npm run build && npm run baseline:update
```

**The 1% tolerance is noise absorption, not slack.** Gzip output differs by a
few bytes across zlib/Node versions, and a gate that reddens on a Node upgrade
is a gate people learn to ignore — which Phase 1's maintainability rules warn
about directly.

**The third budget from the plan — serial API round trips per route — is NOT
implemented**, because measuring it needs a browser driving a signed-in
session, which arrives with the Phase 1 harness. A placeholder would have been
a gate asserting nothing. Baseline for when it lands (store `daoud`): `/pos`,
`/pos/products`, `/pos/cash`, `/transactions` each issue **4 API calls at
depth 2**; `/checkout` issues **1**. The defect it must catch is the reconcile
id-set fetch running serially behind the catalogue delta pull.

**Verified:** passes on an unchanged build; a control that tightened the
recorded `/pos` budget by 20% and precache by 10% produced both failures with
exit code 1, so the gate is known to catch rather than merely known to pass. A
missing baseline file fails closed with instructions.

### 0.3 baseline — runtime (2026-08-30)

Captured on the **production build** (`npm run start`, not `next dev` — dev
serves unminified code with on-demand compilation and its numbers mean
nothing), signed in as store **`daoud`**: **2,280 products, 93 transactions**.
A later run is only comparable against the same store.

> **Read the asymmetry before reading the numbers.** Static assets came from
> **localhost** — no network latency, warm HTTP cache (`transferKB` reads 0
> throughout, which is the tell). Those paint timings are a floor no shop will
> ever see. But the **API and Supabase calls went to the real remote project**,
> so *those* latencies are real. The request-structure and API columns are the
> trustworthy part of this table; FCP/LCP are useful only for detecting a
> regression under identical conditions.

| Route | requests | depth | API calls | API depth | FCP | LCP |
|---|---:|---:|---:|---:|---:|---:|
| `/pos` | 73 | 34 | 4 | 2 | 28 | 68 |
| `/pos/products` | 59 | 35 | 4 | 2 | 80 | 136 |
| `/pos/cash` | 61 | 34 | 4 | 2 | 24 | **1460** |
| `/checkout` | 60 | 33 | 1 | 1 | 56 | 140 |
| `/transactions` | 59 | 32 | 4 | 2 | 88 | 776 |

**The `/pos` boot chain, with real remote latency:**

| # | start | dur | call |
|---|---:|---:|---|
| 1 | 82 | 310 | `/api/admin/stores/features` |
| 2 | 102 | **599** | `/api/my-shift` |
| 3 | 150 | 291 | `product_favorites` |
| 4 | 154 | 313 | `products` (catalogue delta) |
| 5 | **468** | 299 | `products?select=id` (reconcile id set) |

**Four findings worth acting on:**

1. **Call 5 is serial behind call 4.** It starts at 468 ms, and call 4 ended at
   467 ms. The reconcile id-set fetch waits for the delta pull, so the boot
   chain is ~767 ms of API time where ~470 ms would do. This is the single
   clearest Phase 3 target on the till, and it is invisible in any
   localhost-only measurement because it is a *dependency*, not a slow query.
2. **`/api/my-shift` is the slowest call at boot (599 ms)** and it gates
   nothing a cashier needs in order to scan. Phase 5 candidate: move it off the
   boot path entirely.
3. **`/pos/cash` LCP is 1460 ms even with zero asset latency** — 10× to 20×
   every other route. Probably the analytics chart, which CLAUDE.md says loads
   *after* the drawer figures deliberately, so this may be correct behaviour
   rather than a defect. **Confirm which before touching it**; if the drawer
   numbers paint early and only the chart is late, this is working as designed.
4. **Request depth is 32–35 on every route** while API depth is only 1–2. The
   depth is script chunks loading in sequence, not data — which points at the
   same weak code splitting the bundle numbers showed, and at Phase 7 rather
   than Phase 2.

**Not measured, and why:**

- **CPU 4× and Slow 4G throttling** — the browser tooling here exposes no CDP
  throttling. The `perf.*` events from 0.2 are the intended answer: real
  devices on real connections beat any emulation.
- **Main-thread long tasks** — the `longtask` PerformanceObserver **never fires
  in this browser**, confirmed with a control that deliberately blocked the
  main thread for 200 ms and still produced zero entries. Recording 0 would
  have been a fabricated number, so the metric is dropped rather than reported.

### 0.2 notes (2026-08-30)

`perf.boot` / `perf.scan` / `perf.sale` / `perf.route` are in the vocabulary and
emitted from `src/lib/activity/perf.ts`. Design points worth not undoing:

- **Every duration ends at a PAINT**, via a double-rAF, not at the callback
  that finished the work. Stopping at the commit reports a number reliably a
  frame or more optimistic — which is exactly the gap Phase 5 attacks, so
  measuring it away would hide the work. The emit itself happens inside that
  post-paint callback, so instrumentation is never inside what it measures.
- **`performance.now()`, never `Date.now()`.** These tills routinely have wrong
  clocks; a wall-clock jump would produce negative durations.
- **`source` on a scan and `measuredFrom` on a route are reported, never
  inferred.** "It was fast so it must have been a local hit" stops being true
  on exactly the slow devices this exists to find. The page marks the branch
  that answered; the tab bar marks the tap. A route with no marker (browser
  back) is labelled `commit` rather than blended into the same average.
- `logPerfBoot()` fires once per JS context — returning to `/pos` by
  client-side nav is a route change, not a boot.

**Verified:** all four accepted by the real `POST /api/activity` (4 accepted,
0 dropped) and stored in `activity_logs` with the category derived correctly.
Control run confirms the vocabulary gate actually rejects — `perf.bogus` and
`totally.made_up` both dropped, and a mixed batch split 1 accepted / 1 dropped.
Typecheck clean, lint unchanged from baseline, build green.

**Not yet observed:** the client emitters firing from a real interaction, which
needs a signed-in browser session. The emit path they share is proven, so what
is unverified is call-site placement, not the pipeline.

### P-1 resolution (2026-08-30) — and what it does NOT buy

Supabase branching needs Pro; this project is on the free plan. The owner
directed the harness at the **main project** instead, on the grounds that it
has no real clients. A read-only survey agreed: **5 stores, 4,999 products,
118 transactions, 174 line items** — demo volume, not a live book of business.
CLAUDE.md's "serving multiple paying stores" is stale.

The harness is therefore confined to a **dedicated tenant** rather than given
the run of the database:

| | |
|---|---|
| Harness store | `00000000-0000-4000-8000-000000000001` (`__harness__`) |
| Guard | Refuses the main host unless `HARNESS_ALLOW_PRODUCTION_HOST=yes` **and** `HARNESS_STORE_ID` are both set |
| Isolation | Every table is store-scoped, so the store id is the isolation |

> **The confinement is a convention, not an enforcement.** Nothing in the
> database stops a harness query that forgets its `store_id` filter — the
> service-role key bypasses RLS by design (audit P0-3). Fixtures and teardown
> must filter on `HARNESS_STORE_ID` every time. Treat an unscoped write in
> `harness/` as a defect on the same level as a money bug.

**Three things P-1 asked for that this does not deliver**, to be honest about
rather than discover in Phase 5:

1. **No separate origin.** Service workers, Cache Storage, IndexedDB and
   `localStorage` are origin-scoped, so the Phase 6 durability drills are only
   truly clean on their own origin. A Vercel preview deployment of
   `refactor/perf` gives one for free and should be stood up before Phase 6.
2. **Schema is shared.** Any migration the refactor adds lands on the same
   database as the existing stores. Phase 2's RPC work needs care here — it is
   the one part of the plan that cannot be confined by a `store_id`.
3. **Not a clean-room.** Row counts, query plans and cache behaviour are all
   measured next to five other tenants' data. Fine for characterization;
   remember it when reading Phase 8's scale numbers.

---

## 7. Open decisions for the owner

Everything not listed here is settled — see the header.

1. **Which non-production database** (§2, P-1). **This is the only thing
   blocking the start.** It is a human/provisioning task, not something a
   session can do: pick Supabase branching, a second Supabase project, or local
   Docker, and provide the credentials.
2. **Canary store** — may one real store be the flag-gated first adopter? A
   friendly, reasonably busy one; not the largest account.
3. ~~Keep or delete the harness?~~ **Resolved 2026-08-30: keep, if it proves
   maintainable.** Judged at Phase 9 against the rules in Phase 1. This also
   means `CLAUDE.md` §8 ("there is deliberately no automated test suite") will
   need rewriting rather than restoring.
4. **Scale target** — is 20k products / 200k transactions (§Phase 8) the right
   ceiling to design for?
5. **Browser standard.** ~~Open.~~ **Resolved 2026-08-30, with a correction:**
   Blink mandated on desktop and Android; iOS mandated as *installed from
   Safari*, because Chrome-on-iOS is still WebKit and the Home Screen install is
   what buys storage durability. See the platform matrix in §1.
6. **Test devices.** The Android and iOS profiles in the harness are emulation.
   At least one real mid-range Android and one real iPhone are needed to sign
   off Phases 5 and 6 — emulation cannot prove a storage grant, a cold WebView
   launch, or a camera frame rate. Which devices are available?
