-- =============================================================================
-- V544  MULTI-COUNTRY EXPENSE AGGREGATES
-- =============================================================================
-- STATUS: APPLIED + VERIFIED LIVE on jhssdmeruxtrlqnwfksc (org Company A).
--
-- WHY THIS EXISTS
-- ---------------
-- The deep Expenses report (comparison windows, cost per km, why-it-changed,
-- what-moved, site operating cost, evidence) rests on five server aggregates
-- that each take EXACTLY ONE country:
--
--     get_parts_expense_snapshot   get_cost_cpk_overview   get_cost_variance
--     get_expense_period_trend     get_site_operating_cost
--
-- So a reporting scope covering more than one country fell back to a shallow
-- per-country comparison. This migration closes that, and ONLY in the one shape
-- that is honest here.
--
-- THE RULE THAT DECIDES THE SHAPE: MONEY IN DIFFERENT CURRENCIES IS NEVER ADDED.
-- KSA reports in SAR, UAE in AED, Egypt in EGP. Summing them has been a real
-- shipped defect in this app (it rendered "SAR 138,443,319", a number that is
-- not an amount of any currency - and on today's data the same three totals
-- still add to about 138.5M of nothing). A "multi-country" money aggregate is
-- therefore NOT one wider aggregate. It is N aggregates side by side, each in
-- its own currency, with no scope-level total anywhere in the payload.
--
-- WHAT IS DELIBERATELY *NOT* RETURNED, and why each one is a trap:
--   * no scope total, and no scope-level delta - both require adding currencies;
--   * no scope-level PERCENTAGE movement. A percentage is dimensionless and so
--     looks safe, but computing "spend rose 12% across the scope" means summing
--     SAR and AED first. Per country a percentage is real; across countries it
--     is a blended total wearing a disguise. There is no honest weighting
--     without FX, and `currency_rates` holds no approved rate, so the figure is
--     simply not available;
--   * no scope-level COST PER KM. SAR/km and AED/km are different units. They
--     cannot be averaged, and they cannot be km-weighted either, because the
--     numerators are in different currencies;
--   * no scope-level COVERAGE percent. Within one country it is a ratio of
--     same-currency money and is meaningful; across countries the numerator and
--     denominator are each blended sums, so the ratio measures nothing;
--   * no merged by_asset / by_item ranking. Asset codes are a PER-COUNTRY
--     sequence, so the same code is usually a DIFFERENT machine in another
--     country (V376), and item codes mean different items per country (V367).
--     Merging those rows would fuse two machines into one row;
--   * no scope-level distinct ASSET count, for the same reason: counting
--     distinct asset_code across countries silently folds two real machines
--     into one. Counts are only aggregated where they carry no such ambiguity.
--
-- HOW IT IS BUILT: COMPOSITION, NOT A SECOND COPY OF THE ANALYSIS.
-- Each function below loops the permitted countries and CALLS THE EXISTING
-- single-country function once per country, returning its payload verbatim.
-- Two reasons, both load-bearing:
--   1. Correctness is guaranteed by construction rather than by re-derivation.
--      The multi-country result for one country is not merely equal to the
--      single-country result, it IS that result.
--   2. There is no second copy of the price/volume decomposition or the CPK
--      maths to drift. A fix to the single-country function is inherited here
--      automatically. Two copies of a calculation that diverge invisibly is a
--      defect class this codebase has already paid for.
-- The cost is that the work is sequential: the heaviest of the five
-- (get_cost_cpk_overview) measures ~0.9s per country, so a three-country scope
-- is ~2s in one round trip. That is the same work the client would do in three
-- calls, traded for one request, one coherent instant, and the guard below.
--
-- THE SECURITY GAIN, which is the other half of the point.
-- Four of the five parents are SECURITY DEFINER and check only the org - they
-- have NO country ABAC guard, a gap deferred as a family-wide policy call when
-- V461 guarded the Cost/M3 family. Measured live before writing this: a real
-- KSA-only Manager (app_can_see_country('UAE') = false) can today read UAE
-- spend through get_cost_variance and get_parts_expense_snapshot. That hole is
-- NOT touched here (this migration only ADDS; altering a live function is a
-- separate, signed-off change), but every function below refuses a country the
-- caller may not see, PER COUNTRY rather than all-or-nothing: the permitted
-- countries are reported, the rest come back in `refused`. A scope is a filter,
-- never a way to widen access.
--
-- NAMING: `_multi`, NOT AN OVERLOAD. Adding a defaulted signature beside an
-- existing one makes BOTH ambiguous to PostgREST (42725), which has bitten this
-- repo twice. Distinct names make that impossible.
--
-- SECURITY MODEL, mirroring each parent exactly:
--   * DEFINER for the four whose parent is DEFINER; the org check is the tenant
--     boundary and it is re-made here.
--   * get_expense_period_trend_multi is SECURITY INVOKER, and that is not an
--     oversight. Its parent is INVOKER and carries no org filter at all - RLS
--     is its only boundary. Making the wrapper DEFINER would REMOVE that
--     boundary and expose every org's expense trend.
--   * search_path pinned; EXECUTE revoked from PUBLIC and then from anon BY
--     NAME (revoking PUBLIC alone does not clear an explicit anon grant, and
--     revoking anon alone does not clear a PUBLIC grant), granted to
--     authenticated + service_role.
--
-- ROLLBACK (safe - nothing else references these):
--   drop function if exists public.get_parts_expense_snapshot_multi(text[],text,date,date);
--   drop function if exists public.get_cost_cpk_overview_multi(text[],text,date,date);
--   drop function if exists public.get_cost_variance_multi(text[],text,date,date,integer);
--   drop function if exists public.get_expense_period_trend_multi(text[],text);
--   drop function if exists public.get_site_operating_cost_multi(text[],date,date);
--   drop function if exists public._scope_split_countries(text[]);
-- =============================================================================

