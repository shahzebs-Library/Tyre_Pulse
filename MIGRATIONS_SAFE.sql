-- ============================================================
-- TYRE PULSE — SAFE IDEMPOTENT MIGRATIONS
-- Run this file in Supabase SQL Editor.
-- Every statement is safe to re-run (IF NOT EXISTS / IF EXISTS).
-- ============================================================

-- ── Extensions ──────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;          -- pgvector (enable in Dashboard first)

-- ── Helper: add column only if it doesn't exist ─────────────
CREATE OR REPLACE FUNCTION _add_col_if_missing(
  _tbl  text, _col text, _def text
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = _tbl
      AND column_name  = _col
  ) THEN
    EXECUTE format('ALTER TABLE %I ADD COLUMN %I %s', _tbl, _col, _def);
  END IF;
END; $$;

-- ════════════════════════════════════════════════════════════
-- MIGRATION V10 — employee_id, approved, country[], accidents
-- ════════════════════════════════════════════════════════════
SELECT _add_col_if_missing('profiles',  'employee_id', 'text');
SELECT _add_col_if_missing('profiles',  'approved',    'boolean DEFAULT false');
SELECT _add_col_if_missing('profiles',  'countries',   'text[] DEFAULT ARRAY[]::text[]');
SELECT _add_col_if_missing('profiles',  'role',        'text DEFAULT ''Viewer''');
SELECT _add_col_if_missing('profiles',  'full_name',   'text');
SELECT _add_col_if_missing('profiles',  'site',        'text');
SELECT _add_col_if_missing('profiles',  'country',     'text');

CREATE TABLE IF NOT EXISTS accidents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_no      text,
  driver_name   text,
  incident_date date,
  location      text,
  description   text,
  severity      text CHECK (severity IN ('Minor','Moderate','Severe','Fatal')),
  tyre_involved boolean DEFAULT false,
  cost          numeric(12,2) DEFAULT 0,
  site          text,
  country       text,
  created_by    uuid REFERENCES auth.users(id),
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

-- ════════════════════════════════════════════════════════════
-- MIGRATION V11 — gate_passes, stock_movements
-- ════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS gate_passes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pass_no       text UNIQUE,
  asset_no      text,
  driver_name   text,
  pass_date     date,
  pass_type     text CHECK (pass_type IN ('Entry','Exit','Transfer')),
  tyre_serials  text[],
  site          text,
  country       text,
  notes         text,
  issued_by     uuid REFERENCES auth.users(id),
  created_at    timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tyre_serial   text,
  from_site     text,
  to_site       text,
  movement_type text CHECK (movement_type IN ('Transfer','Issue','Return','Scrap','Purchase')),
  quantity      integer DEFAULT 1,
  moved_by      uuid REFERENCES auth.users(id),
  notes         text,
  created_at    timestamptz DEFAULT now()
);

-- ════════════════════════════════════════════════════════════
-- MIGRATION V12 — app_settings (KPI thresholds)
-- ════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS app_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_by  uuid REFERENCES auth.users(id),
  updated_at  timestamptz DEFAULT now()
);

-- Default threshold values
INSERT INTO app_settings (key, value) VALUES
  ('cpk_threshold',              '{"world_class":0.80,"good":1.20,"average":1.80,"poor":2.50}'),
  ('tread_depth_legal_mm',       '{"steer":3,"drive":3,"trailer":3,"other":2}'),
  ('pressure_tolerance_pct',     '10'),
  ('inspection_interval_days',   '30'),
  ('rotation_interval_km',       '20000'),
  ('alert_critical_tread_mm',    '2'),
  ('alert_high_tread_mm',        '3'),
  ('downtime_cost_per_hour',     '850'),
  ('fuel_cost_per_liter',        '22'),
  ('fuel_consumption_per_100km', '35')
ON CONFLICT (key) DO NOTHING;

-- ════════════════════════════════════════════════════════════
-- MIGRATION V13 — AI cache + vector knowledge base
-- ════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS ai_response_cache (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  query_hash  text UNIQUE NOT NULL,
  query_text  text,
  response    text NOT NULL,
  tokens_used integer DEFAULT 0,
  model       text,
  created_at  timestamptz DEFAULT now(),
  expires_at  timestamptz DEFAULT (now() + interval '24 hours')
);
CREATE INDEX IF NOT EXISTS idx_ai_cache_hash    ON ai_response_cache (query_hash);
CREATE INDEX IF NOT EXISTS idx_ai_cache_expires ON ai_response_cache (expires_at);

