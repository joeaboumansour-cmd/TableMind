-- =============================================
-- COMPLETE WAITER VIEW FIX
-- Run this if waiter view features aren't working
-- =============================================

-- =============================================
-- 1. ENSURE TABLE_SERVICE_STATUS EXISTS
-- =============================================
CREATE TABLE IF NOT EXISTS table_service_status (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    table_id UUID NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
    reservation_id UUID REFERENCES reservations(id) ON DELETE SET NULL,
    
    -- Current service state
    status VARCHAR(50) NOT NULL DEFAULT 'empty',
    
    -- Customer info (for walk-ins or quick reference)
    current_customer_name VARCHAR(255),
    current_customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    current_party_size INTEGER,
    
    -- Timestamps for this service session
    seated_at TIMESTAMPTZ,
    order_taken_at TIMESTAMPTZ,
    food_served_at TIMESTAMPTZ,
    check_requested_at TIMESTAMPTZ,
    cleared_at TIMESTAMPTZ,
    
    -- Service metrics
    estimated_turnover_minutes INTEGER DEFAULT 90,
    actual_duration_minutes INTEGER,
    
    -- Staff assignment
    server_id UUID REFERENCES restaurant_users(id) ON DELETE SET NULL,
    server_name VARCHAR(255),
    
    -- Current session notes (cleared when table is reset)
    session_notes TEXT,
    
    -- Revenue tracking (current order value)
    current_order_value DECIMAL(10,2),
    
    -- Created/updated
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Unique constraint: one status record per table
    UNIQUE(restaurant_id, table_id)
);

-- Enable RLS
ALTER TABLE table_service_status ENABLE ROW LEVEL SECURITY;

-- Drop existing policy if exists and create new
DROP POLICY IF EXISTS "Allow all operations for authenticated users" ON table_service_status;
CREATE POLICY "Allow all operations for authenticated users" 
ON table_service_status FOR ALL TO authenticated 
USING (true) WITH CHECK (true);

-- =============================================
-- 2. ENSURE IS_WALK_IN COLUMN EXISTS ON RESERVATIONS
-- =============================================
ALTER TABLE reservations 
ADD COLUMN IF NOT EXISTS is_walk_in BOOLEAN DEFAULT false;

-- =============================================
-- 3. UPDATE TRIGGER FUNCTION FOR TABLE_SERVICE_STATUS
-- =============================================
CREATE OR REPLACE FUNCTION update_table_service_status_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_table_service_status ON table_service_status;
CREATE TRIGGER trigger_update_table_service_status
    BEFORE UPDATE ON table_service_status
    FOR EACH ROW
    EXECUTE FUNCTION update_table_service_status_updated_at();

-- =============================================
-- 4. SYNC RESERVATION TO TABLE STATUS TRIGGER
-- This is the KEY trigger for feature #1
-- =============================================
CREATE OR REPLACE FUNCTION sync_seated_reservation_to_table()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'seated' AND OLD.status != 'seated' THEN
        INSERT INTO table_service_status (
            restaurant_id, table_id, reservation_id,
            status, current_customer_name, current_customer_id,
            current_party_size, seated_at
        )
        SELECT 
            r.restaurant_id, r.table_id, r.id,
            'seated', r.customer_name, r.customer_id,
            r.party_size, NOW()
        FROM reservations r
        WHERE r.id = NEW.id
        ON CONFLICT (restaurant_id, table_id) 
        DO UPDATE SET
            reservation_id = EXCLUDED.reservation_id,
            status = 'seated',
            current_customer_name = EXCLUDED.current_customer_name,
            current_customer_id = EXCLUDED.current_customer_id,
            current_party_size = EXCLUDED.current_party_size,
            seated_at = NOW(),
            cleared_at = NULL,
            updated_at = NOW();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_sync_seated_reservation ON reservations;
CREATE TRIGGER trigger_sync_seated_reservation
    AFTER UPDATE ON reservations
    FOR EACH ROW
    EXECUTE FUNCTION sync_seated_reservation_to_table();

-- =============================================
-- 5. FUNCTION: GET WAITER TABLE STATUS
-- This is the KEY function for the waiter view API
-- =============================================
DROP FUNCTION IF EXISTS get_waiter_table_status(UUID);

