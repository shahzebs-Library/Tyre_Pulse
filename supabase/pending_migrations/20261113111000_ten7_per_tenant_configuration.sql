-- =============================================================================
-- TEN-7 (and CF-13): per-tenant configuration without changing what Company A resolves.
-- STATUS: AUTHORED, NOT APPLIED. Draft for review. Proven only against a PGlite copy
-- of the live function bodies (supabase/tests/tenant_isolation_ten7.test.mjs).
--
-- WHAT IT FIXES
--   module_permissions, site_aliases, brand_aliases and system_config are global. A
--   second tenant would have its site names silently rewritten by Company A's 54
--   aliases and the "-ST" strip, would run on Company A's role matrix (including the
--   rows of Company A's 33 custom roles when a role name matches), could not edit its
--   own matrix, and would read Company A's accident mailbox, logo and palette.
--
-- THE MODEL (minimal, no table is restructured)
--   The existing GLOBAL rows stay exactly where they are and remain the effective
--   configuration of ONE organisation: the "legacy config organisation", named once in
--   system_config.legacy_config_org (super admin write only, read level 'super').
--   For that organisation every lookup below resolves precisely as it does today.
--   For any other organisation:
--     site / brand aliases : only its own rows in the new org_alias_overrides table;
--                            the global alias tables and the "-ST" strip do not apply.
--     role matrix          : own rows (module_permissions.org_id = its id) first, then
--                            the global row ONLY for the ten built-in roles. Global
--                            rows of custom role names never reach another tenant.
--     custom role names    : a profile can only hold a custom role its own
--                            organisation defines.
--     tenant settings      : org_config(key) reads organisations.settings.tenant_config;
--                            the global system_config value is returned only to the
--                            legacy config organisation.
--   Rows with no organisation and no session (Table Editor loads) resolve to the
--   legacy config organisation while system_config.single_tenant_mode = 'true', which
--   is today's behaviour, and to no organisation when it is false.
--
--   New objects: system_config.legacy_config_org, _legacy_config_org(),
--   _single_tenant_org(), _unscoped_row_org(), _org_inherits_legacy_config(uuid), _builtin_roles(),
--   _global_matrix_applies(uuid, text), org_alias_overrides (+ normaliser trigger),
--   set_org_module_permissions(jsonb, text), org_config(text), set_org_config(text, text).
--   Patched from the LIVE bodies by anchored replacement: normalize_site(),
--   normalize_site_name(), normalize_brand(text), app_user_can(text,text) (view branch),
--   get_user_module_permissions(uuid), normalize_profiles_role(), system_config_read_level(text).
--
-- WHAT IT DOES NOT DO (stated, not hidden)
--   * No reader is repointed to org_config(): the accident e-mail consumer, the report
--     palette loader (SettingsContext), brandLogo.js and the edge functions still read
--     system_config. Tenant B therefore still SEES the global mailbox / logo until
--     those readers move (roadmap, client and edge work).
--   * modules.status stays platform-wide; the per-tenant switch is org_module_overrides
--     from TEN-6.
--   * upload_feeds, due_alert_rules, metric / dashboard registries are not scoped here.
--   * No seed for a new tenant (checklist templates, departments, routing rules): TEN-9
--     calls a seed hook if one exists; the seed function itself is roadmap.
--   * The brand trigger on tyre_records uses tyre_brand_canonical (no alias table), so
--     it is tenant neutral already; normalize_brand(text) has no caller in the
--     database today (verified) and is scoped for completeness.
--
-- RISK TO THE CURRENT COMPANY (Company A, 00000000-0000-0000-0000-000000000001)
--   Low. Behaviour is unchanged by construction while system_config.legacy_config_org
--   names Company A: all 1,346 global matrix rows, 54 site aliases, 36 brand aliases,
--   the "-ST" strip and every system_config value still resolve for it. Verified live
--   before authoring: 0 profiles hold a custom role their own organisation does not
--   define, 0 per-organisation matrix rows exist, all 33 custom roles belong to
--   Company A. The test replays identical inserts on a baseline and a migrated
--   database and compares the stored site values and the capability matrix.
--   Cost: normalize_site (39 tables, every insert or update that carries a site) gains
--   about 3 primary-key lookups per row. On a 100k-row import that is real time:
--   MEASURE a 5,000-row parts_consumption insert before and after on a branch.
--   If system_config.legacy_config_org is ever deleted or changed, Company A loses its
--   aliases and its custom-role matrix rows at once. It is super-admin-write only and
--   the migration refuses to finish unless it resolves to an existing organisation.
--
-- OWNER DECISIONS
--   D1 the built-in role list a new tenant inherits defaults for (the ten names in
--      normalize_profiles_role). A new tenant gets Company A's CURRENT global rows for
--      those ten roles as its defaults; confirm that is the intended starter matrix.
--   D2 which system_config keys are tenant settings (list in _tenant_config_keys()).
--   D3 whether a tenant Admin may edit its own role matrix (this draft: yes, own
--      organisation only, never the Admin role, bounded by entitlement from TEN-6).
--
-- APPLY ORDER
--   After 20261113110000 (TEN-6). Before 20261113112000 (TEN-8), which reuses
--   _legacy_config_org() and _single_tenant_org(). The TEN-1..TEN-5 drafts come first;
--   if TEN-4 has already rewritten get_user_module_permissions the anchor below is not
--   found and this migration aborts cleanly: rebuild that one patch on the new body.
--
-- VERIFY (inside begin; ... rollback; on a branch database)
--   select public._legacy_config_org();                    -- Company A id
--   -- as a Company A Manager, before and after: identical
--   select md5(public.get_user_module_permissions()::text);
--   select public.app_user_can('tyre_records', 'view');
--   insert into vehicle_fleet (asset_no, country, site) values ('ZZ-V7', 'KSA', 'nhc-st')
--     returning site;                                      -- NHC, as today
--   select site, count(*) from vehicle_fleet group by 1 order by 1;   -- unchanged
--
-- ROLLBACK
--   Re-create the seven patched functions from public._fn_backup_ten7 (execute each
--   def). The new table, helpers and config row are then unused and can stay.
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

