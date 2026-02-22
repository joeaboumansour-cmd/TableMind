-- ============================================
-- Live Spend Tracking & RevPASH Migration
-- ============================================

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- 1. Live Spend Tracking Table
-- Tracks real-time guest spending per table/session
-- ============================================
CREATE TABLE IF NOT EXISTS live_spend_tracking (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    reservation_id UUID REFERENCES reservations(id) ON DELETE SET NULL,
    table_id UUID REFERENCES tables(id) ON DELETE SET NULL,
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    
    -- Session timing
    session_started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    session_ended_at TIMESTAMP WITH TIME ZONE,
    
    -- Spend tracking (updated in real-time)
    current_spend DECIMAL(10, 2) DEFAULT 0.00,
    spend_updates JSONB DEFAULT '[]', -- Array of {timestamp, amount, items}
    
    -- Order details
    items_ordered JSONB DEFAULT '[]', -- Array of {name, quantity, price, category}
    
    -- RevPASH calculation (updated via trigger)
    seat_count INTEGER DEFAULT 1,
    revpash DECIMAL(10, 2) DEFAULT 0.00,
    
    -- Session status
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'paused', 'closed', 'cancelled')),
    
    -- Staff tracking
    server_id UUID REFERENCES restaurant_users(id) ON DELETE SET NULL,
    server_name VARCHAR(100),
    
    -- Notes
    session_notes TEXT,
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES restaurant_users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES restaurant_users(id) ON DELETE SET NULL
);

-- Indexes for performance
CREATE INDEX idx_live_spend_restaurant ON live_spend_tracking(restaurant_id);
CREATE INDEX idx_live_spend_reservation ON live_spend_tracking(reservation_id);
CREATE INDEX idx_live_spend_table ON live_spend_tracking(table_id);
CREATE INDEX idx_live_spend_status ON live_spend_tracking(status);
CREATE INDEX idx_live_spend_session ON live_spend_tracking(session_started_at);

-- ============================================
-- 2. Table Performance Analytics Table
-- Aggregated metrics for table optimization
-- ============================================
CREATE TABLE IF NOT EXISTS table_performance_analytics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    table_id UUID NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
    
    -- Date period (daily aggregation)
    date DATE NOT NULL,
    
    -- Session metrics
    total_sessions INTEGER DEFAULT 0,
    total_guests INTEGER DEFAULT 0,
    
    -- Financial metrics
    total_revenue DECIMAL(10, 2) DEFAULT 0.00,
    avg_spend_per_session DECIMAL(10, 2) DEFAULT 0.00,
    avg_spend_per_guest DECIMAL(10, 2) DEFAULT 0.00,
    
    -- Time metrics
    avg_session_duration_minutes INTEGER DEFAULT 0,
    total_seat_hours DECIMAL(8, 2) DEFAULT 0.00,
    
    -- RevPASH
    avg_revpash DECIMAL(10, 2) DEFAULT 0.00,
    peak_revpash DECIMAL(10, 2) DEFAULT 0.00,
    
    -- Efficiency metrics
    utilization_percentage DECIMAL(5, 2) DEFAULT 0.00,
    turnover_rate DECIMAL(5, 2) DEFAULT 0.00,
    
    -- Comparison to other tables
    performance_rank INTEGER,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(restaurant_id, table_id, date)
);

CREATE INDEX idx_table_perf_restaurant ON table_performance_analytics(restaurant_id);
CREATE INDEX idx_table_perf_table ON table_performance_analytics(table_id);
CREATE INDEX idx_table_perf_date ON table_performance_analytics(date);

-- ============================================
-- 3. Revenue Alerts Configuration
-- Configure alerts for managers
-- ============================================
CREATE TABLE IF NOT EXISTS revenue_alert_configs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    
    -- Alert conditions
    alert_type VARCHAR(50) NOT NULL CHECK (alert_type IN (
        'low_revpash',
        'high_spend',
        'session_timeout',
        'table_idle',
        'daily_target_missed'
    )),
    
    -- Threshold values
    threshold_value DECIMAL(10, 2),
    comparison_operator VARCHAR(10) CHECK (comparison_operator IN ('>', '<', '>=', '<=', '=')),
    
    -- Notification settings
    notify_roles VARCHAR(20)[] DEFAULT ARRAY['manager'],
    notification_channels VARCHAR(20)[] DEFAULT ARRAY['in_app'],
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(restaurant_id, alert_type)
);

