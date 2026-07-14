-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATIONS V223 — org-scoped read access to accident_audit_log (Case Timeline)
-- Applied live via Supabase MCP on 2026-07-14 (project jhssdmeruxtrlqnwfksc).
--
-- WHY: the "Case timeline / days per step" section in the accident detail view
-- derives each step's duration from the status transitions ALREADY captured by
-- the existing audit trigger log_accident_change() — every accidents UPDATE
-- that changes `status` inserts a row into accident_audit_log with
-- action = 'status_change', changed_at, and full-row old_values/new_values
-- JSONB. No new tracking table or trigger is needed.
--
-- GAP: the log's only SELECT policy was admin-only (is_admin_or_above()), so
-- regular org members who can open the accident could not read its timeline.
--
-- FIX: one permissive SELECT policy for `authenticated` gated by an EXISTS
-- against the PARENT accident. Policy subqueries execute under the caller's
-- own RLS on public.accidents, so the RESTRICTIVE org isolation
-- (organisation_id = public.app_current_org()), the RESTRICTIVE country
-- isolation (app_can_see_country) and the role-based select gates are all
-- inherited: a user can read audit rows exactly for the accidents they can
-- already see, and nothing else. Existing admin policy is unchanged
-- (permissive policies OR together). Read path is served by the existing
-- audit_accident_idx (accident_id, changed_at DESC) index.
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS audit_log_select_case_readers ON public.accident_audit_log;
CREATE POLICY audit_log_select_case_readers ON public.accident_audit_log
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.accidents a
      WHERE a.id = accident_audit_log.accident_id
    )
  );