create table if not exists public._fn_backup_ten7 (
  fn text primary key, def text not null, saved_at timestamptz not null default now());
alter table public._fn_backup_ten7 enable row level security;
revoke all on public._fn_backup_ten7 from public, anon, authenticated;
insert into public._fn_backup_ten7 (fn, def)
select p::text, pg_get_functiondef(p)
  from unnest(array['public.normalize_site()'::regprocedure, 'public.normalize_site_name()'::regprocedure,
                    'public.normalize_brand(text)'::regprocedure, 'public.app_user_can(text,text)'::regprocedure,
                    'public.get_user_module_permissions(uuid)'::regprocedure, 'public.normalize_profiles_role()'::regprocedure,
                    'public.system_config_read_level(text)'::regprocedure]) p
on conflict (fn) do nothing;

-- ---- 1. the one place the legacy organisation is named ----------------------
insert into public.system_config (key, value, category, description)
values ('legacy_config_org', '00000000-0000-0000-0000-000000000001', 'platform',
        'The organisation whose configuration the GLOBAL rows represent (role matrix, site and brand aliases, system settings). Also the default organisation while single_tenant_mode is true. Do not change.')
on conflict (key) do nothing;

select pg_temp.tp_patch('public.system_config_read_level(text)'::regprocedure,
$a$      'user_issue_breach_alerts','alert_email',
$a$,
$b$      'user_issue_breach_alerts','alert_email','legacy_config_org',
$b$);

create or replace function public._legacy_config_org() returns uuid
language plpgsql stable security definer set search_path = public as $fn$
declare v text;
begin
  select nullif(btrim(value, ' "'), '') into v from public.system_config where key = 'legacy_config_org';
  if v is null then return null; end if;
  return v::uuid;
