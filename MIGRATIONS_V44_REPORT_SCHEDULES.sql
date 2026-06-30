-- ============================================================
-- TYREPULSE V44 REPORT SCHEDULES
-- Backing table for ScheduledReports.jsx — stores frequency,
-- recipients, and metadata for automated email report delivery.
-- Also adds ai_token_logs for the AI cost monitor dashboard.
-- ============================================================

-- ── report_schedules ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.report_schedules (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  name          text        NOT NULL,
  report_type   text        NOT NULL CHECK (report_type IN ('executive', 'kpi', 'fleet', 'inspection', 'cost')),
  frequency     text        NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly')),
  day_of_week   int         CHECK (day_of_week BETWEEN 0 AND 6),
  day_of_month  int         CHECK (day_of_month BETWEEN 1 AND 31),
  time_of_day   text        NOT NULL DEFAULT '07:00',
  recipients    text[]      NOT NULL DEFAULT '{}',
  active        boolean     NOT NULL DEFAULT true,
  next_run_at   timestamptz,
  last_sent_at  timestamptz,
  last_error    text,
  created_by    uuid        REFERENCES auth.users ON DELETE SET NULL,
  org_id        uuid        REFERENCES public.organisations(id) ON DELETE CASCADE,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_report_schedules_active      ON public.report_schedules (active, next_run_at);
CREATE INDEX IF NOT EXISTS idx_report_schedules_org_id      ON public.report_schedules (org_id);
CREATE INDEX IF NOT EXISTS idx_report_schedules_created_by  ON public.report_schedules (created_by);

-- Reuse the existing updated_at trigger function. This DB names it
-- public.set_updated_at(); fall back to update_updated_at_column() if a future
-- environment uses that name instead, so the migration is portable.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname = 'set_updated_at') THEN
    DROP TRIGGER IF EXISTS set_updated_at_report_schedules ON public.report_schedules;
    CREATE TRIGGER set_updated_at_report_schedules
      BEFORE UPDATE ON public.report_schedules
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  ELSIF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname = 'public' AND p.proname = 'update_updated_at_column') THEN
    DROP TRIGGER IF EXISTS set_updated_at_report_schedules ON public.report_schedules;
    CREATE TRIGGER set_updated_at_report_schedules
      BEFORE UPDATE ON public.report_schedules
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;

ALTER TABLE public.report_schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rs_select"       ON public.report_schedules;
DROP POLICY IF EXISTS "rs_insert"       ON public.report_schedules;
DROP POLICY IF EXISTS "rs_update"       ON public.report_schedules;
DROP POLICY IF EXISTS "rs_delete"       ON public.report_schedules;

-- All authenticated users in an org can read schedules; only Admins/Managers may write.
CREATE POLICY "rs_select" ON public.report_schedules
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "rs_insert" ON public.report_schedules
  FOR INSERT TO authenticated
  WITH CHECK (get_my_role() IN ('Admin', 'Manager', 'Director'));

CREATE POLICY "rs_update" ON public.report_schedules
  FOR UPDATE TO authenticated
  USING (get_my_role() IN ('Admin', 'Manager', 'Director'))
  WITH CHECK (get_my_role() IN ('Admin', 'Manager', 'Director'));

CREATE POLICY "rs_delete" ON public.report_schedules
  FOR DELETE TO authenticated
  USING (get_my_role() IN ('Admin', 'Manager', 'Director'));

-- ── ai_token_logs ─────────────────────────────────────────────────────────────
-- Lightweight cost-tracking table; the chat-ai edge function inserts one row
-- per request so the AI cost monitor can chart spend over time.

CREATE TABLE IF NOT EXISTS public.ai_token_logs (
  id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         uuid        REFERENCES auth.users ON DELETE SET NULL,
  model           text        NOT NULL,
  feature         text        NOT NULL DEFAULT 'chat',   -- 'chat' | 'embedding' | 'report'
  prompt_tokens   int         NOT NULL DEFAULT 0,
  completion_tokens int       NOT NULL DEFAULT 0,
  total_tokens    int         GENERATED ALWAYS AS (prompt_tokens + completion_tokens) STORED,
  cost_usd        numeric(10,6),                         -- approx cost; populated by edge function
  site            text,
  country         text,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_token_logs_created_at ON public.ai_token_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_token_logs_user_id    ON public.ai_token_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_ai_token_logs_feature    ON public.ai_token_logs (feature);
CREATE INDEX IF NOT EXISTS idx_ai_token_logs_model      ON public.ai_token_logs (model);

ALTER TABLE public.ai_token_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "atl_select" ON public.ai_token_logs;
DROP POLICY IF EXISTS "atl_insert" ON public.ai_token_logs;

CREATE POLICY "atl_select" ON public.ai_token_logs
  FOR SELECT TO authenticated
  USING (get_my_role() IN ('Admin', 'Manager', 'Director'));

-- Edge functions use the service role key, so insert is unrestricted at the
-- RLS level — the edge function enforces its own auth check.
CREATE POLICY "atl_insert" ON public.ai_token_logs
  FOR INSERT TO authenticated
  WITH CHECK (true);
