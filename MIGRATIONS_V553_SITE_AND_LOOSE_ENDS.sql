-- V553  THE SITE DIMENSION, AND FOUR LOOSE ENDS
-- STATUS: APPLIED + VERIFIED LIVE on jhssdmeruxtrlqnwfksc (org Company A) as
-- migration v553_site_and_loose_ends.
--
-- ============================================================================
-- PART 0  WHY SITE HAD NEVER BEEN TESTED
-- ============================================================================
-- V269 introduced site scoping (profiles.sites + app_can_see_site) and V542
-- added the write half. Every check run since has used COUNTRY. Measured first,
-- before anything was written:
--
--   38 profiles. sites IS NULL: 0. sites = '{}': 0. sites containing 'ALL': 38.
--   Narrowed to real sites: ZERO, including both super admins.
--
-- So site isolation has never been exercised by a single user on this database.
-- That is not the same as "it does not work", and the difference had to be
-- measured rather than assumed. It also means every change below is a NO-OP
-- today and can be verified safely: app_can_see_site() returns true for all 38.
--
-- HOW IT WAS TESTED: in a ROLLED BACK transaction the real approved KSA-only
-- Manager 34793423 (role Manager, not Admin, not super) had sites narrowed to
-- ARRAY['NHC'] - one real site carrying 1,805 tyre records. The profile UPDATE
-- was authorised by setting request.jwt.claims to a super admin so that
-- trg_guard_profile_privileged passes; NO trigger was disabled and no ACCESS
-- EXCLUSIVE lock was taken on profiles. Everything was rolled back; no profile
-- on this database was left modified.
--
--   DIRECT TABLE READS - the wall HOLDS:
--     tyre_records          8,145 -> 3,846      (1,805 NHC + 2,041 site IS NULL)
--     tyre_records DIRIYAH  1,382 -> 0
--     vehicle_fleet -> 223   inspections -> 66   work_orders -> 16,391
--
--   DIRECT WRITES (V542) - the wall HOLDS, and was measured the honest way.
--   Counting the inserted row from inside the narrowed session returns 0 whether
--   it was refused OR merely invisible, so the count was taken as a PRIVILEGED
--   reader after `reset role` in the same transaction (the V542 lesson):
--     insert tyre_records site='DIRIYAH'  -> refused by tyre_records_site_write
--     insert tyre_records site='NHC'      -> landed  (correct)
--     insert tyre_records site=NULL       -> landed  (correct - see below)
--     privileged recount: only the NHC and NULL rows exist.
--
--   SECURITY DEFINER FUNCTIONS - the wall DOES NOT EXIST. Same defect class as
--   the country leak V545/V549 closed. Asking each function for DIRIYAH, a site
--   the narrowed user cannot read one row of directly, and hashing the full
--   ordered payload against the SUPER ADMIN's answer to the same call:
--
--     ALL SIX PROBED FUNCTIONS RETURNED A BYTE-IDENTICAL md5. Not similar -
--     identical. They are incapable of telling the two callers apart.
--
--       get_cost_cpk_overview      DIRIYAH spend 802,829 over 7,931,803 km
--       get_cost_variance          item detail, TECHKING 315/80 R22.5 165,185.78
--       get_maint_tyre_split       DIRIYAH tyre 61,804.09
--       get_maintenance_snapshot   13,258 line items, 1,819 tyre lines
--       get_parts_expense_snapshot / get_report_snapshot_authed likewise
--
-- ============================================================================
-- PART A  SITE GUARD ON THE NAMED-SITE PATH
-- ============================================================================
-- The guard is the V545 country idiom with the site reader substituted, placed
-- immediately after the body opens so it runs before any query. All nine return
-- jsonb, so the refusal shape matches their own existing error path and the
-- clients already handle {"ok":false,"reason":"forbidden"}.
--
-- It reads each LIVE definition rather than retyping bodies of up to 8k
-- characters, and ABORTS unless it guards exactly the nine named. A partial run
-- is the failure mode that matters: half a boundary reads as a closed one.
--
-- The insertion anchor was verified per function BEFORE this was written - for
-- all nine the first line-opening `begin` after the $function$ delimiter is the
-- top-level body opener, sitting immediately after the DECLARE block.
--
-- btrim(p_site) <> '' is load-bearing: app_can_see_site treats '' as "no site"
-- and the callers pass '' for "all sites", so testing p_site IS NOT NULL alone
-- would refuse the default all-sites call that every screen makes.
--
-- **THIS CLOSES THE NAMED-SITE PATH ONLY, AND THAT IS STATED RATHER THAN
-- HIDDEN.** p_site NULL or '' still means "no site filter", and on that path
-- these functions apply no site restriction of any kind - exactly the position
-- country was in between V545 and V549. Closing it is the V549 treatment: a
-- row-predicate rewrite inside each function, per function, not a mechanical
-- insertion, and it is NOT attempted here. With all 38 users on {ALL} neither
-- path is reachable by anyone today; the named path is closed because it can be
-- closed mechanically and proven, the all-sites path is left open and recorded.
--
-- **get_report_snapshot AND get_report_tyre_maintenance ARE DELIBERATELY
-- EXCLUDED.** Both are anon-executable public token boards, and their p_site is
-- a filter chosen by the board's creator, not by the caller. PROVEN, not
-- assumed: inside a SECURITY DEFINER function invoked by an anon caller
-- auth.uid() is NULL, so app_can_see_site('NHC') returns FALSE. Adding this
-- guard there would refuse every public report board that carries a site
-- filter. They are a different authorisation model - the token is the
-- authorisation - and must not be swept into a caller-scope guard.
--
-- The five _cost_* / _report_cost_block helpers also take a p_site and are NOT
-- touched: they take a p_org and are already revoked from authenticated and
-- anon (the V378 lesson), so they are not a caller-reachable surface.
--
-- ROLLBACK: re-create each function from _bak.rpc_defs_v553.

