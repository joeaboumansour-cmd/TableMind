-- =============================================
-- MIGRATION: Add Visit Logs & Notes History
-- Safe to run on existing database
-- Only creates new tables, doesn't modify existing ones
-- =============================================

-- =============================================
-- 1. CUSTOMER VISIT LOGS (History Tracking)
-- =============================================
CREATE TABLE IF NOT EXISTS customer_visit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    reservation_id UUID REFERENCES reservations(id) ON DELETE SET NULL,
    
    -- Visit Details
    visit_date DATE NOT NULL,
    visit_type TEXT NOT NULL DEFAULT 'dine_in',
    party_size INTEGER,
    
    -- Outcome
    status TEXT NOT NULL DEFAULT 'completed',
    
    -- Financial/Order Info
    total_spend DECIMAL(10,2),
    items_ordered JSONB,
    
    -- Staff & Service
    server_name TEXT,
    table_id UUID REFERENCES tables(id),
    
    -- Feedback & Notes
    customer_notes TEXT,
    feedback_rating INTEGER CHECK (feedback_rating >= 1 AND feedback_rating <= 5),
    feedback_text TEXT,
    
    -- Metadata
    created_by UUID REFERENCES restaurant_users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_visit_logs_customer_id ON customer_visit_logs(customer_id);
CREATE INDEX IF NOT EXISTS idx_visit_logs_restaurant_id ON customer_visit_logs(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_visit_logs_visit_date ON customer_visit_logs(visit_date);
CREATE INDEX IF NOT EXISTS idx_visit_logs_status ON customer_visit_logs(status);

-- Enable RLS
ALTER TABLE customer_visit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant isolation for visit logs" ON customer_visit_logs;
CREATE POLICY "Tenant isolation for visit logs" ON customer_visit_logs
    FOR ALL
    TO authenticated
    USING (restaurant_id = current_setting('app.current_restaurant_id')::UUID)
    WITH CHECK (restaurant_id = current_setting('app.current_restaurant_id')::UUID);

-- Trigger to auto-update customer stats when visit log is created
CREATE OR REPLACE FUNCTION update_customer_stats_from_visit()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'completed' THEN
        UPDATE customers 
        SET total_visits = total_visits + 1,
            last_visit_date = NEW.visit_date,
            average_spend = (
                SELECT AVG(total_spend) 
                FROM customer_visit_logs 
                WHERE customer_id = NEW.customer_id 
                AND status = 'completed'
            )
        WHERE id = NEW.customer_id;
    ELSIF NEW.status = 'no_show' THEN
        UPDATE customers 
        SET no_show_count = no_show_count + 1
        WHERE id = NEW.customer_id;
    END IF;
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_customer_on_visit ON customer_visit_logs;
CREATE TRIGGER update_customer_on_visit
    AFTER INSERT OR UPDATE ON customer_visit_logs
    FOR EACH ROW
    EXECUTE FUNCTION update_customer_stats_from_visit();

-- =============================================
-- 2. RESERVATION NOTES HISTORY
-- =============================================
CREATE TABLE IF NOT EXISTS reservation_notes_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    
    note_text TEXT NOT NULL,
    note_type TEXT DEFAULT 'general',
    
    created_by UUID REFERENCES restaurant_users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notes_reservation_id ON reservation_notes_history(reservation_id);
CREATE INDEX IF NOT EXISTS idx_notes_restaurant_id ON reservation_notes_history(restaurant_id);

-- Enable RLS
ALTER TABLE reservation_notes_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant isolation for reservation notes" ON reservation_notes_history;
CREATE POLICY "Tenant isolation for reservation notes" ON reservation_notes_history
    FOR ALL
    TO authenticated
    USING (restaurant_id = current_setting('app.current_restaurant_id')::UUID)
    WITH CHECK (restaurant_id = current_setting('app.current_restaurant_id')::UUID);

-- =============================================
-- VERIFICATION
-- =============================================
SELECT 'Migration complete!' as status;
SELECT 
    'customer_visit_logs' as table_name, 
    COUNT(*) as row_count 
FROM customer_visit_logs
UNION ALL
SELECT 
    'reservation_notes_history', 
    COUNT(*) 
FROM reservation_notes_history;
