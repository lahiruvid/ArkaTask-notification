-- =============================================================================
-- DClean / ArkaTasks — Supabase schema (free tier)
-- Run in Supabase → SQL Editor (safe to re-run).
--
-- Required tables for the live app:
--   app_state          — live shared JSON (one row id=main)
--   app_state_history  — sync upload trail (advanced restore)
--   app_login          — username/password recovery
--   app_full_backups   — daily full disaster-recovery copies
--
-- Optional legacy tables (properties/employees/jobs) are unused by app sync.
-- =============================================================================

-- One JSON document for the whole app
CREATE TABLE IF NOT EXISTS app_state (
  id TEXT PRIMARY KEY DEFAULT 'main',
  payload JSONB NOT NULL DEFAULT '{"properties":[],"employees":[],"jobs":[]}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO app_state (id, payload)
VALUES ('main', '{"properties":[],"employees":[],"jobs":[]}'::jsonb)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE app_state ENABLE ROW LEVEL SECURITY;

-- No DELETE for anon — devices can read/update/insert but cannot wipe the row
DROP POLICY IF EXISTS "anon_all_app_state" ON app_state;
DROP POLICY IF EXISTS "anon_select_app_state" ON app_state;
DROP POLICY IF EXISTS "anon_insert_app_state" ON app_state;
DROP POLICY IF EXISTS "anon_update_app_state" ON app_state;

CREATE POLICY "anon_select_app_state" ON app_state
  FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_app_state" ON app_state
  FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_app_state" ON app_state
  FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- Reject empty work payloads so no client can wipe the live DB row
CREATE OR REPLACE FUNCTION app_state_reject_empty()
RETURNS trigger AS $$
DECLARE
  p_count int;
  e_count int;
  j_count int;
  old_score int;
  new_score int;
BEGIN
  p_count := COALESCE(jsonb_array_length(NEW.payload->'properties'), 0);
  e_count := COALESCE(jsonb_array_length(NEW.payload->'employees'), 0);
  j_count := COALESCE(jsonb_array_length(NEW.payload->'jobs'), 0);
  new_score := p_count + e_count + j_count;

  IF TG_OP = 'UPDATE' THEN
    old_score :=
      COALESCE(jsonb_array_length(OLD.payload->'properties'), 0) +
      COALESCE(jsonb_array_length(OLD.payload->'employees'), 0) +
      COALESCE(jsonb_array_length(OLD.payload->'jobs'), 0);
    IF old_score > 0 AND new_score = 0 THEN
      RAISE EXCEPTION 'Refusing empty overwrite of app_state (data protection)';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS app_state_reject_empty_trg ON app_state;
CREATE TRIGGER app_state_reject_empty_trg
  BEFORE INSERT OR UPDATE ON app_state
  FOR EACH ROW EXECUTE PROCEDURE app_state_reject_empty();

-- Append-only history: every successful cloud upload is kept (advanced restore)
CREATE TABLE IF NOT EXISTS app_state_history (
  id BIGSERIAL PRIMARY KEY,
  payload JSONB NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT 'upload',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS app_state_history_created_at_idx
  ON app_state_history (created_at DESC);

ALTER TABLE app_state_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_all_app_state_history" ON app_state_history;
DROP POLICY IF EXISTS "anon_select_app_state_history" ON app_state_history;
DROP POLICY IF EXISTS "anon_insert_app_state_history" ON app_state_history;
DROP POLICY IF EXISTS "anon_delete_app_state_history" ON app_state_history;

CREATE POLICY "anon_select_app_state_history" ON app_state_history
  FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_app_state_history" ON app_state_history
  FOR INSERT TO anon WITH CHECK (true);
-- Allow cleanup of old history rows (optional admin / maintenance)
CREATE POLICY "anon_delete_app_state_history" ON app_state_history
  FOR DELETE TO anon USING (true);

-- Optional: older multi-table schema (unused by app sync)
CREATE TABLE IF NOT EXISTS properties (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  beds INTEGER DEFAULT 0,
  amount DECIMAL(10,2) DEFAULT 0,
  bedsheet_cost DECIMAL(10,2) DEFAULT 0,
  product_cost DECIMAL(10,2) DEFAULT 0,
  archived BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  color_code TEXT DEFAULT '#0d9488',
  archived BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL,
  date DATE NOT NULL,
  status TEXT DEFAULT 'pending',
  linen_cost DECIMAL(10,2) DEFAULT 0,
  product_cost DECIMAL(10,2) DEFAULT 0,
  charged_amount DECIMAL(10,2) DEFAULT 0,
  place_name TEXT NOT NULL DEFAULT '',
  owner_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS job_assignments (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL,
  employee_name TEXT NOT NULL DEFAULT '',
  UNIQUE(job_id, employee_id)
);

-- App login (username + password) — plain text so the developer can look it up
-- in Supabase → Table Editor → app_login when the client forgets credentials.
CREATE TABLE IF NOT EXISTS app_login (
  id TEXT PRIMARY KEY DEFAULT 'main',
  username TEXT NOT NULL DEFAULT 'admin',
  password TEXT NOT NULL DEFAULT 'admin',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO app_login (id, username, password)
VALUES ('main', 'admin', 'admin')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE app_login ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_app_login" ON app_login;
DROP POLICY IF EXISTS "anon_insert_app_login" ON app_login;
DROP POLICY IF EXISTS "anon_update_app_login" ON app_login;

CREATE POLICY "anon_select_app_login" ON app_login
  FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_app_login" ON app_login
  FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_app_login" ON app_login
  FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- Full disaster-recovery snapshots (entire AppData JSON).
-- Live work stays in app_state; these rows are copies you can restore anytime.
-- App keeps ~60 newest rows and deletes older ones automatically.
CREATE TABLE IF NOT EXISTS app_full_backups (
  id BIGSERIAL PRIMARY KEY,
  payload JSONB NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT 'daily',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS app_full_backups_created_at_idx
  ON app_full_backups (created_at DESC);

ALTER TABLE app_full_backups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_app_full_backups" ON app_full_backups;
DROP POLICY IF EXISTS "anon_insert_app_full_backups" ON app_full_backups;
DROP POLICY IF EXISTS "anon_delete_app_full_backups" ON app_full_backups;

CREATE POLICY "anon_select_app_full_backups" ON app_full_backups
  FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_app_full_backups" ON app_full_backups
  FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_delete_app_full_backups" ON app_full_backups
  FOR DELETE TO anon USING (true);

-- Optional maintenance (run manually if history grows large on free DB):
-- DELETE FROM app_state_history
-- WHERE id NOT IN (
--   SELECT id FROM app_state_history ORDER BY created_at DESC LIMIT 100
-- );
