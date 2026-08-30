# harness/

The characterization net for the performance refactor
([`docs/PERF-REFACTOR-PLAN.md`](../docs/PERF-REFACTOR-PLAN.md), Phase 1).

Written for **someone adding a feature**, not for whoever built it. If you are
here because you changed something and want to know what to run, start at
[Everyday use](#everyday-use).

---

## The one thing you must not get wrong

**Every read and write is scoped to `HARNESS_STORE_ID`.**

There is no RLS behind you. The service-role key bypasses row-level security by
design (audit P0-3), so this directory's own filtering is the *only* thing
keeping the harness off other tenants' catalogues and sales. An unscoped
statement here is a defect on the level of a money bug.

`seed.mjs` exposes `scopedDelete()` precisely so that "delete without a store
filter" is not something you can express by accident. Follow the same pattern
in anything you add.

The seatbelt above that is `harness/guard/assert-not-production.mjs`, which
every entry point calls first. It refuses to run unless it knows which database
it is pointed at, and refuses the main project unless **both**
`HARNESS_ALLOW_PRODUCTION_HOST=yes` and `HARNESS_STORE_ID` are set. It fails
closed: an unset URL is refused, not assumed harmless.

---

## Setup

1. `cp .env.test.example .env.test`
2. Fill it in. To run against the main project (the current arrangement — this
   deployment has no real clients), set the two `HARNESS_` keys at the bottom of
   the example file.
3. `npm run harness:guard` — confirms what you are pointed at before anything
   writes.

`.env.test` is gitignored. `.env.test.example` is not.

---

## Everyday use

```bash
npm run harness:unit         # pure-logic suite -- 130 tests, <1s, no DB
npm run harness:unit:watch   # same, in watch mode
npm run harness:guard        # what database am I pointed at?
npm run harness:seed         # tear down + re-seed the fixture store
npm run harness:verify       # 17 assertions, incl. other tenants untouched
npm run harness:seed:down    # tear down only
npm run harness:all          # guard + unit
```

Needs a **running production server** and a seeded database:

```bash
npm run build && npm run start   # in one terminal
npm run harness:contract         # in another -- 89 tests, ~47s
```

**`harness:unit` touches no database and needs no `.env.test`.** Run it freely.
Everything else writes.

Seeding is destructive **within the fixture store only** — it clears that
store's rows and rebuilds them. It takes about a minute for the full 2,492
products; pass `--count 40` for a fast run while iterating.

---

## Layout

| Path | What lives here |
|---|---|
| `guard/` | The production seatbelt. Called first by every entry point. |
| `fixtures/` | `ids.mjs` (derived ids + PRNG), `seed.mjs`, `verify.mjs` |
| `unit/` | Pure-logic characterization (Vitest). No DB, no network, no DOM. |
| `contract/` | API request -> status + response SHAPE. Needs a server + seeded DB. |

Phase 1 adds `e2e/`, `visual/` and `offline/` alongside these. One obvious place per concern, so "where does my new test go" is never a
question.

Nothing in `src/` imports from here, and nothing here imports from `src/`
except pure logic under test. That keeps removal a `git rm` of one folder.

---

## Fixtures

### Everything is derived, nothing is random

Ids come from `fixtures/ids.mjs`; prices come from a seeded PRNG; timestamps
come from fixed anchors. **Re-seeding produces byte-identical rows** — verified
by fingerprinting every table before and after a re-seed. Snapshots are
worthless if the data moves, so if you add fixture data, derive it the same way.
Never reach for `Math.random()` or `Date.now()`.

Ids are readable by prefix, so a failing assertion names something you can
recognise instead of an opaque uuid:

```
f0000001-…  product        f0000005-…  transaction    f0000009-…  cash shift
f0000002-…  category       f0000006-…  transaction item
f0000003-…  store user     f0000007-…  recipe component
f0000004-…  cash register  f0000008-…  combo component
```

### What the seed contains

- **2,492 products**, including the shapes that have caused real bugs: a
  USD-priced item, a zero-cost item (the `profit_percentage` trigger divides by
  cost), one priced above the old `DECIMAL(10,2)` ceiling, a discounted item, a
  variant pair, 4 ingredients in grams, a made-to-order menu item and a combo.
- **5 categories**, a **4-component recipe**, a **combo**.
- **2 store users** with different permissions — one full, one `pos`-only.
  `inventory` is the pricing permission, and the till behaves materially
  differently without it, so both sides need covering.
- **1 register**, **1 closed shift and 1 open shift**. They do not overlap: one
  open shift per register is enforced by a partial unique index, so overlapping
  them would be refused by the database.
- **300 transactions / 592 line items** spanning the **2026-03-29 Beirut DST
  boundary**, deliberately — that is what catches a report grouping by calendar
  day in UTC, or a shift window computed in the wrong zone. Sales inside the
  closed shift's window carry its `shift_id`; the rest are left unassigned so
  the Unassigned bucket is exercised.

### Adding to the fixtures

Add rows, never a new seeding mechanism. Then:

1. Put ids through `fixtureId()` so they stay derived.
2. Add an assertion to `verify.mjs` — an un-asserted fixture is one nobody
   notices the loss of.
3. Re-run `npm run harness:seed && npm run harness:verify`.

Note `uniformKeys()` in `seed.mjs`: PostgREST rejects a bulk insert whose
objects differ in shape, so rows with optional columns are padded with nulls.
If you add a column to some rows only, that is what handles it.

---

## The unit suite

**Characterization, not specification.** These record what the code does
*today*, so the refactor can move things underneath them. Where current
behaviour looks odd it is still recorded as-is with a comment saying so —
changing it is a separate, deliberate decision, not something a refactor does
by accident.

Three assumptions were wrong when these were written, and each is now pinned:

- **`addItem` refuses a repeat rather than accumulating.** Scanning the same
  product twice leaves the quantity alone and returns `false`; quantity only
  ever rises via the manual "+". 
- **Lines are PREPENDED**, so `items[0]` is the most recently scanned.
- **`CartLineModifier.state` is `'included' | 'removed' | 'extra'`** — there is
  no `'kept'`. Only `'removed'` is special-cased, so an invalid state behaves
  like `'included'` and a test using one proves nothing.

`unit/setup.ts` supplies a memory `localStorage` because the cart store is a
zustand `persist` store. It is deliberately the smallest possible shim: if a
test needs more of the browser than that, it belongs in the E2E suite.

## The contract suite

Records **status + response shape**, not values. A snapshot of literal values
would break on every re-seed and on every generated id, and would then be
updated reflexively until it asserted nothing. Shape is the real contract:
which keys exist, what type each holds. Values that matter are asserted
explicitly instead — that the rows belong to the fixture store, that a
duplicate creates exactly one row, that stock moved by the right amount.

To accept an intentional change: `npm run harness:contract -- -u`. **Read the
diff first.** A key vanishing from a money route is not a snapshot in need of
updating.

Sales written by `sale.test.ts` are prefixed `CONTRACT-` and deleted in
`afterAll`, so the `FIXTURE-` rows the rest of the suite reads are untouched.
They do decrement stock, though, so stock drifts across repeated runs —
re-seed if a stock assertion starts behaving oddly.

## Things that will bite you

- **`npm run dev` overwrites `.next`**, which invalidates the bundle numbers in
  `docs/perf-baseline.json`. Rebuild before running `npm run baseline`.
- **Teardown order is dictated by foreign keys, not preference.**
  `recipe_components` must go before `products` (`ingredient_product_id` is
  `ON DELETE RESTRICT`), and `cash_shifts` before `cash_registers` for the same
  reason. Those constraints are deliberate — they stop a mistake cascading real
  counted history away. Do not work around them.
- **`profit_percentage` is computed by a database trigger.** Whatever the seed
  sends is overwritten. Never assert on a value you supplied; assert on the
  formula.
- **The fixture store has retention DISABLED** (`transaction_retention_days = 0`,
  set by `seed.mjs`). `GET /api/transactions` filters on that column, and the
  fixture sales are dated around the March 2026 DST boundary — with the default
  window the route returned `[]` and looked broken. Fixtures need dates far
  enough apart to span a DST change *and* need to stay readable; only a store
  that keeps everything gets both.
- **`modifiers` distinguishes `NULL` from `[]`.** `NULL` is an ordinary retail
  line; `[]` is a menu line where nothing was changed. The kitchen board filters
  on `modifiers IS NOT NULL`, so collapsing them makes a retail store see every
  sale as a ticket. Use `?? null`, never `|| null`.
