-- V548  LEAK SWEEP: SECURITY DEFINER FUNCTIONS THAT NEVER ASKED WHO WAS CALLING
--
-- Companion to V542 (write scoping), V543 (views running as their owner) and
-- V545 (country-argument cost RPCs). This pass covers the surfaces those three
-- did not: definer functions that leak WITHOUT taking a country argument, and
-- therefore cross the ORG boundary - the tenant wall - not merely the country one.
--
-- FOUR HOLES, EVERY ONE REPRODUCED BEFORE IT WAS TOUCHED. All figures below are
-- from impersonating the real approved Egypt-only Director a4fd5401 (org
-- e340fa7a, country {Egypt}) inside rolled-back transactions. Every direct table
-- read by that user returns 0 - RLS was never at fault - and every definer RPC
-- handed over another organisation's data:
--
--   probe                                  direct read      through the RPC
--   -------------------------------------  -----------      ---------------------------
--   profiles / get_console_users(null)      1 row            38 rows, 2 orgs, 38 emails,
--                                                            both super admins
--   accident_audit_log / get_accident_audit 0 rows           16 rows
--   inspection_audit_log / get_inspection_* 0 rows            5 rows
--   tyre_records / fleet_tyre_km_by_asset   0 rows           356 assets, 165,861,400 km
--
-- The mechanism, stated once: public tables are owned by postgres and none sets
-- FORCE ROW LEVEL SECURITY, so the owner bypasses RLS. Any SECURITY DEFINER
-- function is therefore outside the policy system by construction and has to
-- re-ask the question itself. These four never did.
--
-- get_console_users is the worst of the four and the cleanest to close: it takes
-- p_org_id, defaults it to NULL meaning "every organisation", joins auth.users
-- for the real email address, and returns role / is_super_admin / approved /
-- locked / last_login_at. A super admin calling it gets the same 38 rows as the
-- Egypt Director - i.e. the function grants every authenticated user
-- super-admin visibility of the whole user base. It has NO caller anywhere in the
-- repo (only MIGRATIONS_V23 references it, to pin its search_path); the console
-- Users page reads profiles directly under RLS. So the grant is simply withdrawn.
--
-- fleet_tyre_km_by_asset likewise has no client caller. It is reached only from
-- get_fleet_cpk / get_cpk_drivers / get_cpk_km_source, which are themselves
-- SECURITY DEFINER and therefore execute it as postgres, which does not consult
-- the authenticated grant. Its own sibling fleet_hours_by_asset - same signature,
-- same purpose, same file - is SECURITY INVOKER, which is what makes the definer
-- marking on this one look accidental rather than intended.
--
-- The two audit readers ARE live (get_accident_audit is called by
-- src/components/AccidentDetailModal.jsx and mobile/app/(app)/accident/[id].tsx),
-- so they are guarded rather than revoked. They stay SECURITY DEFINER on purpose:
-- turning them into invokers would scope them correctly but would also apply RLS
-- to the profiles join they use for actor_name, collapsing every other person's
-- name to 'System' - a visible regression in the case timeline.
--
-- THE GUARDS MIRROR EACH TABLE'S OWN SELECT RULE, so neither function can return
-- more than a direct read of that table would:
--   * accident_audit_log is governed by audit_log_select (is_admin_or_above) OR
--     audit_log_select_case_readers (the parent accident is visible). The parent
--     test is spelled out here because the policy's EXISTS relies on accidents'
--     RLS, which the definer context bypasses; the org / country / site / active
--     predicates are copied from the live accidents policies verbatim.
--     is_admin_or_above() is DELIBERATELY NOT honoured, for two reasons found by
--     measuring it: get_my_role() returns Title Case ('Manager') while that helper
--     compares against lowercase ('manager'), so it returns FALSE for every user
--     on this database including both super admins - the audit_log_select policy
--     has never once fired. And it carries no org scoping at all. Copying it here
--     would therefore change nothing today while arming a cross-org widening the
--     day somebody repairs the case mismatch. Parent-accident visibility is the
--     whole gate; it is org, country and site scoped, which that helper is not.
--   * inspection_audit_log is governed by insp_audit_select (role in
--     Admin/Manager/Director) plus a RESTRICTIVE org isolation on the audit row
--     itself, so both are restated directly against the audit row.
-- A caller who fails the guard gets zero rows rather than an exception, which is
-- the shape both call sites already handle for "this case has no audit history".
--
-- match_knowledge_documents is included as the one LATENT item: it honours a
-- caller-supplied filter_org with no check, so it would return another tenant's
-- document titles and full content. knowledge_documents currently holds 0 rows,
-- so nothing has leaked and nothing can be reproduced - it is closed now because
-- the fix is free and the first upload would arm it. filter_org is still honoured
-- for the service-role edge function (supabase/functions/ai-orchestrator), which
-- passes a server-derived org id and has no user session, and for a super admin;
-- the browser caller (src/lib/ragService.js) never passes filter_org at all.
--
-- DELIBERATELY NOT CHANGED, with reasons, so the next reader does not re-litigate:
--   * The import staging write gap V542 left open is REAL but INERT. Measured: a
--     KSA-only Manager CAN insert an import_batches row stamped UAE (privileged
--     count in the same transaction = 1) and cannot read it back (0). But
--     import_commit_batch re-checks BOTH org and import_user_can_commit_country
--     before it writes anything to a master table, and refuses: "Cross-country
--     commit denied". So staged rows for an unreachable country can never be
--     promoted. Adding a WITH CHECK here would change the staging flow, which is
--     the entire purpose of those tables, to close a path that is already closed
--     one step later. Left alone; see the report.
--   * get_org_branding / set_org_branding gate cross-org access on
--     app_is_org_admin() (super admin OR role Admin) rather than is_super_admin().
--     There are no plain Admins today, so nothing is exposed, and branding is
--     name / logo / contact email. Flagged, not changed.
--   * cron_run_backup and cron_purge_audit_logs are executable by authenticated.
--     Neither discloses anything and the purge only removes rows already past the
--     configured 365-day retention that the nightly job would remove anyway.
--     Hygiene, not a leak; left to a deliberate pass over the cron entry points.
--
-- ROLLBACK: _bak.v548_prior_state holds each function's exact prior definition
-- and ACL. Re-run the stored `def` to restore a body, and
--   grant execute on function public.get_console_users(uuid,text,integer,integer) to authenticated;
--   grant execute on function public.fleet_tyre_km_by_asset(uuid,text,date,date) to authenticated;
-- to restore the two withdrawn grants.

