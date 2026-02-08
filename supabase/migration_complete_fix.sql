-- =============================================
-- COMPLETE FIX: Database Schema & Functions
-- Run this in Supabase SQL Editor - ALL AT ONCE
-- =============================================
-- IMPORTANT: Run ALL statements together

-- Step 1: Drop existing objects first
DROP TRIGGER IF EXISTS reservation_status_change ON reservations;
DROP FUNCTION IF EXISTS handle_reservation_status_change() CASCADE;
DROP TYPE IF EXISTS reservation_status CASCADE;

-- Step 2: Create the type with no_show
CREATE TYPE reservation_status AS ENUM ('booked', 'confirmed', 'seated', 'finished', 'cancelled', 'no_show');

-- Step 3: Add status column to reservations (only if it doesn't exist)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'reservations' AND column_name = 'status'
    ) THEN
        ALTER TABLE reservations ADD COLUMN status reservation_status DEFAULT 'booked';
    END IF;
END $$;

-- Step 4: Add missing columns to customers table (safe - uses IF NOT EXISTS)
ALTER TABLE customers ADD COLUMN IF NOT EXISTS cancellation_count INTEGER NOT NULL DEFAULT 0 CHECK (cancellation_count >= 0);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_visit_date TIMESTAMPTZ;

-- Step 5: Add missing columns to reservations table
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS seated_at TIMESTAMPTZ;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS actual_arrival_time TIMESTAMPTZ;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS minutes_early_late INTEGER;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS no_show BOOLEAN DEFAULT FALSE;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS visit_completed BOOLEAN DEFAULT FALSE;

-- Step 6: Create RPC functions for incrementing customer stats
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

CREATE OR REPLACE FUNCTION increment_customer_no_show(customer_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE customers
  SET no_show_count = no_show_count + 1,
      updated_at = NOW()
  WHERE id = customer_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION increment_customer_cancellation(customer_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE customers
  SET cancellation_count = cancellation_count + 1,
      updated_at = NOW()
  WHERE id = customer_id;
END;
$$ LANGUAGE plpgsql;

-- Step 7: Create trigger function - check inside function to avoid OLD issues
CREATE OR REPLACE FUNCTION handle_reservation_status_change()
RETURNS TRIGGER AS $$
DECLARE
    customer_record RECORD;
    no_show_threshold INTEGER := 2;
    cancellation_threshold INTEGER := 3;
    vip_visit_threshold INTEGER := 10;
    was_seated BOOLEAN := FALSE;
    old_status_text TEXT;
BEGIN
    -- Get old status if this is an UPDATE
    IF TG_OP = 'UPDATE' THEN
        old_status_text := COALESCE(OLD.status::text, '');
        was_seated := (old_status_text = 'seated');
        
        -- Skip if status didn't change
        IF old_status_text <> '' AND old_status_text = NEW.status::text THEN
            RETURN NEW;
        END IF;
    END IF;
    
    IF NEW.customer_id IS NULL THEN
        RETURN NEW;
    END IF;
    
    SELECT * INTO customer_record 
    FROM customers 
    WHERE id = NEW.customer_id;
    
    IF NOT FOUND THEN
        RETURN NEW;
    END IF;

    -- Handle status change
    CASE NEW.status::text
        WHEN 'cancelled' THEN
            PERFORM increment_customer_cancellation(NEW.customer_id);
            
            IF customer_record.cancellation_count + 1 >= cancellation_threshold THEN
                IF NOT (ARRAY['High Cancellation Risk'] <@ customer_record.tags) THEN
                    UPDATE customers SET tags = array_append(tags, 'High Cancellation Risk'), updated_at = NOW()
                    WHERE id = NEW.customer_id;
                END IF;
            END IF;
            
        WHEN 'seated' THEN
            PERFORM increment_customer_visit(NEW.customer_id);
            
            IF customer_record.total_visits + 1 >= vip_visit_threshold THEN
                IF NOT (ARRAY['VIP'] <@ customer_record.tags) THEN
                    UPDATE customers SET tags = array_append(tags, 'VIP'), updated_at = NOW()
                    WHERE id = NEW.customer_id;
                END IF;
            END IF;
            
            IF customer_record.total_visits + 1 >= 5 AND customer_record.total_visits + 1 < vip_visit_threshold THEN
                IF NOT (ARRAY['Regular'] <@ customer_record.tags) THEN
                    UPDATE customers SET tags = array_append(tags, 'Regular'), updated_at = NOW()
                    WHERE id = NEW.customer_id;
                END IF;
            END IF;
            
        WHEN 'finished' THEN
            IF NOT was_seated THEN
                PERFORM increment_customer_visit(NEW.customer_id);
            END IF;
            
        WHEN 'no_show' THEN
            PERFORM increment_customer_no_show(NEW.customer_id);
            
            IF customer_record.no_show_count + 1 >= no_show_threshold THEN
                IF NOT (ARRAY['High No-Show Risk'] <@ customer_record.tags) THEN
                    UPDATE customers SET tags = array_append(tags, 'High No-Show Risk'), updated_at = NOW()
                    WHERE id = NEW.customer_id;
                END IF;
            END IF;
    END CASE;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 8: Create trigger
CREATE TRIGGER reservation_status_change
    BEFORE UPDATE OF status ON reservations
    FOR EACH ROW
    EXECUTE FUNCTION handle_reservation_status_change();

-- Step 9: Create auto-mark no-shows function
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
    AND NOT no_show;
    
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RETURN updated_count;
END;
$$ LANGUAGE plpgsql;

-- Step 10: Add index
CREATE INDEX IF NOT EXISTS idx_reservations_no_show_check 
ON reservations(status, start_time) 
WHERE status IN ('booked', 'confirmed');

-- Done!
SELECT 'SUCCESS: All database fixes applied!' as result;
