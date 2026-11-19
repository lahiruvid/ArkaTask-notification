-- Clean-tap outbox. Composite key: one clean per apartment, per day, per employee.
--
-- Login lookup does not use this table. Employees and jobs are read from
-- app_state.payload where id = 'main' (the live DClean document).
-- The standalone employees and jobs tables in the app schema are unused by sync.
--
-- Phone match: compare digits only. A stored country prefix still matches
-- when both sides have at least 8 digits. Archived employees are skipped.
-- A job is included when date matches, status is not cancelled, and
-- job_assignments[].employee_id equals the employee.
-- Apartment id is jobs[].property_id. Apartment name is jobs[].place_name.

CREATE TABLE IF NOT EXISTS app_state (
  id TEXT PRIMARY KEY DEFAULT 'main',
  payload JSONB NOT NULL DEFAULT '{"properties":[],"employees":[],"jobs":[]}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS clean_outbox (
  apartment_id TEXT NOT NULL,
  date DATE NOT NULL,
  employee_id TEXT NOT NULL,
  employee_name TEXT NOT NULL DEFAULT '',
  employee_phone TEXT,
  apartment_name TEXT NOT NULL DEFAULT '',
  clean_time TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  relayed_at TIMESTAMPTZ,
  PRIMARY KEY (apartment_id, date, employee_id)
);
