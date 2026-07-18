

ALTER TABLE transactions

ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES store_users(id) ON DELETE SET NULL,

ADD COLUMN IF NOT EXISTS user_name TEXT;



COMMENT ON COLUMN transactions.user_id IS 'ID of the user (employee) who processed the transaction';

COMMENT ON COLUMN transactions.user_name IS 'Display name of the user who processed the transaction (for quick lookup)';



CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user_name ON transactions(user_name);