CREATE TABLE IF NOT EXISTS knowledge_documents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  source_type text CHECK (source_type IN ('SOP','Manual','Policy','Note','Report','History')),
  content     text,
  metadata    jsonb DEFAULT '{}',
  site        text,
  country     text,
  created_by  uuid REFERENCES auth.users(id),
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS document_chunks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL,
  content     text NOT NULL,
  embedding   vector(1536),
  metadata    jsonb DEFAULT '{}',
  created_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chunks_document ON document_chunks (document_id);
CREATE INDEX IF NOT EXISTS idx_chunks_embedding ON document_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ════════════════════════════════════════════════════════════
-- MIGRATION V14 — KPI snapshots (analytics DB layer)
-- ════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS kpi_snapshots (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_month       date NOT NULL,          -- first day of month
  site                 text,
  country              text,
  avg_cpk              numeric(10,4),
  avg_tyre_life_km     numeric(12,0),
  failure_rate_pct     numeric(6,2),
  scrap_rate_pct       numeric(6,2),
  pressure_compliance  numeric(6,2),
  inspection_compliance numeric(6,2),
  total_spend          numeric(14,2),
  tyre_count           integer,
  vehicle_count        integer,
  created_at           timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_kpi_snapshots_month_site
  ON kpi_snapshots (snapshot_month, COALESCE(site,''), COALESCE(country,''));
CREATE INDEX IF NOT EXISTS idx_kpi_snapshots_month ON kpi_snapshots (snapshot_month);

-- ════════════════════════════════════════════════════════════
-- MIGRATION V15 — organisations, audit_log_v2, indexes
-- ════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS organisations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        text UNIQUE NOT NULL,
  settings    jsonb DEFAULT '{}',
  plan        text DEFAULT 'starter',
  active      boolean DEFAULT true,
  created_at  timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log_v2 (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES auth.users(id),
  user_email  text,
  action      text NOT NULL,
  table_name  text,
  record_id   text,
  old_data    jsonb,
  new_data    jsonb,
  ip_address  inet,
  user_agent  text,
  site        text,
  country     text,
  created_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_v2_user    ON audit_log_v2 (user_id);
CREATE INDEX IF NOT EXISTS idx_audit_v2_table   ON audit_log_v2 (table_name);
CREATE INDEX IF NOT EXISTS idx_audit_v2_created ON audit_log_v2 (created_at DESC);

-- Performance indexes on tyre_records
CREATE INDEX IF NOT EXISTS idx_tyre_asset_date
  ON tyre_records (asset_no, issue_date DESC);
CREATE INDEX IF NOT EXISTS idx_tyre_site_date
  ON tyre_records (site, issue_date DESC);
CREATE INDEX IF NOT EXISTS idx_tyre_risk_date
  ON tyre_records (risk_level, issue_date DESC);
CREATE INDEX IF NOT EXISTS idx_tyre_country_date
  ON tyre_records (country, issue_date DESC);
CREATE INDEX IF NOT EXISTS idx_tyre_serial
  ON tyre_records (serial_number);
CREATE INDEX IF NOT EXISTS idx_tyre_brand
  ON tyre_records (brand);
CREATE INDEX IF NOT EXISTS idx_tyre_active
  ON tyre_records (km_at_removal) WHERE km_at_removal IS NULL;

-- ════════════════════════════════════════════════════════════
-- MIGRATION V16 — work_orders
-- ════════════════════════════════════════════════════════════
CREATE SEQUENCE IF NOT EXISTS work_order_seq START 1;

CREATE OR REPLACE FUNCTION generate_work_order_no() RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  RETURN 'WO-' || to_char(now(), 'YYYY') || '-' ||
         lpad(nextval('work_order_seq')::text, 5, '0');
END; $$;

CREATE TABLE IF NOT EXISTS work_orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_no   text UNIQUE NOT NULL DEFAULT generate_work_order_no(),
  asset_no        text NOT NULL,
  status          text DEFAULT 'Open'
    CHECK (status IN ('Open','In Progress','Awaiting Parts','Completed','Closed','Cancelled')),
  priority        text DEFAULT 'Medium'
    CHECK (priority IN ('Low','Medium','High','Critical')),
  work_type       text
    CHECK (work_type IN ('Tyre Change','Inspection','Repair','Rotation','Balancing',
                         'Alignment','Retread','Puncture Repair','Pressure Check',
                         'Emergency','Other')),
  description     text,
  site            text,
  country         text,
  assigned_to     text,
  labour_cost     numeric(12,2) DEFAULT 0,
  parts_cost      numeric(12,2) DEFAULT 0,
  total_cost      numeric(12,2) GENERATED ALWAYS AS (labour_cost + parts_cost) STORED,
  parts_used      jsonb DEFAULT '[]',
  scheduled_date  date,
  completed_at    timestamptz,
  tyre_serials    text[],
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wo_asset    ON work_orders (asset_no);
CREATE INDEX IF NOT EXISTS idx_wo_status   ON work_orders (status);
CREATE INDEX IF NOT EXISTS idx_wo_site     ON work_orders (site);
CREATE INDEX IF NOT EXISTS idx_wo_created  ON work_orders (created_at DESC);

-- ════════════════════════════════════════════════════════════
-- MIGRATION V17 — purchase_orders
-- ════════════════════════════════════════════════════════════
CREATE SEQUENCE IF NOT EXISTS po_seq START 1;

CREATE OR REPLACE FUNCTION generate_po_number() RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  RETURN 'PO-' || to_char(now(), 'YYYY') || '-' ||
         lpad(nextval('po_seq')::text, 5, '0');
END; $$;

CREATE TABLE IF NOT EXISTS purchase_orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number       text UNIQUE NOT NULL DEFAULT generate_po_number(),
  supplier_name   text NOT NULL,
  brand           text,
  status          text DEFAULT 'Draft'
    CHECK (status IN ('Draft','Sent','Confirmed','Partial','Delivered','Cancelled','Closed')),
  priority        text DEFAULT 'Normal'
    CHECK (priority IN ('Low','Normal','High','Urgent')),
  site            text,
  country         text,
  total_amount    numeric(14,2) DEFAULT 0,
  currency        text DEFAULT 'ZAR',
  line_items      jsonb DEFAULT '[]',
  delivery_date   date,
  notes           text,
  approved_by     uuid REFERENCES auth.users(id),
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_po_status   ON purchase_orders (status);
CREATE INDEX IF NOT EXISTS idx_po_supplier ON purchase_orders (supplier_name);
CREATE INDEX IF NOT EXISTS idx_po_site     ON purchase_orders (site);
CREATE INDEX IF NOT EXISTS idx_po_created  ON purchase_orders (created_at DESC);

-- ════════════════════════════════════════════════════════════
-- tyre_records — add missing columns safely
-- ════════════════════════════════════════════════════════════
SELECT _add_col_if_missing('tyre_records', 'category',          'text DEFAULT ''New''');
SELECT _add_col_if_missing('tyre_records', 'pressure_reading',  'numeric(6,1)');
SELECT _add_col_if_missing('tyre_records', 'tread_depth',       'numeric(5,2)');
SELECT _add_col_if_missing('tyre_records', 'km_at_fitment',     'numeric(12,0)');
SELECT _add_col_if_missing('tyre_records', 'km_at_removal',     'numeric(12,0)');
SELECT _add_col_if_missing('tyre_records', 'cost_per_tyre',     'numeric(10,2)');
SELECT _add_col_if_missing('tyre_records', 'risk_level',        'text DEFAULT ''Low''');
SELECT _add_col_if_missing('tyre_records', 'site',              'text');
SELECT _add_col_if_missing('tyre_records', 'country',           'text');
SELECT _add_col_if_missing('tyre_records', 'brand',             'text');
SELECT _add_col_if_missing('tyre_records', 'size',              'text');
SELECT _add_col_if_missing('tyre_records', 'position',          'text');
SELECT _add_col_if_missing('tyre_records', 'driver_name',       'text');
SELECT _add_col_if_missing('tyre_records', 'reason_for_removal','text');
SELECT _add_col_if_missing('tyre_records', 'serial_number',     'text');
SELECT _add_col_if_missing('tyre_records', 'asset_no',          'text');

-- inspections — add missing columns safely
CREATE TABLE IF NOT EXISTS inspections (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_no         text,
  tyre_serial      text,
  position         text,
  pressure_reading numeric(6,1),
  tread_depth      numeric(5,2),
  inspector_name   text,
  inspection_date  date DEFAULT current_date,
  site             text,
  country          text,
  notes            text,
  created_by       uuid REFERENCES auth.users(id),
  created_at       timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inspections_asset   ON inspections (asset_no);
CREATE INDEX IF NOT EXISTS idx_inspections_date    ON inspections (inspection_date DESC);
CREATE INDEX IF NOT EXISTS idx_inspections_site    ON inspections (site);
CREATE INDEX IF NOT EXISTS idx_inspections_serial  ON inspections (tyre_serial);

-- fleet_master
CREATE TABLE IF NOT EXISTS fleet_master (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_no     text UNIQUE NOT NULL,
  vehicle_type text,
  make         text,
  model        text,
  year         integer,
  site         text,
  country      text,
  active       boolean DEFAULT true,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fleet_site    ON fleet_master (site);
CREATE INDEX IF NOT EXISTS idx_fleet_country ON fleet_master (country);

-- stock
CREATE TABLE IF NOT EXISTS stock (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand      text,
  size       text,
  category   text DEFAULT 'New',
  quantity   integer DEFAULT 0,
  unit_cost  numeric(10,2),
  site       text,
  country    text,
  updated_at timestamptz DEFAULT now()
);

-- kpi_targets
CREATE TABLE IF NOT EXISTS kpi_targets (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  metric     text UNIQUE NOT NULL,
  target     numeric(12,4),
  unit       text,
  site       text,
  updated_by uuid REFERENCES auth.users(id),
  updated_at timestamptz DEFAULT now()
);

INSERT INTO kpi_targets (metric, target, unit) VALUES
  ('cpk',                  1.20, 'R/km'),
  ('tyre_life_km',        100000, 'km'),
  ('failure_rate_pct',      8.0, '%'),
  ('scrap_rate_pct',       12.0, '%'),
  ('pressure_compliance',  92.0, '%'),
  ('inspection_compliance',92.0, '%'),
  ('annual_budget',      5000000, 'ZAR')
ON CONFLICT (metric) DO NOTHING;

-- ════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY — basic multi-tenant policies
-- ════════════════════════════════════════════════════════════
-- Enable RLS where not already enabled
DO $$ BEGIN
  ALTER TABLE tyre_records     ENABLE ROW LEVEL SECURITY;
  ALTER TABLE inspections      ENABLE ROW LEVEL SECURITY;
  ALTER TABLE work_orders      ENABLE ROW LEVEL SECURITY;
  ALTER TABLE purchase_orders  ENABLE ROW LEVEL SECURITY;
  ALTER TABLE kpi_snapshots    ENABLE ROW LEVEL SECURITY;
  ALTER TABLE audit_log_v2     ENABLE ROW LEVEL SECURITY;
  ALTER TABLE accidents        ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN OTHERS THEN NULL;
END; $$;

-- Authenticated users can read all records (country-scoped in application layer)
DO $$ BEGIN
  CREATE POLICY "auth_read_tyre_records" ON tyre_records
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END; $$;

DO $$ BEGIN
  CREATE POLICY "auth_write_tyre_records" ON tyre_records
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END; $$;

DO $$ BEGIN
  CREATE POLICY "auth_read_inspections" ON inspections
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END; $$;

DO $$ BEGIN
  CREATE POLICY "auth_write_inspections" ON inspections
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END; $$;

DO $$ BEGIN
  CREATE POLICY "auth_all_work_orders" ON work_orders
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END; $$;

DO $$ BEGIN
  CREATE POLICY "auth_all_purchase_orders" ON purchase_orders
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END; $$;

-- Cleanup helper function
DROP FUNCTION IF EXISTS _add_col_if_missing(text, text, text);

-- Done
SELECT 'Tyre Pulse migrations applied successfully' AS status;
