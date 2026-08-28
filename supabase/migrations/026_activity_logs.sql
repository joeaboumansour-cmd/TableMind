-- ============================================================================
-- 026: Activity Logs
-- ============================================================================
-- A fleet-wide trail of every action and UI interaction performed in a store,
-- read only by the admin console.
--
-- Retention is exactly 3 days, and it is implemented with DAILY RANGE
-- PARTITIONS rather than a DELETE. The requirement — "every new day of logs
-- deletes the oldest day" — is literally a partition drop:
-- DROP TABLE activity_logs_20260821 is instant and leaves no bloat, whereas
-- deleting a day's worth of rows every day would churn autovacuum on a live
-- database forever, and would not return the disk.
--
-- There is deliberately NO DEFAULT partition. A default partition blocks the
-- creation of any new partition that would overlap rows already sitting in it,
-- which would break the daily maintenance run. Instead, POST /api/activity
-- clamps every occurred_at into the retained window before inserting, and
-- re-runs maintenance + retries once if an insert ever does miss a partition.
--
-- The window is deliberately short, and the passive UI trail is switched off
-- (src/lib/activity/domTracker.ts), which together hold this table to a small
-- fraction of what full-fidelity logging would cost. Changing the window is a
-- one-line edit to ACTIVITY_RETENTION_DAYS; the function takes it as an
-- argument precisely so it never needs another migration.
-- ============================================================================

