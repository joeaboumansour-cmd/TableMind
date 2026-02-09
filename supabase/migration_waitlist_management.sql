-- Migration: add_waitlist_management.sql
-- Run this in Supabase SQL Editor
-- Created: February 2026

-- =============================================
-- STEP 1: CREATE ENUMS
-- =============================================

-- Waitlist Status Enum
DO $$ BEGIN
    CREATE TYPE waitlist_status AS ENUM ('waiting', 'arrived', 'notified', 'seated', 'left', 'completed', 'cancelled');
EXCEPTION
    WHEN duplicate_object THEN 
        RAISE NOTICE 'waitlist_status enum already exists';
END $$;

-- Priority Level Enum
DO $$ BEGIN
    CREATE TYPE priority_level AS ENUM ('normal', 'vip', 'urgent');
EXCEPTION
    WHEN duplicate_object THEN 
        RAISE NOTICE 'priority_level enum already exists';
END $$;

-- SMS Status Enum
DO $$ BEGIN
    CREATE TYPE sms_status AS ENUM ('pending', 'sent', 'delivered', 'failed', 'undelivered');
EXCEPTION
    WHEN duplicate_object THEN 
        RAISE NOTICE 'sms_status enum already exists';
END $$;

-- =============================================
-- STEP 2: CREATE TABLES
-- =============================================

