-- Add RLS policies for admin_users table

-- Enable RLS on admin_users
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;

-- Allow anonymous users to read admin_users (for login)
CREATE POLICY "admin_users_select" ON admin_users FOR SELECT USING (true);

-- Allow anonymous users to manage admin_users (for admin panel)
CREATE POLICY "admin_users_all" ON admin_users FOR ALL USING (true);
