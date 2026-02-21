-- =============================================
-- CONSOLIDATED FIX: Database Schema Synchronization
-- Run this in Supabase SQL Editor to fix all consistency issues
-- =============================================
-- IMPORTANT: This consolidates all migrations into a single source of truth

-- =============================================
-- STEP 0: Clean up duplicate triggers and functions
-- =============================================
DROP TRIGGER IF EXISTS reservation_status_change ON reservations;
DROP TRIGGER IF EXISTS update_customer_on_visit ON customer_visit_logs;
DROP FUNCTION IF EXISTS handle_reservation_status_change() CASCADE;
DROP FUNCTION IF EXISTS update_customer_stats_from_visit() CASCADE;
DROP FUNCTION IF EXISTS increment_customer_visit(UUID) CASCADE;
DROP FUNCTION IF EXISTS increment_customer_no_show(UUID) CASCADE;
DROP FUNCTION IF EXISTS increment_customer_cancellation(UUID) CASCADE;
DROP FUNCTION IF EXISTS mark_no_shows() CASCADE;

-- =============================================
-- STEP 1: Update reservation_status enum
-- =============================================
DO $$
BEGIN
    -- Check if the type exists
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'reservation_status') THEN
        -- Add missing values if they don't exist
        ALTER TYPE reservation_status ADD VALUE IF NOT EXISTS 'no_show';
        ALTER TYPE reservation_status ADD VALUE IF NOT EXISTS 'confirmed';
    ELSE
        -- Create the enum if it doesn't exist
        CREATE TYPE reservation_status AS ENUM ('booked', 'confirmed', 'seated', 'finished', 'cancelled', 'no_show');
    END IF;
END $$;

-- =============================================
-- STEP 2: Ensure all customer columns exist
-- =============================================
ALTER TABLE customers 
ADD COLUMN IF NOT EXISTS cancellation_count INTEGER NOT NULL DEFAULT 0 CHECK (cancellation_count >= 0);

ALTER TABLE customers 
ADD COLUMN IF NOT EXISTS no_show_count INTEGER NOT NULL DEFAULT 0 CHECK (no_show_count >= 0);

ALTER TABLE customers 
ADD COLUMN IF NOT EXISTS last_visit_date TIMESTAMPTZ;

-- =============================================
-- STEP 3: Ensure all reservation columns exist
-- =============================================
ALTER TABLE reservations 
ADD COLUMN IF NOT EXISTS status reservation_status NOT NULL DEFAULT 'booked';

ALTER TABLE reservations 
ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;

ALTER TABLE reservations 
ADD COLUMN IF NOT EXISTS seated_at TIMESTAMPTZ;

ALTER TABLE reservations 
ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;

ALTER TABLE reservations 
ADD COLUMN IF NOT EXISTS actual_arrival_time TIMESTAMPTZ;

ALTER TABLE reservations 
ADD COLUMN IF NOT EXISTS minutes_early_late INTEGER;

ALTER TABLE reservations 
ADD COLUMN IF NOT EXISTS no_show BOOLEAN DEFAULT FALSE;

ALTER TABLE reservations 
ADD COLUMN IF NOT EXISTS visit_completed BOOLEAN DEFAULT FALSE;

-- =============================================
-- STEP 4: Create index for no-show detection
-- =============================================
CREATE INDEX IF NOT EXISTS idx_reservations_no_show_check 
ON reservations(status, start_time) 
WHERE status IN ('booked', 'confirmed');

-- =============================================
-- STEP 5: Create SINGLE customer_analytics view
-- =============================================
DROP VIEW IF EXISTS customer_analytics;
DROP VIEW IF EXISTS customer_stats;

CREATE OR REPLACE VIEW customer_analytics AS
SELECT 
    c.id,
    c.restaurant_id,
    c.name,
    c.phone,
    c.email,
    c.notes,
    c.tags,
    c.total_visits,
    COALESCE(c.no_show_count, 0) as no_show_count,
    COALESCE(c.cancellation_count, 0) as cancellation_count,
    c.last_visit_date,
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

-- =============================================
-- STEP 6: Create SINGLE trigger for customer stats (Database-only updates)
-- =============================================
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
    -- Skip if status didn't change
    IF TG_OP = 'UPDATE' THEN
        old_status_text := COALESCE(OLD.status::text, '');
        was_seated := (old_status_text = 'seated');
        
        IF old_status_text <> '' AND old_status_text = NEW.status::text THEN
            RETURN NEW;
        END IF;
    END IF;
    
    -- Skip if no customer_id linked
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

    -- Handle status changes - SINGLE SOURCE OF TRUTH for customer stats
    CASE NEW.status::text
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
            
            -- Auto-tag Regular (5+ visits)
            IF customer_record.total_visits + 1 >= 5 AND customer_record.total_visits + 1 < vip_visit_threshold THEN
                IF NOT (ARRAY['Regular'] <@ COALESCE(customer_record.tags, ARRAY[]::text[])) THEN
                    UPDATE customers SET tags = array_append(tags, 'Regular'), updated_at = NOW()
                    WHERE id = NEW.customer_id;
                END IF;
            END IF;
            
        WHEN 'finished' THEN
            -- Only increment if wasn't already seated
            IF NOT was_seated THEN
                UPDATE customers 
                SET total_visits = total_visits + 1,
                    last_visit_date = NOW(),
                    updated_at = NOW()
                WHERE id = NEW.customer_id;
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

