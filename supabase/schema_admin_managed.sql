-- =============================================
-- TableMind Admin-Managed SaaS Schema
-- Accounts created manually by admin
-- Username + Password authentication (no email verification)
-- =============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================
-- 1. RESTAURANTS TABLE (Tenant Root)
-- =============================================
CREATE TABLE restaurants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    -- Private ID for recognizing customers/branches
    private_id TEXT UNIQUE NOT NULL, -- e.g., "REST-001", "BRANCH-NYC"
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    -- License/Trial Info
    subscription_tier TEXT DEFAULT 'trial', -- trial, starter, pro, enterprise
    license_start_date TIMESTAMPTZ DEFAULT NOW(),
    license_end_date TIMESTAMPTZ, -- NULL = perpetual or until cancelled
    trial_ends_at TIMESTAMPTZ, -- For trial accounts
    is_active BOOLEAN DEFAULT true, -- Can login?
    
    -- Contact Info (optional, for admin reference)
    contact_email TEXT,
    contact_phone TEXT,
    address TEXT,
    timezone TEXT NOT NULL DEFAULT 'America/New_York',
    
    -- Restaurant Settings
    settings JSONB DEFAULT '{
        "opening_time": "11:00",
        "closing_time": "23:00",
        "slot_duration_minutes": 15,
        "default_reservation_duration": 90,
        "max_party_size": 20
    }'::jsonb,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE restaurants ENABLE ROW LEVEL SECURITY;

-- Policy: Restaurant can only see their own data
CREATE POLICY "Restaurants can view own data" ON restaurants
    FOR ALL
    TO authenticated
    USING (id = current_setting('app.current_restaurant_id')::UUID);

-- =============================================
-- 2. RESTAURANT USERS (Login Credentials)
-- =============================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
        CREATE TYPE user_role AS ENUM ('owner', 'manager', 'host', 'waiter', 'admin');
    END IF;
END $$;

CREATE TABLE restaurant_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    
    -- Login Credentials
    username TEXT NOT NULL, -- e.g., "bella_italia", "nyc_host1"
    password_hash TEXT NOT NULL, -- bcrypt hashed password
    
    -- User Info
    display_name TEXT,
    role user_role NOT NULL DEFAULT 'host',
    is_active BOOLEAN DEFAULT true, -- Can login?
    
    -- Tracking
    last_login_at TIMESTAMPTZ,
    login_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Unique username across the entire system
    UNIQUE (username),
    -- Unique constraint per restaurant for display
    UNIQUE (restaurant_id, display_name)
);

-- Enable RLS
ALTER TABLE restaurant_users ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see users from their restaurant
CREATE POLICY "Users can view restaurant members" ON restaurant_users
    FOR SELECT
    TO authenticated
    USING (
        restaurant_id = current_setting('app.current_restaurant_id')::UUID OR
        EXISTS (
            SELECT 1 FROM restaurant_users ru
            WHERE ru.restaurant_id = restaurant_users.restaurant_id
            AND ru.id = auth.uid()
            AND ru.role IN ('owner', 'manager', 'admin')
        )
    );

-- =============================================
-- 3. TABLES (Floor Plan)
-- =============================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'table_shape') THEN
        CREATE TYPE table_shape AS ENUM ('circle', 'rect');
    END IF;
END $$;

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
    
    UNIQUE (restaurant_id, sort_order)
);

-- Enable RLS
ALTER TABLE tables ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation for tables" ON tables
    FOR ALL
    TO authenticated
    USING (restaurant_id = current_setting('app.current_restaurant_id')::UUID)
    WITH CHECK (restaurant_id = current_setting('app.current_restaurant_id')::UUID);

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
    
    UNIQUE (restaurant_id, phone)
);

CREATE INDEX idx_customers_restaurant_id ON customers(restaurant_id);
CREATE INDEX idx_customers_phone ON customers(phone);
CREATE INDEX idx_customers_name ON customers(name);

-- Enable RLS
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation for customers" ON customers
    FOR ALL
    TO authenticated
    USING (restaurant_id = current_setting('app.current_restaurant_id')::UUID)
    WITH CHECK (restaurant_id = current_setting('app.current_restaurant_id')::UUID);