exception when invalid_text_representation then
  return null;
end $fn$;

-- The organisation a row with NO organisation and NO session belongs to. Never raises:
-- it is also used as a column default (TEN-8).
create or replace function public._single_tenant_org() returns uuid
language sql stable security definer set search_path = public as $fn$
  select case when coalesce((select btrim(lower(value), ' "') from public.system_config where key = 'single_tenant_mode'), 'false') = 'true'
              then public._legacy_config_org() end
$fn$;

-- The organisation of a row that arrives with no organisation and no session: an explicit
-- tp.import_org (the setting stamp_import_default_org already honours) wins, then the
-- single-tenant default. Never raises; an unusable setting is ignored here and refused
-- by the stamping trigger.
create or replace function public._unscoped_row_org() returns uuid
language plpgsql stable security definer set search_path = public as $fn$
declare v text := nullif(btrim(coalesce(current_setting('tp.import_org', true), '')), ''); v_org uuid;
begin
  if v is not null then
    begin
      v_org := v::uuid;
    exception when invalid_text_representation then
      v_org := null;
    end;
    if v_org is not null and exists (select 1 from public.organisations o where o.id = v_org) then
      return v_org;
    end if;
  end if;
  return public._single_tenant_org();
end $fn$;

create or replace function public._org_inherits_legacy_config(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select p_org is not null and p_org = public._legacy_config_org()
$fn$;

-- DECISION D1. Must stay equal to the array in normalize_profiles_role().
create or replace function public._builtin_roles() returns text[]
language sql immutable set search_path = public as $fn$
  select array['Admin','Manager','Director','Reporter','Inspector',
               'Tyre Man','Driver','Integration Admin','Data Engineer','Automation']::text[]
$fn$;

create or replace function public._global_matrix_applies(p_org uuid, p_role text) returns boolean
language sql stable security definer set search_path = public as $fn$
  select p_role = any (public._builtin_roles()) or public._org_inherits_legacy_config(p_org)
$fn$;

do $chk$
begin
  if public._legacy_config_org() is null
     or not exists (select 1 from public.organisations o where o.id = public._legacy_config_org()) then
    raise exception 'TEN-7: system_config.legacy_config_org does not name an existing organisation. Nothing applied.';
  end if;
end $chk$;

-- ---- 2. per-tenant aliases --------------------------------------------------
create table if not exists public.org_alias_overrides (
  organisation_id uuid not null default public.app_current_org() references public.organisations(id) on delete cascade,
  kind            text not null check (kind in ('site', 'brand')),
  alias           text not null,
  canonical       text not null,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  primary key (organisation_id, kind, alias)
);
-- Stored in the same normal form the normalisers compare against.
create or replace function public.org_alias_overrides_normalise() returns trigger
language plpgsql set search_path = public as $fn$
begin
  if new.kind = 'site' then
    new.alias := upper(btrim(regexp_replace(new.alias, '\s+', ' ', 'g')));
    new.canonical := upper(btrim(regexp_replace(new.canonical, '\s+', ' ', 'g')));
  else
    new.alias := lower(btrim(new.alias));
    new.canonical := btrim(new.canonical);
  end if;
  if new.alias = '' or new.canonical = '' then
    raise exception 'alias and canonical are required' using errcode = '22023';
  end if;
  return new;
end $fn$;
create trigger trg_org_alias_overrides_normalise before insert or update on public.org_alias_overrides
  for each row execute function public.org_alias_overrides_normalise();

alter table public.org_alias_overrides enable row level security;
create policy org_alias_overrides_org_isolation on public.org_alias_overrides as restrictive for all to authenticated
  using (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()))
  with check (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()));
create policy org_alias_overrides_read on public.org_alias_overrides for select to authenticated
  using ((select public.app_is_active()) is true);
create policy org_alias_overrides_admin_write on public.org_alias_overrides for all to authenticated
  using ((select public.is_super_admin()) or (select public.get_my_role()) = 'Admin')
  with check ((select public.is_super_admin()) or (select public.get_my_role()) = 'Admin');
