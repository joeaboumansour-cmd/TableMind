-- =============================================
-- ARCHITECTURAL IMPROVEMENTS MIGRATION
-- Implements feedback on schema optimization
-- =============================================

-- =============================================
-- 1. ENHANCE TABLES TABLE (Room/Section Support)
-- =============================================

-- Add room/section field to tables for floor plan organization
ALTER TABLE tables 
ADD COLUMN IF NOT EXISTS room_name TEXT,
ADD COLUMN IF NOT EXISTS section TEXT,
ADD COLUMN IF NOT EXISTS position_x DECIMAL(10,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS position_y DECIMAL(10,2) DEFAULT 0;

-- Add index for room-based queries
CREATE INDEX IF NOT EXISTS idx_tables_room_name ON tables(restaurant_id, room_name);
CREATE INDEX IF NOT EXISTS idx_tables_section ON tables(restaurant_id, section);

-- =============================================
-- 2. ALLERGIES MANAGEMENT (Structured Allergy Tracking)
-- =============================================

-- Create master allergies table (common allergens)
CREATE TABLE IF NOT EXISTS allergies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL UNIQUE,
    category TEXT, -- e.g., 'food', 'environmental', 'medical'
    severity_level TEXT CHECK (severity_level IN ('mild', 'moderate', 'severe', 'life_threatening')),
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create junction table for customer allergies
CREATE TABLE IF NOT EXISTS customer_allergies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    allergy_id UUID REFERENCES allergies(id) ON DELETE CASCADE,
    custom_allergy_name TEXT, -- For custom allergies not in master list
    severity TEXT CHECK (severity IN ('mild', 'moderate', 'severe', 'life_threatening')),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Either allergy_id or custom_allergy_name must be provided
    CONSTRAINT allergy_or_custom CHECK (
        (allergy_id IS NOT NULL) OR (custom_allergy_name IS NOT NULL)
    ),
    
    -- Unique constraint to prevent duplicates
    UNIQUE (customer_id, allergy_id, custom_allergy_name)
);