-- Create the SINGLE trigger
CREATE TRIGGER reservation_status_change
    AFTER UPDATE OF status ON reservations
    FOR EACH ROW
    WHEN (OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION handle_reservation_status_change();

-- =============================================
-- STEP 7: Create auto-mark no-shows function (for cron job)
-- =============================================
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
-- STEP 8: Analytics Functions
-- =============================================

-- Customer Segmentation
CREATE OR REPLACE FUNCTION get_customer_segmentation(
  p_restaurant_id UUID,
  p_start_date TIMESTAMPTZ,
  p_end_date TIMESTAMPTZ
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_customers INTEGER;
  v_returning_customers INTEGER;
  v_total_customers INTEGER;
BEGIN
  SELECT COUNT(DISTINCT customer_id) INTO v_new_customers
  FROM reservations
  WHERE restaurant_id = p_restaurant_id
    AND customer_id IS NOT NULL
    AND start_time BETWEEN p_start_date AND p_end_date
    AND NOT EXISTS (
      SELECT 1 FROM reservations r2
      WHERE r2.customer_id = reservations.customer_id
        AND r2.start_time < p_start_date
    );

  SELECT COUNT(DISTINCT customer_id) INTO v_returning_customers
  FROM reservations
  WHERE restaurant_id = p_restaurant_id
    AND customer_id IS NOT NULL
    AND start_time BETWEEN p_start_date AND p_end_date
    AND EXISTS (
      SELECT 1 FROM reservations r2
      WHERE r2.customer_id = reservations.customer_id
        AND r2.start_time < p_start_date
    );

  SELECT COUNT(DISTINCT customer_id) INTO v_total_customers
  FROM reservations
  WHERE restaurant_id = p_restaurant_id
    AND customer_id IS NOT NULL
    AND start_time BETWEEN p_start_date AND p_end_date;

  RETURN json_build_object(
    'new_customers', COALESCE(v_new_customers, 0),
    'returning_customers', COALESCE(v_returning_customers, 0),
    'total_customers', COALESCE(v_total_customers, 0),
    'new_percentage', CASE 
      WHEN v_total_customers > 0 
      THEN ROUND((v_new_customers::NUMERIC / v_total_customers::NUMERIC) * 100, 1)
      ELSE 0 
    END,
    'returning_percentage', CASE 
      WHEN v_total_customers > 0 
      THEN ROUND((v_returning_customers::NUMERIC / v_total_customers::NUMERIC) * 100, 1)
      ELSE 0 
    END
  );
END;
$$;

-- Lead Time Distribution
CREATE OR REPLACE FUNCTION get_lead_time_distribution(
  p_restaurant_id UUID,
  p_start_date TIMESTAMPTZ,
  p_end_date TIMESTAMPTZ
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result JSON;
BEGIN
  SELECT json_build_object(
    'same_day', COALESCE((
      SELECT COUNT(*) FROM reservations
      WHERE restaurant_id = p_restaurant_id
        AND start_time BETWEEN p_start_date AND p_end_date
        AND DATE_TRUNC('day', start_time) = DATE_TRUNC('day', created_at)
    ), 0),
    
    'one_day', COALESCE((
      SELECT COUNT(*) FROM reservations
      WHERE restaurant_id = p_restaurant_id
        AND start_time BETWEEN p_start_date AND p_end_date
        AND start_time::date - created_at::date BETWEEN 1 AND 1
    ), 0),
    
    'two_days', COALESCE((
      SELECT COUNT(*) FROM reservations
      WHERE restaurant_id = p_restaurant_id
        AND start_time BETWEEN p_start_date AND p_end_date
        AND start_time::date - created_at::date BETWEEN 2 AND 3
    ), 0),
    
    'one_week', COALESCE((
      SELECT COUNT(*) FROM reservations
      WHERE restaurant_id = p_restaurant_id
        AND start_time BETWEEN p_start_date AND p_end_date
        AND start_time::date - created_at::date BETWEEN 4 AND 7
    ), 0),
    
    'two_weeks', COALESCE((
      SELECT COUNT(*) FROM reservations
      WHERE restaurant_id = p_restaurant_id
        AND start_time BETWEEN p_start_date AND p_end_date
        AND start_time::date - created_at::date BETWEEN 8 AND 14
    ), 0),
    
    'month_plus', COALESCE((
      SELECT COUNT(*) FROM reservations
      WHERE restaurant_id = p_restaurant_id
        AND start_time BETWEEN p_start_date AND p_end_date
        AND start_time::date - created_at::date > 14
    ), 0),
    
    'average_days', COALESCE((
      SELECT AVG(start_time::date - created_at::date)::NUMERIC(10,1)
      FROM reservations
      WHERE restaurant_id = p_restaurant_id
        AND start_time BETWEEN p_start_date AND p_end_date
        AND created_at IS NOT NULL
    ), 0)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- Day of Week Patterns
CREATE OR REPLACE FUNCTION get_day_of_week_patterns(
  p_restaurant_id UUID,
  p_start_date TIMESTAMPTZ,
  p_end_date TIMESTAMPTZ
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN json_build_object(
    'sunday', COALESCE((SELECT COUNT(*) FROM reservations 
      WHERE restaurant_id = p_restaurant_id AND start_time BETWEEN p_start_date AND p_end_date 
      AND EXTRACT(DOW FROM start_time) = 0), 0),
    'monday', COALESCE((SELECT COUNT(*) FROM reservations 
      WHERE restaurant_id = p_restaurant_id AND start_time BETWEEN p_start_date AND p_end_date 
      AND EXTRACT(DOW FROM start_time) = 1), 0),
    'tuesday', COALESCE((SELECT COUNT(*) FROM reservations 
      WHERE restaurant_id = p_restaurant_id AND start_time BETWEEN p_start_date AND p_end_date 
      AND EXTRACT(DOW FROM start_time) = 2), 0),
    'wednesday', COALESCE((SELECT COUNT(*) FROM reservations 
      WHERE restaurant_id = p_restaurant_id AND start_time BETWEEN p_start_date AND p_end_date 
      AND EXTRACT(DOW FROM start_time) = 3), 0),
    'thursday', COALESCE((SELECT COUNT(*) FROM reservations 
      WHERE restaurant_id = p_restaurant_id AND start_time BETWEEN p_start_date AND p_end_date 
      AND EXTRACT(DOW FROM start_time) = 4), 0),
    'friday', COALESCE((SELECT COUNT(*) FROM reservations 
      WHERE restaurant_id = p_restaurant_id AND start_time BETWEEN p_start_date AND p_end_date 
      AND EXTRACT(DOW FROM start_time) = 5), 0),
    'saturday', COALESCE((SELECT COUNT(*) FROM reservations 
      WHERE restaurant_id = p_restaurant_id AND start_time BETWEEN p_start_date AND p_end_date 
      AND EXTRACT(DOW FROM start_time) = 6), 0)
  );
END;
$$;

-- Dining Times Heatmap
CREATE OR REPLACE FUNCTION get_dining_times_heatmap(
  p_restaurant_id UUID,
  p_start_date TIMESTAMPTZ,
  p_end_date TIMESTAMPTZ
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN (
    SELECT json_agg(
      json_build_object(
        'hour', hour_num,
        'reservations', reservation_count,
        'avg_party_size', ROUND(avg_party_size::NUMERIC, 1)
      )
    )
    FROM (
      SELECT 
        EXTRACT(HOUR FROM start_time)::INTEGER as hour_num,
        COUNT(*) as reservation_count,
        AVG(party_size)::NUMERIC(10,2) as avg_party_size
      FROM reservations
      WHERE restaurant_id = p_restaurant_id
        AND start_time BETWEEN p_start_date AND p_end_date
      GROUP BY EXTRACT(HOUR FROM start_time)
      ORDER BY hour_num
    ) hourly_data
  );
END;
$$;

-- Comprehensive Analytics
CREATE OR REPLACE FUNCTION get_comprehensive_analytics(
  p_restaurant_id UUID,
  p_start_date TIMESTAMPTZ,
  p_end_date TIMESTAMPTZ
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN json_build_object(
    'period', json_build_object(
      'start', p_start_date,
      'end', p_end_date
    ),
    'overview', (
      SELECT json_build_object(
        'total_reservations', COUNT(*),
        'total_guests', SUM(party_size),
        'avg_party_size', ROUND(AVG(party_size)::NUMERIC, 2),
        'completed', COUNT(*) FILTER (WHERE status = 'finished'),
        'cancelled', COUNT(*) FILTER (WHERE status = 'cancelled')
      )
      FROM reservations
      WHERE restaurant_id = p_restaurant_id
        AND start_time BETWEEN p_start_date AND p_end_date
    ),
    'customer_segmentation', get_customer_segmentation(p_restaurant_id, p_start_date, p_end_date),
    'lead_time', get_lead_time_distribution(p_restaurant_id, p_start_date, p_end_date),
    'day_of_week', get_day_of_week_patterns(p_restaurant_id, p_start_date, p_end_date),
    'dining_times', get_dining_times_heatmap(p_restaurant_id, p_start_date, p_end_date)
  );
END;
$$;

-- =============================================
-- STEP 9: Verification
-- =============================================
SELECT '=== CONSOLIDATION COMPLETE ===' as status;
SELECT 'Customer analytics view:' as check_item;
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'customer_analytics' 
ORDER BY ordinal_position;
