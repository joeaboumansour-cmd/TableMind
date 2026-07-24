-- Store-Level Feature Flags
-- Adds per-store feature toggle support

-- ============================================================================
-- ADD COLUMNS TO STORES TABLE
-- ============================================================================

ALTER TABLE stores 
  ADD COLUMN IF NOT EXISTS features JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS store_type TEXT DEFAULT 'general';

COMMENT ON COLUMN stores.features IS 'Feature flags for this store (e.g., {"size_variants": true, "product_discount": true})';
COMMENT ON COLUMN stores.store_type IS 'Store type preset: retail, fashion, general';

-- ============================================================================
-- INDEX FOR QUERYING
-- ============================================================================

-- GIN index for efficient JSONB feature queries
CREATE INDEX IF NOT EXISTS idx_stores_features_gin ON stores USING GIN (features);

-- Index for filtering by store type
CREATE INDEX IF NOT EXISTS idx_stores_type ON stores(store_type);

-- ============================================================================
-- HELPER FUNCTION: Get store feature flags
-- ============================================================================

CREATE OR REPLACE FUNCTION get_store_features(p_store_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_features JSONB;
BEGIN
  SELECT features INTO v_features
  FROM stores
  WHERE id = p_store_id;

  IF v_features IS NULL THEN
    RETURN '{}'::JSONB;
  END IF;

  RETURN v_features;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION get_store_features(UUID) TO authenticated;

-- ============================================================================
-- HELPER FUNCTION: Check if a feature is enabled for a store
-- ============================================================================

CREATE OR REPLACE FUNCTION is_feature_enabled(p_store_id UUID, p_feature_key TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  v_enabled BOOLEAN;
BEGIN
  SELECT (features->>p_feature_key)::BOOLEAN INTO v_enabled
  FROM stores
  WHERE id = p_store_id;

  RETURN COALESCE(v_enabled, FALSE);
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION is_feature_enabled(UUID, TEXT) TO authenticated;