-- =============================================
-- 041 — remove the abandoned TableMind functions
-- =============================================
-- `CLAUDE.md` says TableMind — the restaurant reservation product this repo was
-- pivoted from — left scaffolding in the tree. It also left ~40 functions in the
-- PRODUCTION DATABASE, which is harder to notice because nothing in `src/`
-- mentions them.
--
-- They are not merely unused. They are unusable: the tables they operate on
-- (`reservations`, `customers`, `restaurant_tables`, `waitlist`, …) do not
-- exist. Verified on 2026-09-01 against the live database:
--
--     restaurant-domain tables present ......... 0
--     triggers referencing these functions ..... 0
--     policies referencing these functions ..... 0
--     references anywhere in src/ .............. 0
--
-- ## Why this is a security fix and not housekeeping
--
-- Thirteen of them are **SECURITY DEFINER with `search_path` NOT SET**, and are
-- granted to **PUBLIC, anon and authenticated**:
--
--     add_customer_allergy            get_current_restaurant_id_from_headers
--     add_reservation_note            get_customer_segmentation
--     can_access_restaurant           get_customers_by_allergy
--     create_walk_in                  get_reservation_with_notes
--     debug_rls_headers               get_restaurant_id_from_jwt
--     search_customers                get_restaurant_id_from_request
--     upsert_customer
--
-- That is the exact shape the `db-migration` skill and audit **P0-5** call a
-- privilege-escalation hole: a SECURITY DEFINER function runs as its owner
-- (`postgres`, which has BYPASSRLS) and, with no fixed `search_path`, resolves
-- unqualified names using the CALLER's. Several are also auth primitives from a
-- JWT scheme this app never adopted, and `debug_rls_headers` is a debug routine
-- reachable by `anon`.
--
-- Patching `search_path` onto thirteen dead functions would be work spent
-- keeping dead code alive. Dropping them removes the surface.
--
-- ## Safety
--
-- The predicate below is deliberately narrow, and every exclusion is one that
-- would have caused a real outage:
--
--   * `update_updated_at_column()` is UNREFERENCED in the repo but IS backed by
--     live triggers. Dropping it stops `updated_at` being maintained, which
--     silently breaks the delta sync in `products/refresh.ts`.
--   * `rls_auto_enable()` is an EVENT trigger, so it appears in no `pg_trigger`
--     row and in no source file.
--   * `increment_product_stock()` is unreferenced today but is a POS function,
--     not TableMind. Out of scope.
--
-- The loop therefore requires a positive TableMind signal AND absence from
-- `pg_trigger` and `pg_event_trigger`. Same rule as `evaluateReconcile()`:
-- deletion requires positive proof, and skipping is always safe.
--
-- Re-runnable. Drops nothing that is not there.
-- =============================================

DO $$
DECLARE
  r RECORD;
  dropped INT := 0;
BEGIN
  FOR r IN
    SELECT p.oid,
           p.proname,
           pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.prokind = 'f'
      -- A positive TableMind signal: either it takes a restaurant tenancy id,
      -- or it is one of the named reservation/customer/table routines.
      AND (
        pg_get_function_identity_arguments(p.oid) LIKE '%p_restaurant_id%'
        OR p.proname IN (
          'add_customer_allergy', 'auto_create_table_status',
          'auto_tag_customer_reliability', 'calculate_campaign_stats',
          'calculate_punctuality', 'calculate_revpash',
          'can_access_restaurant', 'debug_rls_headers',
          'get_current_restaurant_id_from_headers',
          'get_reservation_with_notes', 'get_restaurant_id_from_jwt',
          'get_restaurant_id_from_request', 'handle_reservation_status_change',
          'increment_customer_visits', 'increment_customer_visits_trigger',
          'mark_no_shows', 'sync_reservation_from_table_status',
          'sync_seated_reservation_to_table',
          'trigger_recalculate_waitlist_positions',
          'update_customer_punctuality_stats',
          'update_customer_reliability_on_cancel',
          'update_customer_reliability_on_complete',
          'update_customer_reliability_on_noshow',
          'update_revpash', 'update_table_performance_analytics',
          'update_table_service_status_updated_at',
          'update_waitlist_updated_at'
        )
      )
      -- Never drop something a trigger depends on, whatever its name suggests.
      AND NOT EXISTS (
        SELECT 1 FROM pg_trigger t
        WHERE t.tgfoid = p.oid AND NOT t.tgisinternal
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_event_trigger e WHERE e.evtfoid = p.oid
      )
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS public.%I(%s)', r.proname, r.args);
    RAISE NOTICE 'dropped %(%)', r.proname, r.args;
    dropped := dropped + 1;
  END LOOP;

  RAISE NOTICE 'TableMind functions dropped: %', dropped;
END $$;

-- Verification. Both of these should return zero rows afterwards.
--
--   SELECT p.proname
--   FROM pg_proc p
--   WHERE p.pronamespace = 'public'::regnamespace
--     AND pg_get_function_identity_arguments(p.oid) LIKE '%p_restaurant_id%';
--
--   SELECT p.proname
--   FROM pg_proc p
--   WHERE p.pronamespace = 'public'::regnamespace
--     AND p.prosecdef
--     AND p.proconfig IS NULL
--     AND p.proname IN ('debug_rls_headers', 'can_access_restaurant',
--                       'get_restaurant_id_from_jwt');