grant select, insert, update, delete on public.org_alias_overrides to authenticated;
grant all on public.org_alias_overrides to service_role;
revoke all on public.org_alias_overrides from public;
revoke all on public.org_alias_overrides from anon;

-- normalize_site(): 39 triggers. The row's own organisation decides which aliases apply.
select pg_temp.tp_patch('public.normalize_site()'::regprocedure,
$a$declare v_canon text;
begin
  if new.site is null then return new; end if;
$a$,
$b$declare v_canon text; v_org uuid; v_legacy boolean;
begin
  if new.site is null then return new; end if;
  v_org := coalesce(nullif(to_jsonb(new) ->> 'organisation_id', '')::uuid, public.app_current_org(), public._unscoped_row_org());
  v_legacy := public._org_inherits_legacy_config(v_org);
$b$);
select pg_temp.tp_patch('public.normalize_site()'::regprocedure,
$a$  select a.canonical into v_canon from public.site_aliases a where a.alias = new.site;
$a$,
$b$  select o.canonical into v_canon from public.org_alias_overrides o
   where o.organisation_id = v_org and o.kind = 'site' and o.alias = new.site;
  if v_canon is null and v_legacy then
    select a.canonical into v_canon from public.site_aliases a where a.alias = new.site;
  end if;
$b$);
select pg_temp.tp_patch('public.normalize_site()'::regprocedure,
$a$  elsif new.site ~ '[_-]ST$' then
$a$,
$b$  elsif v_legacy and new.site ~ '[_-]ST$' then
$b$);

-- normalize_site_name(): the sites registry.
select pg_temp.tp_patch('public.normalize_site_name()'::regprocedure,
$a$declare v_canon text;
begin
  if new.name is null then return new; end if;
$a$,
$b$declare v_canon text; v_org uuid; v_legacy boolean;
begin
  if new.name is null then return new; end if;
  v_org := coalesce(new.organisation_id, public.app_current_org(), public._unscoped_row_org());
  v_legacy := public._org_inherits_legacy_config(v_org);
$b$);
select pg_temp.tp_patch('public.normalize_site_name()'::regprocedure,
$a$  select a.canonical into v_canon from public.site_aliases a where a.alias = new.name;
$a$,
$b$  select o.canonical into v_canon from public.org_alias_overrides o
   where o.organisation_id = v_org and o.kind = 'site' and o.alias = new.name;
  if v_canon is null and v_legacy then
    select a.canonical into v_canon from public.site_aliases a where a.alias = new.name;
  end if;
$b$);
select pg_temp.tp_patch('public.normalize_site_name()'::regprocedure,
$a$  elsif new.name ~ '[_-]ST$' then
$a$,
$b$  elsif v_legacy and new.name ~ '[_-]ST$' then
$b$);

-- normalize_brand(text): live body has CRLF line ends, so the anchors are single lines.
select pg_temp.tp_patch('public.normalize_brand(text)'::regprocedure,
$a$(select canonical from public.brand_aliases$a$,
$b$(select o.canonical from public.org_alias_overrides o
      where o.organisation_id = coalesce(public.app_current_org(), public._unscoped_row_org())
        and o.kind = 'brand' and o.alias = lower(trim(raw)) limit 1),
    (select canonical from public.brand_aliases$b$);
select pg_temp.tp_patch('public.normalize_brand(text)'::regprocedure,
$a$where alias = lower(trim(raw)) limit 1),$a$,
$b$where alias = lower(trim(raw))
        and public._org_inherits_legacy_config(coalesce(public.app_current_org(), public._unscoped_row_org())) limit 1),$b$);

-- ---- 3. role matrix ---------------------------------------------------------
-- app_user_can, view branch: own-organisation row first, then the global default.
select pg_temp.tp_patch('public.app_user_can(text,text)'::regprocedure,
$a$       where org_id is null and role = v_role and module_key = p_key
       order by updated_at desc nulls last limit 1
$a$,
$b$       where role = v_role and module_key = p_key
         and (org_id = public.app_current_org()
              or (org_id is null and public._global_matrix_applies(public.app_current_org(), v_role)))
       order by (org_id is not null) desc, updated_at desc nulls last limit 1
$b$);

