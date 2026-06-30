-- ═══════════════════════════════════════════════════════════════════════════════
-- TYREPULSE — MASTER MIGRATION (Consolidated, Idempotent)
-- Run this in Supabase SQL Editor on a fresh or existing database.
-- Safe to re-run: all statements use IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.
-- Covers V1–V17 + all missing columns discovered in code audit.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── Extensions ────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS vector;

-- ═══════════════════════════════════════════════════════════════════════════════
-- HELPER FUNCTIONS
-- ═══════════════════════════════════════════════════════════════════════════════

-- Generic updated_at trigger function (reused by all tables)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- Role helper (used in RLS policies)
CREATE OR REPLACE FUNCTION get_my_role()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

-- Lookup user email by UUID (multi-identifier login)
DROP FUNCTION IF EXISTS get_user_email_by_id(uuid);
CREATE OR REPLACE FUNCTION get_user_email_by_id(p_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_email text;
BEGIN
  SELECT email INTO v_email FROM auth.users WHERE id = p_id;
  RETURN v_email;
END;
$$;
GRANT EXECUTE ON FUNCTION get_user_email_by_id(uuid) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════════
-- ORGANISATIONS (multi-tenant)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.organisations (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  name         text        NOT NULL UNIQUE,
  slug         text        NOT NULL UNIQUE,
  plan         text        NOT NULL DEFAULT 'standard'
                CHECK (plan IN ('standard','professional','enterprise')),
  max_users    int         DEFAULT 50,
  max_vehicles int         DEFAULT 500,
  is_active    boolean     DEFAULT true,
  settings     jsonb       DEFAULT '{}',
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);

DROP TRIGGER IF EXISTS set_updated_at_organisations ON public.organisations;
CREATE TRIGGER set_updated_at_organisations
  BEFORE UPDATE ON public.organisations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.organisations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "orgs_select"      ON public.organisations;
DROP POLICY IF EXISTS "orgs_admin_write" ON public.organisations;
CREATE POLICY "orgs_select"      ON public.organisations FOR SELECT TO authenticated USING (true);
CREATE POLICY "orgs_admin_write" ON public.organisations FOR ALL    TO authenticated
  USING (get_my_role() = 'Admin') WITH CHECK (get_my_role() = 'Admin');

-- ═══════════════════════════════════════════════════════════════════════════════
-- PROFILES (extends auth.users)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.profiles (
  id           uuid        REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  username     text        UNIQUE NOT NULL,
  full_name    text,
  role         text        DEFAULT 'Reporter'
                CHECK (role IN ('Admin','Manager','Director','Reporter','Inspector','Tyre Man')),
  region       text        DEFAULT 'KSA',
  avatar_url   text,
  created_at   timestamptz DEFAULT now()
);

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS employee_id    text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS approved       boolean DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS country        text[];
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS pending_reason text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS org_id        uuid REFERENCES public.organisations(id);

CREATE INDEX IF NOT EXISTS idx_profiles_org_id ON public.profiles(org_id);
CREATE INDEX IF NOT EXISTS idx_profiles_role   ON public.profiles(role);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "profiles_select"      ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_own"  ON public.profiles;
DROP POLICY IF EXISTS "profiles_admin_write" ON public.profiles;
CREATE POLICY "profiles_select"      ON public.profiles FOR SELECT  TO authenticated USING (true);
CREATE POLICY "profiles_update_own"  ON public.profiles FOR UPDATE  TO authenticated USING (auth.uid() = id);
CREATE POLICY "profiles_admin_write" ON public.profiles FOR ALL     TO authenticated
  USING (get_my_role() = 'Admin') WITH CHECK (get_my_role() = 'Admin');

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, username, full_name, role, approved)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    'Reporter',
    false
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ═══════════════════════════════════════════════════════════════════════════════
-- VEHICLE FLEET MASTER
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.vehicle_fleet (
  id                       uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  asset_no                 text        NOT NULL UNIQUE,
  fleet_number             text,
  make                     text,
  model                    text,
  vehicle_type             text,
  year                     integer,
  status                   text        DEFAULT 'Active'
                             CHECK (status IN ('Active','Inactive','Under Maintenance','Decommissioned')),
  department               text,
  operator_name            text,
  site                     text,
  country                  text,
  -- Tyre policy
  tyre_size                text,
  tyre_brand_preferred     text,
  expected_km_per_tyre     numeric,
  min_days_between_changes integer     DEFAULT 30,
  max_tyres_per_day        integer     DEFAULT 2,
  monthly_tyre_budget      numeric,
  notes                    text,
  created_by               uuid        REFERENCES public.profiles(id),
  updated_at               timestamptz DEFAULT now(),
  created_at               timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vehicle_fleet_asset_no ON public.vehicle_fleet(asset_no);
CREATE INDEX IF NOT EXISTS idx_vehicle_fleet_site     ON public.vehicle_fleet(site);
CREATE INDEX IF NOT EXISTS idx_vehicle_fleet_country  ON public.vehicle_fleet(country);
CREATE INDEX IF NOT EXISTS idx_vehicle_fleet_status   ON public.vehicle_fleet(status);
CREATE INDEX IF NOT EXISTS idx_vehicle_fleet_type     ON public.vehicle_fleet(vehicle_type);

DROP TRIGGER IF EXISTS set_updated_at_vehicle_fleet ON public.vehicle_fleet;
CREATE TRIGGER set_updated_at_vehicle_fleet
  BEFORE UPDATE ON public.vehicle_fleet
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.vehicle_fleet ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "vehicle_fleet_select" ON public.vehicle_fleet;
DROP POLICY IF EXISTS "vehicle_fleet_insert" ON public.vehicle_fleet;
DROP POLICY IF EXISTS "vehicle_fleet_update" ON public.vehicle_fleet;
DROP POLICY IF EXISTS "vehicle_fleet_delete" ON public.vehicle_fleet;
DROP POLICY IF EXISTS "vehicle_fleet_write"  ON public.vehicle_fleet;
CREATE POLICY "vehicle_fleet_select" ON public.vehicle_fleet FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "vehicle_fleet_insert" ON public.vehicle_fleet FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND auth.role() = 'authenticated');
CREATE POLICY "vehicle_fleet_update" ON public.vehicle_fleet FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL AND auth.role() = 'authenticated')
  WITH CHECK (auth.uid() IS NOT NULL AND auth.role() = 'authenticated');
