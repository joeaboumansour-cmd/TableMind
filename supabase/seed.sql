-- GoldenSquirrel POS - Seed Data
-- Initial admin user for managing stores

-- Insert default admin user
-- Password should be hashed in production (using bcrypt or similar)
-- For demo purposes, using plain text - CHANGE THIS IN PRODUCTION
INSERT INTO admin_users (id, username, password_hash)
VALUES (
  uuid_generate_v4(),
  'admin',
  'admin123' -- In production, use: crypt('your_password', gen_salt('bf'))
);

-- Optional: Insert a demo store for testing
-- Uncomment and modify as needed
/*
INSERT INTO stores (
  id,
  username,
  password_hash,
  license_expires_at
)
VALUES (
  uuid_generate_v4(),
  'demo_store',
  'demo123', -- In production, hash this password
  NOW() + INTERVAL '1 year'
);
*/