-- V551  THE TENANT WALL: ORG ISOLATION INSIDE SECURITY DEFINER FUNCTIONS
-- STATUS: APPLIED + VERIFIED LIVE on jhssdmeruxtrlqnwfksc as v551_org_isolation.
--
-- V542-V550 closed COUNTRY. This closes ORG - the tenant wall, and the more
-- serious boundary, because country separates one company's regions while org
-- separates one company from another.
--
-- Same root cause as every migration in that run: a SECURITY DEFINER function
-- executes as its OWNER, no public table sets FORCE ROW LEVEL SECURITY, so RLS
-- never runs inside one. Each function must re-check for itself. These did not.
--
--
-- THE POPULATION AUDITED, so the boundaries of this claim are explicit:
--
--   400 SECURITY DEFINER functions in public; 352 executable by `authenticated`.
--   Of those, the ones written in sql/plpgsql that reference any of the 60
--   organisation_id-bearing tables and contain NEITHER `organisation_id` NOR
--   `app_current_org` anywhere in the body: 67.
--
--   Static analysis alone was NOT trusted, and twice it was wrong in both
--   directions. `get_console_stats` reads `WHERE is_super_admin=true` as a
--   column filter, which a gate-detecting regex reads as a gate - it has none.
--   The four report functions match `is_super_admin` only because V549 put it
--   in their COUNTRY predicate. Conversely the accident RPC family looks
--   unscoped and is not: it delegates to `_accident_rpc_context`, which
--   re-checks org. So every candidate was settled by IMPERSONATION, and 61 of
--   the 67 were dismissed on evidence:
--
--     * 12 are own-row profiles readers (app_role, app_country_scope,
--       is_super_admin, get_my_role, tyre_scrap_allowed ...). They MUST read
--       the caller's own profile across orgs or the scope system cannot work.
--     * ~30 are trigger functions, not directly callable.
--     * The rest are genuinely admin-gated (owner_data_audit raises
--       "super-admin only") or delegate their org check to a helper.
--
--   The 11 other V549-family reports were re-tested rather than assumed, and
--   all correctly scope org. Compared on FULL-PAYLOAD md5 as the Egypt Director
--   against the super admin, every one differs:
--     get_parts_expense_snapshot  total_expense 0 over 0 lines,
--                                 vs 138,507,286 over 209,381
--     get_maintenance_snapshot / get_fleet_cpk / get_daily_job_cards /
--     list_scrapped_tyres         distinct md5 from the super admin
--     get_expense_by_site 0 sites, get_tyre_cost_by_asset 0 assets,
--     get_brand_size_cpk [] (it carries organisation_id explicitly)
--
--   SIX genuine gaps remained. All six reproduced below.
--
--
-- REPRODUCED, by impersonating the real approved Egypt-only Director
-- a4fd5401 (org e340fa7a) in rolled-back transactions. That org holds ZERO
-- rows of every table; all data belongs to Company A. Direct table reads
-- confirm RLS holds for them - tyre_records 0, vehicle_fleet 0, work_orders 0.
-- Through these functions:
--
--   report_tyre_summary       591 tyre records, EGP 5,893,603.79
--   report_asset_metrics      per-asset aggregates      (payload returned)
--   report_asset_overview     per-asset health scores   (payload returned)
--   get_country_kpi           1 country row, plus TWO unscoped
--                             corrective_actions subqueries
--   count_records_with_extra_fields   11,191  <- byte-identical to super admin
--   get_console_stats         38 users, 4 organisations, 358 inspections
--                                       <- byte-identical to super admin
--
-- The last two are the sharpest proof: measured across ALL 38 approved users,
-- each returns exactly ONE distinct payload. They cannot tell any two callers
-- apart, in any org.
--
--
-- THE BLANK-SCREEN QUESTION, and why applying the filter is correct.
--
-- Every tyre_records row is Company A's. The Egypt Director's app_current_org()
-- is e340fa7a, which holds nothing, so an org filter takes them from 591
-- visible records to none. That is the long-recorded org-membership
-- misconfiguration, not a fault in these functions - and the objection is that
-- the fix blanks a working screen.
--
-- MEASURED, it does not, because the screen is not working now:
--
--   Egypt Director, TODAY, one screen:
--     KPI tile (report_tyre_summary) ....... 591 records, EGP 5,893,603.79
--     the tyre list directly beneath it .... 0 rows
--     asset register / work orders ......... 0 / 0
--     inspections / accidents .............. 0 / 0
--     expense lines ........................ 0
--
-- The Dashboard already contradicts itself: another tenant's money printed
-- above an empty table. These four functions are the INCONSISTENCY, not the
-- working state. Filtering makes the account consistently empty, which is the
-- honest rendering for a user whose organisation holds no data, and is exactly
-- what a direct table read already gives them.
--
-- BLAST RADIUS, measured before writing any of this:
--   4 organisations exist; only Company A holds any data.
--   38 approved users. 37 in Company A. TWO super admins, both in Company A.
--   EXACTLY ONE account - Mahmoud, Director, org e340fa7a - is outside it.
--   0 profiles carry a null org; 0 have org_id and organisation_id disagreeing.
--
-- So this changes the output of ONE misconfigured account and no other, and
-- that account already receives 0 rows from every other feed in the system.
--
-- THE DATA FIX IS NOT DONE HERE AND IS THE OWNER'S CALL. Moving that user into
-- Company A - as was done for `mohamed`/bassiouni previously - would restore
-- their screens, and is recommended separately. It is NOT a substitute for this
-- migration: moving the user hides the leak rather than removing it, and leaves
-- the tenant wall absent for any second tenant onboarded later. The two are
-- complementary, and only the code half is safe to apply unattended.
--
--
-- THE PREDICATE is the database's OWN org idiom, copied from the RESTRICTIVE
-- RLS policy on tyre_records so a definer function and a direct table read can
-- never disagree:
--
--   (<qual>.organisation_id = (select public.app_current_org())
--    or (select public.is_super_admin()))
--
-- Written as (select f()) they are uncorrelated subqueries, evaluated once per
-- query as an InitPlan - the V396/V549 rule. is_super_admin() is retained
-- because the live policy carries it; both super admins are in Company A, so it
-- is a no-op today and preserves platform-owner reach if a tenant is added.
-- A null app_current_org() yields NULL, hence no rows: fail-closed.
--
-- It inserts by rewriting each LIVE definition rather than retyping bodies, and
-- ABORTS unless each anchor matches EXACTLY the expected number of times. A
-- partial run is the failure mode that matters: half a boundary reads as a
-- closed one (the V396/V545 lesson).
--
-- ALSO CLOSED, found during the audit and adjacent to the tenant wall:
--   cron_purge_audit_logs() and cron_run_backup() are cron-only maintenance
--   functions but carry an explicit GRANT EXECUTE to `authenticated`. The
--   Egypt Director successfully executed cron_purge_audit_logs() - a global,
--   cross-tenant audit-log purge. Neither has any call site in src/ or mobile/.
--   Revoked from authenticated; service_role and postgres keep them, so the
--   pg_cron schedules are unaffected.
--
-- NO-OP PROOF: _bak.org_isolation_baseline_v551 holds the md5 of all six
-- payloads for all 38 approved users, captured before and after (456 rows).
--
--   On the FIVE report functions: the ONLY user whose payload changed is the
--   Egypt Director. All 37 others - including both super admins - are
--   byte-identical. Super admin still reads 11,191 records / SAR 12,450,390.96
--   and 3 country rows; the KSA Manager still reads 8,145 / SAR 6,132,319.38.
--
--   get_console_stats is DELIBERATELY NOT a no-op, and this is stated rather
--   than buried: both super admins are byte-identical (38 users, 4 orgs), but
--   all 36 non-super users move from the platform-wide 38 users / 4 orgs to
--   their own organisation (37 users / 1 org for Company A). That IS the fix -
--   those counts are cross-tenant metadata. No screen changes, because its only
--   caller is ConsoleDashboard.jsx and /console is super-admin only; the change
--   is reachable solely by calling the RPC directly, which is the leak itself.
--
-- MEASUREMENT NOTE worth keeping: the first pass compared md5 of the whole
-- get_console_stats payload and reported CHANGED for every user including the
-- super admins. That was the harness, not the function - the payload carries
-- generated_at: now(). Compare the substantive counts, not a hash of a payload
-- containing a timestamp. The same class of error nearly dismissed three
-- correctly-scoped functions: probing them with ->>'total_cost' returned null
-- for everyone because the real key is kpis.total_expense, and null was briefly
-- mistaken for "no rows". Re-tested on full-payload md5, they scope correctly:
-- Egypt Director total_expense 0 over 0 lines vs super admin 138,507,286 over
-- 209,381. Always confirm a probe can return data before reading null as proof.
--
-- ROLLBACK: re-create each function from _bak.rpc_defs_v551, which holds the
-- exact prior definition text, and
--   grant execute on function public.cron_purge_audit_logs() to authenticated;
--   grant execute on function public.cron_run_backup() to authenticated;

