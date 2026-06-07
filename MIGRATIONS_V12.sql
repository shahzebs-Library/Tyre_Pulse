-- TyrePulse - MIGRATIONS V12
-- Run in Supabase SQL Editor
-- Adds: app_settings key/value store
-- Required by Wave 7B alert thresholds and system-wide configuration

-- ============================================================
-- TABLE: app_settings
-- ============================================================
CREATE TABLE IF NOT EXISTS public.app_settings (
  key          text PRIMARY KEY,
  value        text NOT NULL,
  description  text,
  updated_by   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at   timestamptz DEFAULT now()
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_app_settings_updated_by ON public.app_settings(updated_by);
CREATE INDEX IF NOT EXISTS idx_app_settings_updated_at ON public.app_settings(updated_at);

-- ============================================================
-- AUTO-UPDATE TRIGGER: updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_app_settings_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_app_settings_updated_at ON public.app_settings;

CREATE TRIGGER trg_app_settings_updated_at
  BEFORE UPDATE ON public.app_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.set_app_settings_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- SELECT: all authenticated users may read settings
DROP POLICY IF EXISTS "app_settings_select" ON public.app_settings;
CREATE POLICY "app_settings_select"
  ON public.app_settings
  FOR SELECT
  TO authenticated
  USING (true);

-- INSERT: Admin only
DROP POLICY IF EXISTS "app_settings_insert" ON public.app_settings;
CREATE POLICY "app_settings_insert"
  ON public.app_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (get_my_role() = 'Admin');

-- UPDATE: Admin only
DROP POLICY IF EXISTS "app_settings_update" ON public.app_settings;
CREATE POLICY "app_settings_update"
  ON public.app_settings
  FOR UPDATE
  TO authenticated
  USING (get_my_role() = 'Admin')
  WITH CHECK (get_my_role() = 'Admin');

-- DELETE: Admin only
DROP POLICY IF EXISTS "app_settings_delete" ON public.app_settings;
CREATE POLICY "app_settings_delete"
  ON public.app_settings
  FOR DELETE
  TO authenticated
  USING (get_my_role() = 'Admin');

-- ============================================================
-- SEED: Default alert threshold settings
-- These can be updated via the Admin > Settings UI
-- ============================================================
INSERT INTO public.app_settings (key, value, description) VALUES
  ('alert_cpk_threshold',           '2.00',   'CPK above this value triggers a cost alert (cost per km)'),
  ('alert_pressure_low_pct',        '15',      'Pressure deviation % below spec triggers Low alert'),
  ('alert_pressure_critical_pct',   '25',      'Pressure deviation % below spec triggers Critical alert'),
  ('alert_tread_warning_mm',        '4',       'Tread depth (mm) below this triggers Warning alert'),
  ('alert_tread_critical_mm',       '2',       'Tread depth (mm) below this triggers Critical alert'),
  ('alert_inspection_overdue_days', '7',       'Days past scheduled inspection before Overdue alert fires'),
  ('fleet_target_pressure_compliance_pct', '90', 'Target pressure compliance % for fleet KPI dashboard'),
  ('fleet_target_inspection_compliance_pct', '95', 'Target inspection compliance % for fleet KPI dashboard'),
  ('retread_min_km_threshold',      '40000',  'Minimum km a tyre must have run to qualify for retread'),
  ('scrap_km_pct_threshold',        '20',      'Tyres scrapped below this % of fleet avg km are flagged as premature'),
  ('downtime_hours_per_replacement','2',        'Estimated downtime hours per tyre replacement event'),
  ('forecast_months_ahead',         '3',        'Number of months ahead for tyre replacement forecasting'),
  ('default_tyre_cost',             '1200',    'Default tyre cost (USD) used when cost_per_tyre is missing'),
  ('cost_trend_slope_threshold',    '50',      'Monthly cost slope (USD) above which trend is flagged as worsening')
ON CONFLICT (key) DO NOTHING;
