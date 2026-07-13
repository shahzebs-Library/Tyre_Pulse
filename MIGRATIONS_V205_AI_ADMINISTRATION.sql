-- ============================================================================
-- MIGRATIONS_V205 — AI & Automation Administration (enterprise plan §12)
-- ============================================================================
-- SAFE, ADDITIVE slice of §12: gives administrators a DB-backed home to
-- configure AI model catalogue, agent system-prompts, spend/token budgets, and
-- to capture answer feedback — WITHOUT changing runtime AI behaviour. The edge
-- functions keep their current hardcoded model/pricing/prompt values as the
-- authoritative fallback; these tables are admin-managed configuration + audit
-- surfaces only, surfaced by /ai-administration inside the Admin Console.
--
-- This migration deliberately does NOT touch the existing AI-usage tables
-- (ai_token_logs, ai_usage_log). No third usage table is introduced.
--
-- Four small org-scoped tables, each following the V130 RLS template:
--   * RESTRICTIVE org isolation (organisation_id = public.app_current_org())
--   * read = any authenticated org member
--   * write = elevated roles only (Admin / Manager / Director) via get_my_role()
--   * set_updated_at trigger, org index, REVOKE anon / GRANT authenticated
--
-- Depends on V42 helpers: app_current_org(), set_updated_at(), get_my_role().
-- Idempotent and safe to re-run. Reversible DROP block at the foot of the file.
-- ============================================================================