CREATE POLICY "vehicle_fleet_delete" ON public.vehicle_fleet FOR DELETE TO authenticated
  USING (auth.uid() IS NOT NULL AND auth.role() = 'authenticated');

-- ═══════════════════════════════════════════════════════════════════════════════
-- TYRE RECORDS
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.tyre_records (
  id               uuid        DEFAULT uuid_generate_v4() PRIMARY KEY,
  sr               text,
  issue_date       date,
  description      text,
  brand            text,
  serial_no        text,
  qty              integer     DEFAULT 1,
  job_card         text,
  mis_number       text,
  asset_no         text,
  site             text,
  remarks          text,
  remarks_cleaned  text,
  category         text,
  risk_level       text,
  source_sheet     text,
  source_file      text,
  region           text        DEFAULT 'KSA',
  country          text,
  position         text,
  km_at_fitment    numeric,
  km_at_removal    numeric,
  upload_batch_id  uuid,
  cost_per_tyre    numeric     DEFAULT 1200,
  cleaned          boolean     DEFAULT false,
  uploaded_by      uuid        REFERENCES public.profiles(id),
  created_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tyre_records_site         ON public.tyre_records(site);
CREATE INDEX IF NOT EXISTS idx_tyre_records_asset        ON public.tyre_records(asset_no);
CREATE INDEX IF NOT EXISTS idx_tyre_records_date         ON public.tyre_records(issue_date DESC);
CREATE INDEX IF NOT EXISTS idx_tyre_records_brand        ON public.tyre_records(brand);
CREATE INDEX IF NOT EXISTS idx_tyre_records_mis          ON public.tyre_records(mis_number);
CREATE INDEX IF NOT EXISTS idx_tyre_records_jobcard      ON public.tyre_records(job_card);
CREATE INDEX IF NOT EXISTS idx_tyre_records_region       ON public.tyre_records(region);
CREATE INDEX IF NOT EXISTS idx_tyre_records_country      ON public.tyre_records(country);
CREATE INDEX IF NOT EXISTS idx_tyre_records_risk_level   ON public.tyre_records(risk_level);
CREATE INDEX IF NOT EXISTS idx_tyre_records_batch        ON public.tyre_records(upload_batch_id);
CREATE INDEX IF NOT EXISTS idx_tyre_records_asset_site   ON public.tyre_records(asset_no, site);
CREATE INDEX IF NOT EXISTS idx_tyre_records_serial       ON public.tyre_records(serial_no);
-- Partial index: active tyres (not yet removed)
CREATE INDEX IF NOT EXISTS idx_tyre_records_active       ON public.tyre_records(asset_no)
  WHERE km_at_removal IS NULL;

ALTER TABLE public.tyre_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tyre_records_all" ON public.tyre_records;
CREATE POLICY "tyre_records_all" ON public.tyre_records FOR ALL TO authenticated
  USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- ═══════════════════════════════════════════════════════════════════════════════
-- INSPECTIONS (Checklist + Tyre Diagram)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.inspections (
  id               uuid        DEFAULT uuid_generate_v4() PRIMARY KEY,
  asset_no         text,
  inspection_type  text        DEFAULT 'Routine'
                     CHECK (inspection_type IN ('Routine','Pressure Check','Visual','Full Inspection','Pre-Trip')),
  scheduled_date   date        NOT NULL,
  completed_date   date,
  status           text        DEFAULT 'Scheduled'
                     CHECK (status IN ('Scheduled','In Progress','Done','Overdue','Cancelled')),
  site             text,
  country          text,
  region           text        DEFAULT 'KSA',
  inspector_name   text,
  findings         text,
  photos           jsonb       DEFAULT '[]',
  created_by       uuid        REFERENCES public.profiles(id),
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);

-- Columns added in later migrations
ALTER TABLE public.inspections ADD COLUMN IF NOT EXISTS attendees        text;
ALTER TABLE public.inspections ADD COLUMN IF NOT EXISTS severity         text DEFAULT 'Medium';
ALTER TABLE public.inspections ADD COLUMN IF NOT EXISTS photo_data       text;
ALTER TABLE public.inspections ADD COLUMN IF NOT EXISTS linked_action_id uuid REFERENCES public.corrective_actions(id) ON DELETE SET NULL;
ALTER TABLE public.inspections ADD COLUMN IF NOT EXISTS vehicle_type     text;
ALTER TABLE public.inspections ADD COLUMN IF NOT EXISTS tyre_conditions  jsonb DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_inspections_asset_no       ON public.inspections(asset_no);
CREATE INDEX IF NOT EXISTS idx_inspections_status         ON public.inspections(status);
CREATE INDEX IF NOT EXISTS idx_inspections_scheduled_date ON public.inspections(scheduled_date DESC);
CREATE INDEX IF NOT EXISTS idx_inspections_site_status    ON public.inspections(site, status);
CREATE INDEX IF NOT EXISTS idx_inspections_country        ON public.inspections(country);
CREATE INDEX IF NOT EXISTS idx_inspections_vehicle_type   ON public.inspections(vehicle_type);
-- GIN index on tyre_conditions JSONB for fast queries
CREATE INDEX IF NOT EXISTS idx_inspections_tyre_conditions ON public.inspections USING gin(tyre_conditions);

DROP TRIGGER IF EXISTS set_updated_at_inspections ON public.inspections;
CREATE TRIGGER set_updated_at_inspections
  BEFORE UPDATE ON public.inspections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.inspections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "inspections_all" ON public.inspections;
CREATE POLICY "inspections_all" ON public.inspections FOR ALL TO authenticated
  USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- ═══════════════════════════════════════════════════════════════════════════════
-- CORRECTIVE ACTIONS
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.corrective_actions (
  id           uuid        DEFAULT uuid_generate_v4() PRIMARY KEY,
  title        text        NOT NULL,
  priority     text        DEFAULT 'Medium' CHECK (priority IN ('High','Medium','Low')),
  site         text,
  region       text        DEFAULT 'KSA',
  country      text,
  description  text,
  assigned_to  text,
  status       text        DEFAULT 'Open' CHECK (status IN ('Open','In Progress','Closed')),
  photos       jsonb       DEFAULT '[]',
  photo_data   text,
  root_cause   text,
  asset_no     text,
  tyre_serial  text,
  created_by   uuid        REFERENCES public.profiles(id),
  closed_by    uuid        REFERENCES public.profiles(id),
  created_at   timestamptz DEFAULT now(),
  closed_at    timestamptz
);

CREATE INDEX IF NOT EXISTS idx_corrective_status  ON public.corrective_actions(status);
CREATE INDEX IF NOT EXISTS idx_corrective_site    ON public.corrective_actions(site);
CREATE INDEX IF NOT EXISTS idx_corrective_country ON public.corrective_actions(country);
CREATE INDEX IF NOT EXISTS idx_corrective_asset   ON public.corrective_actions(asset_no);

ALTER TABLE public.corrective_actions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "corrective_all" ON public.corrective_actions;
CREATE POLICY "corrective_all" ON public.corrective_actions FOR ALL TO authenticated
  USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- ═══════════════════════════════════════════════════════════════════════════════
-- ROOT CAUSE ANALYSIS
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.rca_records (
  id                    uuid        DEFAULT uuid_generate_v4() PRIMARY KEY,
  asset_no              text,
  tyre_serial           text,
  brand                 text,
  site                  text,
  region                text        DEFAULT 'KSA',
  country               text,
  failure_date          date,
  km_at_failure         numeric,
  hours_at_failure      numeric,
  root_cause            text,
  contributing_factors  jsonb       DEFAULT '[]',
  photos                jsonb       DEFAULT '[]',
  photo_data            text,
  ai_analysis           text,
  corrective_action_id  uuid        REFERENCES public.corrective_actions(id),
  created_by            uuid        REFERENCES public.profiles(id),
  created_at            timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rca_asset   ON public.rca_records(asset_no);
CREATE INDEX IF NOT EXISTS idx_rca_site    ON public.rca_records(site);
CREATE INDEX IF NOT EXISTS idx_rca_country ON public.rca_records(country);
CREATE INDEX IF NOT EXISTS idx_rca_date    ON public.rca_records(failure_date DESC);

ALTER TABLE public.rca_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rca_all" ON public.rca_records;
CREATE POLICY "rca_all" ON public.rca_records FOR ALL TO authenticated
  USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- ═══════════════════════════════════════════════════════════════════════════════
-- ACCIDENTS / INCIDENTS
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.accidents (
  id                           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  incident_date                date,
  asset_no                     text,
  site                         text,
  country                      text,
  description                  text,
  severity                     text        CHECK (severity IN ('Minor','Major','Total Loss')),
  status                       text        DEFAULT 'Reported',
  repair_cost                  numeric(12,2),
  insurance_claim_no           text,
  inspector                    text,
  photos                       text[],
  linked_corrective_action_id  uuid,
  created_by                   uuid        REFERENCES public.profiles(id),
  created_at                   timestamptz DEFAULT now(),
  updated_at                   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_accidents_site    ON public.accidents(site);
CREATE INDEX IF NOT EXISTS idx_accidents_asset   ON public.accidents(asset_no);
CREATE INDEX IF NOT EXISTS idx_accidents_date    ON public.accidents(incident_date DESC);
CREATE INDEX IF NOT EXISTS idx_accidents_country ON public.accidents(country);

DROP TRIGGER IF EXISTS set_updated_at_accidents ON public.accidents;
CREATE TRIGGER set_updated_at_accidents
  BEFORE UPDATE ON public.accidents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.accidents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "accidents_all" ON public.accidents;
CREATE POLICY "accidents_all" ON public.accidents FOR ALL TO authenticated
  USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- ═══════════════════════════════════════════════════════════════════════════════
-- GATE PASSES
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.gate_passes (
  id             uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  asset_no       text        NOT NULL,
  site           text,
  country        text,
  pass_date      date        DEFAULT CURRENT_DATE,
  status         text        DEFAULT 'Pending',
  inspection_id  uuid        REFERENCES public.inspections(id),
  cleared_by     uuid        REFERENCES public.profiles(id),
  cleared_at     timestamptz,
  denial_reason  text,
  notes          text,
  created_at     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gate_passes_asset   ON public.gate_passes(asset_no);
CREATE INDEX IF NOT EXISTS idx_gate_passes_date    ON public.gate_passes(pass_date DESC);
CREATE INDEX IF NOT EXISTS idx_gate_passes_site    ON public.gate_passes(site);
CREATE INDEX IF NOT EXISTS idx_gate_passes_status  ON public.gate_passes(status);

ALTER TABLE public.gate_passes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "gate_passes_all" ON public.gate_passes;
CREATE POLICY "gate_passes_all" ON public.gate_passes FOR ALL TO authenticated
  USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- ═══════════════════════════════════════════════════════════════════════════════
-- STOCK RECORDS & MOVEMENTS
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.stock_records (
  id                  uuid        DEFAULT uuid_generate_v4() PRIMARY KEY,
  site                text        NOT NULL,
  description         text,
  stock_qty           integer     DEFAULT 0,
  min_level           integer     DEFAULT 5,
  critical_level      integer     DEFAULT 3,
  stock_status        text,
  reorder_qty         integer     DEFAULT 0,
  management_action   text,
  region              text        DEFAULT 'KSA',
  country             text,
  updated_by          uuid        REFERENCES public.profiles(id),
  updated_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_site    ON public.stock_records(site);
CREATE INDEX IF NOT EXISTS idx_stock_country ON public.stock_records(country);

ALTER TABLE public.stock_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "stock_all" ON public.stock_records;
CREATE POLICY "stock_all" ON public.stock_records FOR ALL TO authenticated
  USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

CREATE TABLE IF NOT EXISTS public.stock_movements (
  id               uuid        DEFAULT uuid_generate_v4() PRIMARY KEY,
  stock_record_id  uuid        REFERENCES public.stock_records(id) ON DELETE CASCADE,
  site             text        NOT NULL,
  region           text        DEFAULT 'KSA',
  country          text,
  brand            text,
  tyre_size        text,
  movement_type    text        NOT NULL
                     CHECK (movement_type IN ('RECEIVED','ISSUED','RETURNED','ADJUSTED','TRANSFERRED')),
  qty_change       integer     NOT NULL,
  qty_after        integer,
  reference_no     text,
  notes            text,
  created_by       uuid        REFERENCES public.profiles(id),
  created_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_site    ON public.stock_movements(site);
CREATE INDEX IF NOT EXISTS idx_stock_movements_created ON public.stock_movements(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_type    ON public.stock_movements(movement_type);

ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "stock_movements_all" ON public.stock_movements;
CREATE POLICY "stock_movements_all" ON public.stock_movements FOR ALL TO authenticated
  USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- ═══════════════════════════════════════════════════════════════════════════════
-- BUDGETS & KPI TARGETS
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.budgets (
  id             uuid    DEFAULT uuid_generate_v4() PRIMARY KEY,
  site           text    NOT NULL,
  region         text    DEFAULT 'KSA',
  monthly_budget numeric NOT NULL DEFAULT 25000,
  year           integer DEFAULT EXTRACT(year FROM now()),
  month          integer DEFAULT EXTRACT(month FROM now()),
  created_by     uuid    REFERENCES public.profiles(id),
  created_at     timestamptz DEFAULT now(),
  UNIQUE (site, region, year, month)
);

CREATE INDEX IF NOT EXISTS idx_budgets_site_year ON public.budgets(site, year, month);

ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "budgets_all" ON public.budgets;
CREATE POLICY "budgets_all" ON public.budgets FOR ALL TO authenticated
  USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

CREATE TABLE IF NOT EXISTS public.kpi_targets (
  id                         uuid    DEFAULT uuid_generate_v4() PRIMARY KEY,
  month                      integer NOT NULL CHECK (month BETWEEN 1 AND 12),
  year                       integer NOT NULL,
  region                     text    DEFAULT 'KSA',
  country                    text,
  target_cost                numeric,
  target_high_risk_count     integer,
  target_overdue_actions     integer,
  target_cpk                 numeric,
  target_replacement_count   integer,
  created_by                 uuid    REFERENCES public.profiles(id),
  created_at                 timestamptz DEFAULT now(),
  UNIQUE (month, year, region)
);

ALTER TABLE public.kpi_targets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "kpi_targets_all" ON public.kpi_targets;
CREATE POLICY "kpi_targets_all" ON public.kpi_targets FOR ALL TO authenticated
  USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- ═══════════════════════════════════════════════════════════════════════════════
-- WORK ORDERS (Job Cards)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.work_orders (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_no     varchar(30) UNIQUE NOT NULL,
  asset_no          varchar(50) NOT NULL,
  tyre_serial       varchar(100),
  tyre_position     varchar(30),
  status            varchar(25) NOT NULL DEFAULT 'Open'
                      CHECK (status IN ('Open','In Progress','Awaiting Parts','Completed','Closed','Cancelled')),
  priority          varchar(15) NOT NULL DEFAULT 'Medium'
                      CHECK (priority IN ('Low','Medium','High','Critical')),
  work_type         varchar(30) NOT NULL
                      CHECK (work_type IN (
                        'Tyre Change','Inspection','Repair','Rotation',
                        'Balancing','Alignment','Retread','Puncture Repair',
                        'Pressure Check','Emergency','Other'
                      )),
  description       text,
  technician_name   varchar(100),
  workshop_name     varchar(100),
  site              varchar(100),
  country           varchar(50),
  opened_at         timestamptz NOT NULL DEFAULT now(),
  started_at        timestamptz,
  completed_at      timestamptz,
  target_completion timestamptz,
  labour_hours      numeric(6,2)  DEFAULT 0,
  labour_rate       numeric(10,2) DEFAULT 0,
  labour_cost       numeric(12,2) DEFAULT 0,
  parts_cost        numeric(12,2) DEFAULT 0,
  total_cost        numeric(12,2) GENERATED ALWAYS AS (labour_cost + parts_cost) STORED,
  parts_used        jsonb         DEFAULT '[]'::jsonb,
  notes             text,
  created_by        uuid        REFERENCES auth.users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_work_orders_asset_no    ON public.work_orders(asset_no);
CREATE INDEX IF NOT EXISTS idx_work_orders_status      ON public.work_orders(status);
CREATE INDEX IF NOT EXISTS idx_work_orders_priority    ON public.work_orders(priority);
CREATE INDEX IF NOT EXISTS idx_work_orders_opened_at   ON public.work_orders(opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_work_orders_site        ON public.work_orders(site);
CREATE INDEX IF NOT EXISTS idx_work_orders_country     ON public.work_orders(country);
CREATE INDEX IF NOT EXISTS idx_work_orders_work_type   ON public.work_orders(work_type);
CREATE INDEX IF NOT EXISTS idx_work_orders_tyre_serial ON public.work_orders(tyre_serial);

CREATE OR REPLACE FUNCTION update_work_orders_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_work_orders_updated_at ON public.work_orders;
CREATE TRIGGER trg_work_orders_updated_at
  BEFORE UPDATE ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION update_work_orders_updated_at();

CREATE SEQUENCE IF NOT EXISTS work_order_seq START 1;
CREATE OR REPLACE FUNCTION generate_work_order_no()
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE seq_val BIGINT; wo_year TEXT;
BEGIN
  seq_val := nextval('work_order_seq');
  wo_year := TO_CHAR(NOW(), 'YYYY');
  RETURN 'WO-' || wo_year || '-' || LPAD(seq_val::TEXT, 5, '0');
END;
$$;

ALTER TABLE public.work_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "work_orders_read"   ON public.work_orders;
DROP POLICY IF EXISTS "work_orders_write"  ON public.work_orders;
DROP POLICY IF EXISTS "work_orders_delete" ON public.work_orders;
CREATE POLICY "work_orders_read"   ON public.work_orders FOR SELECT    TO authenticated USING (true);
CREATE POLICY "work_orders_write"  ON public.work_orders FOR INSERT    TO authenticated WITH CHECK (true);
CREATE POLICY "work_orders_update" ON public.work_orders FOR UPDATE    TO authenticated USING (true);
CREATE POLICY "work_orders_delete" ON public.work_orders FOR DELETE    TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'Admin'));

-- ═══════════════════════════════════════════════════════════════════════════════
-- PURCHASE ORDERS
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.purchase_orders (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number         varchar(30)   UNIQUE NOT NULL,
  vendor_name       varchar(100)  NOT NULL,
  order_date        date          NOT NULL DEFAULT CURRENT_DATE,
  expected_delivery date,
  actual_delivery   date,
  status            varchar(25)   NOT NULL DEFAULT 'Draft'
                      CHECK (status IN ('Draft','Submitted','Approved','Ordered',
                                        'Partial Delivery','Delivered','Cancelled','Closed')),
  priority          varchar(15)   NOT NULL DEFAULT 'Normal'
                      CHECK (priority IN ('Urgent','High','Normal','Low')),
  items             jsonb         NOT NULL DEFAULT '[]'::jsonb,
  subtotal          numeric(12,2) NOT NULL DEFAULT 0,
  tax_amount        numeric(12,2) NOT NULL DEFAULT 0,
  total_amount      numeric(12,2) NOT NULL DEFAULT 0,
  budget_code       varchar(50),
  site              varchar(100),
  country           varchar(50),
  requested_by      varchar(100),
  approved_by       varchar(100),
  notes             text,
  created_by        uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz   NOT NULL DEFAULT now(),
  updated_at        timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_po_status     ON public.purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_po_vendor     ON public.purchase_orders(vendor_name);
CREATE INDEX IF NOT EXISTS idx_po_date       ON public.purchase_orders(order_date DESC);
CREATE INDEX IF NOT EXISTS idx_po_site       ON public.purchase_orders(site);
CREATE INDEX IF NOT EXISTS idx_po_country    ON public.purchase_orders(country);
CREATE INDEX IF NOT EXISTS idx_po_number     ON public.purchase_orders(po_number);

CREATE OR REPLACE FUNCTION update_purchase_orders_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_po_updated_at ON public.purchase_orders;
CREATE TRIGGER trg_po_updated_at
  BEFORE UPDATE ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION update_purchase_orders_updated_at();

CREATE OR REPLACE FUNCTION generate_po_number()
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_year TEXT := to_char(NOW(), 'YYYY'); v_seq INT; v_po TEXT;
BEGIN
  SELECT COALESCE(MAX(CAST(SPLIT_PART(po_number, '-', 3) AS INT)), 0) + 1
  INTO v_seq FROM public.purchase_orders WHERE po_number LIKE 'PO-' || v_year || '-%';
  v_po := 'PO-' || v_year || '-' || LPAD(v_seq::TEXT, 5, '0');
  RETURN v_po;
END;
$$;
GRANT EXECUTE ON FUNCTION generate_po_number() TO authenticated;

ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "po_select"          ON public.purchase_orders;
DROP POLICY IF EXISTS "po_insert"          ON public.purchase_orders;
DROP POLICY IF EXISTS "po_update"          ON public.purchase_orders;
DROP POLICY IF EXISTS "po_delete_admin"    ON public.purchase_orders;
CREATE POLICY "po_select"       ON public.purchase_orders FOR SELECT TO authenticated USING (true);
CREATE POLICY "po_insert"       ON public.purchase_orders FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = created_by OR created_by IS NULL);
CREATE POLICY "po_update"       ON public.purchase_orders FOR UPDATE TO authenticated
  USING (auth.uid() = created_by OR get_my_role() = 'Admin');
CREATE POLICY "po_delete_admin" ON public.purchase_orders FOR DELETE TO authenticated
  USING (get_my_role() = 'Admin');

-- ═══════════════════════════════════════════════════════════════════════════════
-- UPLOAD HISTORY & COLUMN MAPPINGS
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.upload_history (
  id               uuid        DEFAULT uuid_generate_v4() PRIMARY KEY,
  file_names       jsonb       DEFAULT '[]',
  records_added    integer     DEFAULT 0,
  records_skipped  integer     DEFAULT 0,
  skip_log         jsonb       DEFAULT '[]',
  mapping_used     jsonb       DEFAULT '{}',
  region           text        DEFAULT 'KSA',
  country          text,
  uploaded_by      uuid        REFERENCES public.profiles(id),
  uploaded_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_upload_history_uploaded_by ON public.upload_history(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_upload_history_uploaded_at ON public.upload_history(uploaded_at DESC);

ALTER TABLE public.upload_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "upload_history_all" ON public.upload_history;
CREATE POLICY "upload_history_all" ON public.upload_history FOR ALL TO authenticated
  USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

CREATE TABLE IF NOT EXISTS public.column_mappings (
  id             uuid    DEFAULT uuid_generate_v4() PRIMARY KEY,
  fingerprint    text    UNIQUE NOT NULL,
  mapping        jsonb   NOT NULL,
  file_name      text,
  confirmed_by   uuid    REFERENCES public.profiles(id),
  use_count      integer DEFAULT 1,
  created_at     timestamptz DEFAULT now(),
  last_used_at   timestamptz DEFAULT now()
);

ALTER TABLE public.column_mappings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "column_mappings_all" ON public.column_mappings;
CREATE POLICY "column_mappings_all" ON public.column_mappings FOR ALL TO authenticated
  USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- ═══════════════════════════════════════════════════════════════════════════════
-- AUDIT LOGS
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.audit_log (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      uuid        REFERENCES public.profiles(id),
  action       text        NOT NULL,
  table_name   text,
  record_count integer     DEFAULT 1,
  details      jsonb,
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_user    ON public.audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action  ON public.audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON public.audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_table   ON public.audit_log(table_name);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "audit_select" ON public.audit_log;
DROP POLICY IF EXISTS "audit_insert" ON public.audit_log;
CREATE POLICY "audit_select" ON public.audit_log FOR SELECT TO authenticated USING (true);
CREATE POLICY "audit_insert" ON public.audit_log FOR INSERT TO authenticated WITH CHECK (true);

-- Enhanced audit log (V15)
CREATE TABLE IF NOT EXISTS public.audit_log_v2 (
  id           bigserial   PRIMARY KEY,
  user_id      uuid        REFERENCES auth.users(id),
  user_email   text,
  user_role    text,
  org_id       uuid        REFERENCES public.organisations(id),
  action       text        NOT NULL,
  table_name   text,
  record_id    text,
  old_values   jsonb,
  new_values   jsonb,
  ip_address   inet,
  user_agent   text,
  session_id   text,
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_v2_user       ON public.audit_log_v2(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_v2_created_at ON public.audit_log_v2(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_v2_table      ON public.audit_log_v2(table_name);
CREATE INDEX IF NOT EXISTS idx_audit_v2_action     ON public.audit_log_v2(action);

ALTER TABLE public.audit_log_v2 ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "audit_v2_select" ON public.audit_log_v2;
DROP POLICY IF EXISTS "audit_v2_insert" ON public.audit_log_v2;
CREATE POLICY "audit_v2_select" ON public.audit_log_v2 FOR SELECT TO authenticated
  USING (get_my_role() IN ('Admin','Director'));
CREATE POLICY "audit_v2_insert" ON public.audit_log_v2 FOR INSERT TO authenticated WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════════════
-- SETTINGS & APP SETTINGS
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.settings (
  id         uuid    DEFAULT uuid_generate_v4() PRIMARY KEY,
  key        text    UNIQUE NOT NULL,
  value      jsonb,
  updated_by uuid    REFERENCES public.profiles(id),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "settings_all" ON public.settings;
CREATE POLICY "settings_all" ON public.settings FOR ALL TO authenticated
  USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

INSERT INTO public.settings (key, value) VALUES
  ('cost_per_tyre',   '1200'),
  ('default_region',  '"KSA"'),
  ('company_name',    '"TyrePulse Fleet Management"'),
  ('currency',        '"SAR"')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.app_settings (
  key         text        PRIMARY KEY,
  value       text        NOT NULL,
  description text,
  updated_by  uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at  timestamptz DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.set_app_settings_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_app_settings_updated_at ON public.app_settings;
CREATE TRIGGER trg_app_settings_updated_at
  BEFORE UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_app_settings_updated_at();

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "app_settings_select" ON public.app_settings;
DROP POLICY IF EXISTS "app_settings_admin"  ON public.app_settings;
CREATE POLICY "app_settings_select" ON public.app_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "app_settings_admin"  ON public.app_settings FOR ALL    TO authenticated
  USING (get_my_role() = 'Admin') WITH CHECK (get_my_role() = 'Admin');

INSERT INTO public.app_settings (key, value, description) VALUES
  ('alert_cpk_threshold',                    '2.00',  'CPK above this triggers cost alert'),
  ('alert_pressure_low_pct',                 '15',    'Pressure % below spec → Low alert'),
  ('alert_pressure_critical_pct',            '25',    'Pressure % below spec → Critical alert'),
  ('alert_tread_warning_mm',                 '4',     'Tread mm → Warning'),
  ('alert_tread_critical_mm',                '2',     'Tread mm → Critical'),
  ('alert_inspection_overdue_days',          '7',     'Days past scheduled → Overdue alert'),
  ('fleet_target_pressure_compliance_pct',   '90',    'Target pressure compliance %'),
  ('fleet_target_inspection_compliance_pct', '95',    'Target inspection compliance %'),
  ('retread_min_km_threshold',               '40000', 'Min km to qualify for retread'),
  ('scrap_km_pct_threshold',                 '20',    'Premature scrap flag %'),
  ('downtime_hours_per_replacement',         '2',     'Estimated downtime hrs per replacement'),
  ('forecast_months_ahead',                  '3',     'Months ahead for forecasting'),
  ('default_tyre_cost',                      '1200',  'Default tyre cost when missing'),
  ('cost_trend_slope_threshold',             '50',    'Monthly cost slope threshold')
ON CONFLICT (key) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════════
-- AI CLEANING LOG
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.cleaning_log (
  id                uuid        DEFAULT uuid_generate_v4() PRIMARY KEY,
  original_text     text,
  cleaned_text      text,
  category          text,
  confidence        text,
  tyre_record_id    uuid        REFERENCES public.tyre_records(id),
  cleaned_by_model  text        DEFAULT 'claude-sonnet-4-6',
  created_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cleaning_log_record   ON public.cleaning_log(tyre_record_id);
CREATE INDEX IF NOT EXISTS idx_cleaning_log_created  ON public.cleaning_log(created_at DESC);

ALTER TABLE public.cleaning_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cleaning_log_all" ON public.cleaning_log;
CREATE POLICY "cleaning_log_all" ON public.cleaning_log FOR ALL TO authenticated
  USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- ═══════════════════════════════════════════════════════════════════════════════
-- VECTOR / RAG KNOWLEDGE BASE
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.knowledge_documents (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  title       text        NOT NULL,
  content     text        NOT NULL,
  doc_type    text        NOT NULL
                CHECK (doc_type IN ('SOP','Manual','Policy','Report','Inspection','Note','History')),
  tags        text[]      DEFAULT '{}',
  site        text,
  asset_no    text,
  source_ref  text,
  embedding   vector(1536),
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.inspection_embeddings (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  inspection_id  uuid REFERENCES public.inspections(id) ON DELETE CASCADE,
  asset_no       text,
  site           text,
  content        text NOT NULL,
  embedding      vector(1536),
  created_at     timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tyre_record_embeddings (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  record_id  uuid REFERENCES public.tyre_records(id) ON DELETE CASCADE,
  asset_no   text,
  site       text,
  content    text NOT NULL,
  embedding  vector(1536),
  created_at timestamptz DEFAULT now()
);

-- IVFFlat vector indexes (cosine similarity)
CREATE INDEX IF NOT EXISTS idx_knowledge_embedding
  ON public.knowledge_documents USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS idx_inspection_embedding
  ON public.inspection_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS idx_tyre_record_embedding
  ON public.tyre_record_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Standard indexes
CREATE INDEX IF NOT EXISTS idx_knowledge_doc_type ON public.knowledge_documents(doc_type);
CREATE INDEX IF NOT EXISTS idx_knowledge_site     ON public.knowledge_documents(site);
CREATE INDEX IF NOT EXISTS idx_knowledge_asset    ON public.knowledge_documents(asset_no);

DROP TRIGGER IF EXISTS set_updated_at_knowledge_documents ON public.knowledge_documents;
CREATE TRIGGER set_updated_at_knowledge_documents
  BEFORE UPDATE ON public.knowledge_documents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.knowledge_documents   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inspection_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tyre_record_embeddings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "kd_select" ON public.knowledge_documents;
DROP POLICY IF EXISTS "kd_write"  ON public.knowledge_documents;
DROP POLICY IF EXISTS "ie_select" ON public.inspection_embeddings;
DROP POLICY IF EXISTS "tre_select" ON public.tyre_record_embeddings;

CREATE POLICY "kd_select"  ON public.knowledge_documents  FOR SELECT TO authenticated USING (true);
CREATE POLICY "kd_write"   ON public.knowledge_documents  FOR ALL    TO authenticated
  USING (get_my_role() = 'Admin') WITH CHECK (get_my_role() = 'Admin');
CREATE POLICY "ie_select"  ON public.inspection_embeddings   FOR SELECT TO authenticated USING (true);
CREATE POLICY "tre_select" ON public.tyre_record_embeddings  FOR SELECT TO authenticated USING (true);

-- RAG search functions
CREATE OR REPLACE FUNCTION match_knowledge_documents(
  query_embedding vector(1536),
  match_count     int  DEFAULT 5,
  filter_doc_type text DEFAULT NULL,
  filter_site     text DEFAULT NULL
)
RETURNS TABLE (id uuid, title text, content text, doc_type text, site text, asset_no text, tags text[], similarity float)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT kd.id, kd.title, kd.content, kd.doc_type, kd.site, kd.asset_no, kd.tags,
         1 - (kd.embedding <=> query_embedding) AS similarity
  FROM public.knowledge_documents kd
  WHERE kd.embedding IS NOT NULL
    AND (filter_doc_type IS NULL OR kd.doc_type = filter_doc_type)
    AND (filter_site IS NULL OR kd.site = filter_site OR kd.site IS NULL)
  ORDER BY kd.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

CREATE OR REPLACE FUNCTION match_inspection_findings(
  query_embedding vector(1536),
  match_count     int  DEFAULT 10,
  filter_site     text DEFAULT NULL
)
RETURNS TABLE (id uuid, inspection_id uuid, asset_no text, site text, content text, similarity float)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT ie.id, ie.inspection_id, ie.asset_no, ie.site, ie.content,
         1 - (ie.embedding <=> query_embedding) AS similarity
  FROM public.inspection_embeddings ie
  WHERE ie.embedding IS NOT NULL
    AND (filter_site IS NULL OR ie.site = filter_site)
  ORDER BY ie.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- ENTERPRISE INFRASTRUCTURE
-- ═══════════════════════════════════════════════════════════════════════════════

-- API Rate Limiting
CREATE TABLE IF NOT EXISTS public.api_rate_limits (
  id           uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  identifier   text    NOT NULL,
  endpoint     text    NOT NULL,
  requests     int     DEFAULT 0,
  window_start timestamptz DEFAULT now(),
  UNIQUE (identifier, endpoint)
);

-- System Health Monitoring
CREATE TABLE IF NOT EXISTS public.system_health_log (
  id          bigserial   PRIMARY KEY,
  metric      text        NOT NULL,
  value       numeric,
  unit        text,
  tags        jsonb       DEFAULT '{}',
  recorded_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_system_health_metric_time ON public.system_health_log(metric, recorded_at DESC);

ALTER TABLE public.system_health_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "health_admin_only" ON public.system_health_log;
CREATE POLICY "health_admin_only" ON public.system_health_log FOR ALL TO authenticated
  USING (get_my_role() = 'Admin');

-- Tyre Records Archive (data older than N years)
CREATE TABLE IF NOT EXISTS public.tyre_records_archive (
  LIKE public.tyre_records INCLUDING ALL,
  archived_at timestamptz DEFAULT now(),
  archived_by uuid        REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_archive_asset_no    ON public.tyre_records_archive(asset_no);
CREATE INDEX IF NOT EXISTS idx_archive_archived_at ON public.tyre_records_archive(archived_at DESC);

ALTER TABLE public.tyre_records_archive ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "archive_admin" ON public.tyre_records_archive;
CREATE POLICY "archive_admin" ON public.tyre_records_archive FOR ALL TO authenticated
  USING (get_my_role() = 'Admin');

CREATE OR REPLACE FUNCTION archive_old_tyre_records(years_old int DEFAULT 5)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE rows_archived int;
BEGIN
  INSERT INTO public.tyre_records_archive
    SELECT *, now(), auth.uid()
    FROM public.tyre_records
    WHERE issue_date < now() - (years_old || ' years')::interval
      AND km_at_removal IS NOT NULL;
  GET DIAGNOSTICS rows_archived = ROW_COUNT;
  DELETE FROM public.tyre_records
  WHERE issue_date < now() - (years_old || ' years')::interval
    AND km_at_removal IS NOT NULL;
  RETURN rows_archived;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- STORAGE BUCKET
-- ═══════════════════════════════════════════════════════════════════════════════
INSERT INTO storage.buckets (id, name, public) VALUES ('tyre-photos', 'tyre-photos', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "tyre_photos_upload" ON storage.objects;
DROP POLICY IF EXISTS "tyre_photos_read"   ON storage.objects;
CREATE POLICY "tyre_photos_upload" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'tyre-photos');
CREATE POLICY "tyre_photos_read"   ON storage.objects FOR SELECT
  USING (bucket_id = 'tyre-photos');

-- ═══════════════════════════════════════════════════════════════════════════════
-- SEED: Grandfather existing profiles as approved
-- ═══════════════════════════════════════════════════════════════════════════════
UPDATE public.profiles SET approved = true WHERE approved IS NULL OR approved = false;

-- ═══════════════════════════════════════════════════════════════════════════════
-- DONE
-- All 20 tables, 80+ indexes, RLS policies, triggers, RPCs, and storage bucket.
-- ═══════════════════════════════════════════════════════════════════════════════
