-- =============================================
-- FINAL SECURITY FIX: Use Supabase Headers for RLS
-- Problem: auth.jwt() only works with Supabase JWTs, not custom JWTs
-- Solution: Use current_setting('request.headers') with correct syntax
-- =============================================

-- =============================================
-- 1. HELPER FUNCTION TO EXTRACT RESTAURANT_ID FROM HEADER
-- =============================================

-- Function to get restaurant_id from request headers
-- Supabase exposes headers via current_setting('request.headers') as JSON
CREATE OR REPLACE FUNCTION get_restaurant_id_from_request()
RETURNS UUID AS $$
DECLARE
    headers JSONB;
    restaurant_id TEXT;
BEGIN
    -- Try to get headers from request
    BEGIN
        headers := NULLIF(current_setting('request.headers', true), '')::JSONB;
    EXCEPTION WHEN OTHERS THEN
        headers := NULL;
    END;
    
    -- Extract x-restaurant-id from headers
    IF headers IS NOT NULL THEN
        restaurant_id := headers->>'x-restaurant-id';
        IF restaurant_id IS NOT NULL AND restaurant_id != '' THEN
            RETURN restaurant_id::UUID;
        END IF;
    END IF;
    
    -- Fallback: try the old app setting for backward compatibility
    BEGIN
        restaurant_id := current_setting('app.current_restaurant_id', true);
        IF restaurant_id IS NOT NULL AND restaurant_id != '' THEN
            RETURN restaurant_id::UUID;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        NULL;
    END;
    
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================
-- 2. DROP ALL EXISTING RLS POLICIES
-- =============================================

-- Drop ALL existing policies
DROP POLICY IF EXISTS "Restaurants can view own data" ON restaurants;
DROP POLICY IF EXISTS "Users can view restaurant members" ON restaurant_users;
DROP POLICY IF EXISTS "Tenant isolation for tables" ON tables;
DROP POLICY IF EXISTS "Tenant isolation for customers" ON customers;
DROP POLICY IF EXISTS "Tenant isolation for reservations" ON reservations;
DROP POLICY IF EXISTS "Tenant isolation for visit logs" ON customer_visit_logs;
DROP POLICY IF EXISTS "Tenant isolation for reservation notes" ON reservation_notes_history;

-- Drop policies from previous migrations
DROP POLICY IF EXISTS "Tenant isolation for restaurants" ON restaurants;
DROP POLICY IF EXISTS "Tenant isolation for restaurant_users" ON restaurant_users;

-- =============================================
-- 3. CREATE NEW RLS POLICIES USING HEADERS
-- =============================================

-- Restaurants: Can only view own data
CREATE POLICY "Tenant isolation for restaurants" ON restaurants
    FOR ALL
    TO anon, authenticated
    USING (id = get_restaurant_id_from_request())
    WITH CHECK (id = get_restaurant_id_from_request());

-- Restaurant Users: Can only view users from same restaurant
CREATE POLICY "Tenant isolation for restaurant_users" ON restaurant_users
    FOR ALL
    TO anon, authenticated
    USING (restaurant_id = get_restaurant_id_from_request())
    WITH CHECK (restaurant_id = get_restaurant_id_from_request());

-- Tables: Full tenant isolation
CREATE POLICY "Tenant isolation for tables" ON tables
    FOR ALL
    TO anon, authenticated
    USING (restaurant_id = get_restaurant_id_from_request())
    WITH CHECK (restaurant_id = get_restaurant_id_from_request());

-- Customers: Full tenant isolation
CREATE POLICY "Tenant isolation for customers" ON customers
    FOR ALL
    TO anon, authenticated
    USING (restaurant_id = get_restaurant_id_from_request())
    WITH CHECK (restaurant_id = get_restaurant_id_from_request());

-- Reservations: Full tenant isolation
CREATE POLICY "Tenant isolation for reservations" ON reservations
    FOR ALL
    TO anon, authenticated
    USING (restaurant_id = get_restaurant_id_from_request())
    WITH CHECK (restaurant_id = get_restaurant_id_from_request());

-- Customer Visit Logs: Full tenant isolation
CREATE POLICY "Tenant isolation for visit logs" ON customer_visit_logs
    FOR ALL
    TO anon, authenticated
    USING (restaurant_id = get_restaurant_id_from_request())
    WITH CHECK (restaurant_id = get_restaurant_id_from_request());

-- Reservation Notes History: Full tenant isolation
CREATE POLICY "Tenant isolation for reservation notes" ON reservation_notes_history
    FOR ALL
    TO anon, authenticated
    USING (restaurant_id = get_restaurant_id_from_request())
    WITH CHECK (restaurant_id = get_restaurant_id_from_request());

-- =============================================
-- 4. ENABLE RLS ON ALL TABLES
-- =============================================

ALTER TABLE restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE restaurant_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_visit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservation_notes_history ENABLE ROW LEVEL SECURITY;

-- Force RLS for table owners too
ALTER TABLE restaurants FORCE ROW LEVEL SECURITY;
ALTER TABLE restaurant_users FORCE ROW LEVEL SECURITY;
ALTER TABLE tables FORCE ROW LEVEL SECURITY;
ALTER TABLE customers FORCE ROW LEVEL SECURITY;
ALTER TABLE reservations FORCE ROW LEVEL SECURITY;
ALTER TABLE customer_visit_logs FORCE ROW LEVEL SECURITY;
ALTER TABLE reservation_notes_history FORCE ROW LEVEL SECURITY;

-- =============================================
-- 5. GRANT PERMISSIONS
-- =============================================

GRANT ALL ON restaurants TO anon, authenticated;
GRANT ALL ON restaurant_users TO anon, authenticated;
GRANT ALL ON tables TO anon, authenticated;
GRANT ALL ON customers TO anon, authenticated;
GRANT ALL ON reservations TO anon, authenticated;
GRANT ALL ON customer_visit_logs TO anon, authenticated;
GRANT ALL ON reservation_notes_history TO anon, authenticated;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

-- =============================================
-- 6. VERIFICATION
-- =============================================

SELECT 'RLS Policies Updated' as status;

-- Show the function
SELECT 
    proname as function_name,
    prorettype::regtype as return_type
FROM pg_proc 
WHERE proname = 'get_restaurant_id_from_request';

-- Show policies
SELECT 
    tablename,
    policyname,
    cmd,
    permissive
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename;
