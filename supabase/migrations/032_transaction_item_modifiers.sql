-- ============================================================================
-- 032: Modifiers on a sold line
-- ============================================================================
-- What was actually changed about a made-to-order item: "no pickles",
-- "+2 cheese". Printed on the receipt and read by the kitchen board.
--
-- ## Why a JSONB column and not a child table
--
-- POST /api/transactions is: insert transaction -> bulk insert items ->
-- decrement loop. A child table would need a THIRD write that depends on the
-- generated transaction_items ids, i.e. .select() on the bulk insert plus an
-- array-position join back to the payload — on the checkout path, in a route
-- that already tolerates a failed items insert WITHOUT failing the sale. The
-- db-migration skill names that shape directly: splitting a sale into
-- insert + insert + loop across round trips is how partial sales get created.
--
-- Modifiers are also DESCRIPTIVE, not transactional. They are what was sold —
-- the same reason transaction_items already carries its own product_name and
-- unit_price rather than joining to products. Nothing aggregates them.
--
-- And one optional array field stays trivially in sync between the server
-- payload (SaleLineItem) and the offline queue (QueuedTransactionItem). A child
-- table would need a parallel nested array in the queue AND a second write in
-- the replay path — two more places for online and offline to disagree.
--
-- The honest cost: "how many sandwiches had extra cheese" needs a JSONB scan.
-- Add a GIN index if that reporting need ever appears. It has not.
--
-- ## NULL vs []
--
--   NULL — an ordinary line. Every sale ever made before this migration.
--   []   — a menu line where nothing was changed.
--
-- The distinction is load-bearing for the kitchen board: a ticket is a
-- transaction with at least one item where modifiers IS NOT NULL. Without it,
-- a retail store with kitchen_display on would see every sale as a ticket.
--
-- Nullable with NO default, so existing rows stay NULL and are correctly read
-- as "not a food order".
-- ============================================================================

ALTER TABLE transaction_items
  ADD COLUMN IF NOT EXISTS modifiers JSONB;

COMMENT ON COLUMN transaction_items.modifiers IS
  'Made-to-order choices as sold. NULL = an ordinary line; [] = a menu line with no changes. Denormalised on purpose: the recipe may change after the sale.';