-- -----------------------------------------------------------------------------
-- The one place a requested scope is split into what may be read and what may
-- not. Trims, drops blanks, de-duplicates case-insensitively while KEEPING the
-- caller's spelling (the country name is rendered and exported, so it must come
-- back as the register writes it), preserves the caller's order so the report
-- reads in the order the reader chose, and partitions on app_can_see_country.
-- Written once so five functions cannot disagree about who may read what.
--
-- BOTH lists come out of the SAME de-duplication pass, and that is the point.
-- Computing `refused` separately as "requested but not in allowed" is the
-- obvious shortcut and it is wrong: asking for array['KSA','ksa'] would return
-- KSA once (correctly de-duplicated) and then report 'ksa' as REFUSED, telling
-- the reader we declined a country we had in fact just shown them. A caller
-- cannot tell that apart from a real permission refusal. Caught by an edge-case
-- test against the live database, not by reading the code.
-- -----------------------------------------------------------------------------
create or replace function public._scope_split_countries(
  p_countries text[],
  out allowed  text[],
  out refused  text[]
)
language sql
stable
set search_path to 'public'
as $$
  with req as (
    -- one row per DISTINCT country asked for, first spelling and position win
    select distinct on (lower(btrim(c))) btrim(c) as c, ord
      from unnest(coalesce(p_countries, '{}'::text[])) with ordinality as u(c, ord)
     where c is not null and btrim(c) <> ''
     order by lower(btrim(c)), ord
  ), split as (
    select c, ord, public.app_can_see_country(c) as visible from req
  )
  select
    coalesce((select array_agg(c order by ord) from split where visible),     '{}'::text[]),
    coalesce((select array_agg(c order by ord) from split where not visible), '{}'::text[]);
$$;

comment on function public._scope_split_countries(text[]) is
  'V544: requested countries -> {allowed, refused}, de-duplicated case-insensitively, in request order.';

-- -----------------------------------------------------------------------------
-- 1. PARTS EXPENSE SNAPSHOT, per country.
-- Every figure in the parent is money (total / tyre / spare / oil / by_asset /
-- by_store / top_items / monthly) or a per-country count, so the whole payload
-- is denominated and belongs inside a country block.
-- -----------------------------------------------------------------------------
create or replace function public.get_parts_expense_snapshot_multi(
  p_countries text[] default null,
  p_site      text   default null,
  p_from      date   default null,
  p_to        date   default null
) returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_org       uuid := public.app_current_org();
  v_allowed   text[];
  v_refused   text[] := '{}';
  v_country   text;
  v_blocks    jsonb := '[]'::jsonb;
begin
  if v_org is null or not public.app_is_active() then
    return jsonb_build_object('ok', false, 'reason', 'unauthorized');
  end if;

  select allowed, refused into v_allowed, v_refused
    from public._scope_split_countries(p_countries);

  foreach v_country in array v_allowed loop
    v_blocks := v_blocks || jsonb_build_array(jsonb_build_object(
      'country',  v_country,
      'currency', public.currency_for_country(v_country),
      -- verbatim from the single-country function, so the two can never disagree
      'result',   public.get_parts_expense_snapshot(p_site, v_country, p_from, p_to)));
  end loop;

  return jsonb_build_object(
    'ok', true, 'multi', true, 'generated_at', now(),
    -- states the promise rather than leaving it to be inferred: there is no
    -- scope-level total in this payload and there never will be
    'blended', false,
    'requested', to_jsonb(coalesce(p_countries, '{}'::text[])),
    'refused',   to_jsonb(v_refused),
    'countries', v_blocks);
