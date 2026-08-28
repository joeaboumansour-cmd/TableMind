-- ============================================================================
-- 028: Deleting a product must NOT be blocked by, or destroy, sales history
-- ============================================================================
--
-- PROBLEM
-- -------
-- `transaction_items.product_id` was declared in 001 as a bare
-- `REFERENCES products(id)` with no ON DELETE action, which means NO ACTION:
-- Postgres REFUSES the delete (SQLSTATE 23503) as soon as a product has ever
-- been sold. In practice that is every product worth deleting, so the
-- inventory screen could only ever delete items nobody had bought.
--
-- The workaround that grew around it is worse than the bug: the CSV
-- `replace_all` import deletes every `transaction_items` row and every
-- `transactions` row for the store purely to get the FK out of the way --
-- i.e. it destroys the store's entire sales history to import a spreadsheet.
-- That is removed in the same change as this migration.
--
-- FIX
-- ---
-- ON DELETE SET NULL. `product_id` is already a NULLABLE FK and NULL is
-- already a supported, live state: a one-off line (an unknown barcode priced
-- at the till) has always been written with `product_id = NULL`. See
-- `src/lib/pos/lineItems.ts`.
--
-- The receipt does not lose anything, because `transaction_items` carries its
-- own denormalised copy of everything a receipt prints:
--   product_name, quantity, unit_price, total_price, currency
-- Those are the values as sold. They are not read back from `products` and
-- never were. Nulling `product_id` severs the link to the catalogue row, not
-- the record of the sale.
--
-- NOT CASCADE. CASCADE here would delete the line items -- silently altering
-- the totals of completed, already-paid, already-receipted sales. Money that
-- was taken must stay recorded.
--
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Replace the FK. The constraint is looked up rather than named, because
--    the production database has diverged from these files before and the
--    default name (`transaction_items_product_id_fkey`) is not guaranteed.
--    Any FK from transaction_items.product_id -> products is replaced.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  con RECORD;
BEGIN
  FOR con IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class      t ON t.oid = c.conrelid
    JOIN pg_namespace  n ON n.oid = t.relnamespace
    JOIN pg_class      f ON f.oid = c.confrelid
    WHERE c.contype   = 'f'
      AND n.nspname   = 'public'
      AND t.relname   = 'transaction_items'
      AND f.relname   = 'products'
      AND c.conkey    = ARRAY[
            (SELECT a.attnum
               FROM pg_attribute a
              WHERE a.attrelid = t.oid
                AND a.attname  = 'product_id')
          ]::smallint[]
  LOOP
    EXECUTE format(
      'ALTER TABLE public.transaction_items DROP CONSTRAINT %I', con.conname
    );
    RAISE NOTICE 'Dropped old FK %', con.conname;
  END LOOP;
END $$;

-- The column must be nullable for SET NULL to be legal. It already is; this
-- is a no-op unless production drifted.
ALTER TABLE public.transaction_items
  ALTER COLUMN product_id DROP NOT NULL;

ALTER TABLE public.transaction_items
  ADD CONSTRAINT transaction_items_product_id_fkey
  FOREIGN KEY (product_id)
  REFERENCES public.products(id)
  ON DELETE SET NULL;

-- ----------------------------------------------------------------------------
-- 2. Index the referencing column.
--    Without it, every product delete sequentially scans transaction_items to
--    find the rows it has to null out -- on a busy store that is the whole
--    sales history, per delete. The analytics cost-price join reads this
--    column too.
--
--    Plain CREATE INDEX takes a SHARE lock and blocks writes (i.e. blocks
--    checkout) for its duration. If transaction_items is large enough for
--    that to matter, run this statement on its own instead, outside any
--    transaction:
--        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transaction_items_product
--          ON public.transaction_items(product_id);
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_transaction_items_product
  ON public.transaction_items(product_id);

COMMENT ON COLUMN public.transaction_items.product_id IS
  'Nullable FK to the catalogue row, ON DELETE SET NULL. NULL means the '
  'catalogue row is gone -- either a one-off line that never had one, or a '
  'product deleted after the sale. The sale itself is fully described by '
  'product_name/quantity/unit_price/total_price/currency on this row.';
