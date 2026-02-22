-- =============================================
-- WAITER VIEW ENHANCEMENTS
-- Guest source indicator + Reservation sync
-- =============================================

-- =============================================
-- VIEW: TABLE STATUS WITH DETAILS (ENHANCED)
-- Adds guest_source to distinguish reservation vs walk-in
-- =============================================

DROP VIEW IF EXISTS table_status_with_details;

CREATE OR REPLACE VIEW table_status_with_details AS
SELECT 
    tss.id,
    tss.restaurant_id,
    tss.table_id,
    t.name as table_name,
    t.capacity as table_capacity,
    t.room_name,
    t.section,
    tss.reservation_id,
    tss.status,
    tss.current_customer_name,
    tss.current_customer_id,
    tss.current_party_size,
    tss.seated_at,
    tss.order_taken_at,
    tss.food_served_at,
    tss.check_requested_at,
    tss.cleared_at,
    tss.estimated_turnover_minutes,
    tss.actual_duration_minutes,
    tss.server_id,
    tss.server_name,
    tss.session_notes,
    tss.created_at,
    tss.updated_at,
    -- Guest source indicator: reservation vs walk-in vs empty
    CASE 
        WHEN tss.status = 'empty' THEN 'empty'
        WHEN r.is_walk_in = true THEN 'walk-in'
        WHEN r.id IS NOT NULL THEN 'reservation'
        ELSE 'unknown'
    END as guest_source,
    -- Calculated fields
    CASE 
        WHEN tss.status = 'empty' THEN 'available'
        WHEN tss.status IN ('ready_to_clear') THEN 'finishing'
        ELSE 'occupied'
    END as availability_status,
    CASE 
        WHEN tss.seated_at IS NOT NULL 
        THEN EXTRACT(EPOCH FROM (NOW() - tss.seated_at)) / 60
        ELSE NULL
    END::INTEGER as minutes_seated,
    -- Color coding for UI
    CASE tss.status
        WHEN 'empty' THEN 'gray'
        WHEN 'seated' THEN 'blue'
        WHEN 'order_taken' THEN 'amber'
        WHEN 'appetizer_served' THEN 'orange'
        WHEN 'main_served' THEN 'emerald'
        WHEN 'dessert_served' THEN 'pink'
        WHEN 'check_requested' THEN 'violet'
        WHEN 'ready_to_clear' THEN 'slate'
    END as status_color
FROM table_service_status tss
JOIN tables t ON t.id = tss.table_id
LEFT JOIN reservations r ON r.id = tss.reservation_id;

-- =============================================
-- TRIGGER: Sync seated reservations to table status
-- When host marks reservation as seated, update waiter view
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
-- INDEX: Optimize guest source lookups
-- =============================================

CREATE INDEX IF NOT EXISTS idx_table_service_status_guest_lookup 
ON table_service_status(restaurant_id, status, reservation_id);

-- =============================================
-- COMMENTS
-- =============================================

COMMENT ON VIEW table_status_with_details IS 'Enhanced view showing table status with guest source (reservation/walk-in) for waiter interface';
COMMENT ON FUNCTION sync_seated_reservation_to_table() IS 'Syncs reservation seating to table_service_status so waiter view updates when host seats a guest';

-- =============================================
-- VIEW: UPCOMING RESERVATIONS BY TABLE
-- Shows reservations for next 4 hours to alert waiters
-- =============================================

CREATE OR REPLACE VIEW upcoming_table_reservations AS
SELECT 
    r.id as reservation_id,
    r.restaurant_id,
    r.table_id,
    t.name as table_name,
    r.customer_id,
    r.customer_name,
    r.customer_phone,
    r.party_size,
    r.start_time,
    r.end_time,
    r.status as reservation_status,
    r.notes,
    r.is_walk_in,
    -- Calculate time until reservation
    EXTRACT(EPOCH FROM (r.start_time - NOW())) / 60 as minutes_until,
    -- Categorize urgency
    CASE 
        WHEN r.start_time < NOW() THEN 'overdue'
        WHEN r.start_time <= NOW() + INTERVAL '30 minutes' THEN 'arriving_soon'
        WHEN r.start_time <= NOW() + INTERVAL '2 hours' THEN 'upcoming'
        ELSE 'later'
    END as urgency,
    -- Check if table is currently occupied
    tss.status as current_table_status,
    tss.current_customer_name as seated_customer,
    -- Is this reservation currently active (seated)?
    CASE 
        WHEN r.status = 'seated' THEN true
        ELSE false
    END as is_active
FROM reservations r
JOIN tables t ON t.id = r.table_id
LEFT JOIN table_service_status tss ON tss.table_id = r.table_id
WHERE r.status IN ('booked', 'confirmed', 'seated')
    AND r.start_time >= NOW() - INTERVAL '1 hour'  -- Show recent past
    AND r.start_time <= NOW() + INTERVAL '4 hours'  -- Show next 4 hours
ORDER BY r.start_time ASC;

-- =============================================
-- FUNCTION: Get table status with upcoming reservations
-- For waiter view API - combines current status with upcoming bookings
-- =============================================

-- Drop function first to ensure clean recreation
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
-- INDEX: Optimize upcoming reservation queries
-- =============================================

CREATE INDEX IF NOT EXISTS idx_reservations_upcoming_lookup 
ON reservations(restaurant_id, table_id, start_time, status)
WHERE status IN ('booked', 'confirmed', 'seated');

COMMENT ON VIEW upcoming_table_reservations IS 'Shows upcoming reservations for next 4 hours per table for waiter awareness';
COMMENT ON FUNCTION get_waiter_table_status(UUID) IS 'Returns table status combined with upcoming reservation info for waiter view';