create schema if not exists _bak;
drop table if exists _bak.rpc_defs_v553;
create table _bak.rpc_defs_v553 (proname text, def text, saved_at timestamptz default now());

do $mig$
declare
  r        record;
  def      text;
  body_at  int;
  rel_at   int;
  begin_at int;
  newdef   text;
  n        int := 0;
  targets  text[] := array[
    'get_cost_cpk_overview','get_cost_cpk_overview_multi',
    'get_cost_variance','get_cost_variance_multi',
    'get_maint_tyre_split','get_maintenance_snapshot',
    'get_parts_expense_snapshot','get_parts_expense_snapshot_multi',
    'get_report_snapshot_authed'
  ];
  guard    text := E'\n  if p_site is not null and btrim(p_site) <> '''' and not public.app_can_see_site(p_site) then\n    return jsonb_build_object(''ok'', false, ''reason'', ''forbidden''); end if;\n';
begin
  for r in
    select p.oid, p.proname
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
    join pg_language l   on l.oid  = p.prolang
    where ns.nspname = 'public' and p.prosecdef and l.lanname = 'plpgsql'
      and p.proname = any(targets)
      and pg_get_function_result(p.oid) = 'jsonb'
      -- never touch the anon token boards, whichever name they arrive under
      and has_function_privilege('anon', p.oid, 'EXECUTE') = false
    order by p.proname
  loop
    def := pg_get_functiondef(r.oid);
    if position('app_can_see_site' in def) > 0 then
      continue;                                   -- already guarded, idempotent
    end if;
    insert into _bak.rpc_defs_v553 (proname, def) values (r.proname, def);

    body_at := position('$function$' in def);
    if body_at = 0 then
      raise exception 'V553: no $function$ delimiter on %', r.proname;
    end if;
    rel_at := position(E'\nbegin' in lower(substring(def from body_at)));
    if rel_at = 0 then
      raise exception 'V553: no body-opening begin found on %', r.proname;
    end if;
    begin_at := body_at + rel_at + 5;             -- just past the word `begin`

    newdef := substring(def from 1 for begin_at) || guard || substring(def from begin_at + 1);
    if position('app_can_see_site' in newdef) = 0 then
      raise exception 'V553: guard not inserted on %', r.proname;
    end if;

    execute newdef;
    n := n + 1;
  end loop;

  raise notice 'V553 PART A: site-guarded % functions', n;
  if n <> 9 then
    raise exception 'V553 PART A: expected to guard 9 functions, guarded %', n;
  end if;
end
$mig$;

-- ============================================================================
-- PART B  THE is_admin_or_above() CASE MISMATCH - NOT REPAIRED, DEFUSED
-- ============================================================================
--   SELECT get_my_role() IN ('admin','manager','director')
-- get_my_role() returns profiles.role verbatim, which is Title Case on every
-- row of this database ('Admin','Manager','Director'). The function therefore
-- returns FALSE for every user including both super admins, and the two
-- policies that depend on it have never fired.
--
-- REPAIRING THE CASE WOULD OPEN A CROSS-TENANT HOLE, and this was measured
-- rather than reasoned about. accident_audit_log carries NO organisation_id, NO
-- country and NO site column - its ONLY scoping is the sibling permissive
-- policy audit_log_select_case_readers, an EXISTS against accidents, which
-- inherits that table's org/country/site RLS. Permissive policies OR together,
-- so is_admin_or_above() returning true grants the whole table unconditionally.
--
--   MEASURED, by impersonation in a rolled-back transaction:
--     Mahmoud Taher, Director, organisation e340fa7a - A DIFFERENT TENANT
--       sees now: 0 rows      would see if repaired: ALL 284 rows
--     adnan, Manager, Company A     sees now 284, would see 284  (no change)
--     Aftab, Tyre Man, Company A    sees now 284, would see 284  (unaffected)
--
-- So the case mismatch is the only thing keeping another tenant out of Company
-- A's accident audit trail - old_values/new_values jsonb and changed_by. The
-- bug is load-bearing by accident. The case is NOT fixed.
--
-- What IS done: both dependent policies are retargeted to is_super_admin(), so
-- they express something true instead of sitting there as a landmine for the
-- next person who "fixes" the case. Provably a no-op today:
--   * accident_audit_log - both super admins are in Company A and already read
--     all 284 rows through audit_log_select_case_readers.
--   * alerts - the live gate is the sibling alerts_cap_update
--     (app_user_can('alerts','edit')), which already returns true for admin and
--     super (V229 precedence), so their UPDATE right is unchanged. Every other
--     role keeps exactly the capability it had.
--
-- is_admin_or_above() itself is left ALONE and is now referenced by nothing in
-- the database and nothing in src/. Changing its body is the widening; deleting
-- it is a separate decision that needs its own evidence.
--
-- ROLLBACK: re-create both policies from _bak.policy_defs_v553.

drop table if exists _bak.policy_defs_v553;
create table _bak.policy_defs_v553 (
  tablename text, policyname text, cmd text, permissive text,
  roles text, qual text, with_check text, saved_at timestamptz default now());

insert into _bak.policy_defs_v553 (tablename, policyname, cmd, permissive, roles, qual, with_check)
select tablename, policyname, cmd, permissive, array_to_string(roles,','), qual, with_check
from pg_policies
where schemaname = 'public'
  and (qual ilike '%is_admin_or_above%' or with_check ilike '%is_admin_or_above%');

do $mig$
declare n int;
begin
  select count(*) into n from _bak.policy_defs_v553;
  if n <> 2 then
    raise exception 'V553 PART B: expected exactly 2 dependent policies, found %', n;
  end if;
end
$mig$;

drop policy if exists audit_log_select on public.accident_audit_log;
create policy audit_log_select on public.accident_audit_log
  for select to authenticated
  using (public.is_super_admin());

drop policy if exists alerts_update on public.alerts;
create policy alerts_update on public.alerts
  for update to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- ============================================================================
-- PART C  BRANDING - THE CROSS-ORG GATE ONLY
-- ============================================================================
-- Both functions gated cross-org behaviour on app_is_org_admin(), which is
-- is_super_admin() OR app_role() = 'admin'. There are 0 plain Admins on this
-- database (both Admin-role profiles are super admins), so nothing is exposed
-- today - this is a latent hole, and it is closed in the two DIFFERENT places
-- the two functions need, not by one blanket substitution.
--
--   get_org_branding: reading your OWN org is unconditional and stays so. Only
--   the cross-org branch moves app_is_org_admin() -> is_super_admin(). Reading
--   another tenant's branding is a platform-owner action.
--
--   set_org_branding: its app_is_org_admin() check is NOT a cross-org check, it
--   is the permission to edit AT ALL, and an organisation admin editing their
--   OWN organisation's branding is the intended feature. Substituting
--   is_super_admin() there would break that feature for every future plain
--   Admin. It is left exactly as it is, and a SEPARATE cross-org guard is added
--   after the target org is resolved. That is the actual hole: a plain Admin
--   could pass p_org_id = some other tenant and rewrite their branding.
--
-- Both edits are applied by regexp_replace over the LIVE definition under a
-- guard that ABORTS unless the anchor is found EXACTLY ONCE - an 8k-character
-- body is never retyped by hand.
--
-- ROLLBACK: re-create from _bak.rpc_defs_v553 (both are saved there).

do $mig$
declare
  def text; newdef text; hits int;
begin
  -- ---- get_org_branding ---------------------------------------------------
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'get_org_branding';
  if def is null then raise exception 'V553 PART C: get_org_branding not found'; end if;
  insert into _bak.rpc_defs_v553 (proname, def) values ('get_org_branding', def);

  select count(*) into hits from regexp_matches(
    def, 'IF v_org IS DISTINCT FROM public\.app_current_org\(\) AND NOT public\.app_is_org_admin\(\) THEN', 'g');
  if hits <> 1 then
    raise exception 'V553 PART C: get_org_branding cross-org anchor found % times, expected 1', hits;
  end if;
  newdef := replace(def,
    'IF v_org IS DISTINCT FROM public.app_current_org() AND NOT public.app_is_org_admin() THEN',
    'IF v_org IS DISTINCT FROM public.app_current_org() AND NOT public.is_super_admin() THEN');
  execute newdef;

  -- ---- set_org_branding ---------------------------------------------------
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'set_org_branding';
  if def is null then raise exception 'V553 PART C: set_org_branding not found'; end if;
  insert into _bak.rpc_defs_v553 (proname, def) values ('set_org_branding', def);

  if position('Not authorised to edit branding for another organisation' in def) > 0 then
    raise notice 'V553 PART C: set_org_branding already carries the cross-org guard';
  else
    select count(*) into hits from regexp_matches(
      def, E'IF NOT EXISTS \\(SELECT 1 FROM public\\.organisations WHERE id = v_org\\) THEN', 'g');
    if hits <> 1 then
      raise exception 'V553 PART C: set_org_branding anchor found % times, expected 1', hits;
    end if;
    newdef := replace(def,
      E'IF NOT EXISTS (SELECT 1 FROM public.organisations WHERE id = v_org) THEN',
      E'IF v_org IS DISTINCT FROM public.app_current_org() AND NOT public.is_super_admin() THEN\n'
      || E'    RAISE EXCEPTION ''Not authorised to edit branding for another organisation'';\n'
      || E'  END IF;\n'
      || E'  IF NOT EXISTS (SELECT 1 FROM public.organisations WHERE id = v_org) THEN');
    if position('Not authorised to edit branding for another organisation' in newdef) = 0 then
      raise exception 'V553 PART C: set_org_branding guard not inserted';
    end if;
    execute newdef;
  end if;
end
$mig$;

-- ============================================================================
-- PART D  THREE EXECUTE GRANTS THAT NOTHING LEGITIMATE USES
-- ============================================================================
-- consume_event_accident_notify(domain_events) was the ONLY one of the eight
-- domain-event consumers carrying an `authenticated` EXECUTE grant. The other
-- seven - workflows, webhooks, rules, workflow_notify, approval_push,
-- assignment_push, accident_case_notify - are all postgres|service_role only.
-- It is the odd one out, not a design.
--
-- It takes the event ROW as its argument, so the caller supplies the entire
-- event: id, event_type, entity_id, organisation_id, actor_id, payload. It is
-- SECURITY DEFINER, so its `SELECT * FROM accidents WHERE id = ev.entity_id`
-- bypasses RLS and reaches any accident in any tenant, then INSERTs rows into
-- public.notifications for the role-resolved recipients of that accident's org.
--
--   PROVEN, in a rolled-back transaction, as the LOWEST-privilege real user on
--   the database - a Tyre Man - with a wholly fabricated event row:
--     the call SUCCEEDED with no permission error
--     notifications 1,564 -> 1,566
--     the two injected rows landed in the bells of adnan [Manager] and
--     Test User [Manager]
--
-- It is forgery, not disclosure: the function returns void, and the title and
-- body are composed from the real accident's own fields rather than from
-- attacker text. Email is a second gate - accident_emails_enabled is 'false' -
-- so no mail could be sent today either way.
--
-- cron_run_backup() and cron_purge_audit_logs() were likewise executable by
-- authenticated. Neither discloses anything. cron_run_backup would let any
-- signed-in user trigger a full snapshot of the curated tables on demand -
-- resource abuse, since backup_enabled is 'true'. cron_purge_audit_logs DELETES
-- from audit_log_v2, system_logs and access_audit past audit_retention_days,
-- which is set to 365.
--
--   MEASURED: rows currently older than 365 days are 0 / 0 / 0, so an ordinary
--   user calling it TODAY destroys nothing. That is a property of the data on
--   16 Aug 2026, not of the permission - audit_log_v2 holds 502,835 rows that
--   will age past the window.
--
-- NOTHING LEGITIMATE DEPENDS ON ANY OF THE THREE GRANTS, verified rather than
-- assumed: all 13 pg_cron jobs run as `postgres`, the dispatcher
-- process_domain_events is itself postgres|service_role only, and grep over
-- src/ and mobile/ finds no client call to any of the three (the single hit is
-- a descriptive string in src/lib/api/systemConfig.js naming the backup cron).
--
-- ROLLBACK: the prior ACLs are in _bak.acl_v553; re-grant with
--   GRANT EXECUTE ON FUNCTION <signature> TO authenticated;

drop table if exists _bak.acl_v553;
create table _bak.acl_v553 (
  proname text, args text, acl text, auth_exec boolean, saved_at timestamptz default now());

insert into _bak.acl_v553 (proname, args, acl, auth_exec)
select p.proname,
       pg_get_function_identity_arguments(p.oid),
       coalesce(array_to_string(p.proacl, ' | '), '(default)'),
       has_function_privilege('authenticated', p.oid, 'EXECUTE')
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('consume_event_accident_notify','cron_run_backup','cron_purge_audit_logs');

revoke execute on function public.consume_event_accident_notify(public.domain_events) from authenticated;
revoke execute on function public.cron_run_backup()        from authenticated;
revoke execute on function public.cron_purge_audit_logs()  from authenticated;

do $mig$
declare n int;
begin
  select count(*) into n
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public'
    and p.proname in ('consume_event_accident_notify','cron_run_backup','cron_purge_audit_logs')
    and has_function_privilege('authenticated', p.oid, 'EXECUTE');
  if n <> 0 then
    raise exception 'V553 PART D: % of the 3 functions are still authenticated-executable', n;
  end if;
end
$mig$;