CREATE INDEX idx_revenue_alerts_restaurant ON revenue_alert_configs(restaurant_id);

-- ============================================
-- 4. Functions for RevPASH Calculation
-- ============================================

-- Function to calculate real-time RevPASH for a session
CREATE OR REPLACE FUNCTION calculate_revpash(
    p_spend DECIMAL,
    p_seats INTEGER,
    p_start_time TIMESTAMP WITH TIME ZONE,
    p_end_time TIMESTAMP WITH TIME ZONE DEFAULT NULL
)
RETURNS DECIMAL AS $$
DECLARE
    hours DECIMAL;
BEGIN
    hours := GREATEST(EXTRACT(EPOCH FROM (COALESCE(p_end_time, NOW()) - p_start_time)) / 3600, 0.25);
    RETURN ROUND(p_spend / (p_seats * hours), 2);
END;
$$ LANGUAGE plpgsql;

-- Function to update revpash on live_spend_tracking
CREATE OR REPLACE FUNCTION update_revpash()
RETURNS TRIGGER AS $$
DECLARE
    hours DECIMAL;
BEGIN
    hours := GREATEST(EXTRACT(EPOCH FROM (COALESCE(NEW.session_ended_at, NOW()) - NEW.session_started_at)) / 3600, 0.25);
    NEW.revpash := ROUND(NEW.current_spend / (NEW.seat_count * hours), 2);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-calculate revpash before insert/update
CREATE TRIGGER trigger_calculate_revpash
    BEFORE INSERT OR UPDATE ON live_spend_tracking
    FOR EACH ROW
    EXECUTE FUNCTION update_revpash();

