-- TyrePulse - MIGRATIONS V11
-- Run in Supabase SQL Editor
-- Adds: gate_passes table for vehicle exit clearance

CREATE TABLE IF NOT EXISTS public.gate_passes (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  asset_no        text NOT NULL,
  site            text,
  country         text,
  pass_date       date DEFAULT CURRENT_DATE,
  status          text DEFAULT 'Pending',
  inspection_id   uuid REFERENCES public.inspections(id),
  cleared_by      uuid REFERENCES public.profiles(id),
  cleared_at      timestamptz,
  denial_reason   text,
  notes           text,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gate_passes_asset  ON public.gate_passes(asset_no);
CREATE INDEX IF NOT EXISTS idx_gate_passes_date   ON public.gate_passes(pass_date);
CREATE INDEX IF NOT EXISTS idx_gate_passes_site   ON public.gate_passes(site);

ALTER TABLE public.gate_passes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gate_passes_select" ON public.gate_passes;
DROP POLICY IF EXISTS "gate_passes_insert" ON public.gate_passes;
DROP POLICY IF EXISTS "gate_passes_update" ON public.gate_passes;

CREATE POLICY "gate_passes_select" ON public.gate_passes
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "gate_passes_insert" ON public.gate_passes
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "gate_passes_update" ON public.gate_passes
  FOR UPDATE USING (auth.role() = 'authenticated');
