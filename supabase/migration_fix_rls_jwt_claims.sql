-- =============================================
-- CRITICAL SECURITY FIX: Use JWT Claims for RLS
-- Problem: current_setting('request.headers') doesn't work with Supabase
-- Solution: Use auth.jwt() to extract restaurant_id from JWT claims
-- =============================================

-- =============================================
-- 1. HELPER FUNCTION TO EXTRACT RESTAURANT_ID FROM JWT
-- =============================================

-- Function to get restaurant_id from JWT claims
-- The app sends JWT with claims: { userId, restaurantId, username, role }
CREATE OR REPLACE FUNCTION get_restaurant_id_from_jwt()
RETURNS UUID AS $$
DECLARE
    jwt_claims JSONB;
    restaurant_id TEXT;
BEGIN
    -- Get the JWT claims from the current session
    jwt_claims := auth.jwt();
    
    -- Extract restaurantId from the JWT payload
    -- The app sends: { "restaurantId": "uuid", ... }
    restaurant_id := jwt_claims->>'restaurantId';
    
    IF restaurant_id IS NOT NULL AND restaurant_id != '' THEN
        RETURN restaurant_id::UUID;
    END IF;
    
    -- Fallback: try to get from user metadata if using Supabase Auth
    -- This won't work with custom auth but is here for compatibility
    BEGIN
        restaurant_id := auth.jwt() -> 'app_metadata' ->> 'restaurant_id';
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
-- 2. DROP OLD RLS POLICIES (if they exist)
-- =============================================

-- Drop existing policies
DROP POLICY IF EXISTS "Restaurants can view own data" ON restaurants;
DROP POLICY IF EXISTS "Users can view restaurant members" ON restaurant_users;
DROP POLICY IF EXISTS "Tenant isolation for tables" ON tables;
DROP POLICY IF EXISTS "Tenant isolation for customers" ON customers;
DROP POLICY IF EXISTS "Tenant isolation for reservations" ON reservations;
DROP POLICY IF EXISTS "Tenant isolation for visit logs" ON customer_visit_logs;
DROP POLICY IF EXISTS "Tenant isolation for reservation notes" ON reservation_notes_history;

-- Also drop policies from the new migration if they were created
DROP POLICY IF EXISTS "Tenant isolation for restaurants" ON restaurants;
DROP POLICY IF EXISTS "Tenant isolation for restaurant_users" ON restaurant_users;

-- =============================================
-- 3. CREATE NEW RLS POLICIES USING JWT CLAIMS
-- =============================================

-- Restaurants: Can only view own data (based on JWT restaurantId claim)
CREATE POLICY "Tenant isolation for restaurants" ON restaurants
    FOR ALL
    TO authenticated, anon
    USING (id = get_restaurant_id_from_jwt())
    WITH CHECK (id = get_restaurant_id_from_jwt());

-- Restaurant Users: Can only view users from same restaurant
CREATE POLICY "Tenant isolation for restaurant_users" ON restaurant_users
    FOR ALL
    TO authenticated, anon
    USING (restaurant_id = get_restaurant_id_from_jwt())
    WITH CHECK (restaurant_id = get_restaurant_id_from_jwt());

-- Tables: Full tenant isolation
CREATE POLICY "Tenant isolation for tables" ON tables
    FOR ALL
    TO authenticated, anon
    USING (restaurant_id = get_restaurant_id_from_jwt())
    WITH CHECK (restaurant_id = get_restaurant_id_from_jwt());

-- Customers: Full tenant isolation
CREATE POLICY "Tenant isolation for customers" ON customers
    FOR ALL
    TO authenticated, anon
    USING (restaurant_id = get_restaurant_id_from_jwt())
    WITH CHECK (restaurant_id = get_restaurant_id_from_jwt());

-- Reservations: Full tenant isolation
CREATE POLICY "Tenant isolation for reservations" ON reservations
    FOR ALL
    TO authenticated, anon
    USING (restaurant_id = get_restaurant_id_from_jwt())
    WITH CHECK (restaurant_id = get_restaurant_id_from_jwt());

-- Customer Visit Logs: Full tenant isolation
CREATE POLICY "Tenant isolation for visit logs" ON customer_visit_logs
    FOR ALL
    TO authenticated, anon
    USING (restaurant_id = get_restaurant_id_from_jwt())
    WITH CHECK (restaurant_id = get_restaurant_id_from_jwt());

-- Reservation Notes History: Full tenant isolation
CREATE POLICY "Tenant isolation for reservation notes" ON reservation_notes_history
    FOR ALL
    TO authenticated, anon
    USING (restaurant_id = get_restaurant_id_from_jwt())
    WITH CHECK (restaurant_id = get_restaurant_id_from_jwt());

-- =============================================
-- 4. ENABLE RLS ON ALL TABLES (ENSURE ENABLED)
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

-- Grant access to anon and authenticated roles
GRANT ALL ON restaurants TO anon, authenticated;
GRANT ALL ON restaurant_users TO anon, authenticated;
GRANT ALL ON tables TO anon, authenticated;
GRANT ALL ON customers TO anon, authenticated;
GRANT ALL ON reservations TO anon, authenticated;
GRANT ALL ON customer_visit_logs TO anon, authenticated;
GRANT ALL ON reservation_notes_history TO anon, authenticated;

-- Grant sequence access
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

-- =============================================
-- 6. VERIFICATION
-- =============================================

-- Show the function we created
SELECT 
    proname as function_name,
    prorettype::regtype as return_type,
    prosrc as source
FROM pg_proc 
WHERE proname = 'get_restaurant_id_from_jwt';

-- Verify policies are in place
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE tablename IN (
    'restaurants', 'restaurant_users', 'tables', 
    'customers', 'reservations', 'customer_visit_logs', 'reservation_notes_history'
)
ORDER BY tablename, policyname;