-- The reader already overlays own-organisation rows; only the global arm is narrowed.
select pg_temp.tp_patch('public.get_user_module_permissions(uuid)'::regprocedure,
$a$WHERE org_id IS NULL AND role = v_role
$a$,
$b$WHERE org_id IS NULL AND role = v_role AND public._global_matrix_applies(v_org_id, v_role)
$b$);

-- A profile may only hold a custom role its own organisation defines.
select pg_temp.tp_patch('public.normalize_profiles_role()'::regprocedure,
$a$(SELECT 1 FROM public.custom_roles c WHERE c.name = NEW.role)$a$,
$b$(SELECT 1 FROM public.custom_roles c WHERE c.name = NEW.role
                       AND (c.organisation_id IS NULL
                            OR c.organisation_id IS NOT DISTINCT FROM coalesce(NEW.org_id, NEW.organisation_id)))$b$);

-- Tenant writer. No organisation argument: it writes the caller's own organisation only
-- and never touches a global row. DECISION D3.
create or replace function public.set_org_module_permissions(p_changes jsonb, p_reason text default null)
returns integer language plpgsql security definer set search_path = public as $fn$
declare
  v_uid uuid := auth.uid(); v_org uuid; v_role text; v_super boolean; v_ok boolean;
  rec jsonb; v_r text; v_mod text; v_en boolean; v_n integer := 0;
begin
  select p.org_id, p.role, coalesce(p.is_super_admin, false),
         coalesce(p.approved, false) and not coalesce(p.locked, false)
    into v_org, v_role, v_super, v_ok
    from public.profiles p where p.id = v_uid;
  if not found or not v_ok or v_org is null or (v_role is distinct from 'Admin' and not v_super) then
    raise exception 'Only an Admin of the organisation can change its role access.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_changes) is distinct from 'array' then
    raise exception 'p_changes must be a JSON array of {role, module_key, enabled}.' using errcode = '22023';
  end if;
  perform set_config('app.access_reason', coalesce(nullif(btrim(coalesce(p_reason, '')), ''), ''), true);

  for rec in select * from jsonb_array_elements(p_changes) loop
    v_r := rec ->> 'role'; v_mod := rec ->> 'module_key'; v_en := (rec ->> 'enabled')::boolean;
    if v_r is null or v_mod is null or v_en is null then continue; end if;
    if v_r <> all (public._builtin_roles())
       and not exists (select 1 from public.custom_roles c where c.name = v_r and c.organisation_id = v_org) then
      raise exception 'Unknown role for this organisation: %', v_r using errcode = '22023';
    end if;
    if v_r = 'Admin' then v_en := true; end if;      -- the Admin role is never stripped

    update public.module_permissions
       set enabled = v_en, updated_by = v_uid, updated_at = now()
     where org_id = v_org and role = v_r and module_key = v_mod;
    if not found then
      insert into public.module_permissions (module_key, role, org_id, enabled, updated_by, updated_at)
      values (v_mod, v_r, v_org, v_en, v_uid, now());
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $fn$;

-- ---- 4. tenant settings -----------------------------------------------------
-- DECISION D2: the keys a tenant owns. ai_monthly_budget_usd is deliberately absent:
-- a tenant must not set its own AI budget (platform sets it, roadmap TEN-11).
create or replace function public._tenant_config_keys() returns text[]
language sql immutable set search_path = public as $fn$
  select array['accident_email_to','accident_email_cc','accident_email_subject_prefix',
               'support_email','company_logo','report_palette','default_currency']::text[]
$fn$;