-- Add index for customer allergy lookups
CREATE INDEX IF NOT EXISTS idx_customer_allergies_customer_id ON customer_allergies(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_allergies_allergy_id ON customer_allergies(allergy_id);

-- Insert common food allergies
INSERT INTO allergies (name, category, severity_level, description) VALUES
    ('Peanuts', 'food', 'life_threatening', 'Peanut allergy - can cause severe anaphylaxis'),
    ('Tree Nuts', 'food', 'life_threatening', 'Tree nuts include almonds, walnuts, cashews, etc.'),
    ('Milk/Dairy', 'food', 'moderate', 'Lactose intolerance or milk protein allergy'),
    ('Eggs', 'food', 'moderate', 'Egg white or yolk allergy'),
    ('Wheat/Gluten', 'food', 'moderate', 'Celiac disease or gluten sensitivity'),
    ('Soy', 'food', 'mild', 'Soybean allergy'),
    ('Fish', 'food', 'severe', 'Finned fish allergy'),
    ('Shellfish', 'food', 'severe', 'Crustacean and mollusk allergy'),
    ('Sesame', 'food', 'moderate', 'Sesame seed allergy'),
    ('Mustard', 'food', 'mild', 'Mustard seed allergy'),
    ('Sulfites', 'food', 'moderate', 'Preservative sensitivity'),
    ('Nightshades', 'food', 'mild', 'Tomatoes, peppers, eggplant, potatoes')
ON CONFLICT (name) DO NOTHING;

-- Enable RLS on allergies table (read-only for all authenticated users)
ALTER TABLE allergies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read access to allergies" ON allergies;
CREATE POLICY "Allow read access to allergies" ON allergies
    FOR SELECT
    TO authenticated
    USING (true);

-- Enable RLS on customer_allergies with tenant isolation
ALTER TABLE customer_allergies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant isolation for customer allergies" ON customer_allergies;
CREATE POLICY "Tenant isolation for customer allergies" ON customer_allergies
    FOR ALL
    TO authenticated
    USING (
        customer_allergies.customer_id IN (
            SELECT customers.id FROM customers 
            WHERE customers.restaurant_id = current_setting('app.current_restaurant_id')::UUID
        )
    )
    WITH CHECK (
        customer_allergies.customer_id IN (
            SELECT customers.id FROM customers 
            WHERE customers.restaurant_id = current_setting('app.current_restaurant_id')::UUID
        )
    );

-- =============================================
-- 3. RESERVATION RELIABILITY TRACKING
-- =============================================

-- Add punctuality tracking to reservations
ALTER TABLE reservations 
ADD COLUMN IF NOT EXISTS minutes_early_late INTEGER, -- Positive = late, Negative = early
ADD COLUMN IF NOT EXISTS actual_seated_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS no_show BOOLEAN DEFAULT FALSE;

-- Add index for reliability analysis
CREATE INDEX IF NOT EXISTS idx_reservations_punctuality ON reservations(customer_id, minutes_early_late) 
WHERE minutes_early_late IS NOT NULL;

-- Function to calculate minutes early/late when guest is seated
CREATE OR REPLACE FUNCTION calculate_punctuality()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.actual_seated_at IS NOT NULL AND OLD.actual_seated_at IS NULL THEN
        -- Calculate minutes difference (positive = late, negative = early)
        NEW.minutes_early_late := EXTRACT(EPOCH FROM (NEW.actual_seated_at - NEW.start_time)) / 60;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-calculate punctuality
DROP TRIGGER IF EXISTS calculate_reservation_punctuality ON reservations;
CREATE TRIGGER calculate_reservation_punctuality
    BEFORE UPDATE ON reservations
    FOR EACH ROW
    WHEN (NEW.actual_seated_at IS DISTINCT FROM OLD.actual_seated_at)
    EXECUTE FUNCTION calculate_punctuality();

-- =============================================
-- 4. CUSTOMER RELIABILITY SCORE ENHANCEMENT
-- =============================================

-- Add punctuality stats to customers
ALTER TABLE customers 
ADD COLUMN IF NOT EXISTS avg_minutes_late DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS early_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS late_count INTEGER DEFAULT 0;

-- Function to update customer punctuality stats
CREATE OR REPLACE FUNCTION update_customer_punctuality_stats()
RETURNS TRIGGER AS $$
DECLARE
    avg_late DECIMAL(10,2);
    early_cnt INTEGER;
    late_cnt INTEGER;
BEGIN
    -- Only process if customer_id exists and minutes_early_late was just set
    IF NEW.customer_id IS NULL OR NEW.minutes_early_late IS NULL THEN
        RETURN NEW;
    END IF;
    
    IF OLD.minutes_early_late IS NULL AND NEW.minutes_early_late IS NOT NULL THEN
        -- Calculate stats from all completed reservations
        SELECT 
            AVG(minutes_early_late),
            COUNT(*) FILTER (WHERE minutes_early_late < 0),
            COUNT(*) FILTER (WHERE minutes_early_late > 5)
        INTO avg_late, early_cnt, late_cnt
        FROM reservations
        WHERE customer_id = NEW.customer_id
        AND minutes_early_late IS NOT NULL;
        
        UPDATE customers 
        SET avg_minutes_late = avg_late,
            early_count = early_cnt,
            late_count = late_cnt,
            updated_at = NOW()
        WHERE id = NEW.customer_id;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for punctuality stats
DROP TRIGGER IF EXISTS update_customer_punctuality ON reservations;
CREATE TRIGGER update_customer_punctuality
    AFTER UPDATE ON reservations
    FOR EACH ROW
    WHEN (NEW.minutes_early_late IS DISTINCT FROM OLD.minutes_early_late)
    EXECUTE FUNCTION update_customer_punctuality_stats();

-- =============================================
-- 5. ENHANCED CUSTOMER ANALYTICS VIEW
-- =============================================

-- Drop existing view and create enhanced version
DROP VIEW IF EXISTS customer_analytics;

CREATE OR REPLACE VIEW customer_analytics AS
SELECT 
    c.id,
    c.restaurant_id,
    c.name,
    c.phone,
    c.email,
    c.notes,
    c.dietary_restrictions,
    c.total_visits,
    COALESCE(c.no_show_count, 0) as no_show_count,
    COALESCE(c.cancellation_count, 0) as cancellation_count,
    c.last_visit_date,
    c.tags,
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
    END as risk_level,
    -- Punctuality metrics
    c.avg_minutes_late,
    c.early_count,
    c.late_count,
    -- Punctuality rating
    CASE 
        WHEN c.late_count IS NULL OR c.total_visits = 0 THEN 'Unknown'
        WHEN c.late_count::NUMERIC / NULLIF(c.total_visits, 0) > 0.3 THEN 'Often Late'
        WHEN c.late_count::NUMERIC / NULLIF(c.total_visits, 0) > 0.1 THEN 'Sometimes Late'
        ELSE 'Punctual'
    END as punctuality_rating,
    -- Allergies as array
    COALESCE(
        (SELECT array_agg(DISTINCT COALESCE(a.name, ca.custom_allergy_name))
         FROM customer_allergies ca
         LEFT JOIN allergies a ON ca.allergy_id = a.id
         WHERE ca.customer_id = c.id),
        ARRAY[]::text[]
    ) as allergies
FROM customers c;

-- =============================================
-- 6. FUNCTION: GET CUSTOMERS BY ALLERGY
-- =============================================

CREATE OR REPLACE FUNCTION get_customers_by_allergy(
    p_restaurant_id UUID,
    p_allergy_name TEXT
)
RETURNS TABLE (
    customer_id UUID,
    customer_name TEXT,
    phone TEXT,
    allergy_severity TEXT,
    notes TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        c.id,
        c.name,
        c.phone,
        ca.severity,
        ca.notes
    FROM customers c
    JOIN customer_allergies ca ON c.id = ca.customer_id
    LEFT JOIN allergies a ON ca.allergy_id = a.id
    WHERE c.restaurant_id = p_restaurant_id
    AND (
        a.name ILIKE '%' || p_allergy_name || '%'
        OR ca.custom_allergy_name ILIKE '%' || p_allergy_name || '%'
    )
    ORDER BY c.name;
END;
$$;

-- =============================================
-- 7. FUNCTION: ADD ALLERGY TO CUSTOMER
-- =============================================

CREATE OR REPLACE FUNCTION add_customer_allergy(
    p_customer_id UUID,
    p_allergy_name TEXT,
    p_severity TEXT DEFAULT 'moderate',
    p_notes TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_allergy_id UUID;
    v_result JSON;
BEGIN
    -- Try to find existing allergy
    SELECT id INTO v_allergy_id 
    FROM allergies 
    WHERE name ILIKE p_allergy_name;
    
    -- Insert the customer allergy
    INSERT INTO customer_allergies (customer_id, allergy_id, custom_allergy_name, severity, notes)
    VALUES (
        p_customer_id, 
        v_allergy_id, 
        CASE WHEN v_allergy_id IS NULL THEN p_allergy_name ELSE NULL END,
        p_severity,
        p_notes
    )
    ON CONFLICT (customer_id, allergy_id, custom_allergy_name) DO NOTHING;
    
    -- Also update the tags array for quick filtering
    UPDATE customers 
    SET tags = array_append(tags, 'Allergy: ' || p_allergy_name),
        updated_at = NOW()
    WHERE id = p_customer_id
    AND NOT (tags @> ARRAY['Allergy: ' || p_allergy_name]);
    
    v_result := json_build_object(
        'success', true,
        'customer_id', p_customer_id,
        'allergy', p_allergy_name,
        'severity', p_severity
    );
    
    RETURN v_result;
END;
$$;

-- =============================================
-- 8. ENHANCED RESERVATION VIEW
-- =============================================

CREATE OR REPLACE VIEW reservation_details AS
SELECT 
    r.id,
    r.restaurant_id,
    r.table_id,
    r.customer_id,
    r.customer_name,
    r.party_size,
    r.start_time,
    r.end_time,
    r.status,
    r.source,
    r.notes,
    r.seated_at,
    r.finished_at,
    r.created_by,
    r.created_at,
    r.updated_at,
    r.minutes_early_late,
    r.actual_seated_at,
    r.no_show,
    t.name as table_name,
    t.capacity as table_capacity,
    t.room_name,
    c.name as customer_full_name,
    c.phone as customer_phone,
    c.email as customer_email,
    c.tags as customer_tags,
    ca.allergies as customer_allergies,
    -- Calculated fields
    EXTRACT(EPOCH FROM (r.end_time - r.start_time)) / 60 as duration_minutes,
    CASE 
        WHEN r.minutes_early_late IS NULL THEN 'Not Seated'
        WHEN r.minutes_early_late < -5 THEN 'Early'
        WHEN r.minutes_early_late <= 5 THEN 'On Time'
        ELSE 'Late'
    END as punctuality_status
FROM reservations r
LEFT JOIN tables t ON r.table_id = t.id
LEFT JOIN customers c ON r.customer_id = c.id
LEFT JOIN customer_analytics ca ON c.id = ca.id;

-- =============================================
-- VERIFICATION QUERIES
-- =============================================

-- Check new columns in tables
SELECT 
    column_name, 
    data_type
FROM information_schema.columns 
WHERE table_name = 'tables' 
AND column_name IN ('room_name', 'section', 'position_x', 'position_y')
ORDER BY ordinal_position;

-- Check new columns in reservations
SELECT 
    column_name, 
    data_type
FROM information_schema.columns 
WHERE table_name = 'reservations' 
AND column_name IN ('minutes_early_late', 'actual_seated_at', 'no_show')
ORDER BY ordinal_position;

-- Check new columns in customers
SELECT 
    column_name, 
    data_type
FROM information_schema.columns 
WHERE table_name = 'customers' 
AND column_name IN ('avg_minutes_late', 'early_count', 'late_count')
ORDER BY ordinal_position;

-- Check allergies table
SELECT 
    'allergies' as table_name, 
    COUNT(*) as row_count 
FROM allergies
UNION ALL
SELECT 
    'customer_allergies', 
    COUNT(*) 
FROM customer_allergies;

-- Test the view
SELECT 
    'customer_analytics view' as check_name,
    COUNT(*) as customer_count
FROM customer_analytics
LIMIT 1;
