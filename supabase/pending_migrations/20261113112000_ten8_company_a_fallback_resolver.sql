-- =============================================================================
-- TEN-8 (and CF-01): remove the hard-coded Company A fallbacks.
-- STATUS: AUTHORED, NOT APPLIED. Draft for review. Proven only against PGlite
-- (supabase/tests/tenant_isolation_ten8.test.mjs): handle_new_user,
-- stamp_import_default_org, process_stg_wo_lines, process_expenses_import and
-- material_category_for against VERBATIM copies of the live bodies; the other 15
-- functions against stand-ins that carry the same signature and the same number of
-- occurrences of the literal (the patch and its guard are proven, their full
-- behaviour is not).
--
-- WHAT IT FIXES
--   20 live functions contain the literal 00000000-0000-0000-0000-000000000001, and
--   profiles.org_id defaults to it. Every sign-up becomes a pending member of
--   Company A; every staging or Table Editor load with no session lands in Company A.
--   For a second tenant that is a cross-company disclosure by design.
--
--   After this draft the id is written in exactly ONE place, the row
--   system_config.legacy_config_org (created by TEN-7), and every former literal is a
--   resolver call:
--     public._resolve_import_org()  a write that has no organisation:
--                                   tp.import_org if set and valid, else the legacy
--                                   organisation while single_tenant_mode is 'true',
--                                   else RAISE PT409 (never 40001, never a default).
--     public._single_tenant_org()   same, without raising (lookups, column default).
--     public._legacy_config_org()   rows that predate tenancy (null-organisation
--                                   audit rows, the login showcase).
--     public._signup_context(...)   the organisation, role and approval of a new
--                                   sign-up. Here: the legacy organisation while
--                                   single_tenant_mode is true, otherwise NO
--                                   organisation. TEN-9 replaces this hook so that an
--                                   invitation decides.
--
--   While single_tenant_mode = 'true' (today) every resolver returns Company A, so the
--   result is exact for the current company. When it is 'false': a sign-up without an
--   invitation has no organisation and reads nothing; a staging or service load
--   without tp.import_org raises PT409 and writes nothing.
--
-- PATCHED FROM THE LIVE BODIES (expected occurrences of the literal in brackets)
--   raise when unresolved : extract_tyre_freetext_candidates (1), material_master_coverage (1),
--     material_master_derive (1), material_master_set (1), material_master_set_bulk (1),
--     process_daily_km (1), process_expenses_country (1), process_expenses_import (1),
--     process_stg_job_cards (1), process_stg_open_wo (1), process_stg_wo_lines (1),
--     reclassify_from_master (1), stamp_import_default_org (1),
--     process_stg_monthly_tyres (2, and it now asks the session organisation first).
--   never raise           : material_category_for (1), sync_ksa_kms_to_meter (1).
--   legacy rows           : list_tyre_import_reviews (1), resolve_tyre_import_review (1),
--     get_login_showcase (1).
--   sign-up               : handle_new_user (2) plus three anchored edits.
--   The migration ends by asserting that NO function in schema public still contains
--   the literal. A function added to production after 2026-11-12 that carries it makes
--   this migration abort, which is the safe outcome.
--
-- KNOWN GAPS (stated, not hidden)
--   * sync_ksa_kms_to_meter still takes min(organisation_id) from cpk_asset_meter as
--     its first choice. That arm is outside the literal and is not changed here. It is
--     a KSA-only loader for Company A's raw telematics table and must be retired or
--     scoped before a second tenant owns meter rows (roadmap).
--   * get_login_showcase (anon) still counts the legacy organisation only. Correct for
--     a pre-login screen of today's deployment; per-tenant login branding is roadmap.
--   * single_tenant_mode is NOT changed by this draft. Flipping it is a separate,
--     owner-approved step that requires TEN-9 (invitations) and the import runbook
--     line "set tp.import_org = '<org id>' before any Table Editor or service load".
--   * Usernames and employee ids are still globally unique, so a sign-up for tenant B
--     whose username exists in Company A is refused by the unique index. It never
--     lands in Company A. See TEN-9.
--
-- RISK TO THE CURRENT COMPANY (Company A, 00000000-0000-0000-0000-000000000001)
--   None while single_tenant_mode stays 'true' and system_config.legacy_config_org
--   names Company A: each resolver returns the same id the literal returned, and it is
--   only reached on the same branch (coalesce is lazy). The test replays a sign-up, a
--   Table Editor insert, both verbatim staging pipes and the material lookup on a
--   baseline and a migrated database and compares the rows.
--   New dependency: these 20 functions now read two system_config rows. If either row
--   is deleted, sign-ups arrive with no organisation and sessionless imports are
--   REFUSED (PT409) instead of landing in Company A. Both rows are super-admin-write.
--   Cost: one or two primary-key lookups, only on the no-session branch.
--   profiles.org_id default: `alter table ... alter column ... set default` takes a
--   brief ACCESS EXCLUSIVE lock on profiles (catalog only, no rewrite). Apply out of
--   hours. A profile inserted WITHOUT an organisation keeps getting Company A while
--   single_tenant_mode is true.
--   Medium at the later moment single_tenant_mode is switched off: operator loads then
--   need tp.import_org. That is by design and is the point of the finding.
--
-- OWNER DECISIONS
--   D1 when to switch single_tenant_mode off (not before TEN-9 and the runbook).
--   D2 retire or scope sync_ksa_kms_to_meter.
--
-- APPLY ORDER
--   After 20261113111000 (TEN-7: _legacy_config_org, _single_tenant_org,
--   _unscoped_row_org). Before 20261113113000 (TEN-9 replaces _signup_context).
--   The TEN-1 draft rewrites process_stg_job_cards (org guard on the conflict update).
--   It keeps the fallback line, so the literal count stays 1 and both apply in either
--   order; if it removed the literal this migration aborts on that function and the
--   entry must be dropped from the list below.
--
-- VERIFY (inside begin; ... rollback; on a branch database)
--   select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.prosrc like '%00000000-0000-0000-0000-000000000001%';  -- 0
--   select public._single_tenant_org();                       -- Company A id
--   select column_default from information_schema.columns
--    where table_name = 'profiles' and column_name = 'org_id';  -- _single_tenant_org()
--   -- sessionless staging insert still lands in Company A:
--   insert into stg_wo_lines (work_order_no, country) values ('ZZ-V8', 'KSA');
--   select organisation_id from work_order_line_items where work_order_no = 'ZZ-V8';
--   -- with the switch off (rolled back): the same insert raises PT409
--   update system_config set value = 'false' where key = 'single_tenant_mode';
--   insert into stg_wo_lines (work_order_no, country) values ('ZZ-V8b', 'KSA');   -- PT409
--
-- ROLLBACK
--   Re-create each function from public._fn_backup_ten8 (execute each def) and run
--   alter table public.profiles alter column org_id
--     set default '00000000-0000-0000-0000-000000000001'::uuid;
-- =============================================================================

