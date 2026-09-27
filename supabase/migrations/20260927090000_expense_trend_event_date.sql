-- 20260927090000_expense_trend_event_date
--
-- PURPOSE
--   get_expense_period_trend (called on every Expense Trends / YearlyTrendPanel
--   load, and 1x per country by get_expense_period_trend_multi) had two defects:
--
--   1. CORRECTNESS - Egypt was missing entirely. Periods were cut from the raw
--      ERP text column txn_date and filtered with '^\d{4}-\d{2}'. Egypt's export
--      writes txn_date as '1/31/2022 12:00:00 AM', so all 40,680 Egypt lines
--      (EGP 81,747,668.44) never reached Expense Trends. The typed business date
--      event_date is populated on every row in every country. For KSA and UAE
--      txn_date and event_date agree on every row (measured: 0 month
--      mismatches of 113,268 + 60,020), so their output is byte-identical.
--
--   2. SPEED - the single-statement form `(p_country = 'All' or p_country is
--      null or country = p_country)` cannot use the country index, so a
--      one-country call read every country's rows; the multi wrapper did that
--      three times and hit the 8 s authenticated statement_timeout (3 x 57014
--      in the postgres log, 2026-09-27 05:30-05:59 UTC). Now plpgsql with a
--      plain `country = p_country` branch.
--
--   get_expense_yearly_trend (legacy, no client caller) gets the same
--   event_date fix so the two cannot disagree. Both stay SECURITY INVOKER, so
--   RLS (org + country + site) still bounds every row exactly as before.
--
-- VERIFY (done live, rolled back, impersonating real users)
--   * super admin d2d43a5f: KSA/UAE x year/quarter/month/bogus grain - md5 of old
--     == new on all 8; Egypt 0 -> 6/23/62 rows (year/quarter/month); Egypt trend
--     total 81,747,668.44 == Egypt ledger sum, currency EGP only.
--   * KSA-only Manager 34793423: All x month md5 identical; Egypt still 0 rows
--     (RLS unchanged).
--   * Warm timings same txn, warm-up discarded: KSA month 598 -> 323 ms;
--     3 countries sequential 780 -> 386 ms; All month 756 -> 377 ms.
--
-- ROLLBACK
--   Re-create both functions from the original LANGUAGE sql bodies recorded at
--   the end of this file.

CREATE OR REPLACE FUNCTION public.get_expense_period_trend(p_country text DEFAULT 'All'::text, p_grain text DEFAULT 'year'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  -- Bucketing format per grain. Quarter renders as 2024-Q1, exactly as the old
  -- substring(txn_date) arithmetic did.
  v_fmt text := case lower(coalesce(p_grain,'year'))
                  when 'month'   then 'YYYY-MM'
                  when 'quarter' then 'YYYY-"Q"Q'
                  else 'YYYY'
                end;
  v_out jsonb;
begin
  -- Periods come from the typed business date event_date (populated on every
  -- row), not the raw ERP text txn_date: Egypt's export writes txn_date as
  -- '1/31/2022 12:00:00 AM', which the old '^\d{4}-\d{2}' filter discarded, so
  -- every Egypt line (40,680) was missing from Expense Trends. For KSA and UAE
  -- the two agree on every row (measured: 0 month mismatches), so their output
  -- is byte-identical.
  if p_country = 'All' or p_country is null then
    select coalesce(jsonb_agg(jsonb_build_object(
      'country', country, 'period', period, 'currency', currency, 'lines', lines,
      'tyre', tyre, 'spare', spare, 'lubricant', lubricant, 'total', total
    ) order by country, period), '[]'::jsonb)
      into v_out
      from (
        select country, to_char(event_date, v_fmt) period,
               max(nullif(btrim(currency),'')) currency, count(*) lines,
               round(sum(coalesce(tyre_cost,0)),2)  tyre,
               round(sum(coalesce(spare_cost,0)),2) spare,
               round(sum(coalesce(oil_cost,0)),2)   lubricant,
               round(sum(coalesce(line_cost,0)),2)  total
          from public.parts_consumption
         where event_date is not null
         group by 1, 2) g;
  else
    -- A named country is a plain equality so the planner uses the country
    -- index; the old single-statement OR form read every country's rows on
    -- every call (and the multi-country wrapper did that once per country).
    select coalesce(jsonb_agg(jsonb_build_object(
      'country', country, 'period', period, 'currency', currency, 'lines', lines,
      'tyre', tyre, 'spare', spare, 'lubricant', lubricant, 'total', total
    ) order by country, period), '[]'::jsonb)
      into v_out
      from (
        select country, to_char(event_date, v_fmt) period,
               max(nullif(btrim(currency),'')) currency, count(*) lines,
               round(sum(coalesce(tyre_cost,0)),2)  tyre,
               round(sum(coalesce(spare_cost,0)),2) spare,
               round(sum(coalesce(oil_cost,0)),2)   lubricant,
               round(sum(coalesce(line_cost,0)),2)  total
          from public.parts_consumption
         where event_date is not null
           and country = p_country
         group by 1, 2) g;
  end if;
  return v_out;
end
$function$;

CREATE OR REPLACE FUNCTION public.get_expense_yearly_trend(p_country text DEFAULT 'All'::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with g as (
    select country, to_char(event_date, 'YYYY') yr,
      max(nullif(btrim(currency),'')) currency,
      count(*) lines,
      round(sum(coalesce(tyre_cost,0)),2)  tyre,
      round(sum(coalesce(spare_cost,0)),2) spare,
      round(sum(coalesce(oil_cost,0)),2)   lubricant,
      round(sum(coalesce(line_cost,0)),2)  total
    from public.parts_consumption
    where event_date is not null
      and (p_country = 'All' or p_country is null or country = p_country)
    group by 1, 2
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'country', country, 'year', yr, 'currency', currency, 'lines', lines,
    'tyre', tyre, 'spare', spare, 'lubricant', lubricant, 'total', total
  ) order by country, yr), '[]'::jsonb)
  from g;