create schema if not exists _bak;
drop table if exists _bak.rpc_defs_v551;
create table _bak.rpc_defs_v551(proname text, def text, saved_at timestamptz default now());

do $mig$
declare
  v_def   text;
  v_new   text;
  v_name  text;
  v_hits  int;
  v_org   constant text := '(%s.organisation_id = (select public.app_current_org()) or (select public.is_super_admin())) and ';
  r       record;
begin
  -- ---------------------------------------------------------------- save
  for r in
    select p.oid, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('get_country_kpi','report_tyre_summary','report_asset_metrics',
                        'report_asset_overview','count_records_with_extra_fields',
                        'get_console_stats')
  loop
    insert into _bak.rpc_defs_v551(proname, def) values (r.proname, pg_get_functiondef(r.oid));
  end loop;

  if (select count(*) from _bak.rpc_defs_v551) <> 6 then
    raise exception 'V551 abort: expected 6 prior definitions, saved %',
      (select count(*) from _bak.rpc_defs_v551);
  end if;

  ------------------------------------------------------------------------
  -- 1. get_country_kpi : tyre_records (alias t) + TWO corrective_actions
  ------------------------------------------------------------------------
  select def into v_def from _bak.rpc_defs_v551 where proname = 'get_country_kpi';

  select count(*) into v_hits from regexp_matches(
    v_def, 'from[[:space:]]+public\.tyre_records[[:space:]]+t[[:space:]]+where[[:space:]]+', 'gi');
  if v_hits <> 1 then
    raise exception 'V551 abort: get_country_kpi tyre_records anchor matched % times, expected 1', v_hits;
  end if;

  select count(*) into v_hits from regexp_matches(
    v_def, 'from[[:space:]]+public\.corrective_actions[[:space:]]+a[[:space:]]+where[[:space:]]+', 'gi');
  if v_hits <> 2 then
    raise exception 'V551 abort: get_country_kpi corrective_actions anchor matched % times, expected 2', v_hits;
  end if;

  v_new := regexp_replace(v_def,
    '(from[[:space:]]+public\.tyre_records[[:space:]]+t[[:space:]]+where[[:space:]]+)',
    '\1' || format(v_org, 't'), 'gi');
  v_new := regexp_replace(v_new,
    '(from[[:space:]]+public\.corrective_actions[[:space:]]+a[[:space:]]+where[[:space:]]+)',
    '\1' || format(v_org, 'a'), 'gi');
  execute v_new;

  ------------------------------------------------------------------------
  -- 2. report_tyre_summary : tyre_records (alias r)
  ------------------------------------------------------------------------
  select def into v_def from _bak.rpc_defs_v551 where proname = 'report_tyre_summary';
  select count(*) into v_hits from regexp_matches(
    v_def, 'FROM[[:space:]]+public\.tyre_records[[:space:]]+r[[:space:]]+WHERE[[:space:]]+', 'gi');
  if v_hits <> 1 then
    raise exception 'V551 abort: report_tyre_summary anchor matched % times, expected 1', v_hits;
  end if;
  v_new := regexp_replace(v_def,
    '(FROM[[:space:]]+public\.tyre_records[[:space:]]+r[[:space:]]+WHERE[[:space:]]+)',
    '\1' || format(v_org, 'r'), 'gi');
  execute v_new;

  ------------------------------------------------------------------------
  -- 3 + 4. report_asset_metrics / report_asset_overview : unaliased
  ------------------------------------------------------------------------
  foreach v_name in array array['report_asset_metrics','report_asset_overview'] loop
    select def into v_def from _bak.rpc_defs_v551 where proname = v_name;
    select count(*) into v_hits from regexp_matches(
      v_def, 'FROM[[:space:]]+public\.tyre_records[[:space:]]+WHERE[[:space:]]+', 'gi');
    if v_hits <> 1 then
      raise exception 'V551 abort: % anchor matched % times, expected 1', v_name, v_hits;
    end if;
    v_new := regexp_replace(v_def,
      '(FROM[[:space:]]+public\.tyre_records[[:space:]]+WHERE[[:space:]]+)',
      '\1' || format(v_org, 'tyre_records'), 'gi');
    execute v_new;
  end loop;

  ------------------------------------------------------------------------
  -- 5. count_records_with_extra_fields : unqualified table name
  ------------------------------------------------------------------------
  select def into v_def from _bak.rpc_defs_v551 where proname = 'count_records_with_extra_fields';
  select count(*) into v_hits from regexp_matches(
    v_def, 'FROM[[:space:]]+tyre_records[[:space:]]+WHERE[[:space:]]+', 'gi');
  if v_hits <> 1 then
    raise exception 'V551 abort: count_records_with_extra_fields anchor matched % times, expected 1', v_hits;
  end if;
  v_new := regexp_replace(v_def,
    '(FROM[[:space:]]+tyre_records[[:space:]]+WHERE[[:space:]]+)',
    '\1' || format(v_org, 'tyre_records'), 'gi');
  execute v_new;
