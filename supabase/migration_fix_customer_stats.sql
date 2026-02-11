-- =============================================
-- FIX: Customer Stats Tracking Migration
-- Run this in the Supabase SQL Editor to fix customer visit/cancellation/no-show counts
-- =============================================

-- Step 1: Ensure customer columns exist
ALTER TABLE customers 
ADD COLUMN IF NOT EXISTS cancellation_count INTEGER NOT NULL DEFAULT 0 CHECK (cancellation_count >= 0);

ALTER TABLE customers 
ADD COLUMN IF NOT EXISTS no_show_count INTEGER NOT NULL DEFAULT 0 CHECK (no_show_count >= 0);

ALTER TABLE customers 
ADD COLUMN IF NOT EXISTS last_visit_date TIMESTAMPTZ;

-- Step 2: Create RPC function to increment customer visit count
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

-- Step 3: Create RPC function to increment customer no-show count
CREATE OR REPLACE FUNCTION increment_customer_no_show(customer_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE customers
  SET no_show_count = COALESCE(no_show_count, 0) + 1,
      updated_at = NOW()
  WHERE id = customer_id;
END;
$$ LANGUAGE plpgsql;

-- Step 4: Create RPC function to increment customer cancellation count
CREATE OR REPLACE FUNCTION increment_customer_cancellation(customer_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE customers
  SET cancellation_count = COALESCE(cancellation_count, 0) + 1,
      updated_at = NOW()
  WHERE id = customer_id;
END;
$$ LANGUAGE plpgsql;

-- Step 5: Drop existing trigger if exists (to avoid conflicts)
DROP TRIGGER IF EXISTS reservation_status_change ON reservations;
DROP FUNCTION IF EXISTS handle_reservation_status_change() CASCADE;

-- Step 6: Create improved trigger function for status changes
CREATE OR REPLACE FUNCTION handle_reservation_status_change()
RETURNS TRIGGER AS $$
DECLARE
    customer_record RECORD;
    no_show_threshold INTEGER := 2;
    cancellation_threshold INTEGER := 3;
    vip_visit_threshold INTEGER := 10;
BEGIN
    -- Skip if status didn't change
    IF OLD.status = NEW.status THEN
        RETURN NEW;
    END IF;
    
    -- Skip if no customer_id
    IF NEW.customer_id IS NULL THEN
        RETURN NEW;
    END IF;
    
    -- Get customer record
    SELECT * INTO customer_record 
    FROM customers 
    WHERE id = NEW.customer_id;
    
    IF NOT FOUND THEN
        RETURN NEW;
    END IF;

    -- Handle status changes
    CASE NEW.status::text
        WHEN 'seated' THEN
            -- Increment visits
            UPDATE customers 
            SET total_visits = total_visits + 1,
                last_visit_date = NOW(),
                updated_at = NOW()
            WHERE id = NEW.customer_id;
            
            -- Auto-tag VIP
            IF customer_record.total_visits + 1 >= vip_visit_threshold THEN
                IF NOT (ARRAY['VIP'] <@ COALESCE(customer_record.tags, ARRAY[]::text[])) THEN
                    UPDATE customers SET tags = array_append(tags, 'VIP'), updated_at = NOW()
                    WHERE id = NEW.customer_id;
                END IF;
            END IF;
            
            -- Auto-tag Regular
            IF customer_record.total_visits + 1 >= 5 AND customer_record.total_visits + 1 < vip_visit_threshold THEN
                IF NOT (ARRAY['Regular'] <@ COALESCE(customer_record.tags, ARRAY[]::text[])) THEN
                    UPDATE customers SET tags = array_append(tags, 'Regular'), updated_at = NOW()
                    WHERE id = NEW.customer_id;
                END IF;
            END IF;
            
        WHEN 'finished' THEN
            -- Only increment if wasn't already seated
            IF OLD.status IS DISTINCT FROM 'seated' THEN
                UPDATE customers 
                SET total_visits = total_visits + 1,
                    last_visit_date = NOW(),
                    updated_at = NOW()
                WHERE id = NEW.customer_id;
            END IF;
            
        WHEN 'cancelled' THEN
            -- Increment cancellations
            UPDATE customers 
            SET cancellation_count = COALESCE(cancellation_count, 0) + 1,
                updated_at = NOW()
            WHERE id = NEW.customer_id;
            
            -- Auto-tag High Cancellation Risk
            IF COALESCE(customer_record.cancellation_count, 0) + 1 >= cancellation_threshold THEN
                IF NOT (ARRAY['High Cancellation Risk'] <@ COALESCE(customer_record.tags, ARRAY[]::text[])) THEN
                    UPDATE customers SET tags = array_append(tags, 'High Cancellation Risk'), updated_at = NOW()
                    WHERE id = NEW.customer_id;
                END IF;
            END IF;
            
        WHEN 'no_show' THEN
            -- Increment no-shows
            UPDATE customers 
            SET no_show_count = COALESCE(no_show_count, 0) + 1,
                updated_at = NOW()
            WHERE id = NEW.customer_id;
            
            -- Auto-tag High No-Show Risk
            IF COALESCE(customer_record.no_show_count, 0) + 1 >= no_show_threshold THEN
                IF NOT (ARRAY['High No-Show Risk'] <@ COALESCE(customer_record.tags, ARRAY[]::text[])) THEN
                    UPDATE customers SET tags = array_append(tags, 'High No-Show Risk'), updated_at = NOW()
                    WHERE id = NEW.customer_id;
                END IF;
            END IF;
    END CASE;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 7: Create the trigger
CREATE TRIGGER reservation_status_change
    AFTER UPDATE OF status ON reservations
    FOR EACH ROW
    WHEN (OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION handle_reservation_status_change();

-- Step 8: Create or update the customer_analytics view
CREATE OR REPLACE VIEW customer_analytics AS
SELECT 
    c.id,
    c.restaurant_id,
    c.name,
    c.phone,
    c.email,
    c.notes,
    c.total_visits,
    COALESCE(c.no_show_count, 0) as no_show_count,
    COALESCE(c.cancellation_count, 0) as cancellation_count,
    c.last_visit_date,
    c.tags,
    c.created_at,
    c.updated_at,
    -- Reliability score (0-100)
    CASE 
        WHEN c.total_visits + COALESCE(c.no_show_count, 0) + COALESCE(c.cancellation_count, 0) = 0 THEN 100
        ELSE ROUND(
            (c.total_visits::NUMERIC / 
            NULLIF(c.total_visits + COALESCE(c.no_show_count, 0) + COALESCE(c.cancellation_count, 0), 0)) * 100
        )
    END as reliability_score,
    -- Risk level
    CASE 
        WHEN COALESCE(c.no_show_count, 0) >= 2 OR COALESCE(c.cancellation_count, 0) >= 3 THEN 'High'
        WHEN COALESCE(c.no_show_count, 0) >= 1 OR COALESCE(c.cancellation_count, 0) >= 2 THEN 'Medium'
        ELSE 'Low'
    END as risk_level
FROM customers c;

-- Step 9: Create function to auto-mark no-shows
CREATE OR REPLACE FUNCTION mark_no_shows()
RETURNS INTEGER AS $$
DECLARE
    updated_count INTEGER := 0;
BEGIN
    UPDATE reservations 
    SET status = 'no_show',
        no_show = TRUE,
        updated_at = NOW()
    WHERE status IN ('booked', 'confirmed')
    AND start_time < NOW() - INTERVAL '2 hours'
    AND NOT COALESCE(no_show, FALSE);
    
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RETURN updated_count;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- VERIFICATION
-- =============================================

-- Verify columns exist
SELECT 
    column_name, 
    data_type,
    column_default
FROM information_schema.columns 
WHERE table_name = 'customers' 
AND column_name IN ('total_visits', 'no_show_count', 'cancellation_count', 'last_visit_date')
ORDER BY column_name;

-- Verify functions exist
SELECT proname as function_name 
FROM pg_proc 
WHERE proname IN (
    'increment_customer_visit', 
    'increment_customer_no_show', 
    'increment_customer_cancellation',
    'handle_reservation_status_change',
    'mark_no_shows'
)
ORDER BY proname;

-- Verify trigger exists
SELECT trigger_name, event_manipulation, action_timing
FROM information_schema.triggers
WHERE trigger_name = 'reservation_status_change';

-- Verify view exists
SELECT table_name, table_type
FROM information_schema.views
WHERE table_name = 'customer_analytics';
