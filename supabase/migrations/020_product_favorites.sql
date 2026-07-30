-- Product Favorites (starred / quick-access items per store)
-- Persists the "frequently used" / starred products to Supabase
-- so they sync across devices and survive browser data clearing.

CREATE TABLE product_favorites (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(store_id, product_id)
);

CREATE INDEX idx_product_favorites_store ON product_favorites(store_id);
CREATE INDEX idx_product_favorites_product ON product_favorites(product_id);

-- RLS: store-scoped access (same pattern as products table)
ALTER TABLE product_favorites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "product_favorites_all" ON product_favorites FOR ALL USING (store_id = auth.uid());