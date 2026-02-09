-- =============================================
-- Analytics Helper Functions & Views
-- Run this in the Supabase SQL Editor
-- =============================================

-- Enable UUID extension (if not already enabled)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================
-- 1. CUSTOMER ANALYTICS FUNCTIONS
-- =============================================

-- Get new vs returning customers count
CREATE OR REPLACE FUNCTION get_customer_segmentation(
  p_restaurant_id UUID,
  p_start_date TIMESTAMPTZ,
  p_end_date TIMESTAMPTZ
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_customers INTEGER;
  v_returning_customers INTEGER;
  v_total_customers INTEGER;
BEGIN
  -- Count new customers (first reservation in date range)
  SELECT COUNT(DISTINCT customer_id) INTO v_new_customers
  FROM reservations
  WHERE restaurant_id = p_restaurant_id
    AND customer_id IS NOT NULL
    AND start_time BETWEEN p_start_date AND p_end_date
    AND NOT EXISTS (
      SELECT 1 FROM reservations r2
      WHERE r2.customer_id = reservations.customer_id
        AND r2.start_time < p_start_date
    );

  -- Count returning customers (had reservation before date range)
  SELECT COUNT(DISTINCT customer_id) INTO v_returning_customers
  FROM reservations
  WHERE restaurant_id = p_restaurant_id
    AND customer_id IS NOT NULL
    AND start_time BETWEEN p_start_date AND p_end_date
    AND EXISTS (
      SELECT 1 FROM reservations r2
      WHERE r2.customer_id = reservations.customer_id
        AND r2.start_time < p_start_date
    );

  SELECT COUNT(DISTINCT customer_id) INTO v_total_customers
  FROM reservations
  WHERE restaurant_id = p_restaurant_id
    AND customer_id IS NOT NULL
    AND start_time BETWEEN p_start_date AND p_end_date;

  RETURN json_build_object(
    'new_customers', COALESCE(v_new_customers, 0),
    'returning_customers', COALESCE(v_returning_customers, 0),
    'total_customers', COALESCE(v_total_customers, 0),
    'new_percentage', CASE 
      WHEN v_total_customers > 0 
      THEN ROUND((v_new_customers::NUMERIC / v_total_customers::NUMERIC) * 100, 1)
      ELSE 0 
    END,
    'returning_percentage', CASE 
      WHEN v_total_customers > 0 
      THEN ROUND((v_returning_customers::NUMERIC / v_total_customers::NUMERIC) * 100, 1)
      ELSE 0 
    END
  );
END;
$$;

-- =============================================
-- 2. LEAD TIME ANALYSIS
-- =============================================

-- Get lead time distribution
CREATE OR REPLACE FUNCTION get_lead_time_distribution(
  p_restaurant_id UUID,
  p_start_date TIMESTAMPTZ,
  p_end_date TIMESTAMPTZ
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result JSON;
BEGIN
  SELECT json_build_object(
    'same_day', COALESCE((
      SELECT COUNT(*) FROM reservations
      WHERE restaurant_id = p_restaurant_id
        AND start_time BETWEEN p_start_date AND p_end_date
        AND DATE_TRUNC('day', start_time) = DATE_TRUNC('day', created_at)
    ), 0),
    
    'one_day', COALESCE((
      SELECT COUNT(*) FROM reservations
      WHERE restaurant_id = p_restaurant_id
        AND start_time BETWEEN p_start_date AND p_end_date
        AND start_time::date - created_at::date BETWEEN 1 AND 1
    ), 0),
    
    'two_days', COALESCE((
      SELECT COUNT(*) FROM reservations
      WHERE restaurant_id = p_restaurant_id
        AND start_time BETWEEN p_start_date AND p_end_date
        AND start_time::date - created_at::date BETWEEN 2 AND 3
    ), 0),
    
    'one_week', COALESCE((
      SELECT COUNT(*) FROM reservations
      WHERE restaurant_id = p_restaurant_id
        AND start_time BETWEEN p_start_date AND p_end_date
        AND start_time::date - created_at::date BETWEEN 4 AND 7
    ), 0),
    
    'two_weeks', COALESCE((
      SELECT COUNT(*) FROM reservations
      WHERE restaurant_id = p_restaurant_id
        AND start_time BETWEEN p_start_date AND p_end_date
        AND start_time::date - created_at::date BETWEEN 8 AND 14
    ), 0),
    
    'month_plus', COALESCE((
      SELECT COUNT(*) FROM reservations
      WHERE restaurant_id = p_restaurant_id
        AND start_time BETWEEN p_start_date AND p_end_date
        AND start_time::date - created_at::date > 14
    ), 0),
    
    'average_days', COALESCE((
      SELECT AVG(start_time::date - created_at::date)::NUMERIC(10,1)
      FROM reservations
      WHERE restaurant_id = p_restaurant_id
        AND start_time BETWEEN p_start_date AND p_end_date
        AND created_at IS NOT NULL
    ), 0)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- =============================================
-- 3. DAY OF WEEK PATTERNS
-- =============================================

CREATE OR REPLACE FUNCTION get_day_of_week_patterns(
  p_restaurant_id UUID,
  p_start_date TIMESTAMPTZ,
  p_end_date TIMESTAMPTZ
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN json_build_object(
    'sunday', COALESCE((SELECT COUNT(*) FROM reservations 
      WHERE restaurant_id = p_restaurant_id AND start_time BETWEEN p_start_date AND p_end_date 
      AND EXTRACT(DOW FROM start_time) = 0), 0),
    'monday', COALESCE((SELECT COUNT(*) FROM reservations 
      WHERE restaurant_id = p_restaurant_id AND start_time BETWEEN p_start_date AND p_end_date 
      AND EXTRACT(DOW FROM start_time) = 1), 0),
    'tuesday', COALESCE((SELECT COUNT(*) FROM reservations 
      WHERE restaurant_id = p_restaurant_id AND start_time BETWEEN p_start_date AND p_end_date 
      AND EXTRACT(DOW FROM start_time) = 2), 0),
    'wednesday', COALESCE((SELECT COUNT(*) FROM reservations 
      WHERE restaurant_id = p_restaurant_id AND start_time BETWEEN p_start_date AND p_end_date 
      AND EXTRACT(DOW FROM start_time) = 3), 0),
    'thursday', COALESCE((SELECT COUNT(*) FROM reservations 
      WHERE restaurant_id = p_restaurant_id AND start_time BETWEEN p_start_date AND p_end_date 
      AND EXTRACT(DOW FROM start_time) = 4), 0),
    'friday', COALESCE((SELECT COUNT(*) FROM reservations 
      WHERE restaurant_id = p_restaurant_id AND start_time BETWEEN p_start_date AND p_end_date 
      AND EXTRACT(DOW FROM start_time) = 5), 0),
    'saturday', COALESCE((SELECT COUNT(*) FROM reservations 
      WHERE restaurant_id = p_restaurant_id AND start_time BETWEEN p_start_date AND p_end_date 
      AND EXTRACT(DOW FROM start_time) = 6), 0)
  );
END;
$$;

-- =============================================
-- 4. SEASONAL TRENDS
-- =============================================

CREATE OR REPLACE FUNCTION get_seasonal_trends(
  p_restaurant_id UUID,
  p_year INTEGER
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN (
    SELECT json_agg(
      json_build_object(
        'month', month_num,
        'month_name', month_name,
        'reservations', reservation_count,
        'avg_party_size', ROUND(avg_party_size::NUMERIC, 1),
        'total_guests', total_guests
      )
    )
    FROM (
      SELECT 
        EXTRACT(MONTH FROM start_time)::INTEGER as month_num,
        TO_CHAR(start_time, 'Month') as month_name,
        COUNT(*) as reservation_count,
        AVG(party_size)::NUMERIC(10,2) as avg_party_size,
        SUM(party_size) as total_guests
      FROM reservations
      WHERE restaurant_id = p_restaurant_id
        AND EXTRACT(YEAR FROM start_time) = p_year
      GROUP BY EXTRACT(MONTH FROM start_time), TO_CHAR(start_time, 'Month')
      ORDER BY month_num
    ) monthly_data
  );
END;
$$;

-- =============================================
-- 5. YEAR-OVER-YEAR COMPARISON
-- =============================================

CREATE OR REPLACE FUNCTION get_year_over_year_comparison(
  p_restaurant_id UUID,
  p_current_year INTEGER,
  p_previous_year INTEGER
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current JSON;
  v_previous JSON;
BEGIN
  SELECT json_build_object(
    'reservations', COUNT(*),
    'total_guests', SUM(party_size),
    'avg_party_size', ROUND(AVG(party_size)::NUMERIC, 2),
    'completed_reservations', COUNT(*) FILTER (WHERE status = 'finished')
  ) INTO v_current
  FROM reservations
  WHERE restaurant_id = p_restaurant_id
    AND EXTRACT(YEAR FROM start_time) = p_current_year;

  SELECT json_build_object(
    'reservations', COUNT(*),
    'total_guests', SUM(party_size),
    'avg_party_size', ROUND(AVG(party_size)::NUMERIC, 2),
    'completed_reservations', COUNT(*) FILTER (WHERE status = 'finished')
  ) INTO v_previous
  FROM reservations
  WHERE restaurant_id = p_restaurant_id
    AND EXTRACT(YEAR FROM start_time) = p_previous_year;

  RETURN json_build_object(
    'current_year', v_current,
    'previous_year', v_previous,
    'reservation_growth', CASE 
      WHEN (v_previous->>'reservations')::INTEGER > 0 
      THEN ROUND(
        ((v_current->>'reservations')::INTEGER - (v_previous->>'reservations')::INTEGER)::NUMERIC / 
        (v_previous->>'reservations')::INTEGER * 100, 1
      )
      ELSE 0 
    END,
    'guest_growth', CASE 
      WHEN (v_previous->>'total_guests')::INTEGER > 0 
      THEN ROUND(
        ((v_current->>'total_guests')::INTEGER - (v_previous->>'total_guests')::INTEGER)::NUMERIC / 
        (v_previous->>'total_guests')::INTEGER * 100, 1
      )
      ELSE 0 
    END
  );
END;
$$;

-- =============================================
-- 6. GROWTH RATE (WoW, MoM)
-- =============================================

CREATE OR REPLACE FUNCTION get_growth_rates(
  p_restaurant_id UUID,
  p_current_start TIMESTAMPTZ,
  p_current_end TIMESTAMPTZ,
  p_previous_start TIMESTAMPTZ,
  p_previous_end TIMESTAMPTZ
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_reservations INTEGER;
  v_current_guests INTEGER;
  v_previous_reservations INTEGER;
  v_previous_guests INTEGER;
BEGIN
  SELECT COUNT(*), SUM(party_size) INTO v_current_reservations, v_current_guests
  FROM reservations
  WHERE restaurant_id = p_restaurant_id
    AND start_time BETWEEN p_current_start AND p_current_end;

  SELECT COUNT(*), SUM(party_size) INTO v_previous_reservations, v_previous_guests
  FROM reservations
  WHERE restaurant_id = p_restaurant_id
    AND start_time BETWEEN p_previous_start AND p_previous_end;

  RETURN json_build_object(
    'current_period', json_build_object(
      'reservations', COALESCE(v_current_reservations, 0),
      'guests', COALESCE(v_current_guests, 0)
    ),
    'previous_period', json_build_object(
      'reservations', COALESCE(v_previous_reservations, 0),
      'guests', COALESCE(v_previous_guests, 0)
    ),
    'reservation_growth', CASE 
      WHEN COALESCE(v_previous_reservations, 0) > 0 
      THEN ROUND(
        ((COALESCE(v_current_reservations, 0) - v_previous_reservations)::NUMERIC / v_previous_reservations * 100), 1
      )
      ELSE 0 
    END,
    'guest_growth', CASE 
      WHEN COALESCE(v_previous_guests, 0) > 0 
      THEN ROUND(
        ((COALESCE(v_current_guests, 0) - v_previous_guests)::NUMERIC / v_previous_guests * 100), 1
      )
      ELSE 0 
    END
  );
END;
$$;

-- =============================================
-- 7. TABLE POPULARITY
-- =============================================

CREATE OR REPLACE FUNCTION get_table_popularity(
  p_restaurant_id UUID,
  p_start_date TIMESTAMPTZ,
  p_end_date TIMESTAMPTZ,
  p_limit INTEGER DEFAULT 10
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN (
    SELECT json_agg(
      json_build_object(
        'table_id', table_id,
        'table_name', table_name,
        'reservations', reservation_count,
        'utilization_pct', ROUND(utilization_pct::NUMERIC, 1)
      )
    )
    FROM (
      SELECT 
        t.id as table_id,
        t.name as table_name,
        COUNT(r.id)::INTEGER as reservation_count,
        CASE 
          WHEN t.capacity > 0 
          THEN ROUND((COUNT(r.id)::NUMERIC / t.capacity) * 100, 1)
          ELSE 0 
        END as utilization_pct
      FROM tables t
      LEFT JOIN reservations r ON t.id = r.table_id 
        AND r.start_time BETWEEN p_start_date AND p_end_date
      WHERE t.restaurant_id = p_restaurant_id
      GROUP BY t.id, t.name, t.capacity
      ORDER BY reservation_count DESC
      LIMIT p_limit
    ) popularity_data
  );
END;
$$;

-- =============================================
-- 8. POPULAR DINING TIMES (Hourly Heatmap)
-- =============================================

CREATE OR REPLACE FUNCTION get_dining_times_heatmap(
  p_restaurant_id UUID,
  p_start_date TIMESTAMPTZ,
  p_end_date TIMESTAMPTZ
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN (
    SELECT json_agg(
      json_build_object(
        'hour', hour_num,
        'reservations', reservation_count,
        'avg_party_size', ROUND(avg_party_size::NUMERIC, 1)
      )
    )
    FROM (
      SELECT 
        EXTRACT(HOUR FROM start_time)::INTEGER as hour_num,
        COUNT(*) as reservation_count,
        AVG(party_size)::NUMERIC(10,2) as avg_party_size
      FROM reservations
      WHERE restaurant_id = p_restaurant_id
        AND start_time BETWEEN p_start_date AND p_end_date
      GROUP BY EXTRACT(HOUR FROM start_time)
      ORDER BY hour_num
    ) hourly_data
  );
END;
$$;

-- =============================================
-- 9. COMPREHENSIVE ANALYTICS SUMMARY
-- =============================================

CREATE OR REPLACE FUNCTION get_comprehensive_analytics(
  p_restaurant_id UUID,
  p_start_date TIMESTAMPTZ,
  p_end_date TIMESTAMPTZ
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN json_build_object(
    'period', json_build_object(
      'start', p_start_date,
      'end', p_end_date
    ),
    'overview', (
      SELECT json_build_object(
        'total_reservations', COUNT(*),
        'total_guests', SUM(party_size),
        'avg_party_size', ROUND(AVG(party_size)::NUMERIC, 2),
        'completed', COUNT(*) FILTER (WHERE status = 'finished'),
        'cancelled', COUNT(*) FILTER (WHERE status = 'cancelled')
      )
      FROM reservations
      WHERE restaurant_id = p_restaurant_id
        AND start_time BETWEEN p_start_date AND p_end_date
    ),
    'customer_segmentation', get_customer_segmentation(p_restaurant_id, p_start_date, p_end_date),
    'lead_time', get_lead_time_distribution(p_restaurant_id, p_start_date, p_end_date),
    'day_of_week', get_day_of_week_patterns(p_restaurant_id, p_start_date, p_end_date),
    'dining_times', get_dining_times_heatmap(p_restaurant_id, p_start_date, p_end_date),
    'table_popularity', get_table_popularity(p_restaurant_id, p_start_date, p_end_date, 10)
  );
END;
$$;

-- =============================================
-- VERIFICATION QUERY
-- =============================================

-- SELECT get_comprehensive_analytics(
--   (SELECT id FROM restaurants LIMIT 1),
--   NOW() - INTERVAL '30 days',
--   NOW()
-- );

-- SELECT get_growth_rates(
--   (SELECT id FROM restaurants LIMIT 1),
--   NOW() - INTERVAL '7 days',
--   NOW(),
--   NOW() - INTERVAL '14 days',
--   NOW() - INTERVAL '7 days'
-- );