-- ── ai_models — model catalogue + pricing (per 1M tokens) ────────────────────
CREATE TABLE IF NOT EXISTS public.ai_models (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  key              text,
  provider         text,
  model_id         text,
  input_price      numeric,
  output_price     numeric,
  max_tokens       integer,
  active           boolean NOT NULL DEFAULT true,
  is_default       boolean NOT NULL DEFAULT false,
  notes            text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_models_org ON public.ai_models (organisation_id);

DROP TRIGGER IF EXISTS set_updated_at_ai_models ON public.ai_models;
CREATE TRIGGER set_updated_at_ai_models BEFORE UPDATE ON public.ai_models
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.ai_models ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_models_org_isolation ON public.ai_models;
CREATE POLICY ai_models_org_isolation ON public.ai_models
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS ai_models_read ON public.ai_models;
CREATE POLICY ai_models_read ON public.ai_models FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS ai_models_insert ON public.ai_models;
CREATE POLICY ai_models_insert ON public.ai_models FOR INSERT
  WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director'));

DROP POLICY IF EXISTS ai_models_update ON public.ai_models;
CREATE POLICY ai_models_update ON public.ai_models FOR UPDATE
  USING (public.get_my_role() IN ('Admin','Manager','Director'))
  WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director'));

DROP POLICY IF EXISTS ai_models_delete ON public.ai_models;
CREATE POLICY ai_models_delete ON public.ai_models FOR DELETE
  USING (public.get_my_role() IN ('Admin','Manager','Director'));

REVOKE ALL ON public.ai_models FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_models TO authenticated;

-- ── ai_prompts — versioned agent system prompts ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_prompts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  agent            text,
  name             text,
  system_prompt    text,
  locale           text NOT NULL DEFAULT 'en' CHECK (locale IN ('en','ar')),
  version          integer NOT NULL DEFAULT 1,
  active           boolean NOT NULL DEFAULT true,
  notes            text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_prompts_org ON public.ai_prompts (organisation_id);

DROP TRIGGER IF EXISTS set_updated_at_ai_prompts ON public.ai_prompts;
CREATE TRIGGER set_updated_at_ai_prompts BEFORE UPDATE ON public.ai_prompts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.ai_prompts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_prompts_org_isolation ON public.ai_prompts;
CREATE POLICY ai_prompts_org_isolation ON public.ai_prompts
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS ai_prompts_read ON public.ai_prompts;
CREATE POLICY ai_prompts_read ON public.ai_prompts FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS ai_prompts_insert ON public.ai_prompts;
CREATE POLICY ai_prompts_insert ON public.ai_prompts FOR INSERT
  WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director'));

DROP POLICY IF EXISTS ai_prompts_update ON public.ai_prompts;
CREATE POLICY ai_prompts_update ON public.ai_prompts FOR UPDATE
  USING (public.get_my_role() IN ('Admin','Manager','Director'))
  WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director'));

DROP POLICY IF EXISTS ai_prompts_delete ON public.ai_prompts;
CREATE POLICY ai_prompts_delete ON public.ai_prompts FOR DELETE
  USING (public.get_my_role() IN ('Admin','Manager','Director'));

REVOKE ALL ON public.ai_prompts FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_prompts TO authenticated;

-- ── ai_budgets — token / cost budget caps per period ─────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_budgets (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  period           text NOT NULL DEFAULT 'monthly' CHECK (period IN ('daily','weekly','monthly')),
  token_cap        bigint,
  cost_cap_usd     numeric,
  hard_stop        boolean NOT NULL DEFAULT false,
  scope            text,
  active           boolean NOT NULL DEFAULT true,
  notes            text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_budgets_org ON public.ai_budgets (organisation_id);

DROP TRIGGER IF EXISTS set_updated_at_ai_budgets ON public.ai_budgets;
CREATE TRIGGER set_updated_at_ai_budgets BEFORE UPDATE ON public.ai_budgets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.ai_budgets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_budgets_org_isolation ON public.ai_budgets;
CREATE POLICY ai_budgets_org_isolation ON public.ai_budgets
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS ai_budgets_read ON public.ai_budgets;
CREATE POLICY ai_budgets_read ON public.ai_budgets FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS ai_budgets_insert ON public.ai_budgets;
CREATE POLICY ai_budgets_insert ON public.ai_budgets FOR INSERT
  WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director'));

DROP POLICY IF EXISTS ai_budgets_update ON public.ai_budgets;
CREATE POLICY ai_budgets_update ON public.ai_budgets FOR UPDATE
  USING (public.get_my_role() IN ('Admin','Manager','Director'))
  WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director'));

DROP POLICY IF EXISTS ai_budgets_delete ON public.ai_budgets;
CREATE POLICY ai_budgets_delete ON public.ai_budgets FOR DELETE
  USING (public.get_my_role() IN ('Admin','Manager','Director'));

REVOKE ALL ON public.ai_budgets FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_budgets TO authenticated;

-- ── ai_feedback — user ratings/corrections on AI answers ─────────────────────
-- Any authenticated org member may submit feedback (insert requires a signed-in
-- user); only elevated roles may edit or remove it (moderation / cleanup).
CREATE TABLE IF NOT EXISTS public.ai_feedback (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  conversation_id  uuid,
  message_id       uuid,
  user_id          uuid DEFAULT auth.uid(),
  rating           integer,
  correct          boolean,
  note             text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_feedback_org ON public.ai_feedback (organisation_id);

DROP TRIGGER IF EXISTS set_updated_at_ai_feedback ON public.ai_feedback;
CREATE TRIGGER set_updated_at_ai_feedback BEFORE UPDATE ON public.ai_feedback
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.ai_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_feedback_org_isolation ON public.ai_feedback;
CREATE POLICY ai_feedback_org_isolation ON public.ai_feedback
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS ai_feedback_read ON public.ai_feedback;
CREATE POLICY ai_feedback_read ON public.ai_feedback FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS ai_feedback_insert ON public.ai_feedback;
CREATE POLICY ai_feedback_insert ON public.ai_feedback FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS ai_feedback_update ON public.ai_feedback;
CREATE POLICY ai_feedback_update ON public.ai_feedback FOR UPDATE
  USING (public.get_my_role() IN ('Admin','Manager','Director'))
  WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director'));

DROP POLICY IF EXISTS ai_feedback_delete ON public.ai_feedback;
CREATE POLICY ai_feedback_delete ON public.ai_feedback FOR DELETE
  USING (public.get_my_role() IN ('Admin','Manager','Director'));

REVOKE ALL ON public.ai_feedback FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_feedback TO authenticated;

-- Reversible:
--   DROP TABLE IF EXISTS public.ai_feedback;
--   DROP TABLE IF EXISTS public.ai_budgets;
--   DROP TABLE IF EXISTS public.ai_prompts;
--   DROP TABLE IF EXISTS public.ai_models;