CREATE TABLE IF NOT EXISTS activity_logs (
  id              BIGINT      GENERATED ALWAYS AS IDENTITY,

  -- Tenancy. The column is store_id — never merchant_id or restaurant_id.
  store_id        UUID        NOT NULL REFERENCES stores(id) ON DELETE CASCADE,

  -- Who. user_id is store_users.id; NULL means the store owner, matching the
  -- convention the rest of the app uses (an owner's id IS the store id, so it
  -- is never written into a user_id column).
  user_id         UUID,
  user_name       TEXT,

  -- Where from. session_id is one browser tab/app session; device_id is stable
  -- for the browser profile. Together they make multi-tab and multi-device
  -- noise legible instead of looking like duplicate events.
  session_id      TEXT        NOT NULL,
  device_id       TEXT,

  -- What. category is the coarse bucket the admin UI filters on; action is the
  -- precise event name. Both are constrained in TypeScript
  -- (src/lib/activity/types.ts) rather than by a CHECK, so adding an event
  -- never needs a migration.
  category        TEXT        NOT NULL,
  action          TEXT        NOT NULL,
  target          TEXT,
  details         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  route           TEXT,

  -- Was the device offline when this happened? The whole point of buffering.
  is_offline      BOOLEAN     NOT NULL DEFAULT FALSE,

  -- Client-generated id, for tracing one event back to one device. There is
  -- deliberately NO unique index on it: a unique btree over this insert rate
  -- costs more than the problem it solves, and a duplicate LOG row is harmless
  -- — unlike a duplicate sale, which is what the idempotency rule in the
  -- offline-write skill exists to protect.
  client_event_id TEXT        NOT NULL,

  -- occurred_at is the CLIENT's time, captured at the moment of the action and
  -- honoured by the insert. received_at is when the server saw it. The gap
  -- between them IS the outage. Stamping a buffered event with sync time is
  -- the mistake audit P1-1 documents for offline sales; it would make this
  -- table useless for reconstructing an outage.
  occurred_at     TIMESTAMPTZ NOT NULL,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- A partitioned table must carry the partition key in every unique index,
  -- so the primary key is composite.
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

COMMENT ON TABLE  activity_logs IS 'Admin-only activity trail. Daily partitions, 3-day retention via maintain_activity_log_partitions(). The window is set by ACTIVITY_RETENTION_DAYS in src/lib/activity/types.ts, which the ingest route passes explicitly.';
COMMENT ON COLUMN activity_logs.occurred_at IS 'Client time of the action. Set by the device, NOT the server — the gap to received_at is the offline duration.';
COMMENT ON COLUMN activity_logs.user_id     IS 'store_users.id. NULL means the store owner.';

-- ----------------------------------------------------------------------------
-- Indexes
-- ----------------------------------------------------------------------------
-- Kept to three. Every index is paid on every insert, and this table takes
-- tens of thousands of inserts per store per day. Category / action / free-text
-- filters run inside the store+time window the first index already narrows.
--
-- Declared on the parent, so Postgres creates and attaches a matching index on
-- every partition, present and future.

CREATE INDEX IF NOT EXISTS idx_activity_logs_store_time
  ON activity_logs (store_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_activity_logs_time
  ON activity_logs (occurred_at);

CREATE INDEX IF NOT EXISTS idx_activity_logs_store_user
  ON activity_logs (store_id, user_id, occurred_at DESC);

-- ----------------------------------------------------------------------------
-- Access control
-- ----------------------------------------------------------------------------
-- RLS is enabled with NO permissive policy, so the anon and authenticated
-- roles cannot read or write this table at all. Every access goes through an
-- API route holding the service role key.
--
-- Both of the patterns used elsewhere in this repo would be wrong here:
--   USING (true)                   -- protects nothing; the anon key is public
--   USING (store_id = auth.uid())  -- auth.uid() is always NULL here, because
--                                  -- this app does not use Supabase Auth
-- A fleet-wide behavioural record is exactly the wrong thing to leave reachable
-- with a public key, so the grants are revoked explicitly as well — belt and
-- braces, because RLS on the parent does not govern direct access to a child
-- partition.

ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs FORCE ROW LEVEL SECURITY;

REVOKE ALL ON activity_logs FROM PUBLIC;
REVOKE ALL ON activity_logs FROM anon;
REVOKE ALL ON activity_logs FROM authenticated;
GRANT SELECT, INSERT, DELETE ON activity_logs TO service_role;

-- ----------------------------------------------------------------------------
-- Partition maintenance
-- ----------------------------------------------------------------------------
-- Creates the partitions for the retained window (and tomorrow, for headroom),
-- and drops anything that has fallen out of it.
--
-- Idempotent and safe to call concurrently: existence is checked first, and the
-- create is still wrapped so that losing a race to another instance is a no-op
-- rather than an error. Called opportunistically from POST /api/activity at
-- most once an hour; also grantable to pg_cron later if that is ever wanted.

CREATE OR REPLACE FUNCTION maintain_activity_log_partitions(p_retention_days INT DEFAULT 3)
RETURNS TABLE(action TEXT, partition_name TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_today     DATE;
  v_keep_from DATE;
  v_day       DATE;
  v_name      TEXT;
  v_child     RECORD;
  v_child_day DATE;
BEGIN
  -- Never let a bad argument widen retention or wipe everything. Must match
  -- ACTIVITY_RETENTION_DAYS in src/lib/activity/types.ts.
  IF p_retention_days IS NULL OR p_retention_days < 1 THEN
    p_retention_days := 3;
  END IF;

  v_today     := (NOW() AT TIME ZONE 'UTC')::DATE;
  -- N days retained means today plus the N-1 before it. At the current
  -- setting of 3 that is today and the two days before it.
  v_keep_from := v_today - (p_retention_days - 1);

  -- --- Create ---------------------------------------------------------------
  -- The window reaches BACKWARDS to v_keep_from, not just forward: a device
  -- that was offline for days flushes events stamped with their original,
  -- older occurred_at, and those need a partition to land in.
  -- The +1 day at the end is headroom, so ingest keeps working for a full day
  -- even if maintenance stops running.
  v_day := v_keep_from;
  WHILE v_day <= v_today + 1 LOOP
    v_name := 'activity_logs_' || TO_CHAR(v_day, 'YYYYMMDD');

    IF to_regclass('public.' || quote_ident(v_name)) IS NULL THEN
      BEGIN
        EXECUTE format(
          'CREATE TABLE %I PARTITION OF activity_logs FOR VALUES FROM (%L) TO (%L)',
          v_name,
          -- Bounds are pinned to UTC explicitly. Casting a DATE to TIMESTAMPTZ
          -- uses the session TimeZone, which would make the partition edges
          -- move with whoever happened to call this.
          (TO_CHAR(v_day,     'YYYY-MM-DD') || ' 00:00:00+00'),
          (TO_CHAR(v_day + 1, 'YYYY-MM-DD') || ' 00:00:00+00')
        );
        action := 'created';
        partition_name := v_name;
        RETURN NEXT;
      EXCEPTION
        WHEN duplicate_table OR unique_violation THEN
          -- Another instance created it between the check and the CREATE.
          NULL;
      END;
    END IF;

    v_day := v_day + 1;
  END LOOP;

  -- --- Drop -----------------------------------------------------------------
  -- Anything whose day has fallen out of the retained window. This is the
  -- "every new day deletes the oldest day" rule.
  FOR v_child IN
    SELECT c.relname AS name
    FROM pg_inherits i
    JOIN pg_class     c ON c.oid = i.inhrelid
    JOIN pg_class     p ON p.oid = i.inhparent
    JOIN pg_namespace n ON n.oid = p.relnamespace
    WHERE p.relname = 'activity_logs'
      AND n.nspname = 'public'
  LOOP
    CONTINUE WHEN v_child.name !~ '^activity_logs_[0-9]{8}$';

    v_child_day := TO_DATE(RIGHT(v_child.name, 8), 'YYYYMMDD');
    IF v_child_day < v_keep_from THEN
      EXECUTE format('DROP TABLE IF EXISTS %I', v_child.name);
      action := 'dropped';
      partition_name := v_child.name;
      RETURN NEXT;
    END IF;
  END LOOP;

  RETURN;
END;
$fn$;

COMMENT ON FUNCTION maintain_activity_log_partitions(INT) IS
  'Creates activity_logs daily partitions for the retained window (+1 day headroom) and drops anything older. Idempotent; safe to call concurrently.';

REVOKE ALL ON FUNCTION maintain_activity_log_partitions(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION maintain_activity_log_partitions(INT) TO service_role;

-- Seed the partitions so the very first insert has somewhere to go.
SELECT * FROM maintain_activity_log_partitions(3);