$function$;

-- ROLLBACK BODIES (originals, verbatim from pg_get_functiondef before this migration)
/*
CREATE OR REPLACE FUNCTION public.get_expense_period_trend(p_country text DEFAULT 'All'::text, p_grain text DEFAULT 'year'::text)
 RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
  with base as (
    select
      country,
      case lower(coalesce(p_grain,'year'))
        when 'month'   then substring(txn_date,1,7)
        when 'quarter' then substring(txn_date,1,4) || '-Q' || (((substring(txn_date,6,2))::int + 2) / 3)::text
        else substring(txn_date,1,4)
      end period,
      coalesce(tyre_cost,0) t, coalesce(spare_cost,0) s, coalesce(oil_cost,0) o,
      coalesce(line_cost,0) lc, nullif(btrim(currency),'') curr
    from public.parts_consumption
    where txn_date ~ '^\d{4}-\d{2}'
      and (p_country = 'All' or p_country is null or country = p_country)
  ),
  g as (
    select country, period, max(curr) currency, count(*) lines,
      round(sum(t),2) tyre, round(sum(s),2) spare, round(sum(o),2) lubricant, round(sum(lc),2) total
    from base group by country, period
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'country', country, 'period', period, 'currency', currency, 'lines', lines,
    'tyre', tyre, 'spare', spare, 'lubricant', lubricant, 'total', total
  ) order by country, period), '[]'::jsonb)
  from g;
$function$;
-- NOTE: CREATE OR REPLACE may change LANGUAGE for the same signature, so this
-- body restores the original directly.

CREATE OR REPLACE FUNCTION public.get_expense_yearly_trend(p_country text DEFAULT 'All'::text)
 RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
  with base as (
    select country, substring(txn_date,1,4) yr,
      coalesce(tyre_cost,0) t, coalesce(spare_cost,0) s, coalesce(oil_cost,0) o,
      coalesce(line_cost,0) lc, nullif(btrim(currency),'') curr
    from public.parts_consumption
    where txn_date ~ '^\d{4}'
      and (p_country = 'All' or p_country is null or country = p_country)
  ),
  g as (
    select country, yr, max(curr) currency, count(*) lines,
      round(sum(t),2) tyre, round(sum(s),2) spare, round(sum(o),2) lubricant, round(sum(lc),2) total
    from base group by country, yr
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'country', country, 'year', yr, 'currency', currency, 'lines', lines,
    'tyre', tyre, 'spare', spare, 'lubricant', lubricant, 'total', total
  ) order by country, yr), '[]'::jsonb)
  from g;
$function$;
*/
