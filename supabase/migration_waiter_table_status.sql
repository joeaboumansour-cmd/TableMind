-- =============================================
-- WAITER TABLE SERVICE STATUS & WALK-IN SUPPORT
-- =============================================

-- Table to track real-time service status for each table
CREATE TABLE IF NOT EXISTS table_service_status (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    table_id UUID NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
    reservation_id UUID REFERENCES reservations(id) ON DELETE SET NULL,
    
    -- Current service state
    status VARCHAR(50) NOT NULL DEFAULT 'empty', -- empty, seated, order_taken, appetizer_served, main_served, dessert_served, check_requested, ready_to_clear
    
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
    
    -- Created/updated
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Unique constraint: one status record per table
    UNIQUE(restaurant_id, table_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_table_service_status_restaurant ON table_service_status(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_table_service_status_table ON table_service_status(table_id);
CREATE INDEX IF NOT EXISTS idx_table_service_status_reservation ON table_service_status(reservation_id);
CREATE INDEX IF NOT EXISTS idx_table_service_status_status ON table_service_status(status);

-- Trigger to update updated_at
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
-- VISIT LOGS ENHANCEMENT (for waiter feedback)
-- =============================================

-- Ensure visit logs table exists with all needed fields
ALTER TABLE customer_visit_logs 
ADD COLUMN IF NOT EXISTS waiter_id UUID REFERENCES restaurant_users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS waiter_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS service_status VARCHAR(50), -- track what status the table was in
ADD COLUMN IF NOT EXISTS table_turn_time_minutes INTEGER;

-- =============================================
-- VIEW: TABLE STATUS WITH DETAILS
-- =============================================

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
JOIN tables t ON t.id = tss.table_id;

-- =============================================
-- FUNCTION: INITIALIZE TABLE STATUS
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
-- FUNCTION: UPDATE RESERVATION STATUS FROM TABLE
-- When table status changes, update linked reservation
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
-- FUNCTION: AUTO-CREATE TABLE STATUS ON NEW TABLE
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
-- RLS POLICIES
-- =============================================

ALTER TABLE table_service_status ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users full access (matching existing patterns)
CREATE POLICY "Allow all operations for authenticated users" 
ON table_service_status FOR ALL TO authenticated 
USING (true) WITH CHECK (true);

-- =============================================
-- INITIALIZE EXISTING TABLES
-- =============================================

-- Run this to create status records for existing tables
-- SELECT initialize_table_status('your-restaurant-id');

COMMENT ON TABLE table_service_status IS 'Real-time service status tracking for restaurant tables, supporting both reservations and walk-ins';
