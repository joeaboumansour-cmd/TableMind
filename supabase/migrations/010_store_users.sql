-- Store Users (employees per store with per-section permission toggles)
-- Created by global admins from the admin panel.

CREATE TABLE store_users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT true,
  permissions JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(store_id, username)
);

CREATE INDEX idx_store_users_store ON store_users(store_id);

-- Allow public read for login checking (combined with password check in app code)
-- RLS is minimal here since login is handled by the app, not Supabase Auth
ALTER TABLE store_users ENABLE ROW LEVEL SECURITY;

-- Allow global admin access (service role) and store-level reads
CREATE POLICY "store_users_select" ON store_users FOR SELECT USING (true);
CREATE POLICY "store_users_insert" ON store_users FOR INSERT WITH CHECK (true);
CREATE POLICY "store_users_update" ON store_users FOR UPDATE USING (true);
CREATE POLICY "store_users_delete" ON store_users FOR DELETE USING (true);

-- Add is_active column to stores if it doesn't exist (referenced in admin page)
ALTER TABLE stores ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;