create or replace function pg_temp.tp_patch(p_fn regprocedure, p_anchor text, p_new text, p_expected int default 1)
returns void language plpgsql as $tp$
declare v_def text := pg_get_functiondef(p_fn); v_n int;
begin
  v_n := (length(v_def) - length(replace(v_def, p_anchor, ''))) / greatest(length(p_anchor), 1);
  if v_n <> p_expected then
    raise exception 'tp_patch: anchor found % time(s) in %, expected %. The live body differs from the one this draft was built from. Nothing applied.',
      v_n, p_fn, p_expected;
  end if;
  execute replace(v_def, p_anchor, p_new);
end $tp$;

do $chk$
begin
  if to_regprocedure('public._legacy_config_org()') is null or to_regprocedure('public._unscoped_row_org()') is null then
    raise exception 'TEN-8 needs the TEN-7 draft (20261113111000) applied first. Nothing applied.';
  end if;
  if public._legacy_config_org() is distinct from '00000000-0000-0000-0000-000000000001'::uuid then
    raise exception 'TEN-8: system_config.legacy_config_org does not name the organisation the literals name. Nothing applied.';
  end if;
end $chk$;

create table if not exists public._fn_backup_ten8 (
  fn text primary key, def text not null, saved_at timestamptz not null default now());
alter table public._fn_backup_ten8 enable row level security;
revoke all on public._fn_backup_ten8 from public, anon, authenticated;
insert into public._fn_backup_ten8 (fn, def)
select p.oid::regprocedure::text, pg_get_functiondef(p.oid)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prosrc like '%00000000-0000-0000-0000-000000000001%'
on conflict (fn) do nothing;

-- ---- resolvers --------------------------------------------------------------
-- A write that arrives with no organisation. No argument; raises PT409 when nothing
-- names the organisation. stamp_import_default_org is SECURITY INVOKER and runs as
-- the inserting role, so authenticated needs EXECUTE.
create or replace function public._resolve_import_org() returns uuid
language plpgsql stable security definer set search_path = public as $fn$
declare v_setting text := nullif(btrim(coalesce(current_setting('tp.import_org', true), '')), ''); v_org uuid;
begin
  if v_setting is not null then
    begin
      v_org := v_setting::uuid;
    exception when invalid_text_representation then
      raise exception 'tp.import_org is not a valid uuid' using errcode = 'PT409';
    end;
    if not exists (select 1 from public.organisations o where o.id = v_org) then
      raise exception 'tp.import_org does not name an existing organisation' using errcode = 'PT409';
    end if;
    return v_org;
  end if;
  v_org := public._single_tenant_org();
  if v_org is null then
    raise exception 'Import refused: no organisation on the row or the session, tp.import_org is not set and single_tenant_mode is off'
      using errcode = 'PT409';
  end if;
  return v_org;
end $fn$;

-- Sign-up hook. TEN-9 replaces the body; the signature is the contract.
-- Returns {"org": uuid or null, "role": text or null, "approved": boolean or null}.
create or replace function public._signup_context(p_user_id uuid, p_meta jsonb, p_email text) returns jsonb
language plpgsql security definer set search_path = public as $fn$
begin
  return jsonb_build_object('org', public._single_tenant_org(), 'role', null, 'approved', null);
