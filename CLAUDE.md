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
| Deploy | Vercel | |

---

## 3. Money rules — read this before touching any price

This is the most dangerous area of the codebase and the easiest to get wrong. **`src/lib/utils/format.ts` is the single source of truth.** Never inline a conversion or a rounding calculation.

### The rules

1. **LL (Lebanese Pound) is the base currency.** Prices, totals, and revenue are stored in LL. USD is a derived display/payment currency.
2. **Every LL amount the customer sees or pays must be a multiple of 5,000** — Lebanon has no smaller bill. Use `roundToNearest5k()`.
3. **Rounding happens at the cart total only — never per line item.** Per-item rounding compounds and drifts. `cartStore.getTotal()` is the only place it is applied.
4. **Two exchange rates, and they are not interchangeable:**
   - `SELL_RATE` (90,000) — customer is *paying*. Converting a price into what they owe.
   - `RETURN_RATE` (89,000) — money is going *back* to the customer (change), or a USD payment is being valued in LL.
   The spread is the store's margin on currency. Using the wrong one silently loses money on every transaction.
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

> **Critical:** `/api/health` has a `NetworkOnly` rule in `next.config.ts`. If the service worker is ever allowed to cache it, the app serves a cached `200` forever, believes it is permanently online, never shows offline banners, and never triggers sync. Do not touch that rule.
>
> Equally critical and easier to break by accident: **`extendDefaultRuntimeCaching: true` must stay set.** Supplying a custom `runtimeCaching` array *replaces* the 19 defaults unless it's on — including the `pages` rule that caches HTML navigations, which is the only thing letting the POS open cold with no internet (HTML is deliberately not precached).
>
> Both are asserted by `scripts/verify-sw.mjs`, which runs automatically as part of `npm run build`. **If that check fails, do not ship the worker** — `public/sw.js` is generated and gitignored, so nothing else will catch it. This exact bug has shipped twice.

### Storage layers

`src/lib/db/localDB.ts` — Dexie DB `GoldenSquirrelPOS`:

| Table | Purpose |
|---|---|
| `products_cache` | Mirror of Supabase products, so POS works offline |
| `transactions_cache` | Read-only history cache for the transactions page |
| `offline_queue` | **Completed sales** waiting to be pushed. The money-critical queue. |
| `pending_writes` | Generic non-sale writes (favourites, cash shifts, adjustments) |

Schema is at `version(3)`. Dexie versions are **append-only** — add a new `db.version(n).stores({...})` block, never edit an existing one. Compound indexes in use: `[store_id+barcode]` (barcode lookups must be store-scoped — barcodes are not unique across tenants), `[store_id+created_at]`, `[store_id+name]`.

Every write path is retry-capped at 5 attempts. Queued **transactions** are the exception to dropping: on exhaustion they are **dead-lettered** (`failed_permanently`), never deleted — each one is a completed sale whose money was taken. `getQueuedTransactions()` excludes them; `getDeadLetterTransactions()` returns them. **Nothing surfaces them in the UI yet** — that's an open task.

### Sync

`src/lib/sync/engine.ts` — a singleton `SyncEngine`. Triggers on: connectivity restored, tab becomes visible, a 30-second interval while online, and app init. Guarded by `syncInProgress`.

Idempotency comes from a **`UNIQUE (store_id, transaction_number)`** constraint plus a `23505` duplicate-handling branch in `POST /api/transactions`. If you change how transaction numbers are generated, you break offline-safety.

> **Never reconcile the product cache against an unpaginated query.** Supabase/PostgREST silently caps an unbounded `select` at 1000 rows. Feeding a truncated list to `reconcileProductsCache()` reads as "everything past row 1000 was deleted" and wipes it locally, which the next sync then re-pulls — a permanent delete/refetch loop. Use `fetchAllProductIds()` and the `evaluateReconcile()` guard in `src/lib/sync/engine.ts`: **deletion requires positive proof the ID set is complete.** Skipping is always safe; deleting on partial evidence is not.

Stock decrements are **server-side only** now. Do not re-add client-side stock queuing — that was removed deliberately to prevent double-decrements.

### Adding a new offline-capable write

Follow `.claude/skills/offline-write/SKILL.md` rather than improvising.

---

## 5. Auth — how it really works (and why it's being replaced)

> ⚠️ **The current model is insecure and is being actively replaced. Do not copy these patterns into new code.** See P0 in `docs/AUDIT-2026-08.md`.

- **Supabase Auth is not used.** Ignore any doc that says otherwise.
- Login is hand-rolled against a `stores` / `store_users` table; state lives in **localStorage** (`goldensquirrel_auth`, `goldensquirrel_user`, `goldensquirrel_admin`) and React Context (`src/lib/auth/AuthContext.tsx`).
- **`src/middleware.ts` enforces nothing.** It creates a Supabase client and returns. There is no server-side route protection.
- API routes read tenancy from an **unsigned `x-auth-data` JSON header** and then query with the **service-role key**, bypassing RLS. This is the central vulnerability.
- `src/lib/auth/jwt.ts` contains the correct primitive (`jose`-based verify) and is **imported by nothing**. It is the intended replacement.

### Permissions vs roles — don't mix them up

- ✅ **`src/lib/auth/permissions.ts`** is the real system. Five `SECTIONS`: `pos`, `inventory`, `transactions`, `receipts`, `cash_register`. Guard with `PermissionGuard` from `src/lib/auth/guards.tsx`.
- ❌ **`src/lib/auth/roles.ts`** is **dead TableMind scaffolding** (waiter/host/manager hierarchy, `/reservations`, `/floor-plan`). Nothing imports it. Do not extend it.