-- =============================================
-- 5. RESERVATIONS
-- =============================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'reservation_status') THEN
        CREATE TYPE reservation_status AS ENUM ('booked', 'confirmed', 'seated', 'finished', 'cancelled', 'no_show');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'reservation_source') THEN
        CREATE TYPE reservation_source AS ENUM ('phone', 'walk_in', 'online', 'third_party');
    END IF;
END $$;

CREATE TABLE reservations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    table_id UUID REFERENCES tables(id) ON DELETE SET NULL,
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    customer_name TEXT NOT NULL,
    customer_phone TEXT,
    party_size INTEGER NOT NULL CHECK (party_size > 0),
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    status reservation_status NOT NULL DEFAULT 'booked',
    source reservation_source DEFAULT 'phone',
    notes TEXT,
    -- Visit tracking
    actual_arrival_time TIMESTAMPTZ,
    seated_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    minutes_early_late INTEGER, -- Positive = early, Negative = late
    visit_completed BOOLEAN DEFAULT false,
    no_show BOOLEAN DEFAULT false,
    -- User tracking
    created_by UUID REFERENCES restaurant_users(id),
    updated_by UUID REFERENCES restaurant_users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT valid_time_range CHECK (end_time > start_time)
);

CREATE INDEX idx_reservations_restaurant_id ON reservations(restaurant_id);
CREATE INDEX idx_reservations_customer_id ON reservations(customer_id);
CREATE INDEX idx_reservations_table_id ON reservations(table_id);
CREATE INDEX idx_reservations_start_time ON reservations(start_time);
CREATE INDEX idx_reservations_status ON reservations(status);

-- Enable RLS
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation for reservations" ON reservations
    FOR ALL
    TO authenticated
    USING (restaurant_id = current_setting('app.current_restaurant_id')::UUID)
    WITH CHECK (restaurant_id = current_setting('app.current_restaurant_id')::UUID);

-- =============================================
-- FUNCTIONS & TRIGGERS
-- =============================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

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

CREATE TRIGGER update_restaurant_users_updated_at
    BEFORE UPDATE ON restaurant_users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tables_updated_at
    BEFORE UPDATE ON tables
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Function to increment customer visit count
CREATE OR REPLACE FUNCTION increment_customer_visit(customer_id UUID)
RETURNS void AS $$
BEGIN
    UPDATE customers 
    SET total_visits = total_visits + 1,
        last_visit_date = CURRENT_DATE
    WHERE id = customer_id;
END;
$$ language 'plpgsql';

-- Function to increment customer no-show count
CREATE OR REPLACE FUNCTION increment_customer_no_show(customer_id UUID)
RETURNS void AS $$
BEGIN
    UPDATE customers 
    SET no_show_count = no_show_count + 1
    WHERE id = customer_id;
END;
$$ language 'plpgsql';

-- =============================================
-- 6. CUSTOMER VISIT LOGS (History Tracking)
-- =============================================
CREATE TABLE customer_visit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    reservation_id UUID REFERENCES reservations(id) ON DELETE SET NULL,
    
    -- Visit Details
    visit_date DATE NOT NULL,
    visit_type TEXT NOT NULL DEFAULT 'dine_in', -- dine_in, takeout, delivery, event
    party_size INTEGER,
    
    -- Outcome
    status TEXT NOT NULL DEFAULT 'completed', -- completed, no_show, cancelled, no_show_charge
    
    -- Financial/Order Info
    total_spend DECIMAL(10,2),
    items_ordered JSONB, -- [{"item": "Steak", "price": 35.00, "quantity": 2}]
    
    -- Staff & Service
    server_name TEXT,
    table_id UUID REFERENCES tables(id),
    
    -- Feedback & Notes
    customer_notes TEXT, -- Staff notes about the visit
    feedback_rating INTEGER CHECK (feedback_rating >= 1 AND feedback_rating <= 5),
    feedback_text TEXT,
    
    -- Metadata
    created_by UUID REFERENCES restaurant_users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_visit_logs_customer_id ON customer_visit_logs(customer_id);
