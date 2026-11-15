-- =====================================================================================
-- Interim restriction: no ERP job card decision can be recorded through the API until the
-- corrected function is installed
--
-- STATUS: APPLIED to production 2026-11-15 with the owner's explicit approval, recorded there as
--         version 20261115120856 (observation_erp_confirm_interim_lock). The applied text was a
--         baseline guard block (abort unless the three functions carry the expected ACL and
--         hashes) followed by exactly the three REVOKE statements below.
--         The executable text below is BYTE FOR BYTE the text production recorded in
--         supabase_migrations.schema_migrations for this version (read-only check 2026-11-15:
--         one statement, md5 01d5a77f60aac04bf505831078d0bab8). Its guard only holds against the
--         reviewed production baseline (function hashes, ACL, zero rows), so on any other
--         database it aborts by design. Do not replay it; it is the record of what ran.
--         Baseline md5(pg_get_functiondef) the production guard compared: decide
--         272f785a2a32256bfe2b83b99d131c1b, confirm 479f5400cf932e246c748909733be801, reject
--         f3109e20f4628824f4ecd90bd836e289.
--         Verified on production after the apply (by the lead): ACL on all three functions
--         {postgres=X/postgres,service_role=X/postgres}; decide / confirm / reject refused with
--         42501 for a real Manager; reads work; function md5 unchanged (272f785a.., 479f5400..,
--         f3109e20..); links 0, history 0.
-- ORDER:  production action 1 (done). The drafts 20261116085000 / 090000 / 091000 are NOT
--         approved. 091000 grants EXECUTE again on purpose; its ROLLBACK file restores the
--         function body only and leaves this lock in place.
--
-- WHY: the function live in production (observation_erp_decide, md5
--      272f785a2a32256bfe2b83b99d131c1b) checks company, country and role, but NOT site, and
--      matches wheels from a fixed table that is wrong for some vehicles. Hiding the Confirm
--      button in the web client does not stop a direct, signed-in API call. This closes the
--      door in the database.
--
-- WHAT WAS READ ON PRODUCTION (read-only, 2026-11-15):
--   observation_erp_decide(uuid,uuid,text,text)        SECURITY DEFINER, owner postgres
--   confirm_observation_erp_link(uuid,uuid,text)       SECURITY INVOKER, owner postgres
--   reject_observation_erp_link(uuid,uuid,text)        SECURITY INVOKER, owner postgres
--   ACL of each, identical:  {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--   No other function in public calls them. anon and PUBLIC have no EXECUTE.
--   The two wrappers run as the caller, so they need EXECUTE on observation_erp_decide too:
--   one revoke on that function already closes all three paths. All three are revoked so the
--   wrappers answer with the same clean refusal instead of a nested one.
--
-- WHAT IT DOES: three REVOKE statements. No function body changes, no table changes, no row
--   changes, nothing removed. service_role and the owner keep EXECUTE.
--
-- WHO LOSES WHAT: every signed-in user loses the ability to record a Confirm or a Reject of
--   an ERP job card (Reject is included because it goes through the same function). In
--   practice that is the people who pass the live function's own gate today: approved,
--   unlocked Admin, Manager or Director accounts and super admins. Nobody else could record
--   one before. Reading is untouched: the evidence lookup, the review panel and SELECT on
--   observation_erp_links / observation_erp_link_events keep working.
--
-- WHAT THE CLIENT SEES: PostgreSQL answers 42501 "permission denied for function ...";
--   PostgREST passes that code through (HTTP 403). The web client treats it as
--   "ERP confirmation is not available yet...", never as a raw error. The current client
--   already offers no decision, because observation_erp_rules() does not exist yet.
--
-- VERIFY (rolled back):
--   begin;
--   <the three revoke statements>
--   select p.oid::regprocedure, p.proacl from pg_proc p
--    where p.oid in ('public.observation_erp_decide(uuid,uuid,text,text)'::regprocedure,
--                    'public.confirm_observation_erp_link(uuid,uuid,text)'::regprocedure,
--                    'public.reject_observation_erp_link(uuid,uuid,text)'::regprocedure);
--   -- expect {postgres=X/postgres,service_role=X/postgres} on all three
--   rollback;
--
-- ROLLBACK (documentation only, never run as part of this file; restores the ACL production had
-- before 2026-11-15; needs the owner's explicit approval; the approved route is action 4,
-- 20261116091000, which re-grants together with the corrected rules):
--   grant execute on function public.observation_erp_decide(uuid, uuid, text, text) to authenticated;
--   grant execute on function public.confirm_observation_erp_link(uuid, uuid, text) to authenticated;
--   grant execute on function public.reject_observation_erp_link(uuid, uuid, text) to authenticated;
--
-- LATER: 20261116091000_observation_erp_decide_on_position_service.sql replaces the function
--   body and then grants EXECUTE to authenticated again on all three, deliberately, in the
--   same transaction as the corrected rules.
-- =====================================================================================


-- Guard (replayable part, see STATUS): stop before the revokes unless the reviewed functions are
-- the ones being locked.
-- Interim restriction (repo draft 20261116084000_observation_erp_confirm_interim_lock.sql).
-- Owner approved 2026-11-15. Guard aborts unless production still matches the reviewed baseline.
do $$
declare bad text := '';
begin
  if md5(pg_get_functiondef('public.observation_erp_decide(uuid,uuid,text,text)'::regprocedure)) <> '272f785a2a32256bfe2b83b99d131c1b' then bad := bad || ' decide_hash'; end if;
  if md5(pg_get_functiondef('public.confirm_observation_erp_link(uuid,uuid,text)'::regprocedure)) <> '479f5400cf932e246c748909733be801' then bad := bad || ' confirm_hash'; end if;
  if md5(pg_get_functiondef('public.reject_observation_erp_link(uuid,uuid,text)'::regprocedure)) <> 'f3109e20f4628824f4ecd90bd836e289' then bad := bad || ' reject_hash'; end if;
  if exists (select 1 from pg_proc p where p.oid in ('public.observation_erp_decide(uuid,uuid,text,text)'::regprocedure,'public.confirm_observation_erp_link(uuid,uuid,text)'::regprocedure,'public.reject_observation_erp_link(uuid,uuid,text)'::regprocedure)
             and p.proacl::text <> '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}') then bad := bad || ' acl_baseline'; end if;
  if has_function_privilege('anon','public.observation_erp_decide(uuid,uuid,text,text)'::regprocedure,'EXECUTE') then bad := bad || ' anon_exec'; end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where p.prosrc ~* 'observation_erp_decide|confirm_observation_erp_link|reject_observation_erp_link') <> 2 then bad := bad || ' unexpected_caller'; end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
       and p.proname in ('observation_erp_decide','confirm_observation_erp_link','reject_observation_erp_link')) <> 3 then bad := bad || ' overloads'; end if;
  if (select count(*) from public.observation_erp_links) <> 0 or (select count(*) from public.observation_erp_link_events) <> 0 then bad := bad || ' row_counts'; end if;
  if bad <> '' then raise exception 'interim lock aborted, baseline changed:%', bad; end if;
end $$;

revoke execute on function public.observation_erp_decide(uuid, uuid, text, text) from authenticated;
revoke execute on function public.confirm_observation_erp_link(uuid, uuid, text) from authenticated;
revoke execute on function public.reject_observation_erp_link(uuid, uuid, text) from authenticated;
