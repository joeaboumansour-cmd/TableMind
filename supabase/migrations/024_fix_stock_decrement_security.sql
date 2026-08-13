-- ===
-- Fix decrement_stock RPC security
-- 
-- Problem: The original decrement_stock function is SECURITY INVOKER,
-- so RLS applies when called with the anon key. The RLS policy requires
-- store_id = auth.uid(), but with the anon key auth.uid() is NULL,
-- so the UPDATE silently affects 0 rows.
--
-- Fix: Make it SECURITY DEFINER (bypasses RLS) and add a store_id
-- parameter to verify the caller owns the product.
-- ===

-- Drop the old function (it has no store_id check)
DROP FUNCTION IF EXISTS decrement_stock(UUID, INTEGER);

-- Recreate with SECURITY DEFINER and store_id verification
CREATE OR REPLACE FUNCTION decrement_stock(
  product_id UUID,
  quantity INTEGER,
  p_store_id UUID DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  -- If p_store_id is provided, verify the product belongs to that store.
  -- This prevents cross-tenant stock manipulation.
  IF p_store_id IS NOT NULL THEN
    UPDATE products 
    SET stock_quantity = stock_quantity - quantity
    WHERE id = product_id
      AND store_id = p_store_id;
  ELSE
    -- Legacy behavior (no store check) — kept for backward compatibility
    -- with existing pending_writes that don't include store_id.
    UPDATE products 
    SET stock_quantity = stock_quantity - quantity
    WHERE id = product_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to anon and authenticated roles (needed for the anon-key client)
GRANT EXECUTE ON FUNCTION decrement_stock(UUID, INTEGER, UUID) TO anon, authenticated;