end $mig$;

------------------------------------------------------------------------------
-- 6. get_console_stats : rewritten, not patched.
--
-- This one counts platform metadata - every profile, every organisation - and
-- handed it to any authenticated caller. It is read by exactly one surface,
-- src/console/pages/ConsoleDashboard.jsx, which is super-admin only.
--
-- The super-admin branch is the PRIOR BODY VERBATIM, so the platform owner's
-- figures are unchanged by construction rather than by measurement. Non-supers
-- get the same shape scoped to their own organisation. It is not hard-gated to
-- super admins because a refusal would be a behaviour change for a surface this
-- migration has no reason to touch; scoping keeps it working and truthful.
--
-- `tyres` does not exist in this database (the original caught undefined_table
-- and left 0); `vehicles` is a VIEW carrying no organisation_id, so the scoped
-- branch counts vehicle_fleet, which does.
------------------------------------------------------------------------------
create or replace function public.get_console_stats()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tu int:=0; v_au int:=0; v_lu int:=0; v_pu int:=0;
  v_to int:=0; v_ao int:=0; v_tt int:=0; v_ti int:=0; v_tv int:=0;
  v_nt int:=0; v_nw int:=0; v_sa int:=0;
  v_org uuid;
begin
  if (select public.is_super_admin()) then
    -- prior body, unchanged
    select count(*) into v_tu from profiles;
    select count(*) into v_au from profiles where approved=true and (locked is null or locked=false);
    select count(*) into v_lu from profiles where locked=true;
    select count(*) into v_pu from profiles where approved=false;
    select count(*) into v_sa from profiles where is_super_admin=true;
    select count(*) into v_nt from profiles where created_at >= now()-interval '1 day';
    select count(*) into v_nw from profiles where created_at >= now()-interval '7 days';
    select count(*) into v_to from organisations;
    select count(*) into v_ao from organisations where active=true;
    begin select count(*) into v_tt from tyres; exception when undefined_table then null; end;
    begin select count(*) into v_ti from inspections; exception when undefined_table then null; end;
    begin select count(*) into v_tv from vehicles; exception when undefined_table then null; end;
  else
    v_org := (select public.app_current_org());
    select count(*) into v_tu from profiles where org_id = v_org;
    select count(*) into v_au from profiles where org_id = v_org and approved=true and (locked is null or locked=false);
    select count(*) into v_lu from profiles where org_id = v_org and locked=true;
    select count(*) into v_pu from profiles where org_id = v_org and approved=false;
    select count(*) into v_sa from profiles where org_id = v_org and is_super_admin=true;
    select count(*) into v_nt from profiles where org_id = v_org and created_at >= now()-interval '1 day';
    select count(*) into v_nw from profiles where org_id = v_org and created_at >= now()-interval '7 days';
    select count(*) into v_to from organisations where id = v_org;
    select count(*) into v_ao from organisations where id = v_org and active=true;
    begin select count(*) into v_ti from inspections where organisation_id = v_org; exception when undefined_table then null; end;
    begin select count(*) into v_tv from vehicle_fleet where organisation_id = v_org; exception when undefined_table then null; end;
  end if;

  return jsonb_build_object(
    'users', jsonb_build_object('total',v_tu,'active',v_au,'locked',v_lu,'pending',v_pu,
                                'super_admins',v_sa,'new_today',v_nt,'new_week',v_nw),
    'organisations', jsonb_build_object('total',v_to,'active',v_ao),
    'assets', jsonb_build_object('tyres',v_tt,'inspections',v_ti,'vehicles',v_tv),
    'generated_at', now()
  );