end $fn$;

-- ---- the literal becomes a resolver call ------------------------------------
do $patch$
declare
  c_lit  constant text := $l$'00000000-0000-0000-0000-000000000001'::uuid$l$;
  c_bare constant text := $l$'00000000-0000-0000-0000-000000000001'$l$;
  r record;
begin
  for r in
    select * from (values
      -- signature, token, replacement, expected occurrences
      ('public.extract_tyre_freetext_candidates(boolean)', c_lit, 'public._resolve_import_org()', 1),
      ('public.material_master_coverage()',                c_lit, 'public._resolve_import_org()', 1),
      ('public.material_master_derive()',                  c_lit, 'public._resolve_import_org()', 1),
      ('public.material_master_set(text,text,text,text,text,text,text,boolean)', c_lit, 'public._resolve_import_org()', 1),
      ('public.material_master_set_bulk(jsonb)',           c_lit, 'public._resolve_import_org()', 1),
      ('public.process_daily_km()',                        c_lit, 'public._resolve_import_org()', 1),
      ('public.process_expenses_country()',                c_lit, 'public._resolve_import_org()', 1),
      ('public.process_expenses_import()',                 c_lit, 'public._resolve_import_org()', 1),
      ('public.process_stg_job_cards()',                   c_lit, 'public._resolve_import_org()', 1),
      ('public.process_stg_open_wo()',                     c_lit, 'public._resolve_import_org()', 1),
      ('public.process_stg_wo_lines()',                    c_lit, 'public._resolve_import_org()', 1),
      ('public.reclassify_from_master(boolean)',           c_lit, 'public._resolve_import_org()', 1),
      ('public.stamp_import_default_org()',                c_lit, 'public._resolve_import_org()', 1),
      -- reads new.organisation_id only: ask the session organisation before the resolver
      ('public.process_stg_monthly_tyres()',               c_lit, 'coalesce(public.app_current_org(), public._resolve_import_org())', 2),
      -- lookups: no organisation means no match, never an error
      ('public.material_category_for(text,text)',          c_lit, 'public._single_tenant_org()', 1),
      ('public.sync_ksa_kms_to_meter()',                   c_lit, 'public._single_tenant_org()', 1),
      -- null-organisation rows written before tenancy belong to the legacy organisation
      ('public.list_tyre_import_reviews(text,boolean,integer)', c_lit, 'public._legacy_config_org()', 1),
      ('public.resolve_tyre_import_review(bigint,text)',   c_lit, 'public._legacy_config_org()', 1),
      ('public.get_login_showcase()',                      c_bare, 'public._legacy_config_org()', 1)
    ) as t(sig, token, repl, expected)
  loop
    if to_regprocedure(r.sig) is null then
      raise exception 'TEN-8: function % does not exist. Nothing applied.', r.sig;
    end if;
    perform pg_temp.tp_patch(to_regprocedure(r.sig), r.token, r.repl, r.expected);
  end loop;
end $patch$;

-- ---- handle_new_user: the organisation comes from the sign-up context --------
select pg_temp.tp_patch('public.handle_new_user()'::regprocedure,
$a$  v_approved boolean := false;
begin
$a$,
$b$  v_approved boolean := false;
  v_ctx jsonb := public._signup_context(new.id, new.raw_user_meta_data, new.email);
begin
$b$);
select pg_temp.tp_patch('public.handle_new_user()'::regprocedure,
$a$    'Reporter',
$a$,
$b$    coalesce(nullif(v_ctx ->> 'role', ''), 'Reporter'),
$b$);
select pg_temp.tp_patch('public.handle_new_user()'::regprocedure,
$a$    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
$a$,
$b$    nullif(v_ctx ->> 'org', '')::uuid,
    nullif(v_ctx ->> 'org', '')::uuid,
$b$);
select pg_temp.tp_patch('public.handle_new_user()'::regprocedure,
$a$    ARRAY[v_region],
    v_approved
$a$,
$b$    ARRAY[v_region],
    coalesce((v_ctx ->> 'approved')::boolean, v_approved)
$b$);

-- ---- profiles.org_id default: the same answer today, nothing when multi-tenant --
alter table public.profiles alter column org_id set default public._single_tenant_org();

-- ---- grants: authenticated and service_role first, then PUBLIC, then anon ----
grant execute on function public._resolve_import_org() to authenticated, service_role;
grant execute on function public._signup_context(uuid, jsonb, text) to service_role;
revoke execute on function public._resolve_import_org() from public;
revoke execute on function public._signup_context(uuid, jsonb, text) from public;
revoke execute on function public._resolve_import_org() from anon;
revoke execute on function public._signup_context(uuid, jsonb, text) from anon, authenticated;

-- ---- final guard: the literal is gone from every function -------------------
do $chk$
declare v_left text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into v_left
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosrc like '%00000000-0000-0000-0000-000000000001%';
  if v_left is not null then
    raise exception 'TEN-8: the Company A id is still hard-coded in: %. Add it to the patch list. Nothing applied.', v_left;
  end if;
end $chk$;

select anum_integration.apply_reader_policies();
