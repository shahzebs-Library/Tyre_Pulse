-- =====================================================================
-- V536  LET POSTGRES USE PARALLEL PLANS AGAIN
-- STATUS: APPLIED LIVE 2026-08-12 (project jhssdmeruxtrlqnwfksc)
--         migration name: v536_rls_helpers_parallel_safe
-- =====================================================================
--
-- Every RLS helper defaulted to PARALLEL UNSAFE - Postgres's default for any
-- function that does not say otherwise. ONE unsafe function anywhere in a query
-- disables parallel query for the WHOLE plan, and app_current_org() sits in a
-- RESTRICTIVE policy on ~198 tables. So in practice no query in this
-- application could ever use a parallel worker, on any table, at any size.
--
-- SAFETY WAS CHECKED, NOT ASSUMED. A function may be marked safe only if it
-- does not write, use a sequence, touch a temp table or change transaction
-- state. All twelve bodies were read out of pg_proc first: every one is plain
-- SELECTs against `profiles` (plus module_permissions / app_settings /
-- user_access_grants for app_user_can). None writes.
--
-- app_user_can tripped an automated "writes or DDL" screen and that was a FALSE
-- POSITIVE - the words matched are the table name `user_access_grants` and the
-- literal 'grant' in `g.effect = 'grant'`. Its body is SELECT ... INTO and
-- EXISTS only. Worth recording because the next person to run that screen will
-- see the same flag.
--
-- SECURITY DEFINER is ORTHOGONAL to parallel safety. None of this changes what
-- a function returns; it changes only which plans the planner may consider.
--
-- The four V396 scope readers were already PARALLEL SAFE and are untouched.
--
-- VERIFIED AFTER APPLYING, both halves:
--   1. The boundary is unchanged. Impersonating a real approved KSA Manager:
--      vehicle_fleet 1,030 (exactly the documented KSA fleet), work_orders
--      61,791, tyre_records 8,143, parts_consumption 108,635 - all KSA-only,
--      no cross-country leak.
--   2. The change actually took effect. An aggregate over parts_consumption
--      now plans `Gather / Workers Planned: 1 / Workers Launched: 1` over a
--      `Parallel Seq Scan`. That plan was unavailable before.
--
-- Marking a function safe PERMITS a parallel plan; it does not force one. The
-- planner still decides per query, so do not quote a blanket speedup figure.
--
-- ROLLBACK: alter function <name>(<args>) parallel unsafe;   -- instantaneous
-- =====================================================================

alter function public.app_current_org()                parallel safe;
alter function public.app_role()                       parallel safe;
alter function public.app_is_active()                  parallel safe;
alter function public.app_is_elevated()                parallel safe;
alter function public.app_is_org_admin()               parallel safe;
alter function public.is_super_admin()                 parallel safe;
alter function public.get_my_role()                    parallel safe;
alter function public.is_elevated_user()               parallel safe;
alter function public.is_approved_and_unlocked()       parallel safe;
alter function public.app_can_see_country(text)        parallel safe;
alter function public.app_can_see_site(text)           parallel safe;
alter function public.app_user_can(text, text)         parallel safe;

do $$
declare n int;
begin
  select count(*) into n
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and p.proname in ('app_current_org','app_role','app_is_active','app_is_elevated',
                       'app_is_org_admin','is_super_admin','get_my_role','is_elevated_user',
                       'is_approved_and_unlocked','app_can_see_country','app_can_see_site',
                       'app_user_can')
     and p.proparallel <> 's';
  if n > 0 then
    raise exception 'V536: % helper(s) are still not PARALLEL SAFE', n;
  end if;
end $$;
