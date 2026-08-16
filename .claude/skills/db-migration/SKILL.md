---
name: db-migration
description: How to add a Supabase/Postgres migration in this POS — numbering, RLS requirements, money column types, and how migrations reach production. Load before creating or editing anything in supabase/migrations/, or changing the database schema, an RPC, a policy, or a trigger. Triggers on - migration, supabase/migrations, schema change, ALTER TABLE, CREATE TABLE, RLS, policy, SECURITY DEFINER, RPC, plpgsql, trigger, index, decrement_stock, column type.
---

# Adding a database migration

## ⚠️ The repo does not describe production

The migrations in `supabase/migrations/` are **not a reliable description of the deployed database**. Evidence: `001_initial_schema.sql:95-98` gates every core table on `store_id = auth.uid()`, but the app never uses Supabase Auth, so `auth.uid()` is always `NULL` and those policies would block everything — yet the app works. RLS has clearly been disabled or overridden directly in production. `024_fix_stock_decrement_security.sql:4-8` documents exactly this discovery for the stock RPC.

**Before writing a migration that touches policies, constraints, or an existing table: dump the actual production state and diff it.** Do not assume the local files are the truth.

## Numbering

Sequential three-digit prefix: `NNN_short_description.sql`. Currently at **`024`**.

**`008` is already duplicated** — both `008_product_groups.sql` and `008_product_variants.sql` exist, so their apply order is undefined, and `009_revert.sql` then partially undoes `009` while re-adding columns from `008` (audit P2-8). Migration history is not reproducible.

`ls supabase/migrations/ | tail -1` before you pick a number. Never reuse one.

## Migrations are append-only

Never edit a migration that has been applied to production. Write a new one that alters forward. Someone editing an applied file is how the repo/production divergence above happened.

## Requirements for every new table

### 1. Multi-tenant scoping

Every table holding store data needs `store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE` and an index on it. The column is **`store_id`** — never `merchant_id` or `restaurant_id` (those come from the abandoned TableMind product).

### 2. RLS that actually restricts

```sql
-- ❌ this is what most existing tables do — it protects nothing.
-- Anyone with the public anon key can read and write.
CREATE POLICY "x_all" ON your_table FOR ALL USING (true);

-- ❌ also useless here — auth.uid() is always NULL, this blocks everything
CREATE POLICY "x" ON your_table USING (store_id = auth.uid());
```

`admin_users`, `store_users`, `cash_shifts`, and `cash_adjustments` all carry `USING (true)` on all four verbs — `admin_users` holds plaintext passwords and is world-readable with the public key (audit P0-5).

Until the app has a real server-verified session, **assume the anon key grants whatever your policy allows**, and keep sensitive tables (anything with credentials) reachable only via the service role.

### 3. Money column types

**Amounts are in Lebanese Pounds**, where a single item is routinely ~185,000.

`DECIMAL(10,2)` caps at **99,999,999.99** — a basket over roughly 1,100 USD overflows and throws. `transactions` and `transaction_items` still use it; `cash_shifts` was correctly widened to `DECIMAL(12,2)` (audit P1-3).

**Use `DECIMAL(14,2)` minimum for any LL amount.** See the `money` skill for rounding rules.

### 4. Timestamps

`created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()` — but if the row can originate offline, the **client must send the real time** and the insert must honour it. Relying on the default records the sync time, not the event time, which is a live bug corrupting cash reconciliation and analytics (audit P1-1).

## Functions and RPCs

```sql
CREATE OR REPLACE FUNCTION your_fn(p_store_id UUID, ...)
RETURNS ...
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public   -- ⚠️ REQUIRED
AS $$ ... $$;
```

**`SECURITY DEFINER` without `SET search_path` is a privilege-escalation hole.** `decrement_stock` is missing it and is granted to `anon`, with a legacy `p_store_id DEFAULT NULL` branch that lets any anonymous caller decrement stock in any store (audit P0-5).

Rules:
- Never give a tenant-scoping parameter a `NULL` default that means "skip the check."
- `GRANT EXECUTE` to the narrowest role that needs it — not `anon` unless genuinely public.
- Multi-step writes belong **inside** one function so they're atomic. Splitting a sale into insert + insert + loop across round-trips is how partial sales get created (audit P1-4).

## Triggers

Think hard before `FOR EACH ROW` on `transactions` — it runs on **every sale**, on the checkout hot path. `012_auto_cleanup_trigger.sql:58-64` runs a `COUNT(*)` over the store's whole transaction table plus deletes on every insert, and is redundant with the scheduled job in `013` (audit P2-8). Prefer a scheduled job.

## Keeping types in sync

`src/lib/types/database.ts` is **hand-maintained and stale** — it's missing columns and still declares the pre-`024` `decrement_stock` signature (audit P2-7). If you add or change a column, update it, or better, regenerate:

```bash
npx supabase gen types typescript --project-id <id> > src/lib/types/database.ts
```

Also check whether `src/lib/db/localDB.ts` interfaces need the same field — the local cache mirrors these tables with **different field names** in places, remapped by hand in `sync/engine.ts:324-327`.

## Applying

Migrations are applied to the hosted Supabase project — via the SQL editor or `supabase db push`. There is no automated migration step in the Vercel deploy.

**Order matters:** ship the migration *before* the code that depends on it, or the deploy breaks live stores.

## Checklist

- [ ] Number is unique and sequential (`ls supabase/migrations/ | tail -1`)
- [ ] Not editing an already-applied file
- [ ] Verified against **actual production state**, not just the repo
- [ ] `store_id` present, NOT NULL, FK'd, indexed
- [ ] RLS policy actually restricts — not `USING (true)`, not `auth.uid()`
- [ ] LL money columns are `DECIMAL(14,2)` or wider
- [ ] `SECURITY DEFINER` functions have `SET search_path = public`
- [ ] No tenant parameter defaults to NULL-means-skip
- [ ] `src/lib/types/database.ts` updated
- [ ] Migration deployed before the code that needs it
