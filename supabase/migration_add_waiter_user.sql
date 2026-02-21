-- =============================================
-- Add Test Waiter User
-- =============================================

-- Insert a waiter user for testing
-- Password: waiter123 (bcrypt hashed)
-- Only insert if the user doesn't already exist

INSERT INTO restaurant_users (restaurant_id, username, password_hash, display_name, role, is_active)
SELECT 
    r.id as restaurant_id,
    'waiter' as username,
    '$2a$10$YourHashedPasswordHere' as password_hash,  -- Placeholder - need actual hash
    'Test Waiter' as display_name,
    'waiter' as role,
    true as is_active
FROM restaurants r
WHERE r.slug = 'demo-restaurant'  -- Change this to match your restaurant slug
    AND NOT EXISTS (
        SELECT 1 FROM restaurant_users ru 
        WHERE ru.username = 'waiter' 
        AND ru.restaurant_id = r.id
    )
LIMIT 1;

-- Note: To generate the correct password hash for 'waiter123', run this in your app:
-- const bcrypt = require('bcryptjs');
-- const hash = await bcrypt.hash('waiter123', 10);
-- Then update the password_hash above with the generated hash
