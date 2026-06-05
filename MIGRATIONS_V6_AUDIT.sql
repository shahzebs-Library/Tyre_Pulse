-- ============================================================
-- TYREPULSE - MIGRATIONS V6 AUDIT
-- Run in Supabase SQL Editor
-- Adds: audit_log table for tracking all user actions
-- Built by Shahzeb Rahman © 2026
-- ============================================================

-- Create table without user_id first (safe if table already exists from a prior attempt)
CREATE TABLE IF NOT EXISTS public.audit_log (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  action       text NOT NULL,
  table_name   text,
  record_count integer DEFAULT 1,
  details      jsonb,
  created_at   timestamptz DEFAULT now()
);

-- Add user_id separately — idempotent, works even if table was partially created before
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES public.profiles(id);

CREATE INDEX IF NOT EXISTS idx_audit_log_user    ON public.audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action  ON public.audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON public.audit_log(created_at DESC);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- Drop policies first so the script is safe to re-run
DROP POLICY IF EXISTS "audit_select" ON public.audit_log;
DROP POLICY IF EXISTS "audit_insert" ON public.audit_log;
CREATE POLICY "audit_select" ON public.audit_log FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "audit_insert" ON public.audit_log FOR INSERT WITH CHECK (auth.role() = 'authenticated');