CREATE OR REPLACE FUNCTION get_waiter_table_status(p_restaurant_id UUID)
RETURNS TABLE (
    table_id UUID,
    table_name TEXT,
    table_capacity INTEGER,
    room_name TEXT,
    section TEXT,
    current_status TEXT,
    current_customer_name TEXT,
    current_party_size INTEGER,
    minutes_seated INTEGER,
    current_order_value DECIMAL(10,2),
    reservation_id UUID,
    upcoming_reservation_id UUID,
    upcoming_customer_name TEXT,
    upcoming_party_size INTEGER,
    upcoming_time TIMESTAMPTZ,
    upcoming_status TEXT,
    minutes_until INTEGER,
    urgency TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        t.id::UUID,
        t.name::TEXT,
        t.capacity::INTEGER,
        t.room_name::TEXT,
        t.section::TEXT,
        COALESCE(tss.status, 'empty')::TEXT,
        tss.current_customer_name::TEXT,
        tss.current_party_size::INTEGER,
        CASE 
            WHEN tss.seated_at IS NOT NULL 
            THEN (EXTRACT(EPOCH FROM (NOW() - tss.seated_at))::INTEGER / 60)
            ELSE NULL::INTEGER
        END,
        COALESCE(tss.current_order_value, 0)::DECIMAL(10,2),
        tss.reservation_id::UUID,
        upcoming.reservation_id::UUID,
        upcoming.customer_name::TEXT,
        upcoming.party_size::INTEGER,
        upcoming.start_time::TIMESTAMPTZ,
        upcoming.reservation_status::TEXT,
        upcoming.minutes_until::INTEGER,
        upcoming.urgency::TEXT
    FROM tables t
    LEFT JOIN table_service_status tss ON tss.table_id = t.id AND tss.restaurant_id = t.restaurant_id
    LEFT JOIN LATERAL (
        SELECT 
            r.id as reservation_id,
            r.customer_name,
            r.party_size,
            r.start_time,
            r.status as reservation_status,
            (EXTRACT(EPOCH FROM (r.start_time - NOW())) / 60)::INTEGER as minutes_until,
            CASE 
                WHEN r.start_time < NOW() THEN 'overdue'::TEXT
                WHEN r.start_time <= NOW() + INTERVAL '30 minutes' THEN 'arriving_soon'::TEXT
                ELSE 'upcoming'::TEXT
            END as urgency
        FROM reservations r
        WHERE r.table_id = t.id
            AND r.restaurant_id = t.restaurant_id
            AND r.status IN ('booked', 'confirmed', 'seated')
            AND r.start_time >= NOW() - INTERVAL '30 minutes'
        ORDER BY r.start_time ASC
        LIMIT 1
    ) upcoming ON true
    WHERE t.restaurant_id = p_restaurant_id
        AND t.is_active = true
    ORDER BY t.room_name, t.section, t.name;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- 6. FUNCTION: INITIALIZE TABLE STATUS
-- Creates status records for all tables that don't have one
-- =============================================
CREATE OR REPLACE FUNCTION initialize_table_status(p_restaurant_id UUID)
RETURNS VOID AS $$
DECLARE
    v_table RECORD;
BEGIN
    FOR v_table IN 
        SELECT id FROM tables 
        WHERE restaurant_id = p_restaurant_id
        AND id NOT IN (SELECT table_id FROM table_service_status WHERE restaurant_id = p_restaurant_id)
    LOOP
        INSERT INTO table_service_status (restaurant_id, table_id, status)
        VALUES (p_restaurant_id, v_table.id, 'empty')
        ON CONFLICT (restaurant_id, table_id) DO NOTHING;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- 7. SYNC TABLE STATUS TO RESERVATION
-- When table is cleared, mark reservation as finished
-- =============================================
CREATE OR REPLACE FUNCTION sync_reservation_from_table_status()
RETURNS TRIGGER AS $$
BEGIN
    -- If table is marked seated and has a reservation, update reservation
    IF NEW.status = 'seated' AND NEW.reservation_id IS NOT NULL THEN
        UPDATE reservations 
        SET status = 'seated',
            seated_at = COALESCE(NEW.seated_at, NOW()),
            actual_arrival_time = COALESCE(NEW.seated_at, NOW())
        WHERE id = NEW.reservation_id;
    
    -- If table is cleared and has a reservation, mark as finished
    ELSIF NEW.status = 'empty' AND OLD.status = 'ready_to_clear' AND NEW.reservation_id IS NOT NULL THEN
        UPDATE reservations 
        SET status = 'finished',
            finished_at = NOW(),
            visit_completed = true
        WHERE id = NEW.reservation_id;
        
        -- Clear the reservation link
        NEW.reservation_id = NULL;
        NEW.current_customer_name = NULL;
        NEW.current_customer_id = NULL;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_sync_reservation_status ON table_service_status;
CREATE TRIGGER trigger_sync_reservation_status
    BEFORE UPDATE ON table_service_status
    FOR EACH ROW
    EXECUTE FUNCTION sync_reservation_from_table_status();

-- =============================================
-- 8. AUTO-CREATE TABLE STATUS ON NEW TABLE
-- =============================================
CREATE OR REPLACE FUNCTION auto_create_table_status()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO table_service_status (restaurant_id, table_id, status)
    VALUES (NEW.restaurant_id, NEW.id, 'empty')
    ON CONFLICT (restaurant_id, table_id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_auto_create_table_status ON tables;
CREATE TRIGGER trigger_auto_create_table_status
    AFTER INSERT ON tables
    FOR EACH ROW
    EXECUTE FUNCTION auto_create_table_status();

-- =============================================
-- 9. CUSTOMER TRACKING TRIGGERS (for visit logs & auto-tagging)
-- =============================================

-- Ensure cancellation_count column exists
ALTER TABLE customers 
ADD COLUMN IF NOT EXISTS cancellation_count INTEGER NOT NULL DEFAULT 0 CHECK (cancellation_count >= 0);

-- Ensure last_visit_date column exists
ALTER TABLE customers 
ADD COLUMN IF NOT EXISTS last_visit_date TIMESTAMPTZ;

-- Function to handle reservation status changes
CREATE OR REPLACE FUNCTION handle_reservation_status_change()
RETURNS TRIGGER AS $$
DECLARE
    customer_record RECORD;
    no_show_threshold INTEGER := 2;
    cancellation_threshold INTEGER := 3;
    vip_visit_threshold INTEGER := 10;
BEGIN
    IF NEW.customer_id IS NULL THEN
        RETURN NEW;
    END IF;
    
    SELECT * INTO customer_record 
    FROM customers 
    WHERE id = NEW.customer_id;
    
    IF NOT FOUND THEN
        RETURN NEW;
    END IF;

    CASE NEW.status
        WHEN 'cancelled' THEN
            UPDATE customers 
            SET cancellation_count = cancellation_count + 1,
                updated_at = NOW()
            WHERE id = NEW.customer_id;
            
            IF customer_record.cancellation_count + 1 >= cancellation_threshold THEN
                IF NOT (ARRAY['High Cancellation Risk'] <@ customer_record.tags) THEN
                    UPDATE customers 
                    SET tags = array_append(tags, 'High Cancellation Risk'),
                        updated_at = NOW()
                    WHERE id = NEW.customer_id;
                END IF;
            END IF;
            
        WHEN 'seated' THEN
            UPDATE customers 
            SET total_visits = total_visits + 1,
                last_visit_date = NOW(),
                updated_at = NOW()
            WHERE id = NEW.customer_id;
            
            IF customer_record.total_visits + 1 >= vip_visit_threshold THEN
                IF NOT (ARRAY['VIP'] <@ customer_record.tags) THEN
                    UPDATE customers 
                    SET tags = array_append(tags, 'VIP'),
                        updated_at = NOW()
                    WHERE id = NEW.customer_id;
                END IF;
            END IF;
            
            IF customer_record.total_visits + 1 >= 5 AND customer_record.total_visits + 1 < vip_visit_threshold THEN
                IF NOT (ARRAY['Regular'] <@ customer_record.tags) THEN
                    UPDATE customers 
                    SET tags = array_append(tags, 'Regular'),
                        updated_at = NOW()
                    WHERE id = NEW.customer_id;
                END IF;
            END IF;
            
        WHEN 'finished' THEN
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

DROP TRIGGER IF EXISTS reservation_status_change ON reservations;
CREATE TRIGGER reservation_status_change
    AFTER UPDATE OF status ON reservations
    FOR EACH ROW
    WHEN (OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION handle_reservation_status_change();

-- =============================================
-- 10. INDEXES FOR PERFORMANCE
-- =============================================
CREATE INDEX IF NOT EXISTS idx_table_service_status_restaurant ON table_service_status(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_table_service_status_table ON table_service_status(table_id);
CREATE INDEX IF NOT EXISTS idx_table_service_status_reservation ON table_service_status(reservation_id);
CREATE INDEX IF NOT EXISTS idx_table_service_status_status ON table_service_status(status);
CREATE INDEX IF NOT EXISTS idx_table_service_status_guest_lookup ON table_service_status(restaurant_id, status, reservation_id);
CREATE INDEX IF NOT EXISTS idx_reservations_upcoming_lookup ON reservations(restaurant_id, table_id, start_time, status) WHERE status IN ('booked', 'confirmed', 'seated');

-- =============================================
-- 11. INITIALIZE EXISTING TABLES
-- Run this to create status records for existing tables
-- =============================================
-- Uncomment and run for each restaurant:
-- SELECT initialize_table_status('your-restaurant-id');

-- =============================================
-- VERIFICATION QUERIES (run these to check status)
-- =============================================

-- Check table_service_status table
-- SELECT COUNT(*) as status_count FROM table_service_status;

-- Check triggers on reservations
-- SELECT trigger_name FROM information_schema.triggers WHERE event_object_table = 'reservations';

-- Check if is_walk_in column exists
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'reservations' AND column_name = 'is_walk_in';

-- Check functions exist
-- SELECT routine_name FROM information_schema.routines WHERE routine_schema = 'public' AND routine_name IN ('get_waiter_table_status', 'initialize_table_status', 'sync_seated_reservation_to_table');
