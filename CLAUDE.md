# CLAUDE.md — GoldenSquirrel POS

Ground truth for this repo. **Read this before trusting any other document here.** Several root-level docs describe a different product entirely (see [Document trust](#document-trust)).

---

## 1. What this actually is

A **mobile-first, offline-first retail Point of Sale PWA** for shops in **Lebanon**, handling **dual currency (Lebanese Pound + USD)**. It is live in production on Vercel, serving **multiple paying stores**.

**Naming is a mess — this trips up every new session:**

| Where | Name used |
|---|---|
| Repo folder / git remote | `TableMind` |
| `package.json` `name` | `goldensquirrel` |
| PWA manifest / all UI branding | "Golden Squirrel POS" / "SquirrelPOS" |
| IndexedDB database | `GoldenSquirrelPOS` |
| localStorage key prefix | `goldensquirrel_` |

**`TableMind` was an abandoned predecessor product** — a restaurant reservation/floor-plan system. It was pivoted into this POS and never renamed. Leftover TableMind scaffolding is still in the tree and still ships in the bundle. Treat "TableMind", "restaurant", "reservation", "merchant", "table", "waiter" as **signals of dead code**, not features.

**The tenancy column is `store_id`.** Never `merchant_id`, never `restaurant_id`. If you see those, you are reading dead code or a stale doc.

> **Not every store is a retail store any more.** Bakeries, coffee shops and snack counters sell **made-to-order** items assembled from ingredients. See [§13](#13-store-types-menus-and-ingredient-depletion).

---

## 2. Stack (verified against `package.json`, not docs)

| Thing | Version / choice | Note |
|---|---|---|
| Next.js | **16.1.6**, App Router | Docs claiming Next 14 are wrong |
| React | **19.2.3** | Docs claiming React 18 are wrong |
| Bundler | **webpack** (`--webpack` on dev *and* build) | Deliberate. `@ducanh2912/next-pwa` is incompatible with Turbopack. Do not remove this flag. |
| Tailwind | **v4.1.18**, CSS-first | **There is no `tailwind.config.ts` and there should not be.** Theme lives in `@theme inline` in `src/app/globals.css`. |
| UI primitives | shadcn/ui, **hand-copied, not CLI-managed** | No `components.json` exists, so `npx shadcn add` will not work. The primitives are old-style (`forwardRef` + `displayName`). Match the existing style when editing them. |
| State | Zustand 5 (cart only) | See [State](#6-state--where-data-actually-lives) |
| Local DB | Dexie 4 (IndexedDB) | `src/lib/db/localDB.ts` |
| Backend | Supabase (Postgres) | Migrations in `supabase/migrations/` |
| PWA | `@ducanh2912/next-pwa` | **Not** Serwist, despite Serwist being in `package.json` |
| Toasts | `sonner` | |
| Charts | `recharts` | |
| Deploy | Vercel, functions pinned to **`dub1`** (Dublin) | `vercel.json`. See below |
| Database region | **Supabase `eu-west-1` (Ireland)** | Moved from Seoul 2026-09-01 |

### Where this runs, and why it matters more than any code in here

Supabase is in **Ireland (`eu-west-1`)** and Vercel's Node functions are pinned
to **`dub1`** (Dublin, the same AWS region). Both moved on **2026-09-01**, from
Supabase Seoul and Vercel's default `iad1` (Washington).

The shops are in **Lebanon.** That single fact used to dominate everything:
measured from Beirut on a warm connection, a round trip to Seoul was **285 ms of
which 19 ms was the database doing work.** The rest was distance.

| | Before | After |
|---|---:|---:|
| One row by primary key | 285 ms | **81 ms** |
| 50 products | 274 ms | **83 ms** |
| `get_cash_overview` | 260 ms | **85 ms** |

**Three things follow, and each has already been a trap:**

1. **Do not pin Vercel to a region without checking where the database is.**
   `dub1` against a database in Seoul is *slower* than Washington against Seoul.
   The region pin is always the last step.
2. **`/api/health` is Edge and is unaffected by `vercel.json`** — Edge runs at
   every PoP. It must stay Edge (see §4).
3. **`NEXT_PUBLIC_SUPABASE_URL` is compiled into the client bundle**, so a
   Supabase move needs a *rebuild*, not just an environment change, and every
   till keeps using the old project until its service worker updates.

The runbook, including the two `pg_restore` traps that silently strip the grants
PostgREST needs, is `docs/REGION-MIGRATION.md`.

---

## 3. Money rules — read this before touching any price

This is the most dangerous area of the codebase and the easiest to get wrong. **`src/lib/utils/format.ts` is the single source of truth.** Never inline a conversion or a rounding calculation.

### The rules

1. **LL (Lebanese Pound) is the base currency.** Prices, totals, and revenue are stored in LL. USD is a derived display/payment currency.
2. **Every LL amount the customer sees or pays must be a multiple of 5,000** — Lebanon has no smaller bill. Use `roundToNearest5k()`.
3. **Rounding happens at the cart total only — never per line item.** Per-item rounding compounds and drifts. `cartStore.getTotal()` is the only place it is applied.
4. **Two exchange rates, and they are not interchangeable:**
   - `SELL_RATE` (90,000) — the store is *giving out dollars*: turning a USD **price** into the LL a customer owes (`convertUsdToLl`), and valuing change handed back against an **LL** payment.
   - `RETURN_RATE` (89,000) — the store is *taking dollars in*: **quoting an LL amount in USD** for the customer to pay (`convertLlToUsdForReturn`), valuing a **USD payment** in LL (`convertUsdToLlForReturn`), and change against a payment already made in USD.

   > An earlier revision of this rule put "pricing an LL amount in USD" under
   > `SELL_RATE`. That is wrong, and it contradicts every screen in the app —
   > the till grid, the scan box, the cart rows, the modifier sheet, checkout
   > and the totals panel all quote LL in USD at `RETURN_RATE`. The quote is a
   > payment the store is about to *take in*, so it settles at the buying rate.
   > `convertLlToUsdForSale` exists but is called by nothing except the
   > deprecated `convertLlToUsd`; if you reach for it, be sure you can say why.

   The spread is the store's margin on currency, and the rule that generates
   both lines is **the direction the dollars move, not the direction the
   money moves.** The store buys dollars at 89,000 and sells them at 90,000.

   > This used to read "RETURN_RATE — money going *back* to the customer
   > (change)", which is wrong and was reported as a money bug before being
   > reproduced and traced to the document. Change is not one case. **Change is
   > rated by what the customer tendered**, because that is what decides
   > whether the drawer is handing dollars out or giving back dollars it just
   > took in.

   `getChangeRate()` in `src/app/checkout/page.tsx` is the implementation, and it is the reference for this rule:

   | Customer paid | Change valued at | Why |
   |---|---|---|
   | LL only | `SELL_RATE` (90,000) | the drawer is selling dollars back |
   | USD only | `RETURN_RATE` (89,000) | returning dollars it just took at 89,000 |
   | both | weighted blend by each currency's contribution | neither rate alone is honest |

   The checkout panel labels which rate it used (`$1 = 90,000 LL`, or
   `blended $1 ≈ …`), so the figure on screen is always attributable. Using the
   wrong rate silently moves money on every transaction, in whichever direction
   the mistake happens to fall.
5. **Use the named helpers, not raw arithmetic:** `convertUsdToLl`, `convertUsdToLlForReturn`, `convertLlToUsdForSale`, `convertLlToUsdForReturn`. Raw `* SELL_RATE` bypasses the 5k rounding that `convertUsdToLl` exists to apply.
6. `convertLlToUsd` is **deprecated** — do not use it in new code.

### Known problems here (do not copy these patterns)

- The rates are **hardcoded constants**, so changing them needs a deploy. `stores.usd_rate_sell` / `usd_rate_return` columns already exist (migration `004`) with unused SQL helpers — the intended fix.
- Transactions carry **no rate stamp**, so historical receipts re-price when the rate changes.
- Several screens currently disagree on which rate to use, so the same product can show different USD values in different places. When you touch one of these, fix it toward the rules above rather than matching the neighbour.
- Money is JS floats end-to-end against `DECIMAL(10,2)` columns. See the audit doc for the overflow consequence.

---

## 4. Offline-first architecture

The app must keep selling with no internet. This shapes almost every design decision.

### Connectivity

`src/lib/connectivity.ts` is a **heartbeat-based** singleton — it probes `/api/health`, because `navigator.onLine` lies (it reports "online" for a connected wifi with no internet).

> **`/api/health` runs on the Edge runtime, and must stay there.** It is the most-called endpoint in the product — every tab, every 15s, all day, in every shop — and as a Node function it was the app's RTT floor at ~200ms plus a cold start. Anything imported into that file that needs Node (a Supabase client, the service-role key, `cookies()`) silently drops it back to Node and makes the heartbeat slow again.

> **Critical:** `/api/health` has a `NetworkOnly` rule in `next.config.ts`. If the service worker is ever allowed to cache it, the app serves a cached `200` forever, believes it is permanently online, never shows offline banners, and never triggers sync. Do not touch that rule.
>
> **The credential reads are `NetworkOnly`, and must stay that way.** Login
> compares the password in the browser, so the response to
> `/rest/v1/stores?select=*` carries `password_hash` — which is the password.
> The default `cross-origin` handler was caching that to disk, where it survived
> logout, because nothing ever called `caches.delete()`. Audit P0-10.
> `src/lib/pwa/purgeCredentialCache.ts` cleans devices that already have it.
> **Unrelated to offline login**, which reads localStorage via
> `validateCachedCredentials()` and is deliberately kept across logout.
>
> **`next/dynamic` does NOT keep a library out of the precache.** It keeps it
> out of the initial *bundle*; the precache manifest is built from the whole
> build output, so a shop downloads it on **install** whether or not the code is
> ever reached, and holds it on a device whose storage also holds queued sales.
> (It is not re-downloaded on every deploy — each entry's `revision` IS its
> content hash, so Workbox refetches only chunks that actually changed.) Two
> libraries are
> excluded by name (`/pdf-export/`, `/charts/`), and each needs BOTH halves — a
> `splitChunks` group in `nextConfig.webpack` giving it a stable name, and the
> matching entry here — because webpack names chunks by content hash. **ZXing
> (560 KB) is deliberately still precached:** mobile is camera-first and
> scanning offline is core, whereas every chart screen fetches its data from the
> network and cannot render offline anyway.
>
> **`workboxOptions.exclude` has the same footgun as `runtimeCaching`.** Supplying it REPLACES next-pwa's three defaults (`.woff2` that is not preloaded, `.map`, `manifest-*.js`), so the array in `next.config.ts` re-lists all three before adding its own `/pdf-export/` entry. Drop them and every install re-acquires megabytes of source maps. `scripts/verify-sw.mjs` asserts both halves.
>
> Equally critical and easier to break by accident: **`extendDefaultRuntimeCaching: true` must stay set.** Supplying a custom `runtimeCaching` array *replaces* the 19 defaults unless it's on — including the `pages` rule that caches HTML navigations, which is the only thing letting the POS open cold with no internet (HTML is deliberately not precached).
>
> **A service-worker update reloads the page, so it must never land mid-task.** `src/components/PWAUpdateListener.tsx` applies an update on `controllerchange`, but only once nothing holds `src/lib/pwa/reloadGuard.ts`. Screens declare their own busy state with `useReloadGuard(active, reason)` — a non-empty cart alone is not enough, because every screen outside the POS has an empty cart by definition. If you build a screen where a reload would lose typed or selected state, add a hold.
>
> Both are asserted by `scripts/verify-sw.mjs`, which runs automatically as part of `npm run build`. **If that check fails, do not ship the worker** — `public/sw.js` is generated and gitignored, so nothing else will catch it. This exact bug has shipped twice.

### Storage layers

`src/lib/db/localDB.ts` — Dexie DB `GoldenSquirrelPOS`:

| Table | Purpose |
|---|---|
| `products_cache` | Mirror of Supabase products, so POS works offline |
| `transactions_cache` | Read-only history cache for the transactions page |
| `offline_queue` | **Completed sales** waiting to be pushed. The money-critical queue. |
| `pending_writes` | Generic non-sale writes (favourites, cash shifts, adjustments, **product creates/updates**) |
| `activity_buffer` | Activity-log events waiting to be shipped. **Expendable** — capped at 20,000 rows, oldest shed first, and the first thing dropped under storage pressure. See §12. |

Schema is at `version(4)`. Dexie versions are **append-only** — add a new `db.version(n).stores({...})` block, never edit an existing one. Compound indexes in use: `[store_id+barcode]` (barcode lookups must be store-scoped — barcodes are not unique across tenants), `[store_id+created_at]`, `[store_id+name]`.

Every write path is retry-capped at 5 attempts. Queued **transactions** are the exception to dropping: on exhaustion they are **dead-lettered** (`failed_permanently`), never deleted — each one is a completed sale whose money was taken. `getQueuedTransactions()` excludes them; `getDeadLetterTransactions()` returns them. They **do** surface now: the transactions page reads `getDeadLetterTransactions()` and lists them with `syncState: "failed"` alongside the queued ones.

### Sync

`src/lib/sync/engine.ts` — a singleton `SyncEngine`. Triggers on: connectivity restored, tab becomes visible, a 30-second interval while online, and app init. Guarded by `syncInProgress`.

Idempotency comes from a **`UNIQUE (store_id, transaction_number)`** constraint plus a `23505` duplicate-handling branch in `POST /api/transactions`. If you change how transaction numbers are generated, you break offline-safety.

> **Never reconcile the product cache against an unpaginated query.** Supabase/PostgREST silently caps an unbounded `select` at 1000 rows. Feeding a truncated list to `reconcileProductsCache()` reads as "everything past row 1000 was deleted" and wipes it locally, which the next sync then re-pulls — a permanent delete/refetch loop. Use `fetchAllProductIds()` and the `evaluateReconcile()` guard in `src/lib/products/refresh.ts` (re-exported from `src/lib/sync/engine.ts`, where it used to live): **deletion requires positive proof the ID set is complete.** Skipping is always safe; deleting on partial evidence is not.

Stock decrements are **server-side only** now. Do not re-add client-side stock queuing — that was removed deliberately to prevent double-decrements. They go as **one `decrement_stock_batch` call per sale** (migration 037), not a `decrement_stock` per line; the per-line loop survives only as the fallback for a database that has not had 037 applied.

### Adding a new offline-capable write

Follow `.claude/skills/offline-write/SKILL.md` rather than improvising.

### Product writes are offline-capable now

Products used to be written **straight from the browser** with the Supabase
client, so a create or a reprice simply failed with no internet. The till needs
to name an unknown barcode during an outage, so those writes go through
**`src/lib/products/write.ts`**:

1. The id is generated **client-side**, which makes the server call an
   idempotent upsert rather than an insert that could run twice.
2. `products_cache` is written first and awaited — the product is sellable at
   once, offline included.
3. `POST /api/products` is attempted; on **any** failure it is queued as a
   `product_upsert` pending write.

> **`reconcileProductsCache()` must never delete a product with a queued
> `product_upsert`.** The server's ID set cannot contain something it has never
> been told about, so without that guard a reconcile would wipe the product the
> cashier just created. The guard lives inside `reconcileProductsCache()` so
> every caller gets it, and it **skips the whole pass** when the queue cannot be
> read — deletion requires positive proof, same rule as `evaluateReconcile()`.

**`src/app/(shell)/pos/products/page.tsx` still writes products directly via
Supabase** (its own create/edit form). That path remains online-only; moving it
onto `products/write.ts` is an open task.

---

## 5. Auth — how it really works (and why it's being replaced)

> ⚠️ **The current model is insecure and is being actively replaced. Do not copy these patterns into new code.** See P0 in `docs/AUDIT-2026-08.md`.

- **Supabase Auth is not used.** Ignore any doc that says otherwise.
- Login is hand-rolled against a `stores` / `store_users` table; state lives in **localStorage** (`goldensquirrel_auth`, `goldensquirrel_user`, `goldensquirrel_admin`) and React Context (`src/lib/auth/AuthContext.tsx`).
- **`src/middleware.ts` enforces nothing.** It creates a Supabase client and returns. There is no server-side route protection.
- API routes read tenancy from an **unsigned `x-auth-data` JSON header** and then query with the **service-role key**, bypassing RLS. This is the central vulnerability.
- **`resolveCaller()` shares in-flight lookups**, keyed by `store|user`, because the POS and the cash page each fire three requests at the same instant. Entries are dropped the moment they settle — it is **not** a cache, and must not become one: holding a settled answer would delay revoking an employee on the path that governs cash.
- **Auth may run *alongside* a store-scoped read, never after it, and never instead of it.** `GET /api/cash-shifts`, `/api/transactions`, `/api/categories`, `/api/recipes` and `/api/combos` all issue the read concurrently with `resolveCaller()` and return nothing until the caller is confirmed. Safe only because the read is scoped to the `store_id` the caller is claiming, so a failed auth discards a read of their own store.
- `src/lib/auth/jwt.ts` contains the correct primitive (`jose`-based verify) and is **imported by nothing**. It is the intended replacement.

### Permissions vs roles — don't mix them up

- ✅ **`src/lib/auth/permissions.ts`** is the real system. Six `SECTIONS`: `pos`, `inventory`, `transactions`, `receipts`, `cash_register`, `kitchen`. Guard with `PermissionGuard` from `src/lib/auth/guards.tsx`. **Parse a stored permissions blob with `parsePermissions()`**, which is driven by `SECTIONS` — three hand-written copies of that mapping used to exist in `AuthContext`, and a new section silently arrived as `undefined` (i.e. denied) at every one that was not updated.
> **`inventory` is the pricing permission.** Everything on the desktop till that
> decides what a customer is charged — retyping a cart line's price or name,
> naming an unknown barcode, adding a product — is gated on it, in one place
> (`canEditInventory` in `ProPOSLayout`). Without it a cashier can scan, change
> quantities, remove lines and take payment, and an unknown barcode tells them
> to fetch someone rather than offering fields. There is deliberately **no
> "request it anyway" queue**: a till that lets an unauthorised price through
> "just this once" is how undercharging happens.

- ❌ **`src/lib/auth/roles.ts`** is **dead TableMind scaffolding** (waiter/host/manager hierarchy, `/reservations`, `/floor-plan`). Nothing imports it. Do not extend it.

---

## 6. State — where data actually lives

There are more mechanisms than there should be. Know which is authoritative:

| Concern | Authoritative source |
|---|---|
| Cart | Zustand `src/lib/stores/cartStore.ts` (persisted to localStorage, `version: 1`). Holds **lanes** — see §6a. **`items` is deliberately not persisted**: it mirrors the active lane, so writing it too serialised the basket twice per scan. `onRehydrateStorage` re-derives it. |
| Auth / current user | React Context `src/lib/auth/AuthContext.tsx` — **use `useAuth()`**, don't read localStorage directly |
| Feature flags | `src/hooks/useFeatureFlags.ts` (localStorage-first, then background DB sync) |
| Products / transactions offline | Dexie via `src/lib/db/localDB.ts` |
| Pulling products from Supabase | `refreshProductsIntoCache()` in `src/lib/products/refresh.ts` — the only place that fetches products. Delta against an `updated_at` watermark, full pull when the cache is short, guarded reconcile for deletions, and one in-flight run per store. |
| Connectivity + sync status | `connectivity` and `syncEngine` singletons |

### 6a. Lanes and one-off lines

The desktop till runs **lanes**: parallel carts, so a cashier can park a customer
and serve the next without clearing anything. `MAX_LANES` is 9 (ALT+1..9).

`items` is still a top-level field on the store and still means *the active
lane's items*, so `/checkout`, `LogoutButton` and `PWAUpdateListener` never had
to learn about lanes. `lanes` is the record of truth and `items` is a **mirror**
of the active entry:

- Every mutation funnels through one private `commitItems()` — one writer, no drift.
- `onRehydrateStorage` re-derives `items` from `lanes[activeLaneId]` on load.
- **Anything asking "is a sale in progress" must use `hasAnyLaneItems(state)`**,
  not `items.length` — a parked lane holds a customer's shopping too. The
  service-worker reload guard in `PWAUpdateListener` depends on this.

A **one-off line** (`line_kind: 'one_off'`) is something sold once with no
catalogue row behind it — an unknown barcode priced at the till. Its
`product_id` is a synthetic `oneoff:<uuid>` key so the cart can address it, and
that key is mapped to `null` in exactly one place, **`src/lib/pos/lineItems.ts`**
(`buildTransactionItems` / `buildStockDecrements`). Both the server payload and
the offline-queue payload go through it, so the online and offline paths cannot
disagree. `transaction_items.product_id` is nullable and `POST /api/transactions`
already skips the stock decrement when it is absent.

**Editing a cart line's price** (`updateLine`) clears the discount and sets
`original_unit_price` to the new value — an overridden price *is* the price, and
leaving the old original behind would report a discount nobody gave. The
pre-edit catalogue price is kept in `catalog_unit_price` for display only.

**TanStack Query is not installed at all.** It was mounted in `src/app/providers.tsx` and never used, and was removed in the Aug 2026 cleanup — it is no longer in `package.json`. Data fetching is plain `fetch`/Supabase calls in `useEffect`. (`@tanstack/react-virtual` *is* installed and is used by the inventory list — different package.)

Many components read localStorage directly instead of using `useAuth()`. That's the pattern being cleaned up, not the pattern to follow.

---

## 7. Feature flags

Store-level flags in a `stores.features` JSONB column (migration **`017`**).

- Registry: **`src/lib/features.ts`** — currently **13** keys: `pos`, `inventory`, `transactions`, `receipts`, `product_discount`, `transaction_analytics`, `desktop_shortcuts`, `cash_register`, `activity_logging`, `product_categories`, `menu_items`, `recipe_stock_depletion`, `kitchen_display`.
- Presets: `general`, `retail`, `pharmacy`, `bakery`, `coffee_shop`, `snack`. **Every preset must enumerate every key** — `handlePresetChange` overwrites the whole flags object, so an omitted key falls through to `FEATURES[key].default` at read time and the preset silently means something other than what it reads as.
- Guard component: **`src/lib/auth/featureGuard.tsx`** (not `src/components/FeatureFlagGuard.tsx` — that path in the docs is wrong).
- Admin API: `GET|PATCH /api/admin/stores/features?store_id=…` (query param, not a path segment).
- Always merge through `mergeFeaturesWithDefaults()` so a newly added flag has a value for existing stores.

Adding a flag: add to `FEATURES`, add to the `general` preset in `FEATURE_PRESETS`, wrap the UI in the guard.

---

## 8. Commands

```bash
npm run dev          # localhost:3000, bound to 0.0.0.0 for phone testing on LAN
npm run build        # production build + THREE verification gates (below)
npm run verify:sw    # assert the generated public/sw.js has the required rules
npm run verify:budgets    # no route's JS and no precache total grew
npm run verify:invariants # the statically checkable §1 invariants
npm run baseline:update   # re-record docs/perf-baseline.json ON PURPOSE
npm run analyze      # production build with the bundle treemap (ANALYZE=true)
npm run typecheck    # tsc --noEmit
npm run lint         # eslint .
```

**Baseline:** `typecheck` must be clean before you hand anything over.

If `tsc` reports errors inside `.next/types/**` referring to files that no longer exist, that's a stale build artifact after a route move — `rm -rf .next` and rebuild.

### There IS a test harness now — `harness/`

**This section used to say the opposite.** Vitest and Playwright were removed on
2026-08-16 at the owner's direction; a characterization harness was then built
for the performance refactor and **kept** on 2026-09-01 (Phase 9.3, Branch A).
The old suite is still at commit `744ad0d`; it is not what runs.

It lives entirely under `harness/`, so it remains one `git rm -r` to remove.
Read **`harness/README.md`** before adding to it — especially the checklist,
which says where a new case belongs.

| Suite | What it covers | Cost |
|---|---|---|
| `npm run harness:unit` | pure logic — money, cart lanes, the reconcile guard, eviction order, retry backoff. **175 tests, ~1.6s, no DB, no secrets** | runs on every push in CI |
| `npm run harness:contract` | route response shape and status | needs a built server + seeded DB |
| `npm run harness:e2e` | the golden cashier flows | needs a browser; nightly |
| `npm run harness:visual` | screenshots, 3 platform profiles | **opt-in, by hand only** |
| `npm run harness:mutation` | proves the net actually catches things — 7/7 | by hand |

**The rule that comes with keeping it: a new feature ships with its case.** One
case for the thing that would be expensive to get wrong, not a case for
everything it touches. Assert behaviour, never implementation detail.

> **Zero tolerance for flake.** A case that fails intermittently gets fixed or
> deleted the same day. Nothing flaked more than once across the entire
> refactor. One flaky test teaches everyone to ignore red, and a net nobody
> trusts is worse than no net, because it costs time and buys nothing.

**The harness points at the MAIN Supabase project**, confined to its own tenant
by `HARNESS_STORE_ID`. There is no RLS behind it — that scoping is the only
thing keeping it off real stores' data. `npm run harness:guard` asserts this and
runs first. **`.env.test` still points at the pre-migration Seoul project** and
needs updating to Ireland.

**These four still gate every build, and are independent of the harness** — they
survive it being deleted, which is why they exist:

```bash
npm run typecheck         # must be clean before handing anything over
npm run verify:sw         # the service-worker rules (4 checks)
npm run verify:budgets    # no route's JS grew, precache did not grow
npm run verify:invariants # the statically checkable §1 invariants (8 checks)
```

`verify:sw`, `verify:budgets` and `verify:invariants` run automatically inside
`npm run build`. **If one fails, do not ship** — `public/sw.js` is generated and
gitignored, so nothing else catches it.

Lint is **advisory**: it has ~76 pre-existing errors from the Next 16 upgrade
and does not block. Do not add to them.

---

## 9. Conventions and gotchas

- **Every route is a client component.** There are no server components or server actions; data is fetched in `useEffect`. There are now `error.tsx` and `global-error.tsx` at the app root, but still no `loading.tsx` anywhere.
- **`/pos` has two layouts.** Mobile is camera-first and lives in the page. Desktop
  is the **Pro till** in `src/components/pos/pro/` (`ProPOSLayout` composes
  `LaneTabs`, `SmartScanInput`, `ProCartRow` + `CartLineEditor`, `ProTotalsPanel`,
  `QuickGrid`). The page keeps the data — catalogue load, barcode index, sync —
  and hands the layout an `onProductAdd` / `resolveBarcode` pair. Which one
  renders is still `isDesktop() && isEnabled("desktop_shortcuts")`.
- **The desktop till no longer loads ZXing.** It used to render
  `<BarcodeScanner desktopMode>` — a ~420KB dynamic chunk — just to get a text
  input. `SmartScanInput` replaces it and keeps the wedge behaviours (Enter
  submits, refocus after every scan, no dedup).
- **There is no "Done" button.** The quick-sale path that completed a sale
  without calculating change is gone from both layouts; `/checkout` is the only
  way a sale ends, and it now plays `playCompleteSound()` with its QR summary.
- **`src/app/(shell)/` is a route group** holding `/pos`, `/pos/products`, `/pos/cash` and `/transactions`. The parenthesised folder name is **not** part of the URL — those paths are unchanged. Its `layout.tsx` renders the persistent `BottomTabBar`. `/checkout` is deliberately outside the shell so no tab bar tempts a cashier away mid-payment.
- **Code splitting:** `@zxing/library` (via `BarcodeScanner`) and `recharts` (via `TransactionAnalytics`) are heavy and must stay behind `next/dynamic`. Import the scan beep from `@/lib/feedback`, **never** from `@/components/BarcodeScanner` — the latter drags ZXing back into the POS bundle. Run `npm run analyze` before adding a dependency to a hot route.
- **Dark mode is forced** in three redundant places. The `:root` light palette in `globals.css` is dead. Don't use light-mode utilities (`bg-red-50`, `bg-yellow-200`) — they render as near-white blocks.
- **Prefer theme tokens** (`bg-primary`, `text-destructive`) over hardcoded `bg-amber-500`. The codebase does the latter ~40 times; that's debt, not a convention.
- Money display always goes through `formatLL()` / `formatUSD()`.
- **`products.profit_percentage` is computed by a database trigger**, not by the
  client: `((selling_price - cost_price) / cost_price) * 100`, or 0 when cost is
  0 (migrations 005/009). Verified live — all 3,336 costed rows match the formula
  exactly. Whatever a client sends is overwritten, so **never validate or reject
  a write on it**; it is a markup, not a 0-100 percentage, and it is routinely
  over 100 (up to 489% in one store) and sometimes negative. `discount_percentage`
  IS a real 0-100 percentage.
- Migrations are append-only and manually numbered; the highest is **`041`**. **`008` is already duplicated** — check the highest number before adding (`ls supabase/migrations/ | tail -1`), and note that this line has been stale before.
- `.env.local` is correctly gitignored. Required vars are in `.env.example`.
- Path alias: `@/*` → `./src/*`.
- Careful: `src/lib/utils.ts` (file) and `src/lib/utils/` (directory) both exist. `@/lib/utils` resolves to the **file**; formatting helpers are at `@/lib/utils/format`.

---

## 10. Document trust

| Document | Trust | Why |
|---|---|---|
| **`CLAUDE.md`** (this file) | ✅ Authoritative | |
| `docs/AUDIT-2026-08.md` | ✅ Current | The live bug/debt backlog |
| `docs/PERF-REFACTOR-PLAN.md` | ✅ Authoritative for the refactor | Plan of record for the performance refactor. **If it is in progress, read it before touching `src/`** — it carries the invariant list and the step ledger. |
| `docs/REGION-MIGRATION.md` | ✅ Current | The Seoul→Ireland runbook, with what actually broke |
| `docs/CSV_IMPORT_EXPORT_GUIDE.md` | ✅ Accurate | Matches the code |
| `README.md` | ✅ Accurate | Setup only |
| `ARCHITECTURE.md` | ✅ Rewritten Aug 2026 | Was wrong before; now matches reality |
| `docs/FEATURE_FLAG_ARCHITECTURE.md` | ⚠️ Concept good, details drifted | Trust the design and playbook; verify file paths against source |
| `FUNCTIONAL_REQUIREMENTS.md` | ⚠️ Wishlist, ~40% built | Aspirational. Not a description of current behaviour. |
| `docs/archive/**` | ❌ Historical only | Includes `TECHNICAL_SPECS.md` and `ROADMAP.md`, which describe the **TableMind restaurant app** — `merchants`, `customers`, `credit_transactions`, `/reservations`, Supabase Auth. **Almost entirely fiction relative to this codebase.** Never plan from them. |

---

## 11. Working agreement

- This is a **live POS handling real money for paying customers.** Bias toward correctness over cleverness, and toward small reversible changes.
- **Never** weaken a store-scoping filter, an auth check, or a rounding rule to make something work.
- When touching money, offline sync, or auth, say what you verified — not just what you changed.
- The audit doc is the shared backlog. When you fix something in it, mark it resolved there in the same change.

---

## 11a. Cash registers and shifts

Migration **`027`** replaced "one drawer per store per day" with named registers.

### The model

```
cash_registers (durable, named)  1 ──< N  cash_shifts (opened_at → closed_at)
```

- A **register** is a physical drawer. It is named once ("Front Counter") and
  keeps that name across days.

### Removing a register — the outcome is not a preference

`DELETE /api/cash-registers?register_id=…` picks the removal for you:

| State of the drawer | What happens |
|---|---|
| Never used (no shifts) | Deleted outright |
| Has any shift history | **Retired** (`is_active = false`); every row kept |
| Has an open shift | **Refused** — count and close it first |

`cash_shifts.register_id` is `ON DELETE RESTRICT` precisely so a mistake here
cannot cascade a drawer's counted history away, and the route never works around
that — a `23503` falls back to retiring. **Do not "simplify" this into a single
hard delete.** Those shift rows are the record of real money.

Retired registers drop off the cash page but **stay in the performance report as
long as they sold something in the window** — dropping them on retirement would
silently rewrite last month's takings.
- A **shift** is one accountable period on one register. Its life is
  `opened_at → closed_at`. **`business_date` is a label, not the identity or the
  boundary** — the old `UNIQUE (store_id, business_date)` is what made a shift
  and a calendar day the same object, and it is gone.
- **One open shift per register**, enforced by a partial unique index rather
  than by the API. The old guard checked `business_date - 1`, so a shift left
  open across a two-day closure was invisible to it.

### Sales are attributed by WHO, not by which device

The supervisor opens a shift on a register and **assigns a cashier**. Everything
that cashier sells while it is open is stamped with that `shift_id` (and its
`register_id`) by `POST /api/transactions`.

Resolution happens **server-side, by matching the sale's own `created_at`** to
the assigned shift's window — never "what is open right now". That is what keeps
offline sales correct: a sale rung in Ali's morning shift and synced after it
closed still lands on the morning shift.

> **Do not move this onto a per-device setting.** It was built that way first
> and is unworkable: the setting lives in each till's `localStorage`, so a
> supervisor cannot administer it from their own machine, and a POS-only cashier
> cannot reach `/pos/cash` to set it themselves.

Assignment takes **two columns**, because one nullable id would have to mean
both "the owner is on this drawer" and "nobody is yet":

| State | Columns |
|---|---|
| An employee | `assigned_user_id` set |
| The store owner | `assigned_to_owner = true` (they have no `store_users` row) |
| Nobody yet | neither |

A cashier may be on **at most one drawer at a time** — two partial unique
indexes, both carrying `IS NOT NULL` / `= true` in the predicate, because a
unique index treats NULLs as distinct and a single index over the nullable
column would permit exactly the duplicates it looks like it prevents.

### Nothing ever auto-closes

An unclosed shift **stays open** and is flagged overdue (`isOverdue()` in
`src/lib/cash/types.ts` — open and opened before today began). It blocks
reopening *that* register only. A closing figure is a physical count; a machine
inventing one destroys the variance it exists to catch. An approval **request**
may expire on its own — that withholds a permission, which is the safe
direction.

### Drawer maths

**`summariseShift()` in `src/lib/cashShift.ts` is the only place.** Cash into
the drawer is `SUM(amount_paid) − SUM(change_given)` and nothing else:

- `amount_paid` is **gross tender**, not net takings. The old page summed it
  alone, annotated "change is already netted into amount_paid" — it is not, and
  a 100,000 sale paid with a 200,000 note was counted as 200,000.
- **Never add `usd_amount_paid`** into the LL total. Those dollars are already
  inside `amount_paid` at `RETURN_RATE`. That was audit P1-2.

Aggregation is done by **RPC, never by summing a `select` in JS** —
`get_shift_totals` and `get_register_performance`. PostgREST silently caps an
unbounded select at 1000 rows, which would under-report exactly the busiest
shift. Both return raw LL/USD components so the exchange rate keeps its single
definition in `format.ts`.

### The page must load fast, and work offline

Both were fixed together; the mechanisms are the same ones history and inventory
already use.

- **`GET /api/cash-shifts` is three parallel waves, not ten serial `await`s.**
  It paid full network latency ten times over before rendering anything, which
  was most of an eight-second load. Only two real dependencies exist: register
  ids before their shifts, shift ids before their totals. **Add a new query to
  the wave whose inputs it needs — never as another serial await.**
- **`resolveCaller()` is one query, not two.** The `stores` existence check was
  redundant for employees (`store_users.store_id` is a foreign key). It runs on
  every cash request.
- **The page paints from `src/lib/cash/snapshot.ts` first**, then revalidates —
  the "ALWAYS load cached first" pattern from the transactions page. The
  snapshot is a display convenience, never a source of truth, and is cleared on
  logout so the next person cannot see the last one's takings.
- **Aggregate in Postgres, never by summing a select.** `get_unassigned_totals`
  exists because the route used to pull up to 1000 rows over the wire to add two
  columns, for a figure that is almost always zero.
  > This rule is not local to the cash page. `GET /api/transactions/analytics`
  > broke it for a year: it selected every sale WITH its nested line items and
  > added them up in JS, so any store past 1,000 sales in the window was shown
  > revenue and profit computed from an arbitrary 1,000 of them — silently.
  > It runs on **`get_transaction_analytics`** (migration 037) now. That
  > function returns cost as `cost_ll` plus raw `usd_cost_lines`, and does NOT
  > convert: the LL/USD rate has one definition, in `format.ts`, and the route
  > applies `productCostInLL()` per product exactly as before. Do not "simplify"
  > that by summing the USD side in SQL — it would round once rather than per
  > product and move a number the owner reads daily.
- **Analytics loads after the drawer figures**, not alongside them — a 30-day
  range scan was holding up the numbers people came to read.

**Offline:** opening a shift, counting and closing it, adjustments, and creating
a register all queue through `pending_writes`. Register creation generates its
**id on the client**, so a queued `cash_shift_open` referring to it is valid
before the register reaches the server; `register_create` is sorted to the front
of the cash queue for the same reason, and the POST is an idempotent upsert that
disambiguates a clashing name rather than dropping the drawer. Deciding an
approval request stays online-only.

### A sale is never blocked by cash-register state

No register, no shift, no assignment, a failed lookup — the sale completes and
is recorded with a null `shift_id`, surfacing in the **Unassigned** bucket on
the cash page. This is a live till; a refused sale costs a real customer.

### Pieces

| Path | Role |
|---|---|
| `src/lib/cash/types.ts` | Domain types, `isOverdue()`, request vocabulary |
| `src/lib/cashShift.ts` | `summariseShift()` and the drawer helpers |
| `src/lib/auth/apiCaller.ts` | `resolveCaller()` — fixes the P0-3 half of the auth hole |
| `src/lib/auth/apiHeaders.ts` | `buildAuthHeaders()` — the owner now sends an explicit `user_id` |
| `GET\|POST /api/cash-shifts` | Every register with its current shift; open/close |
| `/api/cash-registers` + `/analytics` | Register CRUD; per-register performance |
| `/api/my-shift` | A cashier's own assignment. No amounts, no other people. |
| `/api/register-requests` | Approval flow (schema + panel live; till-side raise is the next feature) |
| `src/components/cash/**` | Cards, dialogs, requests panel, performance chart |

---

## 12. Activity logging (admin trail)

Every meaningful action in a store is recorded to `activity_logs` and read only by the admin console at `/admin/activity`. Retention is **3 days** — set by `ACTIVITY_RETENTION_DAYS` in `src/lib/activity/types.ts`, which is the single source of truth: the ingest route passes it to the SQL function on every call, and the admin UI derives its date ranges from it.

### What is and is not captured

**Actions** come from explicit `logActivity()` calls: every cart mutation, price edit, catalogue write, sale, cash movement, login, permission refusal, sync failure and connectivity change.

**The passive UI trail is switched OFF** — `UI_TRAIL` in `src/lib/activity/domTracker.ts` is `false`. Clicks and field commits were ~60–70% of all rows (a single checkout is ~15 clicks, because every keypad digit is a button), and they buy little the explicit events do not already say. Uncaught errors are still captured — that listener is not governed by the switch. Flip `UI_TRAIL` to `true` to get the trail back; nothing else changes, because `ui.click` / `ui.field_commit` stay in the vocabulary and the admin filters already list them.

**Individual keypresses are never recorded, trail on or off.** A scan is one event carrying the whole code. Per-key logging would be hundreds of thousands of rows a day per store, would capture passwords character by character, and would fill the offline buffer that shares a disk with queued sales. Do not "improve" this by adding a keydown logger.

Values of password fields, anything inside `data-log="redact"`, and any `details` key matching `/pass|secret|token|credential|pin|otp/` are never recorded. Give a control a `data-log="…"` attribute to name it in the trail.

### The pieces

| File | Role |
|---|---|
| `src/lib/activity/types.ts` | The closed vocabulary. Every event name lives here; the server rejects anything not in it. |
| `src/lib/activity/logger.ts` | `logActivity(action, opts)` — synchronous, never throws, never returns a promise. In-memory ring, flushed at 50 events / 5s / pagehide. |
| `src/lib/activity/flush.ts` | Posts to `/api/activity`; buffers to Dexie on any failure; drains on reconnect. |
| `src/lib/activity/domTracker.ts` | The passive UI trail (**off** — see `UI_TRAIL`) plus uncaught-error capture (always on). |
| `src/components/ActivityTracker.tsx` | Mounted in `providers.tsx`. No-ops on `/admin` and when the flag is off. |
| `POST /api/activity` | Ingest. Validates, clamps `occurred_at`, rate-limits, and runs partition maintenance at most hourly. |
| `GET /api/admin/activity` | Read + `?format=csv`. Gated on `requireAdmin()`. |

### Rules

- **A log call must never be awaited, and never on the money path.** `logActivity` is fire-and-forget by construction; keep it that way.
- **Cart events are emitted from `commitItems()` in `cartStore.ts`, the single writer.** Add a new mutation there and it is logged automatically — do not scatter `logActivity` through the actions instead.
- **`occurred_at` is the client's clock, captured when the action happened**, and the server honours it. The gap to `received_at` is the outage. Never stamp a buffered event with flush time (that is the audit P1-1 mistake).
- **`store_id` and the user fields are baked into the event at enqueue time.** `logout()` clears `goldensquirrel_auth`, so an event that looked them up at flush time would have no tenant. `auth.logout` is therefore logged *before* the keys are cleared.
- **The buffer is expendable.** It is dropped first by `freeExpendableSpace()`, capped at 20,000 rows, and a batch the server rejects with a 4xx is discarded rather than dead-lettered. This is the opposite of how queued sales behave, on purpose.
- **The flusher yields to the sync engine** via `setSyncBusy()`, called around `runSync()`.
- **Kill switch:** the `activity_logging` feature flag, default on, toggled per store from the existing admin feature dialog. Use it before reaching for a deploy if volume becomes a problem.

### Retention

`activity_logs` is **range-partitioned by day**. `maintain_activity_log_partitions(n)` creates the partitions for the retained window plus tomorrow, and **drops** anything older — the "new day deletes the oldest day" rule is a partition drop, not a `DELETE`, so the disk comes back immediately and there is no bloat to vacuum.

**Changing retention is a one-line edit to `ACTIVITY_RETENTION_DAYS`** — no migration, because the function takes the window as an argument. Lowering it has one non-obvious consequence: a device offline for longer than the window has its buffered events **dropped** at ingest, since there is no partition for them.

### The three volume levers, in order of how little they cost

1. **`activity_logging` feature flag**, per store, from the existing admin dialog. No deploy. Full stop for that store.
2. **`ACTIVITY_RETENTION_DAYS`** — currently 3.
3. **`UI_TRAIL`** in `domTracker.ts` — currently `false`, which is where most of the saving came from.

There is **no DEFAULT partition**, because one would block creating the next day's partition. Instead `POST /api/activity` drops events older than the window and clamps future timestamps to `now`. If an insert ever does miss a partition, the route runs maintenance and retries once.

Maintenance is called opportunistically from the ingest route (at most hourly per instance) — no cron, no Vercel config. The RPC is granted to `service_role` if you later want pg_cron to drive it.

### Admin auth

`src/lib/auth/adminSession.ts` — HS256 via `jose`, httpOnly `gs_admin_session` cookie, 12h. **`ADMIN_JWT_SECRET` throws when unset**; there is no fallback secret, unlike `src/lib/auth/jwt.ts` (which is TableMind scaffolding and must not be used here). The localStorage `goldensquirrel_admin` blob still exists but only drives the client-side redirect — it is not trusted by any route.

`requireAdmin()` is a one-line gate. The older `/api/admin` routes are still unauthenticated (audit P0-2); use it when you touch them.

---

## 13. Store types, menus and ingredient depletion

A **snack shop** sells a fries sandwich: no barcode, assembled from ingredients, and the customer changes it at the counter. That is what this subsystem is for.

### Store type is a label; behaviour gates on flags

`stores.store_type` records **which preset an admin picked** and nothing reads it at runtime. All behaviour gates on the feature flags in §7, because `mergeFeaturesWithDefaults()` back-fills a new key for every existing store with no data migration, while `store_type` would leave every live store on `'general'` until touched by hand. A store is also allowed to be a mix (a pharmacy with a coffee counter), which a type cannot express and flags can.

**Do not add `storeType` to `StoreUser`.** It is persisted to `goldensquirrel_user`, so every already-logged-in device would have it `undefined`, and nothing needs it synchronously.

### Ingredients ARE products

`products.kind` is `'sellable' | 'ingredient'` (migration **030**). One table, so the products cache, offline sync, inventory screen, CSV and `decrement_stock` all work on ingredients for free.

> **`isSellable()` in `src/lib/products/kind.ts` is `!== 'ingredient'`, NEVER `=== 'sellable'`.** `kind` is optional on `CachedProduct`, so a device whose IndexedDB predates 030 has `undefined` on every row. The strict form would show an **empty catalogue** on the busiest screen in the app. Default-sellable is the safe direction.

The till hides ingredients from search and the grid, but **`barcodeIndex` stays complete** — a scanned ingredient *is* in the catalogue, so falling through to the unknown-barcode prompt would read as a broken scanner. `handleProductAdd` refuses it by name instead.

**`stock_quantity` stays INTEGER, and the ingredient's `stock_unit` IS the recipe unit.** Pickles are `'g'` with stock `4000`; a recipe of `20` means 20 grams. No float maths near stock, no RPC change. The cost: a recipe cannot use half a unit, so units must be the smallest the shop counts.

> The one silent way this loses money is a **unit mismatch** — pickles entered as `4` (jars) against a recipe of `20` (grams) drives stock to -4000, unnoticed until a stock take. Three mitigations: `stock_unit` lives on the product so there is one answer; inventory renders `4000 g`, never a bare `4000`; the recipe editor shows live **servings remaining** while you type. It is a convention with no enforcement — keep all three.

### Recipes

`recipe_components` (migration **031**): `quantity` NUMERIC(12,3) for authoring, plus `is_default`, `is_removable`, `max_quantity`, `price_delta_ll` DECIMAL(14,2).

- **Removing a default never refunds.** Crediting for a removal is a negative-price surface behind a control that needs only `pos`.
- `ingredient_product_id` is **`ON DELETE RESTRICT`** — deleting an in-use ingredient is refused, not silently broken. Same principle as `cash_shifts.register_id`.
- `PUT /api/recipes` **replaces** a whole recipe. Not atomic; acceptable only because no money or stock moves on that path. If recipes ever gain a till-side write, move it into a plpgsql function first.

### Cart line identity

The cart was keyed by `product_id`, but two sandwiches with different modifiers are two lines of the **same product**. `CartItem.line_uid` is optional and **`lineKey()` in `src/lib/pos/lineKey.ts` is the only way to address a line**. For a plain line the key *is* the product id, so retail behaviour is unchanged.

**Persist `version` stays 1.** `line_uid` is optional precisely so no store migration is needed; bumping it would newly run `migrate()` over every live device's parked lanes for nothing.

> `updateLine`, `removeItem`, `updateQuantity`, `increment/decrementQuantity`, the `#cart-item-` anchor and every React `key` use `lineKey()`. Using `product_id` there means editing one configured line edits the other.

`addConfiguredItem` **always appends, never dedupes** — the kitchen prepares two sandwiches in parallel and one must be voidable alone.

### Money on a configured line

- Add-ons are **exact LL** summed into `unit_price`; `roundToNearest5k` still runs only in `getTotal()`.
- The product discount applies to the **base only**, never to add-ons.
- The base is **derived** (`unit_price` minus extras), not stored, which makes the `updateLine` interaction correct for free.

### Stock depletion

**`buildStockDecrements()` in `src/lib/pos/lineItems.ts` is the only place.** A line with `modifiers.length > 0` decrements its **components**; a line without decrements itself, exactly as before. Integerised **once, at the whole line** — `round(qty * count * line_qty)`, never per unit.

The client computes it and the server obeys, falling back to the `items`-derived loop when `stock_decrements` is absent. Client-side because **the recipe at the time of sale is the right recipe** — a sandwich sold offline Monday and synced Wednesday must deduct what Monday's recipe said.

> **`QueuedTransaction.stock_decrements` must be forwarded by the sync engine's replay.** Without it a queued menu sale falls into the fallback and decrements the **menu item** instead of its ingredients — silent, offline-only, invisible until a stock take. `checkout/page.tsx` builds two payloads from one source; the field goes in **both**.
>
> The `else` branch in `POST /api/transactions` is the **compatibility hinge** for every sale already sitting in a device's queue. Do not remove it.

A sale is **never blocked** for want of an ingredient. Stock goes negative routinely.

### Modifiers on the sale

`transaction_items.modifiers` JSONB (migration **032**), nullable, no default:

| value | meaning |
|---|---|
| `NULL` | an ordinary line — every sale made before 032 |
| `[]` | a menu line where nothing was changed |

**The distinction is load-bearing:** the kitchen board filters tickets on `modifiers IS NOT NULL`, so collapsing `[]` to `null` would make a retail store see every sale as a ticket. Use `?? null`, never `|| null`.

> **Migration 032 must be applied before the code that sends the column.** The `transaction_items` insert failure is deliberately swallowed (the sale is already created), so against a database without the column every sale succeeds with **no line items** — empty receipts, empty tickets, broken analytics, silently.

Chosen over a child table because the checkout path is already insert then insert then loop, and a child table needs a third write depending on generated ids. Cost: "how many had extra cheese" needs a JSONB scan.

`describeModifiers()` in `src/lib/pos/modifierSummary.ts` formats them for **all four** surfaces — cart row, kitchen ticket, receipt, history — so a cook and a customer read the same words. Only the *changes* are shown, never the whole recipe.

### Kitchen display

`/kitchen`, gated on the `kitchen` section **and** the `kitchen_display` flag. `kitchen_ticket_state` (migration **033**) holds only preparation state; the paid transaction **is** the order.

> **The state row is created lazily by the kitchen API, never by `POST /api/transactions`.** That is the load-bearing property: the money path does not change shape, and a kitchen outage cannot affect a sale. A transaction with no row is implicitly `'new'`. Do not "improve" this by inserting a ticket at checkout.

`PATCH` carries `from` and rejects a stale value with 409 — two stations *will* tap the same card. Backwards moves are allowed (a cook who mistaps must be able to undo); `served` and `voided` are terminal.

**Internet-only, and it says so.** The dangerous failure is not an error, it is an empty board reading as "no orders" — hence the offline banner and keeping the last tickets on screen.

> Until modifiers are widespread, the board treats **every** sale in the last 6 hours as a ticket, because there is nothing else to mark a food order with. Harmless, and invisible to anyone without `kitchen_display`.

### Pieces

| Path | Role |
|---|---|
| `src/lib/products/kind.ts` | `isSellable()`, `STOCK_UNITS`, `formatStock()` |
| `src/lib/categories/**` | Category types, localStorage cache, loader |
| `src/lib/recipes/**` | Recipe types, cache, `saveRecipe()` |
| `src/lib/pos/lineKey.ts` | `lineKey()` — the only way to address a cart line |
| `src/lib/pos/modifierSummary.ts` | `describeModifiers()` — one wording everywhere |
| `src/lib/kitchen/types.ts` | Ticket status machine, `BOARD_COLUMNS` |
| `src/components/pos/pro/useMenuSheet.ts` | "Open the sheet or add directly" — shared by both tills |
| `src/components/pos/pro/MenuBrowser.tsx` | Category rail over `QuickGrid` (whose props are unchanged) |
| `src/components/pos/pro/ModifierSheet.tsx` | The modifier dialog. Gated on `pos`, not `inventory` |
| `src/components/inventory/RecipeEditor.tsx` | Recipe authoring, with the servings hint |
| `src/components/inventory/CategoryManagerDialog.tsx` | Category CRUD |
| `/api/categories`, `/api/recipes`, `/api/kitchen/tickets` | All `resolveCaller()`-gated |
