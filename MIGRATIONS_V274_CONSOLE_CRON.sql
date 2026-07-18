-- =============================================================================
-- MIGRATIONS_V274_CONSOLE_CRON.sql
-- Super-admin, read-only visibility into scheduled pg_cron jobs for the
-- console "Automation Health" page.
--
-- Adds ONE SECURITY DEFINER read function public.console_cron_jobs() that
-- returns every pg_cron job with its most recent run status + end time
-- (LEFT JOIN LATERAL on cron.job_run_details by jobid, newest first).
--
--   * Self-gates on public.is_super_admin() -> RAISE EXCEPTION otherwise. The
--     cron.* catalog is not exposed to clients; only this gated projection is.
--   * Pinned search_path = 'cron','public' (definer-safety).
--   * Degrades to an EMPTY set when the pg_cron extension / its tables are not
--     installed (guarded with to_regclass), so the function is safe to create
--     and call on a project without pg_cron.
--   * EXECUTE revoked from PUBLIC + anon; granted to authenticated (the in-body
--     super-admin self-gate is the real boundary).
--
-- Read-only: it never writes and never schedules a job. Idempotent + reversible
-- (see footer). Written for the parent to apply; NOT applied here.
-- Next free migration V275.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.console_cron_jobs()
RETURNS TABLE (
  jobid       bigint,
  jobname     text,
  schedule    text,
  active      boolean,
  last_status text,
  last_end    timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'cron', 'public'
AS $function$
BEGIN
  -- Super-admin only. Any other caller gets a hard stop (no data leak).
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  -- pg_cron may not be installed on this project: return an empty set instead
  -- of failing so the console page can render an honest "no cron" state.
  IF to_regclass('cron.job') IS NULL THEN
    RETURN;
  END IF;

  IF to_regclass('cron.job_run_details') IS NULL THEN
    -- Jobs exist but no run history table: return jobs with null run info.
    RETURN QUERY
      SELECT j.jobid, j.jobname::text, j.schedule::text, j.active,
             NULL::text, NULL::timestamptz
      FROM cron.job j
      ORDER BY j.jobname NULLS LAST, j.jobid;
    RETURN;
  END IF;

  RETURN QUERY
    SELECT j.jobid,
           j.jobname::text,
           j.schedule::text,
           j.active,
           r.status::text  AS last_status,
           r.end_time      AS last_end
    FROM cron.job j
    LEFT JOIN LATERAL (
      SELECT d.status, d.end_time
      FROM cron.job_run_details d
      WHERE d.jobid = j.jobid
      ORDER BY d.start_time DESC NULLS LAST, d.runid DESC
      LIMIT 1
    ) r ON true
    ORDER BY j.jobname NULLS LAST, j.jobid;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.console_cron_jobs() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.console_cron_jobs() TO authenticated;

-- =============================================================================
-- Reversal (manual):
--   DROP FUNCTION IF EXISTS public.console_cron_jobs();
-- =============================================================================
