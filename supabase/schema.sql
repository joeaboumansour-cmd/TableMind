-- =============================================
-- TableMind Database Schema
-- Run this in the Supabase SQL Editor
-- =============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================
-- 1. RESTAURANTS TABLE
-- =============================================
CREATE TABLE restaurants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE restaurants ENABLE ROW LEVEL SECURITY;

-- Allow all operations for authenticated users (temporary policy)
CREATE POLICY "Allow all operations for authenticated users" ON restaurants
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- =============================================
-- 2. TABLES TABLE
-- =============================================
CREATE TYPE table_shape AS ENUM ('circle', 'rect');

CREATE TABLE tables (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    capacity INTEGER NOT NULL CHECK (capacity > 0),
    shape table_shape NOT NULL DEFAULT 'rect',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Ensure unique sort order per restaurant
    UNIQUE (restaurant_id, sort_order)
);

-- Enable RLS
ALTER TABLE tables ENABLE ROW LEVEL SECURITY;

-- Allow all operations for authenticated users
CREATE POLICY "Allow all operations for authenticated users" ON tables
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- =============================================
-- 3. CUSTOMERS TABLE
-- =============================================
CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    tags TEXT[] DEFAULT '{}',
    total_visits INTEGER NOT NULL DEFAULT 0 CHECK (total_visits >= 0),
    no_show_count INTEGER NOT NULL DEFAULT 0 CHECK (no_show_count >= 0),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX idx_customers_restaurant_id ON customers(restaurant_id);
CREATE INDEX idx_customers_phone ON customers(phone);
CREATE INDEX idx_customers_name ON customers(name);

-- Enable RLS
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

-- Allow all operations for authenticated users
CREATE POLICY "Allow all operations for authenticated users" ON customers
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- =============================================
-- 4. RESERVATIONS TABLE
-- =============================================
CREATE TYPE reservation_status AS ENUM ('booked', 'confirmed', 'seated', 'finished', 'cancelled');

CREATE TABLE reservations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    table_id UUID REFERENCES tables(id) ON DELETE SET NULL,
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    customer_name TEXT NOT NULL, -- Denormalized for quick display
    party_size INTEGER NOT NULL CHECK (party_size > 0),
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    status reservation_status NOT NULL DEFAULT 'booked',
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Ensure end_time is after start_time
    CONSTRAINT valid_time_range CHECK (end_time > start_time)
);

-- Indexes for common queries
CREATE INDEX idx_reservations_restaurant_id ON reservations(restaurant_id);
CREATE INDEX idx_reservations_customer_id ON reservations(customer_id);
CREATE INDEX idx_reservations_table_id ON reservations(table_id);
CREATE INDEX idx_reservations_start_time ON reservations(start_time);
CREATE INDEX idx_reservations_status ON reservations(status);

-- Enable RLS
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;

-- Allow all operations for authenticated users
CREATE POLICY "Allow all operations for authenticated users" ON reservations
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- =============================================
-- FUNCTIONS & TRIGGERS
-- =============================================

-- Function to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger for customers table
CREATE TRIGGER update_customers_updated_at
    BEFORE UPDATE ON customers
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Trigger for reservations table
CREATE TRIGGER update_reservations_updated_at
    BEFORE UPDATE ON reservations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- SAMPLE DATA (Optional - for testing)
-- =============================================

-- Insert a sample restaurant
INSERT INTO restaurants (name, timezone) VALUES 
    ('Demo Restaurant', 'America/New_York');

-- Insert sample tables (using a subquery to get the restaurant id)
WITH restaurant AS (SELECT id FROM restaurants LIMIT 1)
INSERT INTO tables (restaurant_id, name, capacity, shape, sort_order)
SELECT 
    restaurant.id,
    unnest(ARRAY['Table 1', 'Table 2', 'Table 3', 'Table 4', 'Table 5', 'Table 6']) as name,
    unnest(ARRAY[2, 4, 4, 6, 8, 2]) as capacity,
    unnest(ARRAY['rect'::table_shape, 'rect'::table_shape, 'circle'::table_shape, 'rect'::table_shape, 'rect'::table_shape, 'circle'::table_shape]) as shape,
    generate_series(1, 6) as sort_order
FROM restaurant;

-- Insert sample customers
WITH restaurant AS (SELECT id FROM restaurants LIMIT 1)
INSERT INTO customers (restaurant_id, name, phone, email, tags, total_visits)
VALUES 
    ((SELECT id FROM restaurant), 'John Smith', '555-0101', 'john@email.com', ARRAY['VIP'], 15),
    ((SELECT id FROM restaurant), 'Sarah Johnson', '555-0102', 'sarah@email.com', ARRAY['Regular'], 8),
    ((SELECT id FROM restaurant), 'Mike Brown', '555-0103', 'mike@email.com', ARRAY['Family'], 3),
    ((SELECT id FROM restaurant), 'Emily Davis', '555-0104', 'emily@email.com', ARRAY['Date Night'], 12);

-- =============================================
-- VERIFICATION QUERY (Run this to check setup)
-- =============================================

SELECT 
    'restaurants' as table_name, 
    COUNT(*) as row_count 
FROM restaurants
UNION ALL
SELECT 
    'tables', 
    COUNT(*) 
FROM tables
UNION ALL
SELECT 
    'customers', 
    COUNT(*) 
FROM customers
UNION ALL
SELECT 
    'reservations', 
    COUNT(*) 
FROM reservations;