create or replace function public.org_config(p_key text) returns text
language plpgsql stable security definer set search_path = public as $fn$
declare v_org uuid := public.app_current_org(); v_level text := public.system_config_read_level(p_key); v text;
begin
  if auth.uid() is null or public.app_is_active() is not true then return null; end if;
  if not (v_level = 'all' or (v_level = 'elevated' and public.app_is_elevated()) or public.is_super_admin()) then
    return null;
  end if;
  if p_key = any (public._tenant_config_keys()) then
    select o.settings -> 'tenant_config' ->> p_key into v from public.organisations o where o.id = v_org;
    if v is not null then return v; end if;
    if not public._org_inherits_legacy_config(v_org) then return null; end if;   -- no borrowing another company's value
  end if;
  select c.value into v from public.system_config c where c.key = p_key;
  return v;
end $fn$;

create or replace function public.set_org_config(p_key text, p_value text) returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare v_org uuid := public.app_current_org();
begin
  if v_org is null or public.app_is_active() is not true
     or (public.get_my_role() is distinct from 'Admin' and not public.is_super_admin()) then
    raise exception 'Only an Admin of the organisation can change its settings.' using errcode = '42501';
  end if;
  if not (p_key = any (public._tenant_config_keys())) then
    raise exception 'Not a tenant setting: %', p_key using errcode = '22023';
  end if;
  update public.organisations o
     set settings = jsonb_set(
           jsonb_set(coalesce(o.settings, '{}'::jsonb), '{tenant_config}',
                     coalesce(o.settings -> 'tenant_config', '{}'::jsonb), true),
           array['tenant_config', p_key], to_jsonb(p_value), true),
         updated_at = now()
   where o.id = v_org;
  return jsonb_build_object('ok', true, 'key', p_key);
end $fn$;

-- ---- grants: authenticated and service_role first, then PUBLIC, then anon ----
grant execute on function public._single_tenant_org() to authenticated, service_role;   -- used as a column default (TEN-8)
grant execute on function public._builtin_roles() to authenticated, service_role;
grant execute on function public.set_org_module_permissions(jsonb, text) to authenticated, service_role;
grant execute on function public.org_config(text) to authenticated, service_role;
grant execute on function public.set_org_config(text, text) to authenticated, service_role;
grant execute on function public._legacy_config_org() to service_role;
grant execute on function public._unscoped_row_org() to service_role;
grant execute on function public._org_inherits_legacy_config(uuid) to service_role;
grant execute on function public._global_matrix_applies(uuid, text) to service_role;
grant execute on function public._tenant_config_keys() to service_role;
grant execute on function public.org_alias_overrides_normalise() to service_role;

revoke execute on function public._single_tenant_org() from public;
revoke execute on function public._builtin_roles() from public;
revoke execute on function public.set_org_module_permissions(jsonb, text) from public;
revoke execute on function public.org_config(text) from public;
revoke execute on function public.set_org_config(text, text) from public;
revoke execute on function public._legacy_config_org() from public;
revoke execute on function public._unscoped_row_org() from public;
revoke execute on function public._org_inherits_legacy_config(uuid) from public;
revoke execute on function public._global_matrix_applies(uuid, text) from public;
revoke execute on function public._tenant_config_keys() from public;
revoke execute on function public.org_alias_overrides_normalise() from public;

revoke execute on function public._single_tenant_org() from anon;
revoke execute on function public._builtin_roles() from anon;
revoke execute on function public.set_org_module_permissions(jsonb, text) from anon;
revoke execute on function public.org_config(text) from anon;
revoke execute on function public.set_org_config(text, text) from anon;
revoke execute on function public._legacy_config_org() from anon, authenticated;
revoke execute on function public._unscoped_row_org() from anon, authenticated;
revoke execute on function public._org_inherits_legacy_config(uuid) from anon, authenticated;
revoke execute on function public._global_matrix_applies(uuid, text) from anon, authenticated;
revoke execute on function public._tenant_config_keys() from anon, authenticated;
revoke execute on function public.org_alias_overrides_normalise() from anon, authenticated;

select anum_integration.apply_reader_policies();