create schema if not exists _bak;
drop table if exists _bak.v548_prior_state;
create table _bak.v548_prior_state (
  proname   text,
  args      text,
  def       text,
  acl       text,
  saved_at  timestamptz default now()
);

insert into _bak.v548_prior_state (proname, args, def, acl)
select p.proname,
       pg_get_function_identity_arguments(p.oid),
       pg_get_functiondef(p.oid),
       coalesce(p.proacl::text, 'DEFAULT_NO_ACL')
from pg_proc p
join pg_namespace ns on ns.oid = p.pronamespace and ns.nspname = 'public'
where p.proname in ('get_console_users','fleet_tyre_km_by_asset',
                    'get_accident_audit','get_inspection_audit',
                    'match_knowledge_documents');

do $mig$
declare n int;
begin
  select count(*) into n from _bak.v548_prior_state;
  if n <> 5 then
    raise exception 'V548: expected to snapshot 5 functions, snapshotted %', n;
  end if;
end $mig$;

------------------------------------------------------------------ 1. revocations
-- No caller in the repo for either. postgres and service_role keep EXECUTE, so
-- the definer RPCs that call fleet_tyre_km_by_asset internally are unaffected
-- (inside a definer function the current user is the owner, not the caller).
revoke execute on function public.get_console_users(uuid, text, integer, integer)
  from authenticated, anon, public;

revoke execute on function public.fleet_tyre_km_by_asset(uuid, text, date, date)
  from authenticated, anon, public;