end $$;

-- -----------------------------------------------------------------------------
-- 2. COST + CPK OVERVIEW, per country.
-- The parent already detects a multi-currency read (`blended: true`) but STILL
-- fills totals, cpk and every dimension from a cross-country sum, so its
-- un-scoped answer is a blended total with a warning flag attached. Per country
-- there is nothing to blend: each block is one currency, and its cost per km is
-- a rate in that currency that is never averaged with another.
-- -----------------------------------------------------------------------------
create or replace function public.get_cost_cpk_overview_multi(
  p_countries text[] default null,
  p_site      text   default null,
  p_from      date   default null,
  p_to        date   default null
) returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_org     uuid := public.app_current_org();
  v_allowed text[];
  v_refused text[] := '{}';
  v_country text;
  v_blocks  jsonb := '[]'::jsonb;
begin
  if v_org is null or not public.app_is_active() then
    return jsonb_build_object('ok', false, 'reason', 'unauthorized');
  end if;

  select allowed, refused into v_allowed, v_refused
    from public._scope_split_countries(p_countries);

  foreach v_country in array v_allowed loop
    v_blocks := v_blocks || jsonb_build_array(jsonb_build_object(
      'country',  v_country,
      'currency', public.currency_for_country(v_country),
      'result',   public.get_cost_cpk_overview(v_country, p_site, p_from, p_to)));
  end loop;

  return jsonb_build_object(
    'ok', true, 'multi', true, 'generated_at', now(), 'blended', false,
    'requested', to_jsonb(coalesce(p_countries, '{}'::text[])),
    'refused',   to_jsonb(v_refused),
    'countries', v_blocks);
end $$;

-- -----------------------------------------------------------------------------
-- 3. COST VARIANCE, per country.
-- The parent already REFUSES to decompose a multi-currency read, returning
-- `blended: true` with the reason "Choose a country". That refusal is correct
-- and is not being softened: the price and volume effects are signed amounts
-- that must add back up to the delta, which only holds inside one currency.
-- Running the same decomposition once per country keeps that closure exact
-- within each block, and there is no scope-level effect total.
-- -----------------------------------------------------------------------------
create or replace function public.get_cost_variance_multi(
  p_countries text[]  default null,
  p_site      text    default null,
  p_from      date    default null,
  p_to        date    default null,
  p_limit     integer default 25
) returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_org     uuid := public.app_current_org();
  v_allowed text[];
  v_refused text[] := '{}';
  v_country text;
  v_blocks  jsonb := '[]'::jsonb;
begin
  if v_org is null or not public.app_is_active() then
    return jsonb_build_object('ok', false, 'reason', 'unauthorized');
  end if;

  select allowed, refused into v_allowed, v_refused
    from public._scope_split_countries(p_countries);

  foreach v_country in array v_allowed loop
    v_blocks := v_blocks || jsonb_build_array(jsonb_build_object(
      'country',  v_country,
      'currency', public.currency_for_country(v_country),
      'result',   public.get_cost_variance(v_country, p_site, p_from, p_to, p_limit)));
  end loop;

  return jsonb_build_object(
    'ok', true, 'multi', true, 'generated_at', now(), 'blended', false,
    'requested', to_jsonb(coalesce(p_countries, '{}'::text[])),
    'refused',   to_jsonb(v_refused),
    'countries', v_blocks);
end $$;

-- -----------------------------------------------------------------------------
-- 4. EXPENSE PERIOD TREND, per country.
-- This one was ALREADY multi-country in substance: it groups by (country,
-- period) and tags every row with its own country and currency, so its rows
-- were never blended. What it could not express was a SUBSET - it takes one
-- country or the literal 'All'. This wrapper closes exactly that gap.
--
-- SECURITY INVOKER, DELIBERATELY. The parent carries no organisation filter of
-- any kind; RLS on parts_consumption is its only boundary. A DEFINER wrapper
-- would run as the owner, bypass RLS, and hand every organisation's expense
-- trend to any caller. Do not "harden" this by adding SECURITY DEFINER.
-- -----------------------------------------------------------------------------
create or replace function public.get_expense_period_trend_multi(
  p_countries text[] default null,
  p_grain     text   default 'year'
) returns jsonb
language plpgsql
stable
set search_path to 'public'
as $$
declare
  v_allowed text[];
  v_refused text[] := '{}';
  v_country text;
  v_blocks  jsonb := '[]'::jsonb;
