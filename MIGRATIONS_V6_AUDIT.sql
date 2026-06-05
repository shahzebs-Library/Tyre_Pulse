-- ============================================================
-- TYREPULSE - MIGRATIONS V6 AUDIT
-- Run in Supabase SQL Editor
-- Adds: audit_log table for tracking all user actions
-- Built by Shahzeb Rahman © 2026
-- ============================================================

-- Create table with minimum required columns only (safe if already partially exists)
CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY
);

-- Add every column separately — each is idempotent, handles any partial table state
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS user_id      uuid REFERENCES public.profiles(id);
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS action       text;
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS table_name   text;
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS record_count integer DEFAULT 1;
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS details      jsonb;
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS created_at   timestamptz DEFAULT now();

-- Add NOT NULL constraint to action if not already set
ALTER TABLE public.audit_log ALTER COLUMN action SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_log_user    ON public.audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action  ON public.audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON public.audit_log(created_at DESC);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_select" ON public.audit_log;
DROP POLICY IF EXISTS "audit_insert" ON public.audit_log;
CREATE POLICY "audit_select" ON public.audit_log FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "audit_insert" ON public.audit_log FOR INSERT WITH CHECK (auth.role() = 'authenticated');