--------------------------------------------------------- 2. accident audit guard
create or replace function public.get_accident_audit(p_accident_id uuid)
 returns table(id uuid, accident_id uuid, changed_by uuid, actor_name text,
               changed_at timestamp with time zone, action text,
               old_values jsonb, new_values jsonb)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  SELECT a.id, a.accident_id, a.changed_by,
         COALESCE(p.full_name, p.username, 'System') AS actor_name,
         a.changed_at, a.action, a.old_values, a.new_values
    FROM public.accident_audit_log a
    LEFT JOIN public.profiles p ON p.id = a.changed_by
   WHERE a.accident_id = p_accident_id
     -- Mirrors audit_log_select_case_readers: the parent accident is visible to
     -- me, under accidents' own org / country / site / active predicates copied
     -- verbatim from the live policies. is_admin_or_above() is excluded on
     -- purpose - see the header.
     AND EXISTS (
          SELECT 1 FROM public.accidents acc
           WHERE acc.id = p_accident_id
             AND public.app_is_active()
             AND (acc.organisation_id = public.app_current_org()
                  OR public.is_super_admin())
             AND (acc.country IS NULL
                  OR public.is_super_admin()
                  OR public.app_sees_all_countries()
                  OR lower(btrim(acc.country)) = ANY (COALESCE(public.app_country_scope(), '{}'::text[])))
             AND (acc.site IS NULL
                  OR btrim(acc.site) = ''
                  OR public.app_sees_all_sites()
                  OR upper(btrim(acc.site)) = ANY (COALESCE(public.app_site_scope(), '{}'::text[])))
        )
   ORDER BY a.changed_at DESC
   LIMIT 100;
$function$;

------------------------------------------------------- 3. inspection audit guard
create or replace function public.get_inspection_audit(p_inspection_id uuid)
 returns table(id uuid, inspection_id uuid, changed_by uuid, actor_name text,
               changed_at timestamp with time zone, action text,
               old_values jsonb, new_values jsonb)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  SELECT a.id, a.inspection_id, a.changed_by,
         COALESCE(p.full_name, p.username, 'System') AS actor_name,
         a.changed_at, a.action, a.old_values, a.new_values
    FROM public.inspection_audit_log a
    LEFT JOIN public.profiles p ON p.id = a.changed_by
   WHERE a.inspection_id = p_inspection_id
     -- Mirrors inspection_audit_log's own rules: insp_audit_select (role gate)
     -- AND the RESTRICTIVE org isolation, both restated against the audit row.
     AND (public.get_my_role() = ANY (ARRAY['Admin','Manager','Director'])
          OR public.is_super_admin())
     AND (NOT (a.organisation_id IS DISTINCT FROM public.app_current_org())
          OR public.is_super_admin())
   ORDER BY a.changed_at DESC
   LIMIT 200;
$function$;

--------------------------------------------- 4. knowledge search org constraint
create or replace function public.match_knowledge_documents(
  query_embedding vector,
  match_count integer default 5,
  filter_doc_type text default null::text,
  filter_site text default null::text,
  filter_org uuid default null::uuid)
 returns table(id uuid, title text, content text, doc_type text, site text,
               similarity double precision)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  SELECT kd.id, kd.title, kd.content, kd.doc_type, kd.site,
         1 - (kd.embedding <=> query_embedding) AS similarity
  FROM public.knowledge_documents kd
  WHERE kd.embedding IS NOT NULL
    AND kd.organisation_id = COALESCE(filter_org, public.app_current_org())
    -- A caller-supplied org is honoured only for a caller entitled to it: the
    -- service-role edge function (no user session, so app_current_org() is null),
    -- a super admin, or someone naming their own organisation.
    AND (filter_org IS NULL
         OR public.app_current_org() IS NULL
         OR filter_org = public.app_current_org()
         OR public.is_super_admin())
    AND (filter_doc_type IS NULL OR kd.doc_type = filter_doc_type)
    AND (filter_site IS NULL OR kd.site = filter_site)
  ORDER BY kd.embedding <=> query_embedding
  LIMIT greatest(match_count, 1);
$function$;

------------------------------------------------------------------------ guards
do $mig$
declare
  bad text;
begin
  if has_function_privilege('authenticated',
       'public.get_console_users(uuid,text,integer,integer)', 'EXECUTE') then
    raise exception 'V548: get_console_users is still executable by authenticated';
  end if;
  if has_function_privilege('authenticated',
       'public.fleet_tyre_km_by_asset(uuid,text,date,date)', 'EXECUTE') then
    raise exception 'V548: fleet_tyre_km_by_asset is still executable by authenticated';
  end if;

  for bad in
    select p.proname
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace and ns.nspname = 'public'
    where p.proname in ('get_accident_audit','get_inspection_audit','match_knowledge_documents')
      and position('app_current_org' in pg_get_functiondef(p.oid)) = 0
  loop
    raise exception 'V548: guard missing on %', bad;
  end loop;
