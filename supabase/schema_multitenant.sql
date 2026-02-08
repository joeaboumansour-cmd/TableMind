-- =============================================
-- TableMind Multi-Tenant SaaS Database Schema
-- Each restaurant is a separate tenant with isolated data
-- =============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================
-- 1. RESTAURANTS TABLE (Tenant Root)
-- =============================================
CREATE TABLE restaurants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL, -- Unique subdomain/identifier
    email TEXT UNIQUE NOT NULL, -- Owner email
    phone TEXT,
    address TEXT,
    timezone TEXT NOT NULL DEFAULT 'America/New_York',
    settings JSONB DEFAULT '{
        "opening_time": "11:00",
        "closing_time": "23:00",
        "slot_duration_minutes": 15,
        "default_reservation_duration": 90,
        "max_party_size": 20
    }'::jsonb,
    subscription_status TEXT DEFAULT 'trial', -- trial, active, cancelled, suspended
    subscription_tier TEXT DEFAULT 'starter', -- starter, pro, enterprise
    trial_ends_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    owner_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Enable RLS
ALTER TABLE restaurants ENABLE ROW LEVEL SECURITY;

-- Policies: Users can see restaurants they own or are staff of
CREATE POLICY "Users can view own restaurants" ON restaurants
    FOR SELECT
    TO authenticated
    USING (
        owner_user_id = auth.uid() OR
        EXISTS (
            SELECT 1 FROM restaurant_staff 
            WHERE restaurant_id = restaurants.id 
            AND user_id = auth.uid()
        )
    );

CREATE POLICY "Owners can update their restaurants" ON restaurants
    FOR UPDATE
    TO authenticated
    USING (owner_user_id = auth.uid())
    WITH CHECK (owner_user_id = auth.uid());

CREATE POLICY "Authenticated users can create restaurants" ON restaurants
    FOR INSERT
    TO authenticated
    WITH CHECK (owner_user_id = auth.uid());

-- =============================================
-- 2. RESTAURANT STAFF (Multi-user per restaurant)
-- =============================================
CREATE TYPE staff_role AS ENUM ('owner', 'manager', 'host', 'waiter');

CREATE TABLE restaurant_staff (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    name TEXT,
    role staff_role NOT NULL DEFAULT 'host',
    is_active BOOLEAN DEFAULT true,
    invited_at TIMESTAMPTZ DEFAULT NOW(),
    joined_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Either user_id (accepted) or email (pending invite)
    CONSTRAINT staff_user_or_email CHECK (
        (user_id IS NOT NULL) OR (email IS NOT NULL)
    ),
    -- Unique constraint per restaurant+user
    UNIQUE (restaurant_id, user_id),
    -- Unique constraint per restaurant+email
    UNIQUE (restaurant_id, email)
);

-- Enable RLS
ALTER TABLE restaurant_staff ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view their restaurant members" ON restaurant_staff
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM restaurant_staff rs
            WHERE rs.restaurant_id = restaurant_staff.restaurant_id
            AND rs.user_id = auth.uid()
        ) OR
        EXISTS (
            SELECT 1 FROM restaurants r
            WHERE r.id = restaurant_staff.restaurant_id
            AND r.owner_user_id = auth.uid()
        )
    );

CREATE POLICY "Owners and managers can manage staff" ON restaurant_staff
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM restaurant_staff rs
            WHERE rs.restaurant_id = restaurant_staff.restaurant_id
            AND rs.user_id = auth.uid()
            AND rs.role IN ('owner', 'manager')
        ) OR
        EXISTS (
            SELECT 1 FROM restaurants r
            WHERE r.id = restaurant_staff.restaurant_id
            AND r.owner_user_id = auth.uid()
        )
    );

-- =============================================
-- 3. TABLES (Floor Plan)
-- =============================================
CREATE TYPE table_shape AS ENUM ('circle', 'rect');

CREATE TABLE tables (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    capacity INTEGER NOT NULL CHECK (capacity > 0),
    shape table_shape NOT NULL DEFAULT 'rect',
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Ensure unique sort order per restaurant
    UNIQUE (restaurant_id, sort_order)
);

-- Enable RLS
ALTER TABLE tables ENABLE ROW LEVEL SECURITY;

-- Tenant isolation: Staff can only see their restaurant's tables
CREATE POLICY "Tenant isolation for tables" ON tables
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM restaurant_staff rs
            WHERE rs.restaurant_id = tables.restaurant_id
            AND rs.user_id = auth.uid()
            AND rs.is_active = true
        ) OR
        EXISTS (
            SELECT 1 FROM restaurants r
            WHERE r.id = tables.restaurant_id
            AND r.owner_user_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM restaurant_staff rs
            WHERE rs.restaurant_id = tables.restaurant_id
            AND rs.user_id = auth.uid()
            AND rs.is_active = true
        ) OR
        EXISTS (
            SELECT 1 FROM restaurants r
            WHERE r.id = tables.restaurant_id
            AND r.owner_user_id = auth.uid()
        )
    );

