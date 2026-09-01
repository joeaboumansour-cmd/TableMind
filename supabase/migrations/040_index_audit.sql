-- =============================================
-- 040 — index audit (Phase 2.4)
-- =============================================
-- Driven by pg_stat_user_indexes on the PRODUCTION database, which has never
-- had its statistics reset — so these are real scan counts over the life of the
-- app, not a guess from reading queries.
--
-- `products` is the table that matters: 96,682 inserts and 139,592 deletes
-- against 7,491 live rows. Every redundant index on it is paid for on all
-- 236,000 of those writes.
-- =============================================

-- ---------------------------------------------------------------------------
-- 1. Drop a duplicate index
-- ---------------------------------------------------------------------------
-- idx_products_barcode_store (001_initial_schema.sql:79) and
-- idx_products_store_barcode_lookup (019_performance_indexes.sql:33) are the
-- SAME index: btree (store_id, barcode), no WHERE clause on either. 019 even
-- carries the comment "idx_products_barcode_store already exists from initial
-- schema" immediately above the line that recreates it.
--
-- The planner can only use one, and it splits arbitrarily between them —
-- 1,477 scans against 15. Keeping both buys nothing and costs a write on every
-- product insert, update and delete.
--
-- The 019 one is kept because it is the one the planner has actually been
-- choosing, and its name says what it is for.
DROP INDEX IF EXISTS idx_products_barcode_store;

-- ---------------------------------------------------------------------------
-- 2. Index the two foreign keys that are checked on every product delete
-- ---------------------------------------------------------------------------
-- Both columns are ON DELETE RESTRICT, so Postgres must prove no row
-- references a product before it can be deleted. With no index that proof is a
-- sequential scan, and this app deletes products in bulk — 139,592 so far.
--
-- Both tables are small today (9 and 4 rows), so this changes nothing
-- measurable now. It is here because the cost is O(deletes x rows) and only one
-- of those factors is small.
CREATE INDEX IF NOT EXISTS idx_recipe_components_ingredient
  ON recipe_components(ingredient_product_id);

CREATE INDEX IF NOT EXISTS idx_combo_components_item
  ON combo_components(item_product_id);

-- ---------------------------------------------------------------------------
-- What was deliberately NOT dropped, and why
-- ---------------------------------------------------------------------------
-- Anyone repeating the "idx_scan = 0 means unused" query will land on these.
-- Two of the three answers are traps.
--
-- * idx_cash_shifts_one_open_per_register
--   idx_cash_shifts_one_open_per_user
--   idx_cash_shifts_one_open_for_owner
--       DO NOT DROP. These are partial UNIQUE indexes, and a unique index is
--       used to ENFORCE on write, not scanned on read — idx_scan = 0 is the
--       expected reading for one that is doing its job perfectly. They are what
--       makes "one open shift per register" and "a cashier is on at most one
--       drawer" true; CLAUDE.md 11a explains why the API-level guard they
--       replaced was not sufficient. Dropping them permits exactly the
--       duplicates they exist to prevent, and nothing would fail loudly.
--
-- * idx_transactions_created_at_desc
--       KEEP. It looks droppable -- (created_at DESC) with no store_id, while
--       every application query is store-scoped -- but it has 2,952 scans. The
--       cross-store readers are the admin console and the retention cleanup.
--
-- * idx_stores_features_gin, idx_stores_type, idx_import_export_audit_*
--       Genuinely unscanned, and left alone anyway: they sit on tables of 6 and
--       189 rows, so they cost nothing to keep and a migration is not free.
