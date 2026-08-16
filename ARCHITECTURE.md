# GoldenSquirrel POS — System Architecture

*Rewritten 2026-08-16 against the actual codebase. Previous versions described Supabase Auth, `merchant_id` scoping, and enforcing middleware — none of which exist. See `CLAUDE.md` for the conventions summary and `docs/AUDIT-2026-08.md` for known defects.*

## Overview

An **offline-first, mobile-first retail POS** delivered as a Progressive Web App, for shops in **Lebanon** operating in **dual currency (Lebanese Pound + USD)**. Live on Vercel, serving multiple stores.

The defining constraint is that **the app must keep selling with no internet**. Almost every architectural decision follows from that.

## High-level

```
┌───────────────────────────────────────────────────────────────────┐
│  CLIENT — PWA (every route is a client component)                 │
│                                                                   │
│   UI            State                    Local persistence        │
│   Next 16 App   Zustand    (cart)        IndexedDB / Dexie        │
│   React 19      Context    (auth)          products_cache         │
│   Tailwind 4    singletons (sync,          transactions_cache     │
│   shadcn/ui                 connectivity)  offline_queue          │
│                 localStorage (flags,       pending_writes         │
│                              session)                             │
│                                                                   │
│   Service worker (@ducanh2912/next-pwa) — app shell + assets      │
└───────────────────────────────────────────────────────────────────┘
                    │                          ▲
       writes       │                          │  pulls (products,
     (fetch, or     ▼                          │   transactions)
      queue if  ┌────────────────────────┐     │
      offline)  │  Sync engine           │─────┘
                │  src/lib/sync/engine   │
                └────────────────────────┘
                    │
                    ▼
┌───────────────────────────────────────────────────────────────────┐
│  SERVER — Next.js API routes (src/app/api/*)                      │
│  All use the Supabase SERVICE ROLE key, bypassing RLS.            │
└───────────────────────────────────────────────────────────────────┘
                    │
                    ▼
┌───────────────────────────────────────────────────────────────────┐
│  Supabase (Postgres)  — stores, store_users, products,            │
│  transactions, transaction_items, cash_shifts, cash_adjustments,  │
│  admin_users, product_favorites, import_export_audit              │
└───────────────────────────────────────────────────────────────────┘
```

## Client

**Every route is a client component.** There are no server components, server actions, `loading.tsx`, or `error.tsx` files anywhere in `src/app/`. Data is fetched in `useEffect` and rendered client-side. This is a consequence of the offline-first design — a server-rendered page can't render with no network — but it's applied more broadly than necessary.

| Route | Purpose |
|---|---|
| `/pos` | The main till — cart, scanning, quick sale |
| `/pos/products` | Inventory CRUD, variants, CSV import/export |
| `/pos/cash` | Cash shift open/close, adjustments, reconciliation |
| `/checkout` | Dual-currency payment, change calculation, QR receipt |
| `/transactions` | Sales history, filters, analytics |
| `/receipt/[id]` | Public e-receipt (token-authenticated), PDF export |
| `/admin` | Super-admin — stores, employees, feature flags |
| `/barcodegen` | EAN-13 barcode label generation |
| `/login` | Store owner + employee login, with offline fallback |

## Offline model

Three cooperating pieces:

**1. Connectivity detection** — `src/lib/connectivity.ts`, a heartbeat singleton that probes `/api/health`. `navigator.onLine` is not used, because it reports "online" for a wifi connection with no internet. `/api/health` is pinned to `NetworkOnly` in the service worker config; if it were ever cached, the app would believe it was permanently online.

**2. Local persistence** — Dexie (IndexedDB), database `GoldenSquirrelPOS`, in `src/lib/db/localDB.ts`:

| Table | Role |
|---|---|
| `products_cache` | Mirror of Supabase products so the till works offline |
| `transactions_cache` | Read cache for the history page |
| `offline_queue` | **Completed sales** awaiting push — the money-critical queue |
| `pending_writes` | Other writes: favourites, cash shifts, adjustments |

**3. Sync engine** — `src/lib/sync/engine.ts`, a singleton. Fires on: connectivity restored, tab visible, a 30-second interval while online, and app init. Guarded by an in-progress flag.

- **Pull**: incremental product fetch by `updated_at`, then a reconcile pass against the live ID set to detect deletions.
- **Push**: serial drain of `offline_queue`, then `pending_writes`.
- **Idempotency**: `UNIQUE (store_id, transaction_number)` plus a `23505` duplicate branch in `POST /api/transactions`. A lost response is safe to retry.
- **Retry**: `pending_writes` carry `retry_count`, capped at 5 for stock decrements.

Stock decrements are **server-side only**; client-side stock queuing was removed to prevent double-decrement.

## Money

Dual currency with two rates. `src/lib/utils/format.ts` is the single source of truth.

- **LL is the base currency.** USD is derived for display and payment.
- All LL amounts the customer sees or pays are **multiples of 5,000** (no smaller bill exists in Lebanon), applied **at the cart total only** — never per line item, which would compound drift.
- `SELL_RATE` (90,000) when the customer pays; `RETURN_RATE` (89,000) when money goes back to them. The spread is the store's currency margin.

Rates are currently hardcoded constants, and transactions carry no rate stamp. Both are known issues — see audit P1-7.

## Auth and multi-tenancy

> **This is the weakest part of the system and is being replaced.** See audit P0-1 through P0-5.

- **Supabase Auth is not used.** Login is hand-rolled against `stores` / `store_users`; session state lives in localStorage plus React Context.
- **`src/middleware.ts` enforces nothing** — it constructs a Supabase client and returns. There is no server-side route protection.
- API routes read tenancy from an **unsigned `x-auth-data` header** and query with the **service-role key**, bypassing RLS. Any client can claim any `store_id`.
- RLS policies exist but do not protect: sensitive tables use `USING (true)`, while core tables gate on `auth.uid()`, which is always NULL here.

**Tenancy column is `store_id`** throughout. Two authorization concepts coexist:

- **Permissions** (`src/lib/auth/permissions.ts`) — per-user section access: `pos`, `inventory`, `transactions`, `receipts`, `cash_register`. This is the real system.
- **Feature flags** (`src/lib/features.ts`) — per-*store* capability toggles in a `stores.features` JSONB column, 8 keys. Orthogonal to permissions: a flag says the store bought the feature, a permission says this employee may use it.

`src/lib/auth/roles.ts` is dead scaffolding from the abandoned TableMind restaurant product. Nothing imports it.

## Data retention

Store-configurable via `transaction_retention_days` (default 90) and `max_transactions` (default 5000), from migration `011`. Cleanup runs both as a scheduled job (`013`) and as an `AFTER INSERT FOR EACH ROW` trigger on `transactions` (`012`) — the trigger is redundant and sits on the checkout hot path (audit P2-8).

## Barcode scanning

`src/components/BarcodeScanner.tsx` runs three engines: the native `BarcodeDetector` API (Android), Quagga2 (iOS fallback), and ZXing. Plus a keyboard-input mode for USB hardware scanners on desktop. Formats: EAN-13, UPC-A, Code128, with check-digit validation and audio/haptic feedback.

## Deployment

Vercel, with Supabase Cloud as the database. Builds use **webpack, not Turbopack** (`--webpack`) because `@ducanh2912/next-pwa` is incompatible with Turbopack.

Database migrations are **not** part of the deploy — they're applied manually to the hosted Supabase project, so a migration must ship before the code that depends on it. Note also that the migrations in this repo do not fully describe production state (see the `db-migration` skill).
