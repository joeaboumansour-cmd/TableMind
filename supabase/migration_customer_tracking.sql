-- =============================================
-- Customer Tracking & Auto-Tagging Migration
-- =============================================

-- 1. Add cancellation_count to customers table
ALTER TABLE customers 
ADD COLUMN IF NOT EXISTS cancellation_count INTEGER NOT NULL DEFAULT 0 CHECK (cancellation_count >= 0);

-- 2. Add last_visit_date to customers table
ALTER TABLE customers 
ADD COLUMN IF NOT EXISTS last_visit_date TIMESTAMPTZ;

-- 3. Create function to handle reservation status changes and update customer stats
CREATE OR REPLACE FUNCTION handle_reservation_status_change()
RETURNS TRIGGER AS $$
DECLARE
    customer_record RECORD;
    no_show_threshold INTEGER := 2;      -- Auto-tag after 2 no-shows
    cancellation_threshold INTEGER := 3; -- Auto-tag after 3 cancellations
    vip_visit_threshold INTEGER := 10;   -- VIP after 10 visits
BEGIN
    -- Only process if customer_id is set
    IF NEW.customer_id IS NULL THEN
        RETURN NEW;
    END IF;
    
    -- Get current customer data
    SELECT * INTO customer_record 
    FROM customers 
    WHERE id = NEW.customer_id;
    
    IF NOT FOUND THEN
        RETURN NEW;
    END IF;

    -- Handle different status changes
    CASE NEW.status
        WHEN 'cancelled' THEN
            -- Increment cancellation count
            UPDATE customers 
            SET cancellation_count = cancellation_count + 1,
                updated_at = NOW()
            WHERE id = NEW.customer_id;
            
            -- Auto-tag: High Cancellation Risk
            IF customer_record.cancellation_count + 1 >= cancellation_threshold THEN
                IF NOT (ARRAY['High Cancellation Risk'] <@ customer_record.tags) THEN
                    UPDATE customers 
                    SET tags = array_append(tags, 'High Cancellation Risk'),
                        updated_at = NOW()
                    WHERE id = NEW.customer_id;
                END IF;
            END IF;
            
        WHEN 'seated' THEN
            -- Increment visit count
            UPDATE customers 
            SET total_visits = total_visits + 1,
                last_visit_date = NOW(),
                updated_at = NOW()
            WHERE id = NEW.customer_id;
            
            -- Auto-tag: VIP after threshold visits
            IF customer_record.total_visits + 1 >= vip_visit_threshold THEN
                IF NOT (ARRAY['VIP'] <@ customer_record.tags) THEN
                    UPDATE customers 
                    SET tags = array_append(tags, 'VIP'),
                        updated_at = NOW()
                    WHERE id = NEW.customer_id;
                END IF;
            END IF;
            
            -- Auto-tag: Regular (5+ visits)
            IF customer_record.total_visits + 1 >= 5 AND customer_record.total_visits + 1 < vip_visit_threshold THEN
                IF NOT (ARRAY['Regular'] <@ customer_record.tags) THEN
                    UPDATE customers 
                    SET tags = array_append(tags, 'Regular'),
                        updated_at = NOW()
                    WHERE id = NEW.customer_id;
                END IF;
            END IF;
            
        WHEN 'finished' THEN
            -- Also count finished as a visit if not already seated
            -- This handles cases where reservation goes directly to finished
            IF OLD.status NOT IN ('seated') THEN
                UPDATE customers 
                SET total_visits = total_visits + 1,
                    last_visit_date = NOW(),
                    updated_at = NOW()
                WHERE id = NEW.customer_id;
            END IF;
            
    END CASE;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Create trigger for status changes
DROP TRIGGER IF EXISTS reservation_status_change ON reservations;
CREATE TRIGGER reservation_status_change
    AFTER UPDATE OF status ON reservations
    FOR EACH ROW
    WHEN (OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION handle_reservation_status_change();

-- 5. Create function to mark no-shows automatically (2 hours past reservation)
CREATE OR REPLACE FUNCTION mark_no_shows()
RETURNS INTEGER AS $$
DECLARE
    updated_count INTEGER := 0;
    reservation_record RECORD;
    customer_record RECORD;
    no_show_threshold INTEGER := 2;  -- Auto-tag after 2 no-shows
BEGIN
    -- Find reservations that are:
    -- 1. Status is 'booked' or 'confirmed'
    -- 2. Start time was more than 2 hours ago
    FOR reservation_record IN 
        SELECT r.*, c.no_show_count, c.tags
        FROM reservations r
        JOIN customers c ON r.customer_id = c.id
        WHERE r.status IN ('booked', 'confirmed')
        AND r.start_time < NOW() - INTERVAL '2 hours'
    LOOP
        -- Update reservation status to no_show
        UPDATE reservations 
        SET status = 'no_show',
            updated_at = NOW()
        WHERE id = reservation_record.id;
        
        -- Increment customer's no_show_count
        UPDATE customers 
        SET no_show_count = no_show_count + 1,
            updated_at = NOW()
        WHERE id = reservation_record.customer_id;
        
        -- Auto-tag: High No-Show Risk
        IF reservation_record.no_show_count + 1 >= no_show_threshold THEN
            IF NOT (ARRAY['High No-Show Risk'] <@ reservation_record.tags) THEN
                UPDATE customers 
                SET tags = array_append(tags, 'High No-Show Risk'),
                        updated_at = NOW()
                WHERE id = reservation_record.customer_id;
            END IF;
        END IF;
        
        updated_count := updated_count + 1;
    END LOOP;
    
    RETURN updated_count;
END;
$$ LANGUAGE plpgsql;

-- 6. Create Edge Function to call mark_no_shows (for cron job)
-- This will be called via HTTP from a cron job or manually
COMMENT ON FUNCTION mark_no_shows() IS 'Marks reservations as no-show if 2+ hours past start time. Returns count of updated reservations.';

-- 7. Create view for customer stats summary
CREATE OR REPLACE VIEW customer_stats AS
SELECT 
    c.id,
    c.name,
    c.phone,
    c.total_visits,
    c.no_show_count,
    c.cancellation_count,
    c.last_visit_date,
    c.tags,
    -- Calculate reliability score (0-100)
    CASE 
        WHEN c.total_visits + c.no_show_count + c.cancellation_count = 0 THEN 100
        ELSE ROUND(
            (c.total_visits::NUMERIC / 
            NULLIF(c.total_visits + c.no_show_count + c.cancellation_count, 0)) * 100
        )
    END as reliability_score,
    -- Calculate risk level
    CASE 
        WHEN c.no_show_count >= 2 OR c.cancellation_count >= 3 THEN 'High'
        WHEN c.no_show_count >= 1 OR c.cancellation_count >= 2 THEN 'Medium'
        ELSE 'Low'
    END as risk_level
FROM customers c;

-- 8. Add index for no-show detection query
CREATE INDEX IF NOT EXISTS idx_reservations_no_show_check 
ON reservations(status, start_time) 
WHERE status IN ('booked', 'confirmed');

-- =============================================
-- VERIFICATION
-- =============================================

-- Check the new columns exist
SELECT 
    column_name, 
    data_type,
    column_default
FROM information_schema.columns 
WHERE table_name = 'customers' 
AND column_name IN ('cancellation_count', 'last_visit_date')
ORDER BY column_name;
