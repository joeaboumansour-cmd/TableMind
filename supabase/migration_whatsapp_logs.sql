-- =============================================
-- WhatsApp Integration Migration
-- Adds table for logging WhatsApp messages
-- =============================================

-- Create WhatsApp logs table
CREATE TABLE IF NOT EXISTS whatsapp_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    phone_number TEXT NOT NULL,
    message TEXT NOT NULL,
    template_name TEXT,
    status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'delivered', 'read', 'failed')),
    provider_message_id TEXT,
    error_message TEXT,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    delivered_at TIMESTAMPTZ,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE whatsapp_logs ENABLE ROW LEVEL SECURITY;

-- Policy: Allow all operations for authenticated users
CREATE POLICY "Allow all operations for authenticated users" ON whatsapp_logs
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_restaurant_id ON whatsapp_logs(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_customer_id ON whatsapp_logs(customer_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_sent_at ON whatsapp_logs(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_status ON whatsapp_logs(status);
CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_phone_number ON whatsapp_logs(phone_number);

-- Add columns to customers table for extended profiles
ALTER TABLE customers 
    ADD COLUMN IF NOT EXISTS birthday DATE,
    ADD COLUMN IF NOT EXISTS anniversary DATE,
    ADD COLUMN IF NOT EXISTS food_preferences TEXT[] DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS dietary_restrictions TEXT[] DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS spending_tier TEXT CHECK (spending_tier IN ('low', 'medium', 'high', 'vip')),
    ADD COLUMN IF NOT EXISTS preferred_table TEXT,
    ADD COLUMN IF NOT EXISTS first_visit_date DATE,
    ADD COLUMN IF NOT EXISTS average_party_size INTEGER DEFAULT 2;

-- Create customer segments table for advanced filtering
CREATE TABLE IF NOT EXISTS customer_segments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    filters JSONB NOT NULL DEFAULT '{}',
    is_default BOOLEAN NOT NULL DEFAULT false,
    customer_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE customer_segments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations for authenticated users" ON customer_segments
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_customer_segments_restaurant_id ON customer_segments(restaurant_id);

-- Insert default customer segments
INSERT INTO customer_segments (restaurant_id, name, description, filters, is_default)
SELECT 
    r.id,
    segment.name,
    segment.description,
    segment.filters,
    true
FROM restaurants r
CROSS JOIN (
    VALUES 
        ('VIP Customers', 'High-value customers with VIP tag', '{"tags": {"contains": "VIP"}}'::jsonb),
        ('Regulars', 'Customers with 5+ visits', '{"min_visits": 5}'::jsonb),
        ('At Risk', 'Customers who haven''t visited in 90 days', '{"last_visit_before_days": 90}'::jsonb),
        ('First Timers', 'Customers with only 1 visit', '{"max_visits": 1}'::jsonb),
        ('Birthday This Month', 'Customers with birthdays this month', '{"birthday_month": "current"}'::jsonb),
        ('Reliable', 'Customers with 90%+ reliability score', '{"min_reliability": 90}'::jsonb)
) AS segment(name, description, filters)
WHERE NOT EXISTS (
    SELECT 1 FROM customer_segments cs WHERE cs.restaurant_id = r.id AND cs.is_default = true
);

-- Create function to update customer segments count
CREATE OR REPLACE FUNCTION update_customer_segment_counts()
RETURNS TRIGGER AS $$
BEGIN
    -- Update count for all segments of the restaurant
    UPDATE customer_segments 
    SET customer_count = (
        SELECT COUNT(*) 
        FROM customers 
        WHERE customers.restaurant_id = customer_segments.restaurant_id
    ),
    updated_at = NOW()
    WHERE restaurant_id = COALESCE(NEW.restaurant_id, OLD.restaurant_id);
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Create trigger to update segment counts
DROP TRIGGER IF EXISTS update_segment_counts_on_customer_change ON customers;
CREATE TRIGGER update_segment_counts_on_customer_change
    AFTER INSERT OR UPDATE OR DELETE ON customers
    FOR EACH ROW
    EXECUTE FUNCTION update_customer_segment_counts();

-- Add table handoff notes table
CREATE TABLE IF NOT EXISTS table_handoff_notes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    table_id UUID REFERENCES tables(id) ON DELETE CASCADE,
    reservation_id UUID REFERENCES reservations(id) ON DELETE SET NULL,
    note TEXT NOT NULL,
    priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    created_by TEXT,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE table_handoff_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations for authenticated users" ON table_handoff_notes
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_handoff_notes_restaurant_id ON table_handoff_notes(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_handoff_notes_table_id ON table_handoff_notes(table_id);
CREATE INDEX IF NOT EXISTS idx_handoff_notes_reservation_id ON table_handoff_notes(reservation_id);
CREATE INDEX IF NOT EXISTS idx_handoff_notes_priority ON table_handoff_notes(priority) WHERE resolved_at IS NULL;

-- Update trigger for handoff notes
CREATE TRIGGER update_handoff_notes_updated_at
    BEFORE UPDATE ON table_handoff_notes
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Create view for customer analytics with extended fields
CREATE OR REPLACE VIEW customer_analytics_extended AS
SELECT 
    c.*,
    r.name as restaurant_name,
    CASE 
        WHEN c.total_visits = 0 THEN 100
        ELSE ROUND((c.total_visits::numeric / NULLIF(c.total_visits + c.no_show_count + c.cancellation_count, 0)) * 100)
    END as reliability_score,
    CASE 
        WHEN c.total_visits >= 10 AND c.no_show_count = 0 THEN 'VIP'
        WHEN c.total_visits >= 5 THEN 'Regular'
        WHEN c.total_visits >= 2 THEN 'Returning'
        ELSE 'New'
    END as customer_type,
    CASE 
        WHEN c.last_visit_date < NOW() - INTERVAL '90 days' THEN 'At Risk'
        WHEN c.last_visit_date < NOW() - INTERVAL '60 days' THEN 'Dormant'
        WHEN c.total_visits >= 5 THEN 'Active'
        ELSE 'New'
    END as engagement_status,
    EXTRACT(YEAR FROM AGE(NOW(), c.first_visit_date)) as customer_years,
    CASE 
        WHEN c.birthday IS NOT NULL THEN 
            CASE 
                WHEN EXTRACT(MONTH FROM c.birthday) = EXTRACT(MONTH FROM NOW()) THEN true
                ELSE false
            END
        ELSE false
    END as birthday_this_month
FROM customers c
JOIN restaurants r ON c.restaurant_id = r.id;

-- Grant access to the view
GRANT SELECT ON customer_analytics_extended TO authenticated;
