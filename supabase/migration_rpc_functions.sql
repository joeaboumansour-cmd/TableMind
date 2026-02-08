-- =============================================
-- RPC Functions for Customer Tracking
-- =============================================

-- 1. Function to increment customer visit count
CREATE OR REPLACE FUNCTION increment_customer_visit(customer_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE customers
  SET total_visits = total_visits + 1,
      last_visit_date = NOW(),
      updated_at = NOW()
  WHERE id = customer_id;
END;
$$ LANGUAGE plpgsql;

-- 2. Function to increment customer no-show count
CREATE OR REPLACE FUNCTION increment_customer_no_show(customer_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE customers
  SET no_show_count = no_show_count + 1,
      updated_at = NOW()
  WHERE id = customer_id;
END;
$$ LANGUAGE plpgsql;

-- 3. Function to increment customer cancellation count
CREATE OR REPLACE FUNCTION increment_customer_cancellation(customer_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE customers
  SET cancellation_count = cancellation_count + 1,
      updated_at = NOW()
  WHERE id = customer_id;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- VERIFICATION
-- =============================================

-- Check if functions exist
SELECT proname FROM pg_proc WHERE proname IN ('increment_customer_visit', 'increment_customer_no_show', 'increment_customer_cancellation');
