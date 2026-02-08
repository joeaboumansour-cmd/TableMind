-- =============================================
-- FINAL FIX: Status Tracking & Customer Analytics
-- Run this in Supabase SQL Editor
-- =============================================

-- Step 1: Check if reservation_status enum exists and add no_show
DO $$
BEGIN
    -- Check if the type exists
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'reservation_status') THEN
        -- Add no_show value to existing enum (PostgreSQL 9.x+)
        ALTER TYPE reservation_status ADD VALUE IF NOT EXISTS 'no_show';
        ALTER TYPE reservation_status ADD VALUE IF NOT EXISTS 'confirmed';
    ELSE
        -- Create the enum if it doesn't exist
        CREATE TYPE reservation_status AS ENUM ('booked', 'confirmed', 'seated', 'finished', 'cancelled', 'no_show');
    END IF;
END $$;

-- Step 2: Add status column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'reservations' AND column_name = 'status'
    ) THEN
        ALTER TABLE reservations ADD COLUMN status reservation_status DEFAULT 'booked';
    END IF;
END $$;

-- Step 3: Add missing columns to customers (safe - IF NOT EXISTS)
ALTER TABLE customers ADD COLUMN IF NOT EXISTS cancellation_count INTEGER NOT NULL DEFAULT 0 CHECK (cancellation_count >= 0);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_visit_date TIMESTAMPTZ;

-- Step 4: Add missing columns to reservations
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS seated_at TIMESTAMPTZ;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS actual_arrival_time TIMESTAMPTZ;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS minutes_early_late INTEGER;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS no_show BOOLEAN DEFAULT FALSE;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS visit_completed BOOLEAN DEFAULT FALSE;

-- Step 5: Drop old trigger if exists
DROP TRIGGER IF EXISTS reservation_status_change ON reservations;
DROP FUNCTION IF EXISTS handle_reservation_status_change() CASCADE;

-- Step 6: Create trigger function for auto-tagging
CREATE OR REPLACE FUNCTION handle_reservation_status_change()
RETURNS TRIGGER AS $$
DECLARE
    customer_record RECORD;
    no_show_threshold INTEGER := 2;
    cancellation_threshold INTEGER := 3;
    vip_visit_threshold INTEGER := 10;
BEGIN
    -- Skip if status didn't change (only on UPDATE)
    IF TG_OP = 'UPDATE' AND OLD.status = NEW.status THEN
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
    IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
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
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 7: Create the trigger
CREATE TRIGGER reservation_status_change
    AFTER UPDATE OF status ON reservations
    FOR EACH ROW
    WHEN (OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION handle_reservation_status_change();

-- Step 8: Create function to auto-mark no-shows
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

-- Step 9: Create auto-tag analysis view
CREATE OR REPLACE VIEW customer_analytics AS
SELECT 
    c.id,
    c.name,
    c.phone,
    c.total_visits,
    COALESCE(c.no_show_count, 0) as no_show_count,
    COALESCE(c.cancellation_count, 0) as cancellation_count,
    c.last_visit_date,
    c.tags,
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

-- Verification
SELECT 'Migration complete!' as message;

-- Check enum values
SELECT enumlabel as status_values
FROM pg_enum 
WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'reservation_status');