-- Waitlist Table
CREATE TABLE IF NOT EXISTS waitlist (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    customer_name TEXT NOT NULL,
    phone TEXT,
    party_size INTEGER NOT NULL CHECK (party_size > 0 AND party_size <= 20),
    notes TEXT,
    status waitlist_status NOT NULL DEFAULT 'waiting',
    priority priority_level NOT NULL DEFAULT 'normal',
    estimated_wait_minutes INTEGER,
    actual_wait_minutes INTEGER,
    position INTEGER NOT NULL,
    preferences TEXT[] DEFAULT '{}',
    sms_notifications_sent JSONB DEFAULT '[]'::jsonb,
    notified_at TIMESTAMPTZ,
    arrived_at TIMESTAMPTZ,
    seated_at TIMESTAMPTZ,
    left_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- SMS Notifications Table
CREATE TABLE IF NOT EXISTS sms_notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    waitlist_id UUID REFERENCES waitlist(id) ON DELETE SET NULL,
    reservation_id UUID REFERENCES reservations(id) ON DELETE SET NULL,
    customer_phone TEXT NOT NULL,
    message TEXT NOT NULL,
    notification_type TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'twilio',
    provider_message_id TEXT,
    status sms_status NOT NULL DEFAULT 'pending',
    error_message TEXT,
    sent_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Waitlist Settings Table
CREATE TABLE IF NOT EXISTS waitlist_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE UNIQUE,
    is_enabled BOOLEAN NOT NULL DEFAULT true,
    default_estimated_wait_minutes INTEGER NOT NULL DEFAULT 25,
    max_party_size INTEGER NOT NULL DEFAULT 12,
    max_waitlist_length INTEGER NOT NULL DEFAULT 50,
    auto_sms_notifications BOOLEAN NOT NULL DEFAULT true,
    notification_reminder_minutes INTEGER NOT NULL DEFAULT 10,
    table_ready_timeout_minutes INTEGER NOT NULL DEFAULT 10,
    average_turnover_minutes INTEGER NOT NULL DEFAULT 90,
    sms_template_added TEXT DEFAULT 'You''re #{position} on the waitlist. Est. wait: {estimated_wait} min.',
    sms_template_ready TEXT DEFAULT 'Your table is ready! Please check in with the host within {timeout} min.',
    sms_template_reminder TEXT DEFAULT 'Reminder: Your table will be ready soon!',
    sms_template_cancelled TEXT DEFAULT 'We couldn''t reach you. Your spot has been released.',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================
-- STEP 3: UPDATE EXISTING TABLES
-- =============================================

-- Add waitlist-related columns to tables table
ALTER TABLE tables ADD COLUMN IF NOT EXISTS is_window BOOLEAN DEFAULT false;
ALTER TABLE tables ADD COLUMN IF NOT EXISTS is_quiet_zone BOOLEAN DEFAULT false;
ALTER TABLE tables ADD COLUMN IF NOT EXISTS is_outdoor BOOLEAN DEFAULT false;
ALTER TABLE tables ADD COLUMN IF NOT EXISTS wait_priority INTEGER DEFAULT 50;

-- =============================================
-- STEP 4: CREATE INDEXES
-- =============================================

-- Waitlist indexes
CREATE INDEX IF NOT EXISTS idx_waitlist_restaurant_status 
    ON waitlist(restaurant_id, status);
CREATE INDEX IF NOT EXISTS idx_waitlist_created_at 
    ON waitlist(restaurant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_waitlist_phone 
    ON waitlist(phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_waitlist_position 
    ON waitlist(restaurant_id, position);

-- SMS notifications indexes
CREATE INDEX IF NOT EXISTS idx_sms_notifications_waitlist_id 
    ON sms_notifications(waitlist_id);
CREATE INDEX IF NOT EXISTS idx_sms_notifications_status 
    ON sms_notifications(status);
CREATE INDEX IF NOT EXISTS idx_sms_notifications_created_at 
    ON sms_notifications(created_at);

-- =============================================
-- STEP 5: ROW LEVEL SECURITY POLICIES
-- =============================================

ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE waitlist_settings ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated operations (customize based on your auth setup)
CREATE POLICY "Allow authenticated access to waitlist" ON waitlist
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Allow authenticated access to sms_notifications" ON sms_notifications
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Allow authenticated access to waitlist_settings" ON waitlist_settings
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- =============================================
-- STEP 6: HELPER FUNCTIONS
-- =============================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_waitlist_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger for updated_at
DROP TRIGGER IF EXISTS update_waitlist_updated_at ON waitlist;
CREATE TRIGGER update_waitlist_updated_at
    BEFORE UPDATE ON waitlist
    FOR EACH ROW
    EXECUTE FUNCTION update_waitlist_updated_at();

DROP TRIGGER IF EXISTS update_waitlist_settings_updated_at ON waitlist_settings;
CREATE TRIGGER update_waitlist_settings_updated_at
    BEFORE UPDATE ON waitlist_settings
    FOR EACH ROW
    EXECUTE FUNCTION update_waitlist_updated_at();

-- Function to recalculate waitlist positions
CREATE OR REPLACE FUNCTION recalculate_waitlist_positions(p_restaurant_id UUID)
RETURNS void AS $$
DECLARE
    v_waitlist RECORD;
    v_position INTEGER := 1;
BEGIN
    -- Loop through active waitlist entries and recalculate positions
    FOR v_waitlist IN 
        SELECT id FROM waitlist 
        WHERE restaurant_id = p_restaurant_id 
        AND status IN ('waiting', 'arrived', 'notified')
        ORDER BY 
            CASE priority 
                WHEN 'urgent' THEN 1 
                WHEN 'vip' THEN 2 
                ELSE 3 
            END,
            created_at ASC
    LOOP
        UPDATE waitlist SET position = v_position WHERE id = v_waitlist.id;
        v_position := v_position + 1;
    END LOOP;
END;
$$ language 'plpgsql';

-- Function to calculate estimated wait time
CREATE OR REPLACE FUNCTION calculate_estimated_wait(
    p_restaurant_id UUID,
    p_party_size INTEGER
) RETURNS INTEGER AS $$
DECLARE
    v_avg_turnover INTEGER;
    v_wait_ahead INTEGER;
    v_suitable_tables INTEGER;
BEGIN
    -- Get average turnover time from settings
    SELECT COALESCE(average_turnover_minutes, 90) 
    INTO v_avg_turnover 
    FROM waitlist_settings 
    WHERE restaurant_id = p_restaurant_id;

    -- Count parties ahead in waitlist
    SELECT COUNT(*) INTO v_wait_ahead
    FROM waitlist
    WHERE restaurant_id = p_restaurant_id
    AND status IN ('waiting', 'arrived')
    AND party_size <= p_party_size;

    -- Count suitable tables available
    SELECT COUNT(*) INTO v_suitable_tables
    FROM tables
    WHERE restaurant_id = p_restaurant_id
    AND capacity >= p_party_size
    AND is_blocked = false;

    -- Calculate wait time
    IF v_suitable_tables > 0 THEN
        RETURN v_wait_ahead * v_avg_turnover * 0.7;
    ELSE
        RETURN v_wait_ahead * v_avg_turnover * 1.3;
    END IF;
END;
$$ language 'plpgsql';

-- Function to trigger position recalculation on status/priority change
CREATE OR REPLACE FUNCTION trigger_recalculate_waitlist_positions()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status != OLD.status OR 
       NEW.priority != OLD.priority OR
       NEW.position != OLD.position THEN
        PERFORM recalculate_waitlist_positions(COALESCE(
            NEW.restaurant_id, 
            OLD.restaurant_id
        ));
    END IF;
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS trigger_waitlist_position_update ON waitlist;
CREATE TRIGGER trigger_waitlist_position_update
    AFTER UPDATE ON waitlist
    FOR EACH ROW
    EXECUTE FUNCTION trigger_recalculate_waitlist_positions();

-- =============================================
-- STEP 7: INSERT DEFAULT SETTINGS
-- =============================================

-- Insert default settings for existing restaurants (if not exists)
INSERT INTO waitlist_settings (restaurant_id)
SELECT id FROM restaurants
ON CONFLICT (restaurant_id) DO NOTHING;

-- =============================================
-- VERIFICATION QUERY
-- =============================================
-- Run this to verify the migration:
-- SELECT 'waitlist' as table_name, COUNT(*) as row_count FROM waitlist
-- UNION ALL
-- SELECT 'sms_notifications', COUNT(*) FROM sms_notifications
-- UNION ALL
-- SELECT 'waitlist_settings', COUNT(*) FROM waitlist_settings;

-- =============================================
-- ROLLBACK SCRIPT (if needed)
-- =============================================
/*
DROP TRIGGER IF EXISTS trigger_waitlist_position_update ON waitlist;
DROP TRIGGER IF EXISTS update_waitlist_settings_updated_at ON waitlist_settings;
DROP TRIGGER IF EXISTS update_waitlist_updated_at ON waitlist;
DROP FUNCTION IF EXISTS trigger_recalculate_waitlist_positions();
DROP FUNCTION IF EXISTS calculate_estimated_wait(UUID, INTEGER);
DROP FUNCTION IF EXISTS recalculate_waitlist_positions(UUID);
DROP FUNCTION IF EXISTS update_waitlist_updated_at();
DROP TABLE IF EXISTS waitlist_settings;
DROP TABLE IF EXISTS sms_notifications;
DROP TABLE IF EXISTS waitlist;
DROP TYPE IF EXISTS sms_status;
DROP TYPE IF EXISTS priority_level;
DROP TYPE IF EXISTS waitlist_status;
*/