---

## 6. State — where data actually lives

There are more mechanisms than there should be. Know which is authoritative:

| Concern | Authoritative source |
|---|---|
| Cart | Zustand `src/lib/stores/cartStore.ts` (persisted to localStorage) |
| Auth / current user | React Context `src/lib/auth/AuthContext.tsx` — **use `useAuth()`**, don't read localStorage directly |
| Feature flags | `src/hooks/useFeatureFlags.ts` (localStorage-first, then background DB sync) |
| Products / transactions offline | Dexie via `src/lib/db/localDB.ts` |
| Connectivity + sync status | `connectivity` and `syncEngine` singletons |

**TanStack Query is mounted in `src/app/providers.tsx` but never used** — zero `useQuery` calls. Don't assume it's the fetching convention; it isn't.

Many components read localStorage directly instead of using `useAuth()`. That's the pattern being cleaned up, not the pattern to follow.

---

## 7. Feature flags

Store-level flags in a `stores.features` JSONB column (migration **`017`**).

- Registry: **`src/lib/features.ts`** — currently **8** keys: `pos`, `inventory`, `transactions`, `receipts`, `product_discount`, `transaction_analytics`, `desktop_shortcuts`, `cash_register`.
- Guard component: **`src/lib/auth/featureGuard.tsx`** (not `src/components/FeatureFlagGuard.tsx` — that path in the docs is wrong).
- Admin API: `GET|PATCH /api/admin/stores/features?store_id=…` (query param, not a path segment).
- Always merge through `mergeFeaturesWithDefaults()` so a newly added flag has a value for existing stores.

Adding a flag: add to `FEATURES`, add to the `general` preset in `FEATURE_PRESETS`, wrap the UI in the guard.

---

## 8. Commands

```bash
npm run dev          # localhost:3000, bound to 0.0.0.0 for phone testing on LAN
npm run build        # production build + service-worker verification
npm run verify:sw    # assert the generated public/sw.js has the required rules
npm run analyze      # production build with the bundle treemap (ANALYZE=true)
npm run typecheck    # tsc --noEmit
npm run lint         # eslint .
```

**Baseline:** `typecheck` must be clean before you hand anything over.

If `tsc` reports errors inside `.next/types/**` referring to files that no longer exist, that's a stale build artifact after a route move — `rm -rf .next` and rebuild.

### There is no automated test suite — this is deliberate

Vitest, Playwright, and both test directories were **removed on 2026-08-16 at the owner's direction**. Verification is done by a human QA team. **Do not add test files, test frameworks, or test scripts unless the owner asks for them.**

What this means for you:

- `npm run typecheck` and `npm run lint` are the only automated gates. Run them.
- Nothing will catch a regression for you. On money, offline sync, and auth, that raises the bar on care — reason through the change and say explicitly what you verified and how, per §11.
- Prefer small reversible changes over clever ones, and keep pure logic in pure functions (e.g. `evaluateReconcile` in `src/lib/sync/engine.ts`) so it can be reasoned about directly.

If the suite is ever wanted back, it is in git history at commit `744ad0d`:

```bash
git checkout 744ad0d -- tests src/tests playwright.config.ts vitest.config.ts
```

---

## 9. Conventions and gotchas

- **Every route is a client component.** There are no server components or server actions; data is fetched in `useEffect`. There are now `error.tsx` and `global-error.tsx` at the app root, but still no `loading.tsx` anywhere.
- **`src/app/(shell)/` is a route group** holding `/pos`, `/pos/products`, `/pos/cash` and `/transactions`. The parenthesised folder name is **not** part of the URL — those paths are unchanged. Its `layout.tsx` renders the persistent `BottomTabBar`. `/checkout` is deliberately outside the shell so no tab bar tempts a cashier away mid-payment.
- **Code splitting:** `@zxing/library` (via `BarcodeScanner`) and `recharts` (via `TransactionAnalytics`) are heavy and must stay behind `next/dynamic`. Import the scan beep from `@/lib/feedback`, **never** from `@/components/BarcodeScanner` — the latter drags ZXing back into the POS bundle. Run `npm run analyze` before adding a dependency to a hot route.
- **Dark mode is forced** in three redundant places. The `:root` light palette in `globals.css` is dead. Don't use light-mode utilities (`bg-red-50`, `bg-yellow-200`) — they render as near-white blocks.
- **Prefer theme tokens** (`bg-primary`, `text-destructive`) over hardcoded `bg-amber-500`. The codebase does the latter ~40 times; that's debt, not a convention.
- Money display always goes through `formatLL()` / `formatUSD()`.
- Migrations are append-only and manually numbered. **`008` is already duplicated** — check the highest number before adding.
- `.env.local` is correctly gitignored. Required vars are in `.env.example`.
- Path alias: `@/*` → `./src/*`.
- Careful: `src/lib/utils.ts` (file) and `src/lib/utils/` (directory) both exist. `@/lib/utils` resolves to the **file**; formatting helpers are at `@/lib/utils/format`.

---

## 10. Document trust

| Document | Trust | Why |
|---|---|---|
| **`CLAUDE.md`** (this file) | ✅ Authoritative | |
| `docs/AUDIT-2026-08.md` | ✅ Current | The live bug/debt backlog |
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
