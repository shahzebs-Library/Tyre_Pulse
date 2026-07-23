-- V339: job-card MMYY period vs record date data-quality check (DIAGNOSTIC ONLY).
-- NOT applied live by this task - produced as a reviewable .sql only.
--
-- The ERP job-card / work-order numbers end in a four digit group that is MMYY:
--   "GCKR/JC/0131/0726" -> 07/26 -> July 2026
--   "RM/RMJC/0001/0226" -> 02/26 -> February 2026
--   "EG/JC/0001/0120"   -> 01/20 -> January 2020
-- When that encoded month/year disagrees with the record's actual opened_at,
-- the row is a likely data-entry typo (e.g. "0336" = year 2036 on a work order
-- that actually opened in March 2026). This migration adds a read-only helper
-- and a view the app can query to list such flags. It performs NO data
-- mutation and adds NO trigger or constraint.
--
-- Mirrors the pure JS engine src/lib/jobCardDate.js exactly (final 4 digit
-- group, MM 1..12, YY -> 2000 + YY).
--
-- Measured on live data at authoring time: 84,480 work_orders have a derivable
-- MMYY period, of which 786 disagree with opened_at (the rest match). 206 more
-- rows carry an out-of-range month (MM > 12) and are treated as not derivable.
-- Next free migration V340.

-- jobcard_period(text) -> (mm int, yy int)
-- Returns ZERO rows when there is no trailing 4 digit group or the month is out
-- of range 1..12 (so a LATERAL join naturally drops non-derivable rows).
CREATE OR REPLACE FUNCTION public.jobcard_period(p_job text)
RETURNS TABLE (mm int, yy int)
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT
    substring(g FROM 1 FOR 2)::int AS mm,
    2000 + substring(g FROM 3 FOR 2)::int AS yy
  FROM (
    SELECT (regexp_match(btrim(coalesce(p_job, '')), '(\d{4})\s*$'))[1] AS g
  ) x
  WHERE x.g IS NOT NULL
    AND substring(x.g FROM 1 FOR 2)::int BETWEEN 1 AND 12;
$$;

COMMENT ON FUNCTION public.jobcard_period(text) IS
  'Diagnostic: parse the trailing MMYY group of a job-card number into (mm, yy). Zero rows when not derivable or month out of range.';

-- v_jobcard_date_mismatch: work_orders whose job-card MMYY disagrees with the
-- opened_at month/year. security_invoker = true so the querying user''s RLS on
-- work_orders (org + country + site isolation) governs which rows are visible.
CREATE OR REPLACE VIEW public.v_jobcard_date_mismatch
WITH (security_invoker = true) AS
SELECT
  w.id,
  w.organisation_id,
  w.work_order_no,
  w.opened_at,
  w.country,
  w.site,
  p.mm                                   AS jobcard_month,
  p.yy                                   AS jobcard_year,
  date_part('month', w.opened_at)::int   AS opened_month,
  date_part('year',  w.opened_at)::int   AS opened_year
FROM public.work_orders w
CROSS JOIN LATERAL public.jobcard_period(w.work_order_no) p
WHERE w.opened_at IS NOT NULL
  AND (
        p.mm <> date_part('month', w.opened_at)::int
     OR p.yy <> date_part('year',  w.opened_at)::int
      );

COMMENT ON VIEW public.v_jobcard_date_mismatch IS
  'Diagnostic (read-only): work_orders where the job-card MMYY does not match opened_at. RLS-inheriting (security_invoker).';

GRANT SELECT ON public.v_jobcard_date_mismatch TO authenticated;
