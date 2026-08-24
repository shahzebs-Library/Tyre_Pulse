-- ============================================================================
-- V607. Close two security-advisor regressions.
--
-- STATUS: APPLIED + VERIFIED LIVE on jhssdmeruxtrlqnwfksc (2026-08-24) as
--         `v607_search_path_and_trigger_grants`.
--
-- MEASURED BEFORE / AFTER (security advisor):
--     function_search_path_mutable                  13 -> 0
--     anon_security_definer_function_executable     12 -> 10
--     authenticated_security_definer_function_...  352 -> 350
--     total advisories                             770 -> 753
--
-- ── 1. TRIGGER FUNCTIONS MUST NOT CARRY AN EXECUTE GRANT ────────────────────
-- Supabase grants EXECUTE to PUBLIC at CREATE time, so every function created
-- since the V500 sweep inherits it. Two had: `expense_building_guard` (V603's
-- UAE import guard) and `sync_ksa_kms_to_meter`. Both RETURN trigger and are
-- fired by the trigger machinery, which never consults EXECUTE - so revoking
-- costs nothing and removes the surface.
--
-- Revoking from PUBLIC is the operative step. A `revoke ... from anon` alone is
-- a NO-OP against a PUBLIC grant (V500 learned this the hard way, and its first
-- run left 100 functions still anon-executable).
--
-- The anon-executable DEFINER set is now back to exactly the 10 the V500
-- allowlist names, verified by listing them rather than counting:
--   get_accident_portal_snapshot, get_display_snapshot, get_email_by_identifier,
--   get_public_config, get_report_snapshot, get_report_tyre_maintenance,
--   get_workshop_snapshot, login_attempt_status, record_login_failure,
--   reset_login_attempts
--
-- PROVEN NOT TO BREAK THE TRIGGERS, rather than assumed. After the revoke, two
-- probe rows were inserted into parts_consumption and the V603 guard still
-- behaved exactly as specified: the UAE non-workshop BUILDINGS row was SKIPPED
-- (0 rows landed) and the UAE workshop row was KEPT (1 row). Both probes, and
-- the reject-log row they produced, were then deleted - confirmed 0 left.
--
-- ── 2. PIN search_path ON EVERY FLAGGED FUNCTION ────────────────────────────
-- An unpinned search_path lets a same-named object in an earlier schema capture
-- a call. Two populations were flagged:
--
--   LIVE, in public: tyre_brand_canonical and tyre_removal_reason_canonical.
--   Each has 2 callers (they are the SQL half of the mirror pair with
--   normalizeBrandToken in src/lib/tyreLearning.js and the V590 removal-reason
--   canonicaliser). ALTER ... SET search_path does not touch the body, so
--   behaviour is unchanged and no dependent index is invalidated.
--
--   LEFTOVER, in _bak: 11 verification helpers from the completed V554 / V557 /
--   V561 / V569 security sweeps. They are PINNED RATHER THAN DROPPED for two
--   reasons: _bak is the rollback schema and pinning is non-destructive, and
--   they are already unreachable - `has_schema_privilege` confirms neither anon
--   nor authenticated holds USAGE on _bak, so no app role can call them at all.
--   Nothing in public references them either (checked against every function
--   body). They contribute no risk; they were contributing 11 of the 13 warnings
--   in this category, which is worse than it sounds - a permanently noisy
--   category is where the next REAL finding goes unnoticed.
--
-- ROLLBACK
--   alter function <each> reset search_path;
--   grant execute on function public.expense_building_guard() to public;
--   grant execute on function public.sync_ksa_kms_to_meter()  to public;
-- ============================================================================

revoke all on function public.expense_building_guard()  from public, anon, authenticated;
revoke all on function public.sync_ksa_kms_to_meter()   from public, anon, authenticated;

alter function public.tyre_brand_canonical(raw text)               set search_path = public;
alter function public.tyre_removal_reason_canonical(p_reason text) set search_path = public;

alter function _bak.canon(j jsonb)                                              set search_path = public;
alter function _bak.jsonb_canon(j jsonb)                                        set search_path = public;
alter function _bak.probe(p_user uuid)                                          set search_path = public;
alter function _bak.probe(p_user uuid, p_batch integer)                         set search_path = public;
alter function _bak.probe_content(p_user uuid, p_batch integer)                 set search_path = public;
alter function _bak.v554_capture(p_phase text, p_uid uuid)                      set search_path = public;
alter function _bak.v554_sig(v jsonb)                                           set search_path = public;
alter function _bak.v557_calls(grp integer)                                     set search_path = public;
alter function _bak.v557_capture(p_phase text, p_user text, p_calls text[])     set search_path = public;
alter function _bak.v561_capture(p_phase text, p_who text, p_uid uuid, p_calls text[]) set search_path = public;
alter function _bak.v569_capture(p_phase text, p_run integer)                   set search_path = public;

-- Abort rather than report success on a partial run: half a boundary reads as a
-- closed one, which is the failure mode that matters here.
do $v$
declare n int;
begin
  select count(*) into n
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname in ('public','_bak') and p.prokind = 'f' and p.proconfig is null
     and p.proname in ('canon','jsonb_canon','probe','probe_content','v554_capture','v554_sig',
                       'v557_calls','v557_capture','v561_capture','v569_capture',
                       'tyre_brand_canonical','tyre_removal_reason_canonical');
  if n <> 0 then raise exception 'V607: % function(s) still have an unpinned search_path', n; end if;

  if has_function_privilege('anon', 'public.expense_building_guard()', 'EXECUTE')
     or has_function_privilege('anon', 'public.sync_ksa_kms_to_meter()', 'EXECUTE') then
    raise exception 'V607: a trigger function is still anon-executable';
  end if;
end $v$;