CREATE INDEX idx_visit_logs_restaurant_id ON customer_visit_logs(restaurant_id);
CREATE INDEX idx_visit_logs_visit_date ON customer_visit_logs(visit_date);
CREATE INDEX idx_visit_logs_status ON customer_visit_logs(status);

-- Enable RLS
ALTER TABLE customer_visit_logs ENABLE ROW LEVEL SECURITY;

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

CREATE TRIGGER update_customer_on_visit
    AFTER INSERT OR UPDATE ON customer_visit_logs
    FOR EACH ROW
    EXECUTE FUNCTION update_customer_stats_from_visit();

-- =============================================
-- 7. RESERVATION NOTES HISTORY
-- =============================================
CREATE TABLE reservation_notes_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    
    note_text TEXT NOT NULL,
    note_type TEXT DEFAULT 'general', -- general, dietary, special_occasion, complaint, vip_request
    
    created_by UUID REFERENCES restaurant_users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notes_reservation_id ON reservation_notes_history(reservation_id);
CREATE INDEX idx_notes_restaurant_id ON reservation_notes_history(restaurant_id);

-- Enable RLS
ALTER TABLE reservation_notes_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation for reservation notes" ON reservation_notes_history
    FOR ALL
    TO authenticated
    USING (restaurant_id = current_setting('app.current_restaurant_id')::UUID)
    WITH CHECK (restaurant_id = current_setting('app.current_restaurant_id')::UUID);

-- Trigger for auto-increment on reservation finish
CREATE OR REPLACE FUNCTION increment_customer_visits_trigger()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'finished' AND OLD.status != 'finished' THEN
        PERFORM increment_customer_visit(NEW.customer_id);
    END IF;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_customer_visits_on_finish
    AFTER UPDATE ON reservations
    FOR EACH ROW
    WHEN (NEW.status = 'finished')
    EXECUTE FUNCTION increment_customer_visits_trigger();

-- =============================================
-- EXAMPLE: How to Create a Restaurant Account (Run in SQL Editor)
-- =============================================
/*
-- Step 1: Create the restaurant
INSERT INTO restaurants (private_id, name, slug, subscription_tier, license_end_date, contact_email)
VALUES (
    'REST-001',           -- Private ID for recognizing this customer
    'Bella Italia',       -- Restaurant name
    'bella-italia',       -- URL slug
    'pro',                -- Tier: trial, starter, pro, enterprise
    '2025-12-31',         -- License valid until (NULL for perpetual)
    'owner@bella.com'     -- Contact email (for your reference)
)
RETURNING id; -- Save this UUID for Step 2

-- Step 2: Create login user(s) for this restaurant
-- Generate password hash using bcrypt (you can use https://bcrypt-generator.com/)
-- Example: 'password123' -> '$2a$10$...'

INSERT INTO restaurant_users (restaurant_id, username, password_hash, display_name, role)
VALUES (
    'restaurant-uuid-from-step-1',
    'bella_owner',                                    -- Username for login
    '$2a$10$YourBcryptHashHere',                      -- bcrypt hashed password
    'Owner Name',                                     -- Display name
    'owner'                                           -- Role: owner, manager, host, waiter
);

-- Create additional users as needed
INSERT INTO restaurant_users (restaurant_id, username, password_hash, display_name, role)
VALUES (
    'restaurant-uuid-from-step-1',
    'bella_host1',
    '$2a$10$YourBcryptHashHere',
    'Host 1',
    'host'
);
*/

-- =============================================
-- VERIFICATION QUERY
-- =============================================
SELECT 
    'restaurants' as table_name, COUNT(*) as row_count FROM restaurants
UNION ALL
SELECT 'restaurant_users', COUNT(*) FROM restaurant_users
UNION ALL
SELECT 'tables', COUNT(*) FROM tables
UNION ALL
SELECT 'customers', COUNT(*) FROM customers
UNION ALL
SELECT 'reservations', COUNT(*) FROM reservations;
