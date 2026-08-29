-- ============================================================================
-- 035: Public menu
-- ============================================================================
-- A printable QR code that opens the shop's menu: every sellable item, its
-- price, and what it comes with. Built from inventory, so it is never out of
-- date and nobody has to maintain a second list.
-- ============================================================================


-- ============================================================================
-- WHY A TOKEN AND NOT THE STORE ID
-- ============================================================================
-- The obvious URL is /<store_id>/menu. It must not be.
--
-- `x-auth-data` is an unsigned client-supplied header, and resolveCaller()
-- identifies the owner as `user_id === store_id` (see lib/auth/apiCaller.ts).
-- So knowing a store's UUID is today most of what you need to impersonate its
-- OWNER. Printing that UUID on a poster, on a table tent, and on every shared
-- link would hand it to anyone who walks past — turning audit P0-1 from
-- "requires knowing a specific UUID" into "requires reading a menu".
--
-- So the public URL carries an opaque token instead, exactly as public
-- receipts already do (migration 022). The token identifies a menu and nothing
-- else: it grants no write, and it is not the tenancy key.
--
-- The token is also ROTATABLE. A store that printed a poster it now regrets
-- can be given a new one, and the old QR simply stops resolving.

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS menu_token TEXT;

-- Unique so a token resolves to exactly one store, partial so the many stores
-- that never publish a menu do not all collide on NULL.
CREATE UNIQUE INDEX IF NOT EXISTS idx_stores_menu_token
  ON stores(menu_token)
  WHERE menu_token IS NOT NULL;


-- ============================================================================
-- PUBLISHED FLAG
-- ============================================================================
-- Separate from the token so a shop can take its menu down for a refurbishment
-- without invalidating a QR code already printed on fifty table tents.
--
-- Defaults FALSE: generating a token is deliberate, and a store's prices should
-- never become public as a side effect of a migration.
ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS menu_published BOOLEAN NOT NULL DEFAULT false;


COMMENT ON COLUMN stores.menu_token IS
  'Opaque capability token for the public menu URL. NEVER the store id — see migration 035.';
COMMENT ON COLUMN stores.menu_published IS
  'Whether the public menu resolves. Separate from the token so a menu can be taken down without reprinting QR codes.';
