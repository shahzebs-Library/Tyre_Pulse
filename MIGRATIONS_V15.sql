-- ── Wave 22 Enterprise & Scale Infrastructure ─────────────────────────────────
-- MIGRATIONS_V15.sql — Multi-tenant, audit v2, performance indexes, archiving
-- Idempotent: safe to run multiple times
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Multi-tenant organisation support ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS organisations (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name         text NOT NULL UNIQUE,
  slug         text NOT NULL UNIQUE,
  plan         text NOT NULL DEFAULT 'standard' CHECK (plan IN ('standard','professional','enterprise')),
  max_users    int  DEFAULT 50,
  max_vehicles int  DEFAULT 500,
  is_active    boolean DEFAULT true,
  settings     jsonb DEFAULT '{}',
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);

-- Add org_id to profiles if not exists
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organisations(id);
CREATE INDEX IF NOT EXISTS idx_profiles_org_id ON profiles(org_id);

-- ── Enhanced Audit Log ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log_v2 (
  id          bigserial PRIMARY KEY,
  user_id     uuid REFERENCES auth.users(id),
  user_email  text,
  user_role   text,
  org_id      uuid REFERENCES organisations(id),
  action      text NOT NULL,
  table_name  text,
  record_id   text,
  old_values  jsonb,
  new_values  jsonb,
  ip_address  inet,
  user_agent  text,
  session_id  text,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_v2_user_id    ON audit_log_v2(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_v2_created_at ON audit_log_v2(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_v2_table_name ON audit_log_v2(table_name);
CREATE INDEX IF NOT EXISTS idx_audit_log_v2_action     ON audit_log_v2(action);

ALTER TABLE audit_log_v2 ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "audit_log_v2_select" ON audit_log_v2;
DROP POLICY IF EXISTS "audit_log_v2_insert" ON audit_log_v2;
CREATE POLICY "audit_log_v2_select" ON audit_log_v2 FOR SELECT TO authenticated
  USING (get_my_role() IN ('Admin','Director'));
CREATE POLICY "audit_log_v2_insert" ON audit_log_v2 FOR INSERT TO authenticated
  WITH CHECK (true);

-- ── Performance Optimisation Indexes ─────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_tyre_records_issue_date    ON tyre_records(issue_date DESC);
CREATE INDEX IF NOT EXISTS idx_tyre_records_risk_level    ON tyre_records(risk_level);
CREATE INDEX IF NOT EXISTS idx_tyre_records_asset_site    ON tyre_records(asset_no, site);
CREATE INDEX IF NOT EXISTS idx_tyre_records_brand         ON tyre_records(brand);
CREATE INDEX IF NOT EXISTS idx_tyre_records_removal_null  ON tyre_records(asset_no) WHERE km_at_removal IS NULL;
CREATE INDEX IF NOT EXISTS idx_inspections_asset_no       ON inspections(asset_no);
CREATE INDEX IF NOT EXISTS idx_inspections_site_status    ON inspections(site, status);
CREATE INDEX IF NOT EXISTS idx_inspections_scheduled_date ON inspections(scheduled_date DESC);

-- ── API Rate Limiting Table ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS api_rate_limits (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  identifier   text NOT NULL,
  endpoint     text NOT NULL,
  requests     int  DEFAULT 0,
  window_start timestamptz DEFAULT now(),
  UNIQUE (identifier, endpoint)
);

-- ── System Health Monitoring ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_health_log (
  id          bigserial PRIMARY KEY,
  metric      text NOT NULL,
  value       numeric,
  unit        text,
  tags        jsonb DEFAULT '{}',
  recorded_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_system_health_log_metric_time ON system_health_log(metric, recorded_at DESC);

ALTER TABLE system_health_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "health_admin_only" ON system_health_log;
CREATE POLICY "health_admin_only" ON system_health_log FOR ALL TO authenticated
  USING (get_my_role() = 'Admin');

-- ── Data Archiving Support ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tyre_records_archive (
  LIKE tyre_records INCLUDING ALL,
  archived_at timestamptz DEFAULT now(),
  archived_by uuid REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_tyre_records_archive_asset_no    ON tyre_records_archive(asset_no);
CREATE INDEX IF NOT EXISTS idx_tyre_records_archive_archived_at ON tyre_records_archive(archived_at DESC);

ALTER TABLE tyre_records_archive ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "archive_admin_only" ON tyre_records_archive;
CREATE POLICY "archive_admin_only" ON tyre_records_archive FOR ALL TO authenticated
  USING (get_my_role() = 'Admin');

-- ── Archiving function (archive records older than N years) ──────────────────
CREATE OR REPLACE FUNCTION archive_old_tyre_records(years_old int DEFAULT 5)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE rows_archived int;
BEGIN
  INSERT INTO tyre_records_archive
    SELECT *, now(), auth.uid()
    FROM tyre_records
    WHERE issue_date < now() - (years_old || ' years')::interval
      AND km_at_removal IS NOT NULL;

  GET DIAGNOSTICS rows_archived = ROW_COUNT;

  DELETE FROM tyre_records
  WHERE issue_date < now() - (years_old || ' years')::interval
    AND km_at_removal IS NOT NULL;

  RETURN rows_archived;
END;
$$;

-- ── updated_at trigger on organisations ───────────────────────────────────────
DROP TRIGGER IF EXISTS set_updated_at_organisations ON organisations;
CREATE TRIGGER set_updated_at_organisations
  BEFORE UPDATE ON organisations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── RLS for organisations ─────────────────────────────────────────────────────
ALTER TABLE organisations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "orgs_select"      ON organisations;
DROP POLICY IF EXISTS "orgs_admin_write" ON organisations;
CREATE POLICY "orgs_select"      ON organisations FOR SELECT TO authenticated USING (true);
CREATE POLICY "orgs_admin_write" ON organisations FOR ALL    TO authenticated
  USING (get_my_role() = 'Admin') WITH CHECK (get_my_role() = 'Admin');
