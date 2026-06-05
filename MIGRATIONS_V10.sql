-- ============================================================
-- TYREPULSE - MIGRATIONS V10
-- Run in Supabase SQL Editor
-- Adds: employee_id, approved, country to profiles
-- Adds: upload_batch_id to tyre_records
-- Creates: accidents table
-- Built by Shahzeb Rahman © 2026
-- ============================================================

-- Profiles: employee ID, approval flag, country assignment
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS employee_id   text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS approved      boolean DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS country       text[];   -- Array: user may be assigned to multiple countries
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS pending_reason text;

-- Grandfather all existing accounts as approved (only new sign-ups start as unapproved)
UPDATE public.profiles SET approved = true WHERE approved IS NULL OR approved = false;

-- Tyre records: track which upload batch each record came from
ALTER TABLE public.tyre_records ADD COLUMN IF NOT EXISTS upload_batch_id uuid;
CREATE INDEX IF NOT EXISTS idx_tyre_records_batch ON public.tyre_records(upload_batch_id);

-- ── Accidents / Incidents table ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.accidents (
  id                         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  incident_date              date,
  asset_no                   text,
  site                       text,
  country                    text,
  description                text,
  severity                   text CHECK (severity IN ('Minor', 'Major', 'Total Loss')),
  status                     text DEFAULT 'Reported',
  repair_cost                numeric(12,2),
  insurance_claim_no         text,
  inspector                  text,
  photos                     text[],
  linked_corrective_action_id uuid,
  created_by                 uuid REFERENCES public.profiles(id),
  created_at                 timestamptz DEFAULT now(),
  updated_at                 timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_accidents_site    ON public.accidents(site);
CREATE INDEX IF NOT EXISTS idx_accidents_asset   ON public.accidents(asset_no);
CREATE INDEX IF NOT EXISTS idx_accidents_date    ON public.accidents(incident_date);
CREATE INDEX IF NOT EXISTS idx_accidents_country ON public.accidents(country);

ALTER TABLE public.accidents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "accidents_select" ON public.accidents;
DROP POLICY IF EXISTS "accidents_insert" ON public.accidents;
DROP POLICY IF EXISTS "accidents_update" ON public.accidents;
DROP POLICY IF EXISTS "accidents_delete" ON public.accidents;

CREATE POLICY "accidents_select" ON public.accidents FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "accidents_insert" ON public.accidents FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "accidents_update" ON public.accidents FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "accidents_delete" ON public.accidents FOR DELETE USING (auth.role() = 'authenticated');
