-- =============================================
-- DEBUG: Verify Tenant Isolation is Working
-- Run this after applying the migration to confirm fix
-- =============================================

-- 1. Show all current policies
SELECT 
    tablename,
    policyname,
    cmd,
    permissive,
    qual as using_expression,
    with_check as with_check_expression
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- 2. Check if RLS is enabled and forced on tables
SELECT 
    relname as table_name,
    relrowsecurity as rls_enabled,
    relforcerowsecurity as rls_forced
FROM pg_class
WHERE relname IN ('tables', 'customers', 'reservations', 'restaurants', 'restaurant_users', 'customer_visit_logs', 'reservation_notes_history', 'whatsapp_logs', 'waitlist')
  AND relnamespace = 'public'::regnamespace
ORDER BY relname;

-- 3. Check for any remaining permissive policies (USING (true) or USING (1=1))
-- These would indicate a security vulnerability
SELECT 
    tablename,
    policyname,
    qual as using_expression
FROM pg_policies
WHERE schemaname = 'public'
  AND (qual = 'true' OR qual = '(true)' OR qual = '1=1' OR qual = '(1=1)')
ORDER BY tablename;

-- 4. Test the helper function
-- This should return NULL when called without the header
SELECT get_restaurant_id_from_request() as restaurant_id_from_request;

-- =============================================
-- VERIFICATION QUERIES (Run these as authenticated user)
-- =============================================

-- After the fix, these queries should ONLY return rows for your restaurant:
-- SELECT * FROM tables;
-- SELECT * FROM customers;
-- SELECT * FROM reservations;

-- If you see data from other restaurants, the isolation is NOT working!