-- Function to get current RevPASH for a restaurant
CREATE OR REPLACE FUNCTION get_current_revpash(p_restaurant_id UUID)
RETURNS TABLE (
    table_id UUID,
    table_name VARCHAR,
    current_spend DECIMAL,
    revpash DECIMAL,
    session_duration_minutes INTEGER,
    status VARCHAR
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        lst.table_id,
        t.name as table_name,
        lst.current_spend,
        lst.revpash,
        EXTRACT(EPOCH FROM (NOW() - lst.session_started_at)) / 60::INTEGER as session_duration_minutes,
        lst.status
    FROM live_spend_tracking lst
    JOIN tables t ON t.id = lst.table_id
    WHERE lst.restaurant_id = p_restaurant_id
    AND lst.status = 'active'
    ORDER BY lst.revpash DESC;
END;
$$ LANGUAGE plpgsql;

-- Function to update table performance analytics
CREATE OR REPLACE FUNCTION update_table_performance_analytics()
RETURNS TRIGGER AS $$
BEGIN
    -- Insert or update daily analytics for the table
    INSERT INTO table_performance_analytics (
        restaurant_id, table_id, date,
        total_sessions, total_guests, total_revenue,
        avg_session_duration_minutes, avg_revpash
    )
    SELECT 
        NEW.restaurant_id,
        NEW.table_id,
        CURRENT_DATE,
        COUNT(*),
        SUM(NEW.seat_count),
        SUM(NEW.current_spend),
        AVG(EXTRACT(EPOCH FROM (COALESCE(NEW.session_ended_at, NOW()) - NEW.session_started_at)) / 60),
        AVG(NEW.revpash)
    FROM live_spend_tracking
    WHERE restaurant_id = NEW.restaurant_id
    AND table_id = NEW.table_id
    AND DATE(session_started_at) = CURRENT_DATE
    ON CONFLICT (restaurant_id, table_id, date)
    DO UPDATE SET
        total_sessions = EXCLUDED.total_sessions,
        total_guests = EXCLUDED.total_guests,
        total_revenue = EXCLUDED.total_revenue,
        avg_session_duration_minutes = EXCLUDED.avg_session_duration_minutes,
        avg_revpash = EXCLUDED.avg_revpash,
        avg_spend_per_session = EXCLUDED.total_revenue / NULLIF(EXCLUDED.total_sessions, 0),
        avg_spend_per_guest = EXCLUDED.total_revenue / NULLIF(EXCLUDED.total_guests, 0),
        updated_at = NOW();
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update analytics
CREATE TRIGGER trigger_update_table_performance
    AFTER INSERT OR UPDATE ON live_spend_tracking
    FOR EACH ROW
    EXECUTE FUNCTION update_table_performance_analytics();

-- ============================================
-- 5. RLS Policies
-- ============================================

ALTER TABLE live_spend_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE table_performance_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE revenue_alert_configs ENABLE ROW LEVEL SECURITY;

-- Live spend tracking policies
CREATE POLICY live_spend_tenant_isolation ON live_spend_tracking
    FOR ALL USING (restaurant_id IN (
        SELECT restaurant_id FROM restaurant_users WHERE id = auth.uid()
    ));

-- Table performance analytics policies
CREATE POLICY table_perf_tenant_isolation ON table_performance_analytics
    FOR ALL USING (restaurant_id IN (
        SELECT restaurant_id FROM restaurant_users WHERE id = auth.uid()
    ));

-- Revenue alert config policies
CREATE POLICY revenue_alerts_tenant_isolation ON revenue_alert_configs
    FOR ALL USING (restaurant_id IN (
        SELECT restaurant_id FROM restaurant_users WHERE id = auth.uid()
    ));

-- ============================================
-- 6. Seed default alert configurations
-- ============================================

-- This would be inserted per restaurant during onboarding
-- Example default configs:
-- Low RevPASH alert: < $15 per hour per seat
-- High spend alert: > $500 per table
-- Session timeout: > 3 hours

-- ============================================
-- 7. Update existing reservations table
-- Add spend tracking reference
-- ============================================
ALTER TABLE reservations 
ADD COLUMN IF NOT EXISTS live_spend_id UUID REFERENCES live_spend_tracking(id) ON DELETE SET NULL;

ALTER TABLE reservations
ADD COLUMN IF NOT EXISTS final_spend DECIMAL(10, 2);

ALTER TABLE reservations
ADD COLUMN IF NOT EXISTS revpash DECIMAL(10, 2);

-- ============================================
-- 8. Views for Easy Reporting
-- ============================================

-- Current floor status with spend
CREATE OR REPLACE VIEW current_floor_status AS
SELECT 
    t.id as table_id,
    t.name as table_name,
    t.capacity,
    t.room_name,
    t.section,
    lst.id as session_id,
    lst.status as session_status,
    lst.current_spend,
    lst.revpash,
    lst.seat_count,
    lst.session_started_at,
    EXTRACT(EPOCH FROM (NOW() - lst.session_started_at)) / 60::INTEGER as minutes_active,
    r.id as reservation_id,
    r.customer_name,
    r.party_size,
    r.status as reservation_status,
    lst.server_name
FROM tables t
LEFT JOIN live_spend_tracking lst ON lst.table_id = t.id AND lst.status = 'active'
LEFT JOIN reservations r ON r.id = lst.reservation_id
WHERE t.is_active = true;

-- Daily RevPASH summary
CREATE OR REPLACE VIEW daily_revpash_summary AS
SELECT 
    restaurant_id,
    DATE(session_started_at) as date,
    COUNT(*) as total_sessions,
    SUM(current_spend) as total_revenue,
    AVG(revpash) as avg_revpash,
    MAX(revpash) as max_revpash,
    SUM(seat_count) as total_guests,
    AVG(EXTRACT(EPOCH FROM (COALESCE(session_ended_at, NOW()) - session_started_at)) / 60) as avg_duration_minutes
FROM live_spend_tracking
WHERE status != 'cancelled'
GROUP BY restaurant_id, DATE(session_started_at)
ORDER BY date DESC;

-- Add comments for documentation
COMMENT ON TABLE live_spend_tracking IS 'Real-time guest spend tracking per table/session for RevPASH calculation';
COMMENT ON TABLE table_performance_analytics IS 'Daily aggregated table performance metrics including RevPASH';
COMMENT ON TABLE revenue_alert_configs IS 'Configuration for revenue-related alerts and notifications';
COMMENT ON COLUMN live_spend_tracking.revpash IS 'Revenue per Available Seat Hour - calculated automatically';
