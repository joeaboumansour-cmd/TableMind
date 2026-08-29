-- ============================================================================
-- 033: Kitchen ticket state
-- ============================================================================
-- The kitchen board shows PAID sales and how far along they are.
--
-- ## The paid transaction IS the order
--
-- This table holds ONLY the preparation state. It deliberately does not copy
-- the lines: `transactions` + `transaction_items` already are the order, and
-- duplicating them would put a second money-adjacent write on the checkout
-- path and give the kitchen its own version of what was sold.
--
-- ## The row is created LAZILY, by the kitchen API, on first read
--
-- `POST /api/transactions` is NOT touched by this migration and must not be.
-- That is the load-bearing property of the whole design:
--
--   * the money path does not change shape at all — no new insert, no new
--     failure mode, no extra latency on the checkout hot path;
--   * a kitchen outage, or this table being missing entirely, cannot affect
--     a sale.
--
-- A transaction with no row here is implicitly 'new'. That is not a fallback,
-- it is the normal state of every ticket nobody has touched yet.
--
-- ## Numbering
--
-- 033, not 030-032. Those numbers are reserved by the approved plan for
-- products.kind, recipe_components and transaction_items.modifiers, which land
-- with the menu work. Migrations are append-only and numbers are never reused,
-- so taking 033 now keeps those free rather than forcing them to renumber.
-- ============================================================================


CREATE TABLE IF NOT EXISTS kitchen_ticket_state (
  -- One state row per sale, so the primary key IS the transaction. This makes
  -- double-inserting a ticket impossible rather than merely unlikely.
  transaction_id UUID PRIMARY KEY REFERENCES transactions(id) ON DELETE CASCADE,

  -- Denormalised so every query can be store-scoped without joining through
  -- transactions. Tenancy scoping must never depend on a join being remembered.
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,

  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'in_progress', 'ready', 'served', 'voided')),

  -- Who picked the ticket up. A display name, not a FK: a kitchen station is
  -- often shared, and a station that cannot be attributed is still allowed to
  -- work. Never used for authorisation.
  claimed_by TEXT,

  -- Set when the ticket ENTERS each state, so a shop can ask how long food
  -- actually takes. Null means it has not reached that state.
  started_at TIMESTAMPTZ,
  ready_at   TIMESTAMPTZ,
  served_at  TIMESTAMPTZ,

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The board's only query: live tickets for one store, newest state first.
CREATE INDEX IF NOT EXISTS idx_kitchen_state_store_status
  ON kitchen_ticket_state(store_id, status, updated_at DESC);


-- ============================================================================
-- UPDATED_AT
-- ============================================================================
-- Drives the poll watermark, so it must be maintained by the database rather
-- than by whichever caller remembered to set it.

CREATE OR REPLACE FUNCTION update_kitchen_ticket_state_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_kitchen_ticket_state_updated_at ON kitchen_ticket_state;
CREATE TRIGGER trigger_kitchen_ticket_state_updated_at
  BEFORE UPDATE ON kitchen_ticket_state
  FOR EACH ROW
  EXECUTE FUNCTION update_kitchen_ticket_state_updated_at();


-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
-- RLS enabled with NO permissive policies, following 027 and 029. The service
-- role bypasses RLS and every path to this table goes through /api/kitchen,
-- which resolves the caller server-side. This deliberately does NOT copy the
-- USING (true) pattern from the older migrations, which grants full read and
-- write to anyone holding the public anon key (audit P0-5).

ALTER TABLE kitchen_ticket_state ENABLE ROW LEVEL SECURITY;