end $mig$;


-- ===========================================================================
-- V548b  SECOND PASS: TWO MORE CROSS-ORG READERS OF tyre_records
-- Applied as migration v548b_leak_sweep_org_scope.
--
-- Found by sweeping the definer functions that reference no authorisation
-- helper at all. Both were reproduced from the same Egypt-only Director
-- a4fd5401, whose direct read of tyre_records returns 0:
--
--   get_extra_field_stats(null)   -> 33 distinct extra_fields keys, up to 7,613
--                                    records behind a single key, WITH sample
--                                    values drawn from another org's rows
--   check_duplicate_serials(...)  -> fed 25 Company A serials, returned 62 rows
--                                    carrying id, issue_date, site and brand
--
-- Neither had any organisation predicate. Both now carry the same org test the
-- rest of the schema uses, with the customary super-admin bypass. Blast radius
-- is nil: all tyre_records rows belong to Company A, whose users resolve to that
-- same org, so a legitimate caller sees exactly what it saw before.
--
-- get_extra_field_stats is live (src/lib/api/customData.js). check_duplicate_serials
-- has no caller in the app; it is scoped rather than revoked because
-- MASTER_ENGINE.sql and DEPLOYMENT.md both document it as a pre-upload helper,
-- so a path may exist outside this repo.
--
-- The p_country dimension is deliberately left alone. These are LANGUAGE sql and
-- so cannot carry the V545 `if` guard without conversion to plpgsql; the country
-- half of that family is owned by a separate pass. Adding only the org predicate
-- here keeps the two changes independent - a later country guard can be layered
-- on without disturbing this one.
--
-- NOT CHANGED, having been examined: brain_classify_cached(p_org, ...) also takes
-- a caller-supplied org and writes to brain_cache, but it is not a cache-poisoning
-- vector - it can only ever insert brain_classify()'s own deterministic output for
-- the input supplied, which is the same value the system would compute itself,
-- and it uses ON CONFLICT DO NOTHING so it cannot overwrite an existing decision.
--
-- ROLLBACK: prior definitions are in _bak.v548b_prior_state.
-- ===========================================================================

drop table if exists _bak.v548b_prior_state;
create table _bak.v548b_prior_state as
select p.proname,
       pg_get_function_identity_arguments(p.oid) as args,
       pg_get_functiondef(p.oid) as def,
       now() as saved_at
from pg_proc p
join pg_namespace ns on ns.oid = p.pronamespace and ns.nspname = 'public'
where p.proname in ('get_extra_field_stats','check_duplicate_serials');

create or replace function public.get_extra_field_stats(p_country text default null::text)
 returns table(field_key text, record_count bigint, sample_vals text[])
 language sql
 stable security definer
 set search_path to 'public', 'extensions'
as $function$
  SELECT
    key AS field_key,
    COUNT(*) AS record_count,
    (ARRAY_AGG(DISTINCT (extra_fields ->> key)))[1:5] AS sample_vals
  FROM tyre_records,
       LATERAL jsonb_object_keys(extra_fields) AS key
  WHERE extra_fields IS NOT NULL
    AND extra_fields <> '{}'::jsonb
    AND (organisation_id = public.app_current_org() OR public.is_super_admin())
    AND (p_country IS NULL OR country = p_country)
  GROUP BY key
  ORDER BY record_count DESC;
$function$;

create or replace function public.check_duplicate_serials(serials text[])
 returns table(serial_no text, existing_id uuid, existing_date date,
               existing_site text, existing_brand text)
 language sql
 stable security definer
 set search_path to 'public', 'extensions'
as $function$
  select t.serial_no, t.id, t.issue_date, t.site, t.brand
  from public.tyre_records t
  where t.serial_no = any(serials)
    and (t.organisation_id = public.app_current_org() or public.is_super_admin())
  order by t.serial_no, t.issue_date desc
$function$;

do $mig$
declare bad text;
begin
  for bad in
    select p.proname from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace and ns.nspname = 'public'
    where p.proname in ('get_extra_field_stats','check_duplicate_serials')
      and position('app_current_org' in pg_get_functiondef(p.oid)) = 0
  loop
    raise exception 'V548b: org predicate missing on %', bad;
  end loop;
end $mig$;
