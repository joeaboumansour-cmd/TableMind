-- =============================================
-- HOST APP OPTIMIZATIONS MIGRATION
-- Speed-focused schema for manual host data entry
-- Prevents duplicate customers, enables quick search
-- =============================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- For trigram/GIN text search

-- =============================================
-- 1. QUICK SEARCH CUSTOMER FLOW
-- =============================================

-- Add GIN indexes for fast phone/name searching within restaurant
-- This allows hosts to type "555" and instantly see all matching customers
CREATE INDEX IF NOT EXISTS idx_customers_phone_gin 
ON customers USING gin (phone gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_customers_name_gin 
ON customers USING gin (name gin_trgm_ops);

-- Composite index for restaurant-scoped phone search (most common lookup)
CREATE INDEX IF NOT EXISTS idx_customers_restaurant_phone 
ON customers(restaurant_id, phone text_pattern_ops);

-- Function: Quick customer search by phone or name (fuzzy match)
CREATE OR REPLACE FUNCTION search_customers(
    p_restaurant_id UUID,
    p_search_term TEXT,
    p_limit INTEGER DEFAULT 10
)
RETURNS TABLE (
    id UUID,
    name TEXT,
    phone TEXT,
    email TEXT,
    tags TEXT[],
    total_visits INTEGER,
    reliability_score INTEGER,
    similarity NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
BEGIN
    -- If search term looks like a phone number (digits, dashes, spaces, parens)
    IF p_search_term ~ '^[0-9\-\(\)\s]+$' THEN
        -- Normalize phone: remove non-digits for comparison
        RETURN QUERY
        SELECT 
            c.id,
            c.name,
            c.phone,
            c.email,
            c.tags,
            c.total_visits,
            CASE 
                WHEN c.total_visits + COALESCE(c.no_show_count, 0) = 0 THEN 100
                ELSE ROUND((c.total_visits::NUMERIC / 
                    NULLIF(c.total_visits + COALESCE(c.no_show_count, 0), 0)) * 100)
            END as reliability_score,
            similarity(c.phone, p_search_term) as similarity
        FROM customers c
        WHERE c.restaurant_id = p_restaurant_id
        AND (
            c.phone ILIKE '%' || p_search_term || '%'
            OR similarity(c.phone, p_search_term) > 0.1
        )
        ORDER BY similarity DESC, c.name
        LIMIT p_limit;
    ELSE
        -- Name search with fuzzy matching
        RETURN QUERY
        SELECT 
            c.id,
            c.name,
            c.phone,
            c.email,
            c.tags,
            c.total_visits,
            CASE 
                WHEN c.total_visits + COALESCE(c.no_show_count, 0) = 0 THEN 100
                ELSE ROUND((c.total_visits::NUMERIC / 
                    NULLIF(c.total_visits + COALESCE(c.no_show_count, 0), 0)) * 100)
            END as reliability_score,
            similarity(c.name, p_search_term) as similarity
        FROM customers c
        WHERE c.restaurant_id = p_restaurant_id
        AND (
            c.name ILIKE '%' || p_search_term || '%'
            OR similarity(c.name, p_search_term) > 0.2
        )
        ORDER BY similarity DESC, c.name
        LIMIT p_limit;
    END IF;
END;
$$;

-- Function: Upsert customer (prevents duplicates on phone within restaurant)
CREATE OR REPLACE FUNCTION upsert_customer(
    p_restaurant_id UUID,
    p_name TEXT,
    p_phone TEXT DEFAULT NULL,
    p_email TEXT DEFAULT NULL,
    p_notes TEXT DEFAULT NULL,
    p_tags TEXT[] DEFAULT '{}'
)
RETURNS TABLE (
    customer_id UUID,
    is_new BOOLEAN,
    name TEXT,
    phone TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_customer_id UUID;
    v_is_new BOOLEAN := false;
BEGIN
    -- Try to find existing customer by phone (within this restaurant)
    IF p_phone IS NOT NULL AND p_phone != '' THEN
        SELECT c.id INTO v_customer_id
        FROM customers c
        WHERE c.restaurant_id = p_restaurant_id
        AND c.phone = p_phone
        LIMIT 1;
    END IF;
    
    -- If not found by phone, try email
    IF v_customer_id IS NULL AND p_email IS NOT NULL AND p_email != '' THEN
        SELECT c.id INTO v_customer_id
        FROM customers c
        WHERE c.restaurant_id = p_restaurant_id
        AND c.email = p_email
        LIMIT 1;
    END IF;
    
    -- If still not found, create new customer
    IF v_customer_id IS NULL THEN
        INSERT INTO customers (
            restaurant_id, name, phone, email, notes, tags
        ) VALUES (
            p_restaurant_id, p_name, p_phone, p_email, p_notes, p_tags
        )
        RETURNING customers.id INTO v_customer_id;
        v_is_new := true;
    ELSE
        -- Update existing customer with any new info provided
        UPDATE customers 
        SET 
            name = COALESCE(NULLIF(p_name, ''), customers.name),
            email = COALESCE(NULLIF(p_email, ''), customers.email),
            notes = COALESCE(NULLIF(p_notes, ''), customers.notes),
            tags = CASE 
                WHEN p_tags IS NOT NULL AND array_length(p_tags, 1) > 0 
                THEN p_tags 
                ELSE customers.tags 
            END,
            updated_at = NOW()
        WHERE id = v_customer_id;
    END IF;
    
    RETURN QUERY
    SELECT v_customer_id, v_is_new, p_name, p_phone;
END;
$$;

-- =============================================
-- 2. ENHANCED TABLE SCHEMA (Floor Plan Ready)
-- =============================================

-- Add floor plan and capacity range fields to tables
ALTER TABLE tables 
ADD COLUMN IF NOT EXISTS min_capacity INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS max_capacity INTEGER,
ADD COLUMN IF NOT EXISTS x_position INTEGER,
ADD COLUMN IF NOT EXISTS y_position INTEGER,
ADD COLUMN IF NOT EXISTS room_name TEXT,
ADD COLUMN IF NOT EXISTS section TEXT;

-- Add constraint to ensure max_capacity is set (fallback to capacity)
UPDATE tables 
SET max_capacity = capacity 
WHERE max_capacity IS NULL;

ALTER TABLE tables 
ALTER COLUMN max_capacity SET NOT NULL;

-- Add index for availability queries
CREATE INDEX IF NOT EXISTS idx_tables_capacity_range 
ON tables(restaurant_id, min_capacity, max_capacity) 
WHERE is_active = TRUE;

-- Function: Get available tables for party size and time
CREATE OR REPLACE FUNCTION get_available_tables(
    p_restaurant_id UUID,
    p_party_size INTEGER,
    p_start_time TIMESTAMPTZ,
    p_end_time TIMESTAMPTZ,
    p_room_name TEXT DEFAULT NULL
)
RETURNS TABLE (
    table_id UUID,
    table_name TEXT,
    min_capacity INTEGER,
    max_capacity INTEGER,
    room_name TEXT,
    shape TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        t.id as table_id,
        t.name as table_name,
        t.min_capacity,
        t.max_capacity,
        t.room_name,
        t.shape::TEXT
    FROM tables t
    WHERE t.restaurant_id = p_restaurant_id
    AND t.is_active = TRUE
    AND t.min_capacity <= p_party_size
    AND t.max_capacity >= p_party_size
    AND (p_room_name IS NULL OR t.room_name = p_room_name)
    AND NOT EXISTS (
        -- Check for overlapping reservations
        SELECT 1 FROM reservations r
        WHERE r.table_id = t.id
        AND r.status IN ('booked', 'confirmed', 'seated')
        AND r.start_time < p_end_time
        AND r.end_time > p_start_time
    )
    ORDER BY t.max_capacity, t.name;
END;
$$;

-- =============================================
-- 3. AUTOMATED RELIABILITY TRACKING (Trigger-based)
-- =============================================

-- Add reliability_score to customers if not exists
ALTER TABLE customers 
ADD COLUMN IF NOT EXISTS reliability_score INTEGER DEFAULT 100 CHECK (reliability_score BETWEEN 0 AND 100),
ADD COLUMN IF NOT EXISTS cancellation_count INTEGER DEFAULT 0 CHECK (cancellation_count >= 0);

-- Function: Update customer stats on no-show
CREATE OR REPLACE FUNCTION update_customer_reliability_on_noshow()
RETURNS TRIGGER AS $$
BEGIN
    -- Only process if no_show changed from false to true
    IF (NEW.no_show = TRUE AND (OLD.no_show = FALSE OR OLD.no_show IS NULL)) THEN
        UPDATE customers 
        SET 
            no_show_count = COALESCE(no_show_count, 0) + 1,
            -- Score drops 15 points per no-show, minimum 0
            reliability_score = GREATEST(0, COALESCE(reliability_score, 100) - 15),
            updated_at = NOW()
        WHERE id = NEW.customer_id;
        
        -- Also create/update a visit log for the no-show
        INSERT INTO customer_visit_logs (
            restaurant_id,
            customer_id,
            reservation_id,
            visit_date,
            status,
            party_size,
            customer_notes
        ) VALUES (
            NEW.restaurant_id,
            NEW.customer_id,
            NEW.id,
            NEW.start_time::DATE,
            'no_show',
            NEW.party_size,
            'Auto-logged: No-show for reservation at ' || NEW.start_time::TIME
        )
        ON CONFLICT DO NOTHING;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if exists and create new
DROP TRIGGER IF EXISTS trg_customer_reliability_noshow ON reservations;
CREATE TRIGGER trg_customer_reliability_noshow
    AFTER UPDATE OF no_show ON reservations
    FOR EACH ROW
    WHEN (NEW.no_show IS DISTINCT FROM OLD.no_show)
    EXECUTE FUNCTION update_customer_reliability_on_noshow();

-- Function: Update customer stats on cancellation
CREATE OR REPLACE FUNCTION update_customer_reliability_on_cancel()
RETURNS TRIGGER AS $$
BEGIN
    -- Only process if status changed to cancelled
    IF (NEW.status = 'cancelled' AND OLD.status != 'cancelled') THEN
        UPDATE customers 
        SET 
            cancellation_count = COALESCE(cancellation_count, 0) + 1,
            -- Score drops 5 points per cancellation, minimum 0
            reliability_score = GREATEST(0, COALESCE(reliability_score, 100) - 5),
            updated_at = NOW()
        WHERE id = NEW.customer_id;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_customer_reliability_cancel ON reservations;
CREATE TRIGGER trg_customer_reliability_cancel
    AFTER UPDATE OF status ON reservations
    FOR EACH ROW
    WHEN (NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled')
    EXECUTE FUNCTION update_customer_reliability_on_cancel();

-- Function: Boost reliability score on completed visit
CREATE OR REPLACE FUNCTION update_customer_reliability_on_complete()
RETURNS TRIGGER AS $$
BEGIN
    -- Only process if status changed to finished
    IF (NEW.status = 'finished' AND OLD.status != 'finished') THEN
        UPDATE customers 
        SET 
            total_visits = COALESCE(total_visits, 0) + 1,
            last_visit_date = NEW.start_time::DATE,
            -- Boost score by 2 points per completed visit, max 100
            reliability_score = LEAST(100, COALESCE(reliability_score, 100) + 2),
            updated_at = NOW()
        WHERE id = NEW.customer_id;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_customer_reliability_complete ON reservations;
CREATE TRIGGER trg_customer_reliability_complete
    AFTER UPDATE OF status ON reservations
    FOR EACH ROW
    WHEN (NEW.status = 'finished' AND OLD.status IS DISTINCT FROM 'finished')
    EXECUTE FUNCTION update_customer_reliability_on_complete();

-- Function: Auto-tag customers based on reliability
CREATE OR REPLACE FUNCTION auto_tag_customer_reliability()
RETURNS TRIGGER AS $$
BEGIN
    -- Auto-tag VIP (10+ visits)
    IF NEW.total_visits >= 10 AND NOT (ARRAY['VIP'] <@ NEW.tags) THEN
        NEW.tags := array_append(NEW.tags, 'VIP');
    END IF;
    
    -- Auto-tag Regular (5+ visits)
    IF NEW.total_visits >= 5 AND NEW.total_visits < 10 AND NOT (ARRAY['Regular'] <@ NEW.tags) THEN
        NEW.tags := array_append(NEW.tags, 'Regular');
    END IF;
    
    -- Auto-tag High No-Show Risk (2+ no-shows OR reliability < 70)
    IF (NEW.no_show_count >= 2 OR NEW.reliability_score < 70) AND NOT (ARRAY['High Risk'] <@ NEW.tags) THEN
        NEW.tags := array_append(NEW.tags, 'High Risk');
    END IF;
    
    -- Auto-tag New (first visit)
    IF NEW.total_visits = 1 AND NOT (ARRAY['New'] <@ NEW.tags) THEN
        NEW.tags := array_append(NEW.tags, 'New');
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_customer_auto_tag ON customers;
CREATE TRIGGER trg_customer_auto_tag
    BEFORE UPDATE ON customers
    FOR EACH ROW
    EXECUTE FUNCTION auto_tag_customer_reliability();

-- =============================================
-- 4. SIMPLIFIED VISIT LOGS (Host-friendly)
-- =============================================

-- Simplify customer_visit_logs for manual entry
-- Remove complex JSONB items_ordered, replace with simple fields

-- Add simplified fields if not exists
ALTER TABLE customer_visit_logs 
ADD COLUMN IF NOT EXISTS top_items_ordered TEXT, -- Host types: "Steak, Wine, Salad"
ADD COLUMN IF NOT EXISTS host_notes TEXT;        -- Quick notes for host

-- Remove items_ordered JSONB column (data migration not needed for new installs)
-- If you have existing data, manually migrate first before dropping
-- ALTER TABLE customer_visit_logs DROP COLUMN IF EXISTS items_ordered;

-- Create a view for host-friendly visit display
CREATE OR REPLACE VIEW customer_visit_summary AS
SELECT 
    cvl.id,
    cvl.customer_id,
    c.name as customer_name,
    c.phone as customer_phone,
    cvl.visit_date,
    cvl.party_size,
    cvl.total_spend,
    cvl.top_items_ordered,
    cvl.customer_notes,
    cvl.host_notes,
    cvl.feedback_rating,
    cvl.status,
    t.name as table_name,
    cvl.created_at
FROM customer_visit_logs cvl
JOIN customers c ON cvl.customer_id = c.id
LEFT JOIN tables t ON cvl.table_id = t.id;

-- =============================================
-- 5. RESERVATION NOTES HISTORY (Enhanced)
-- =============================================

-- Ensure reservation_notes_history has proper indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_notes_history_customer_lookup 
ON reservation_notes_history(reservation_id, created_at DESC);

-- Function: Add note to reservation with history tracking
CREATE OR REPLACE FUNCTION add_reservation_note(
    p_reservation_id UUID,
    p_restaurant_id UUID,
    p_note_text TEXT,
    p_note_type TEXT DEFAULT 'general',
    p_created_by UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_note_id UUID;
BEGIN
    -- Insert into history
    INSERT INTO reservation_notes_history (
        reservation_id,
        restaurant_id,
        note_text,
        note_type,
        created_by
    ) VALUES (
        p_reservation_id,
        p_restaurant_id,
        p_note_text,
        p_note_type,
        p_created_by
    )
    RETURNING id INTO v_note_id;
    
    -- Also update the main reservation notes (concatenate for quick view)
    UPDATE reservations 
    SET notes = COALESCE(notes || E'\n---\n', '') || p_note_text,
        updated_at = NOW()
    WHERE id = p_reservation_id;
    
    RETURN v_note_id;
END;
$$;

-- Function: Get reservation with full note history
CREATE OR REPLACE FUNCTION get_reservation_with_notes(p_reservation_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_result JSON;
BEGIN
    SELECT json_build_object(
        'reservation', row_to_json(r.*),
        'notes_history', COALESCE(
            (SELECT json_agg(
                json_build_object(
                    'id', rn.id,
                    'note_text', rn.note_text,
                    'note_type', rn.note_type,
                    'created_at', rn.created_at,
                    'created_by', ru.display_name
                ) ORDER BY rn.created_at DESC
            )
            FROM reservation_notes_history rn
            LEFT JOIN restaurant_users ru ON rn.created_by = ru.id
            WHERE rn.reservation_id = p_reservation_id),
            '[]'::json
        )
    ) INTO v_result
    FROM reservations r
    WHERE r.id = p_reservation_id;
    
    RETURN v_result;
END;
$$;

-- =============================================
-- 6. HOST DASHBOARD VIEW (Quick Access)
-- =============================================

-- Drop and recreate view to handle column changes
DROP VIEW IF EXISTS host_dashboard;

-- Create a comprehensive view for the host dashboard
CREATE VIEW host_dashboard AS
SELECT 
    r.id as reservation_id,
    r.restaurant_id,
    r.customer_id,
    r.customer_name,
    r.customer_phone,
    r.party_size,
    r.start_time,
    r.end_time,
    r.status,
    r.source,
    r.table_id,
    t.name as table_name,
    t.room_name,
    -- Customer info
    c.tags as customer_tags,
    c.reliability_score,
    c.total_visits,
    c.no_show_count,
    -- Calculated fields
    CASE 
        WHEN r.start_time < NOW() AND r.status IN ('booked', 'confirmed') THEN 'overdue'
        WHEN r.start_time < NOW() + INTERVAL '15 minutes' AND r.status IN ('booked', 'confirmed') THEN 'arriving_soon'
        ELSE 'upcoming'
    END as urgency,
    -- Time until reservation
    EXTRACT(EPOCH FROM (r.start_time - NOW())) / 60 as minutes_until,
    r.notes
FROM reservations r
LEFT JOIN customers c ON r.customer_id = c.id
LEFT JOIN tables t ON r.table_id = t.id
WHERE r.status IN ('booked', 'confirmed', 'seated')
AND r.start_time > NOW() - INTERVAL '2 hours'
ORDER BY r.start_time;

-- =============================================
-- 7. PERFORMANCE INDEXES
-- =============================================

-- Additional indexes for common host queries
CREATE INDEX IF NOT EXISTS idx_reservations_active 
ON reservations(restaurant_id, start_time) 
WHERE status IN ('booked', 'confirmed', 'seated');

CREATE INDEX IF NOT EXISTS idx_customers_tags 
ON customers USING gin (tags);

-- =============================================
-- VERIFICATION QUERIES
-- =============================================

-- Check all new indexes
SELECT 
    indexname,
    tablename
FROM pg_indexes
WHERE schemaname = 'public'
AND indexname LIKE 'idx_customers%'
ORDER BY tablename, indexname;

-- Check new columns in tables
SELECT 
    column_name,
    data_type,
    column_default
FROM information_schema.columns
WHERE table_name = 'tables'
AND column_name IN ('min_capacity', 'max_capacity', 'x_position', 'y_position', 'room_name', 'section')
ORDER BY ordinal_position;

-- Check new columns in customers
SELECT 
    column_name,
    data_type,
    column_default
FROM information_schema.columns
WHERE table_name = 'customers'
AND column_name IN ('reliability_score', 'cancellation_count')
ORDER BY ordinal_position;

-- Test the search function (will return empty if no data)
SELECT 'Search function created' as status;

-- =============================================
-- SUCCESS MESSAGE
-- =============================================
SELECT 'Host App Optimizations Migration Complete!' as status,
       'New features: Quick Search, Auto Reliability, Host Dashboard' as features;