begin
  select allowed, refused into v_allowed, v_refused
    from public._scope_split_countries(p_countries);

  foreach v_country in array v_allowed loop
    v_blocks := v_blocks || jsonb_build_array(jsonb_build_object(
      'country',  v_country,
      'currency', public.currency_for_country(v_country),
      'result',   public.get_expense_period_trend(v_country, p_grain)));
  end loop;

  return jsonb_build_object(
    'ok', true, 'multi', true, 'generated_at', now(), 'blended', false,
    'requested', to_jsonb(coalesce(p_countries, '{}'::text[])),
    'refused',   to_jsonb(v_refused),
    'countries', v_blocks);
end $$;

-- -----------------------------------------------------------------------------
-- 5. SITE OPERATING COST, per country.
-- The parent's rows already carry their own country and currency, so its money
-- was never blended either. Two things are gained by going through a country at
-- a time: `coverage` (what share of expense lines resolve to an asset's site)
-- becomes a per-country figure instead of one scope-wide ratio that averages
-- three unrelated data-quality levels into a number describing none of them;
-- and the missing country ABAC guard is supplied - the parent, called with a
-- NULL country, returns every country in the organisation regardless of what
-- the caller may see.
-- -----------------------------------------------------------------------------
create or replace function public.get_site_operating_cost_multi(
  p_countries text[] default null,
  p_from      date   default null,
  p_to        date   default null
) returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_org     uuid := public.app_current_org();
  v_allowed text[];
  v_refused text[] := '{}';
  v_country text;
  v_blocks  jsonb := '[]'::jsonb;
begin
  -- The parent gates on the org alone; app_is_active is added here because a
  -- wrapper may only ever be stricter than what it wraps, never looser.
  if v_org is null or not public.app_is_active() then
    return jsonb_build_object('ok', false, 'reason', 'unauthorized');
  end if;

  select allowed, refused into v_allowed, v_refused
    from public._scope_split_countries(p_countries);

  foreach v_country in array v_allowed loop
    v_blocks := v_blocks || jsonb_build_array(jsonb_build_object(
      'country',  v_country,
      'currency', public.currency_for_country(v_country),
      'result',   public.get_site_operating_cost(v_country, p_from, p_to)));
  end loop;

  return jsonb_build_object(
    'ok', true, 'multi', true, 'generated_at', now(), 'blended', false,
    'requested', to_jsonb(coalesce(p_countries, '{}'::text[])),
    'refused',   to_jsonb(v_refused),
    'countries', v_blocks);
end $$;

-- -----------------------------------------------------------------------------
-- GRANTS. Order is load-bearing: grant first, then revoke PUBLIC, then revoke
-- anon by name. Revoking PUBLIC alone also strips authenticated where it reaches
-- the function through PUBLIC; revoking anon alone leaves a PUBLIC grant intact.
-- -----------------------------------------------------------------------------
grant execute on function public._scope_split_countries(text[])                                  to authenticated, service_role;
grant execute on function public.get_parts_expense_snapshot_multi(text[], text, date, date)        to authenticated, service_role;
grant execute on function public.get_cost_cpk_overview_multi(text[], text, date, date)             to authenticated, service_role;
grant execute on function public.get_cost_variance_multi(text[], text, date, date, integer)        to authenticated, service_role;
grant execute on function public.get_expense_period_trend_multi(text[], text)                      to authenticated, service_role;
grant execute on function public.get_site_operating_cost_multi(text[], date, date)                 to authenticated, service_role;

revoke execute on function public._scope_split_countries(text[])                                 from public;
revoke execute on function public.get_parts_expense_snapshot_multi(text[], text, date, date)       from public;
revoke execute on function public.get_cost_cpk_overview_multi(text[], text, date, date)            from public;
revoke execute on function public.get_cost_variance_multi(text[], text, date, date, integer)       from public;
revoke execute on function public.get_expense_period_trend_multi(text[], text)                     from public;
revoke execute on function public.get_site_operating_cost_multi(text[], date, date)                from public;

revoke execute on function public._scope_split_countries(text[])                                 from anon;
revoke execute on function public.get_parts_expense_snapshot_multi(text[], text, date, date)       from anon;
revoke execute on function public.get_cost_cpk_overview_multi(text[], text, date, date)            from anon;
revoke execute on function public.get_cost_variance_multi(text[], text, date, date, integer)       from anon;
revoke execute on function public.get_expense_period_trend_multi(text[], text)                     from anon;
revoke execute on function public.get_site_operating_cost_multi(text[], date, date)                from anon;
