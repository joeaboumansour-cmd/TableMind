-- Debug RLS - Run this in Supabase SQL Editor to test if headers are working

-- Test function that returns what the RLS function sees
CREATE OR REPLACE FUNCTION debug_rls_headers()
RETURNS TABLE (
    headers_json JSONB,
    restaurant_id TEXT,
    raw_setting TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        NULLIF(current_setting('request.headers', true), '')::JSONB as headers_json,
        (NULLIF(current_setting('request.headers', true), '')::JSONB)->>'x-restaurant-id' as restaurant_id,
        current_setting('request.headers', true) as raw_setting;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant access
GRANT EXECUTE ON FUNCTION debug_rls_headers() TO anon, authenticated;

-- Test query (run this after setting header)
-- SELECT * FROM debug_rls_headers();

-- Alternative: Check RLS is actually enabled
SELECT 
    relname as table_name,
    relrowsecurity as rls_enabled,
    relforcerowsecurity as rls_forced
FROM pg_class
WHERE relname IN ('customers', 'reservations', 'tables', 'restaurants')
ORDER BY relname;

-- Check policies exist
SELECT 
    tablename,
    policyname,
    permissive,
    roles::text,
    cmd,
    qual
FROM pg_policies
WHERE tablename IN ('customers', 'reservations', 'tables', 'restaurants')
ORDER BY tablename, policyname;
