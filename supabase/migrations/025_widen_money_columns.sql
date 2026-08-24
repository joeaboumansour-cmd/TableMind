-- ============================================================================
-- 025 — Widen money columns for Lebanese Pound amounts
-- ============================================================================
--
-- WHY
-- ---
-- Amounts in this system are denominated in LL, where a single item is
-- routinely ~185,000. The original schema sized every money column as
-- DECIMAL(10,2), which caps at 99,999,999.99 — reached by a basket of roughly
-- 1,100 USD equivalent.
--
-- The failure is not a visible error. `POST /api/transactions` throws
-- `numeric field overflow`, returns 500, and the client reads any 500 as an
-- offline condition and drops the sale into the local offline queue — where it
-- fails on every retry until it is dead-lettered. The money was taken at the
-- till and the sale never reaches the server. (audit P1-3)
--
-- `cash_shifts` was already widened to DECIMAL(12,2) in 021; `transactions`,
-- `transaction_items` and `products` never were. This brings them to
-- DECIMAL(14,2) — a ceiling of ~10^12 LL, which is far past any real basket.
--
-- `profit_percentage` is a second instance of the same mistake. It is sized
-- DECIMAL(5,2) (max 999.99) but is COMPUTED from LL prices by the inventory
-- form (`pos/products/page.tsx` handleSellingPriceChange →
-- calculateProfitPercentage). Cost 1,000 LL against selling 185,000 LL yields
-- 18,400 — which overflows and fails the product save with an opaque error.
--
-- USD columns (usd_subtotal, cost_price_usd, …) are left alone: they hold
-- dollars, where DECIMAL(10,2) is ~100M and is not reachable.
--
-- SAFETY
-- ------
-- Widening only relaxes a constraint. No existing row can fail to convert, so
-- this is safe to apply independently of any application change, and should be
-- applied BEFORE the code that depends on it.
--
-- ⚠️ LOCKING — READ BEFORE RUNNING
-- ALTER COLUMN ... TYPE takes an ACCESS EXCLUSIVE lock and may rewrite the
-- table. Reads and writes to that table block for the duration, so a rewrite
-- of transaction_items on a busy store will stall checkouts.
--
--   * Run OFF-HOURS.
--   * Run one statement group at a time, not the whole file blind.
--   * Size the tables first so the duration is known rather than discovered:
--
--       SELECT relname, pg_size_pretty(pg_total_relation_size(oid))
--       FROM pg_class
--       WHERE relname IN ('transactions','transaction_items','products');
--
-- PRE-FLIGHT — RUN THIS FIRST
-- ---------------------------
-- The repo is NOT a reliable description of production (see the db-migration
-- skill, and audit P0-5). Confirm the ACTUAL current types before applying,
-- and re-run it afterwards to confirm the change landed:
--
--   SELECT table_name, column_name, numeric_precision, numeric_scale
--   FROM information_schema.columns
--   WHERE table_schema = 'public'
--     AND table_name IN ('transactions','transaction_items','products')
--     AND data_type = 'numeric'
--   ORDER BY table_name, column_name;
--
-- Any column already at precision >= 14 can have its statement skipped.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- transactions — LL totals
-- ----------------------------------------------------------------------------
ALTER TABLE transactions
  ALTER COLUMN subtotal     TYPE DECIMAL(14,2),
  ALTER COLUMN total_amount TYPE DECIMAL(14,2),
  ALTER COLUMN amount_paid  TYPE DECIMAL(14,2),
  ALTER COLUMN change_given TYPE DECIMAL(14,2);


-- ----------------------------------------------------------------------------
-- transaction_items — LL line amounts
--
-- Largest table of the three. Size it before running this one.
-- ----------------------------------------------------------------------------
ALTER TABLE transaction_items
  ALTER COLUMN unit_price  TYPE DECIMAL(14,2),
  ALTER COLUMN total_price TYPE DECIMAL(14,2);


-- ----------------------------------------------------------------------------
-- products — LL prices, and the percentage computed from them
-- ----------------------------------------------------------------------------
ALTER TABLE products
  ALTER COLUMN cost_price    TYPE DECIMAL(14,2),
  ALTER COLUMN selling_price TYPE DECIMAL(14,2);

-- Percentage, not an amount — but derived from LL prices, so it needs headroom
-- well past 999.99. See the note above.
ALTER TABLE products
  ALTER COLUMN profit_percentage TYPE DECIMAL(10,2);


-- ============================================================================
-- POST-APPLY VERIFICATION
--
-- Expected: numeric_precision 14 for every column below except
-- products.profit_percentage, which should read 10.
--
--   SELECT table_name, column_name, numeric_precision, numeric_scale
--   FROM information_schema.columns
--   WHERE table_schema = 'public'
--     AND (   (table_name = 'transactions'      AND column_name IN ('subtotal','total_amount','amount_paid','change_given'))
--          OR (table_name = 'transaction_items' AND column_name IN ('unit_price','total_price'))
--          OR (table_name = 'products'          AND column_name IN ('cost_price','selling_price','profit_percentage')))
--   ORDER BY table_name, column_name;
-- ============================================================================