end;
$function$;

------------------------------------------------------------------------------
-- 7. cron-only maintenance functions must not be callable by an end user.
--    Reproduced: the Egypt Director executed cron_purge_audit_logs()
--    successfully. Neither has a call site in src/ or mobile/.
------------------------------------------------------------------------------
revoke execute on function public.cron_purge_audit_logs() from authenticated;
revoke execute on function public.cron_run_backup()      from authenticated;

------------------------------------------------------------------------------
-- guard: every patched function must now carry an org predicate.
------------------------------------------------------------------------------
do $chk$
declare v_missing text;
begin
  select string_agg(p.proname, ', ') into v_missing
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('get_country_kpi','report_tyre_summary','report_asset_metrics',
                      'report_asset_overview','count_records_with_extra_fields','get_console_stats')
    and pg_get_functiondef(p.oid) !~* 'app_current_org';
  if v_missing is not null then
    raise exception 'V551 abort: no org predicate after patch on: %', v_missing;
  end if;

  if has_function_privilege('authenticated','public.cron_purge_audit_logs()','EXECUTE')
     or has_function_privilege('authenticated','public.cron_run_backup()','EXECUTE') then
    raise exception 'V551 abort: cron functions still executable by authenticated';
  end if;
end $chk$;

------------------------------------------------------------------------------
-- RECOMMENDED FOLLOW-UP, DELIBERATELY NOT APPLIED HERE: THE DATA HALF.
--
-- This migration removes the leak. It does NOT restore the Egypt Director's
-- screens, because their organisation genuinely holds no data. That is a live
-- production data change affecting a real person's access and is the owner's
-- call, so it is written down rather than executed.
--
-- The precedent is on record: user `mohamed`/bassiouni (0bdeeb0d) sat in the
-- same empty org e340fa7a and was moved into Company A, keeping country
-- ['Egypt'] so the country wall still bounds them to Egypt's 591 records.
-- Mahmoud (a4fd5401, Director, country ['Egypt']) is the last member of that
-- org and the only approved user outside Company A.
--
-- NOTE the trigger: trg_guard_profile_privileged raises unless get_my_role() is
-- 'Admin', and an MCP/SQL session has no profile row, so get_my_role() is NULL
-- and a direct UPDATE is refused. Disable and re-enable in the SAME
-- transaction, then verify tgenabled = 'O'.
--
--   begin;
--   alter table public.profiles disable trigger trg_guard_profile_privileged;
--   update public.profiles
--      set org_id          = '00000000-0000-0000-0000-000000000001',
--          organisation_id = '00000000-0000-0000-0000-000000000001'
--    where id = 'a4fd5401-7345-4c08-9701-d39349e612af';
--   alter table public.profiles enable trigger trg_guard_profile_privileged;
--   commit;
--
--   -- verify: expect tgenabled 'O', and Egypt-scoped visibility only
--   select tgname, tgenabled from pg_trigger
--    where tgrelid = 'public.profiles'::regclass
--      and tgname  = 'trg_guard_profile_privileged';
--
-- Expected result afterwards: that Director reads Egypt's 591 tyre records and
-- EGP 5,893,603.79 through BOTH the RPCs and direct table reads - consistently,
-- which is what they never had. KSA and UAE stay invisible to them, enforced by
-- the country wall (V549) rather than by an accident of org membership.
--
-- The alternative - leaving the four functions unfiltered and fixing only the
-- data - was considered and rejected. It would make the leak invisible rather
-- than absent, and would leave the tenant wall missing for the next tenant
-- onboarded. The org membership is a data error; the missing predicate was a
-- code error. Both are worth fixing, and only one of them is safe to fix here.