-- =============================================
-- 4. CUSTOMERS (Per-restaurant CRM)
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
    average_spend DECIMAL(10,2),
    preferred_table_id UUID REFERENCES tables(id),
    dietary_restrictions TEXT,
    notes TEXT,
    last_visit_date DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Unique phone per restaurant
    UNIQUE (restaurant_id, phone)
);

-- Indexes for common queries
CREATE INDEX idx_customers_restaurant_id ON customers(restaurant_id);
CREATE INDEX idx_customers_phone ON customers(phone);
CREATE INDEX idx_customers_name ON customers(name);

-- Enable RLS
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation for customers" ON customers
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM restaurant_staff rs
            WHERE rs.restaurant_id = customers.restaurant_id
            AND rs.user_id = auth.uid()
            AND rs.is_active = true
        ) OR
        EXISTS (
            SELECT 1 FROM restaurants r
            WHERE r.id = customers.restaurant_id
            AND r.owner_user_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM restaurant_staff rs
            WHERE rs.restaurant_id = customers.restaurant_id
            AND rs.user_id = auth.uid()
            AND rs.is_active = true
        ) OR
        EXISTS (
            SELECT 1 FROM restaurants r
            WHERE r.id = customers.restaurant_id
            AND r.owner_user_id = auth.uid()
        )
    );

-- =============================================
-- 5. RESERVATIONS (Core Booking Data)
-- =============================================
CREATE TYPE reservation_status AS ENUM ('booked', 'confirmed', 'seated', 'finished', 'cancelled', 'no_show');
CREATE TYPE reservation_source AS ENUM ('phone', 'walk_in', 'online', 'third_party');

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
    source reservation_source DEFAULT 'phone',
    notes TEXT,
    seated_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    created_by UUID REFERENCES auth.users(id),
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
CREATE INDEX idx_reservations_date_range ON reservations(restaurant_id, start_time);

-- Enable RLS
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation for reservations" ON reservations
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM restaurant_staff rs
            WHERE rs.restaurant_id = reservations.restaurant_id
            AND rs.user_id = auth.uid()
            AND rs.is_active = true
        ) OR
        EXISTS (
            SELECT 1 FROM restaurants r
            WHERE r.id = reservations.restaurant_id
            AND r.owner_user_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM restaurant_staff rs
            WHERE rs.restaurant_id = reservations.restaurant_id
            AND rs.user_id = auth.uid()
            AND rs.is_active = true
        ) OR
        EXISTS (
            SELECT 1 FROM restaurants r
            WHERE r.id = reservations.restaurant_id
            AND r.owner_user_id = auth.uid()
        )
    );

-- =============================================
-- 6. ANALYTICS EVENTS (For reporting)
-- =============================================
CREATE TABLE analytics_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL, -- reservation_created, reservation_cancelled, etc.
    event_data JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation for analytics" ON analytics_events
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM restaurant_staff rs
            WHERE rs.restaurant_id = analytics_events.restaurant_id
            AND rs.user_id = auth.uid()
            AND rs.is_active = true
        ) OR
        EXISTS (
            SELECT 1 FROM restaurants r
            WHERE r.id = analytics_events.restaurant_id
            AND r.owner_user_id = auth.uid()
        )
    );

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

-- Triggers for updated_at
CREATE TRIGGER update_customers_updated_at
    BEFORE UPDATE ON customers
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_reservations_updated_at
    BEFORE UPDATE ON reservations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_restaurants_updated_at
    BEFORE UPDATE ON restaurants
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Function to auto-increment customer visit count
CREATE OR REPLACE FUNCTION increment_customer_visits()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'finished' AND OLD.status != 'finished' THEN
        UPDATE customers 
        SET total_visits = total_visits + 1,
            last_visit_date = CURRENT_DATE
        WHERE id = NEW.customer_id;
    END IF;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_customer_visits_on_finish
    AFTER UPDATE ON reservations
    FOR EACH ROW
    WHEN (NEW.status = 'finished')
    EXECUTE FUNCTION increment_customer_visits();

-- =============================================
-- SAMPLE DATA (For Testing - Optional)
-- =============================================

-- Insert a sample restaurant (would be created during signup)
-- INSERT INTO restaurants (name, slug, email, owner_user_id) 
-- VALUES ('Demo Restaurant', 'demo-restaurant', 'owner@demo.com', 'user-uuid-here');

-- =============================================
-- VERIFICATION QUERY
-- =============================================
SELECT 
    'restaurants' as table_name, COUNT(*) as row_count FROM restaurants
UNION ALL
SELECT 'restaurant_staff', COUNT(*) FROM restaurant_staff
UNION ALL
SELECT 'tables', COUNT(*) FROM tables
UNION ALL
SELECT 'customers', COUNT(*) FROM customers
UNION ALL
SELECT 'reservations', COUNT(*) FROM reservations;
