// Shared PGlite harness for the commercial-readiness drafts TEN-6 .. TEN-9
// (supabase/pending_migrations/20261113110000 .. 113000).
//
// The drafts patch LIVE function bodies by anchored replacement, so this baseline reproduces
// the live definitions VERBATIM (read from production with pg_get_functiondef on 2026-11-12,
// SELECT only). If a body below drifts from production the draft's own anchor guard is what
// will abort on apply; the tests here prove behaviour against the bodies as they were read.
//
//   verbatim  : app_current_org, app_is_active (CRLF kept), is_super_admin, app_user_can,
//               enforce_plan_limit, ensure_org_subscription, get_subscription_overview,
//               org_can_add, handle_new_user, stamp_import_default_org, normalize_site(),
//               normalize_site_name, normalize_brand (CRLF kept), get_user_module_permissions,
//               normalize_profiles_role, sync_profile_org_columns, system_config_read_level,
//               process_stg_wo_lines, process_expenses_import, material_category_for
//   stand-ins : the other 15 functions that carry the Company A id. Same signature and the same
//               number of occurrences of the literal as live (measured), small body. They prove
//               the patch loop and its guard, not the behaviour of the real 1.6k to 8k bodies.
//   stubs     : auth.*, get_my_role, app_role, app_is_elevated, app_can_see_country,
//               _console_ip_allowed, erp_* helpers, anum_integration.apply_reader_policies.
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

export const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
// The real Company A id: the live functions hard-code it, so the harness must use it.
export const ORG_A = '00000000-0000-0000-0000-000000000001'
export const ORG_B = id(902)
export const ORG_C = id(903)
export const U = {
  superadmin: id(11), adminA: id(12), managerA: id(13), tyremanA: id(14), supervisorA: id(15), reporterA: id(16),
  adminB: id(21), managerB: id(22), supervisorB: id(23),
  adminC: id(31), managerC: id(32),
}
const LIT = ORG_A

export const DRAFTS = {
  ten6: '20261113110000_ten6_entitlement_enforcement.sql',
  ten7: '20261113111000_ten7_per_tenant_configuration.sql',
  ten8: '20261113112000_ten8_company_a_fallback_resolver.sql',
  ten9: '20261113113000_ten9_tenant_lifecycle.sql',
}
export const draftSql = name =>
  readFileSync(new URL(`../../pending_migrations/${DRAFTS[name]}`, import.meta.url), 'utf8')

const BASELINE = `
create role authenticated; create role anon; create role service_role;
create schema auth;
create schema anum_integration;
create function anum_integration.apply_reader_policies() returns void language sql as $$ select $$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('test.uid', true), '')::uuid $$;
create function auth.role() returns text language sql stable as $$
  select case when nullif(current_setting('test.uid', true), '') is null then 'service_role' else 'authenticated' end $$;
create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
create table auth.mfa_factors(id uuid primary key default gen_random_uuid(), user_id uuid, status text);
create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);

create table public.organisations(id uuid primary key default gen_random_uuid(), name text not null, slug text not null unique,
  settings jsonb default '{}'::jsonb, plan text default 'starter', active boolean default true, created_at timestamptz default now(),
  country text, countries text[] default '{}', primary_country text, contact_email text, notes text, locked boolean default false,
  updated_at timestamptz default now());

create table public.profiles(id uuid primary key, username text, full_name text, role text, region text, employee_id text,
  email text, org_id uuid default '${LIT}'::uuid references public.organisations(id),
  organisation_id uuid references public.organisations(id) on delete set null, country text[],
  approved boolean default false, locked boolean default false, is_super_admin boolean default false,
  site text, sites text[], updated_at timestamptz default now());
create unique index profiles_username_lower_uidx on public.profiles (lower(username)) where ((username is not null) and (btrim(username) <> ''::text));
create unique index profiles_employee_id_lower_uidx on public.profiles (lower(employee_id)) where ((employee_id is not null) and (btrim(employee_id) <> ''::text));

CREATE OR REPLACE FUNCTION public.app_current_org()
 RETURNS uuid
 LANGUAGE sql
 STABLE PARALLEL SAFE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT org_id FROM public.profiles WHERE id = auth.uid();
$function$;

CREATE OR REPLACE FUNCTION public.app_is_active()
 RETURNS boolean
 LANGUAGE sql
 STABLE PARALLEL SAFE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$\r\n  select coalesce(approved, false) = true\r\n     and coalesce(locked, false) = false\r\n  from public.profiles\r\n  where id = auth.uid()\r\n$function$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE PARALLEL SAFE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((select p.is_super_admin from public.profiles p
                   where p.id = auth.uid() and p.locked = false), false)
     and (
       coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
       or not exists (select 1 from auth.mfa_factors f
                      where f.user_id = auth.uid() and f.status = 'verified')
     );
$function$;

create function public.get_my_role() returns text language sql stable security definer set search_path=public as $$
  select role from public.profiles where id = auth.uid() $$;
create function public.app_role() returns text language sql stable security definer set search_path=public as $$
  select lower(coalesce(public.get_my_role(), '')) $$;
create function public.app_is_elevated() returns boolean language sql stable security definer set search_path=public as $$
  select public.is_super_admin() or public.app_role() in ('admin', 'manager', 'director') $$;
create function public.app_can_see_country(p text) returns boolean language sql stable set search_path=public as $$ select true $$;
create function public._console_ip_allowed() returns boolean language sql stable set search_path=public as $$ select true $$;

CREATE OR REPLACE FUNCTION public.sync_profile_org_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if NEW.org_id is null and NEW.organisation_id is not null then
    NEW.org_id := NEW.organisation_id;
  elsif NEW.organisation_id is null and NEW.org_id is not null then
    NEW.organisation_id := NEW.org_id;
  elsif NEW.org_id is not null and NEW.organisation_id is not null
        and NEW.org_id is distinct from NEW.organisation_id then
    NEW.organisation_id := NEW.org_id;
  end if;
  return NEW;
end;
$function$;

create table public.custom_roles(id uuid primary key default gen_random_uuid(), organisation_id uuid default public.app_current_org(),
  name text not null, active boolean not null default true);

CREATE OR REPLACE FUNCTION public.normalize_profiles_role()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.role IS NULL THEN
    NEW.role := 'Reporter';
    RETURN NEW;
  END IF;

  CASE lower(trim(NEW.role))
    WHEN 'schedule'        THEN NEW.role := 'Reporter';
    WHEN 'schedules'       THEN NEW.role := 'Reporter';
    WHEN 'schedule_report' THEN NEW.role := 'Reporter';
    WHEN 'schaule'         THEN NEW.role := 'Reporter';
    WHEN 'schdule'         THEN NEW.role := 'Reporter';
    ELSE NULL;
  END CASE;

  IF NEW.role <> ALL (ARRAY['Admin','Manager','Director','Reporter','Inspector',
                            'Tyre Man','Driver','Integration Admin','Data Engineer','Automation']::text[])
     AND NOT EXISTS (SELECT 1 FROM public.custom_roles c WHERE c.name = NEW.role) THEN
    NEW.role := 'Reporter';
  END IF;

  RETURN NEW;
END;
$function$;
create trigger tr_normalize_profiles_role before insert or update on public.profiles for each row execute function public.normalize_profiles_role();
create trigger tr_sync_profile_org before insert or update on public.profiles for each row execute function public.sync_profile_org_columns();

create table public.system_config(key text primary key, value text, description text, updated_by uuid,
  updated_at timestamptz not null default now(), category text default 'general', value_text text);
insert into public.system_config(key, value) values ('single_tenant_mode', 'true'), ('require_approval', 'true'),
  ('accident_email_to', 'fleet@example.test'), ('company_logo', 'logo-a.png'), ('report_palette', 'Vivid');

CREATE OR REPLACE FUNCTION public.system_config_read_level(p_key text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case
    when p_key in (
      'console_ip_allowlist_enabled','dual_control_enabled','max_login_attempts',
      'api_key_max_age_days','audit_retention_days','data_retention_months',
      'backup_enabled','backup_max_table_rows',
      'cron_alert_enabled','cron_alert_fail_streak','cron_alert_grace_min',
      'cron_alert_recover_ok','cron_alert_stuck_min',
      'sentry_auto_incidents','tenant_export_retention_days','max_users_per_org',
      'user_issue_breach_alerts','alert_email',
      'ai_model','ai_rate_limit_per_min','ai_cache_ttl_hours'
    ) then 'super'
    when p_key in (
      'accident_email_to','accident_email_cc','accident_email_subject_prefix',
      'support_email','digest_frequency'
    ) then 'elevated'
    else 'all'
  end;
$function$;

create table public.subscription_plans(id uuid primary key default gen_random_uuid(), code text not null unique, name text not null,
  description text, price_monthly numeric not null default 0, price_annual numeric not null default 0, currency text not null default 'USD',
  max_vehicles integer, max_users integer, max_api_keys integer, max_storage_gb integer, features jsonb not null default '{}'::jsonb,
  is_public boolean not null default true, sort_order integer not null default 0, active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
insert into public.subscription_plans(code, name, max_vehicles, max_users, max_api_keys, max_storage_gb, features, sort_order) values
  ('trial', 'Trial', 25, 3, 1, 1, '{"ai_tools":true,"erp_sync":false,"tv_display":false,"report_scheduling":false,"automation_platform":false}', 1),
  ('starter', 'Starter', 100, 10, 2, 10, '{"ai_tools":true,"erp_sync":false,"tv_display":true,"report_scheduling":true,"automation_platform":false}', 2),
  ('professional', 'Professional', 750, 50, 10, 100, '{"ai_tools":true,"erp_sync":true,"tv_display":true,"report_scheduling":true,"automation_platform":true}', 3),
  ('enterprise', 'Enterprise', null, null, null, null, '{"ai_tools":true,"erp_sync":true,"tv_display":true,"report_scheduling":true,"automation_platform":true}', 4);
create table public.org_subscriptions(id uuid primary key default gen_random_uuid(), organisation_id uuid unique default public.app_current_org(),
  plan_code text not null references public.subscription_plans(code),
  status text not null default 'trialing' check (status = any (array['trialing','active','past_due','canceled','expired'])),
  billing_interval text not null default 'monthly' check (billing_interval = any (array['monthly','annual'])),
  seats integer not null default 1 check (seats >= 0), trial_ends_at timestamptz,
  current_period_start timestamptz not null default now(), current_period_end timestamptz, cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());

create table public.modules(module_id text primary key, name text not null, category text,
  status text not null default 'live' check (status = any (array['live','maintenance','disabled','beta'])));
insert into public.modules(module_id, name, status) values ('tyre_records', 'Tyre Records', 'live'),
  ('scheduled_reports', 'Scheduled Reports', 'live'), ('fleet_master', 'Fleet Master', 'live'), ('vehicle_washing', 'Vehicle Washing', 'disabled');

create table public.module_permissions(id uuid primary key default gen_random_uuid(), module_key text not null, role text not null,
  org_id uuid, enabled boolean not null default true, updated_by uuid, updated_at timestamptz not null default now());
create unique index module_permissions_role_module_org_uidx on public.module_permissions
  (role, module_key, coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid));
create table public.user_access_grants(id uuid primary key default gen_random_uuid(), org_id uuid, user_id uuid not null,
  module_key text not null, capability text not null default 'view', effect text not null default 'grant', expires_at timestamptz);

CREATE OR REPLACE FUNCTION public.app_user_can(p_key text, p_cap text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid(); v_role text; v_super boolean := false;
  v_cap text := coalesce(nullif(btrim(p_cap), ''), 'view');
  v_default boolean := false; v_revoked boolean; v_granted boolean;
  v_json jsonb; v_ov jsonb;
begin
  if v_uid is null then return false; end if;
  select role, coalesce(is_super_admin, false) into v_role, v_super
    from public.profiles
   where id = v_uid
     and coalesce(approved, true) = true
     and coalesce(locked, false) = false;
  if not found then return false; end if;

  if v_super is true or v_role = 'Admin' then return true; end if;
  if v_cap = 'delete' then return false; end if;

  if v_cap = 'view' then
    v_default := coalesce((
      select enabled from public.module_permissions
       where org_id is null and role = v_role and module_key = p_key
       order by updated_at desc nulls last limit 1
    ), false);
  else
    begin
      select (settings->'app_settings'->>'permission_overrides')::jsonb into v_json from public.organisations where id=public.app_current_org();
      v_ov := coalesce(v_json -> 'overrides', v_json);
      v_default := coalesce((v_ov -> v_role -> p_key ->> v_cap)::boolean, false);
    exception when others then v_default := false;
    end;
  end if;

  v_revoked := exists (
    select 1 from public.user_access_grants g
     where g.user_id = v_uid and g.module_key = p_key and g.capability = v_cap
       and g.effect = 'revoke' and (g.expires_at is null or g.expires_at > now())
  );
  if v_revoked then return false; end if;
  if v_default then return true; end if;
  v_granted := exists (
    select 1 from public.user_access_grants g
     where g.user_id = v_uid and g.module_key = p_key and g.capability = v_cap
       and g.effect = 'grant' and (g.expires_at is null or g.expires_at > now())
  );
  return v_granted;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_user_module_permissions(p_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID; v_role TEXT; v_org_id UUID; v_perms JSONB := '{}'; rec RECORD;
BEGIN
  v_uid := COALESCE(p_user_id, auth.uid());
  SELECT role, organisation_id INTO v_role, v_org_id FROM profiles WHERE id = v_uid;
  FOR rec IN SELECT module_key, enabled FROM module_permissions WHERE org_id IS NULL AND role = v_role
  LOOP v_perms := v_perms || jsonb_build_object(rec.module_key, rec.enabled); END LOOP;
  IF v_org_id IS NOT NULL THEN
    FOR rec IN SELECT module_key, enabled FROM module_permissions WHERE org_id = v_org_id AND role = v_role
    LOOP v_perms := v_perms || jsonb_build_object(rec.module_key, rec.enabled); END LOOP;
  END IF;
  RETURN v_perms;
END;
$function$;

create table public.vehicle_fleet(id uuid primary key default gen_random_uuid(), organisation_id uuid default public.app_current_org(),
  country text, asset_no text, site text, created_at timestamptz default now());

CREATE OR REPLACE FUNCTION public.get_subscription_overview()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org      uuid := public.app_current_org();
  v_sub      public.org_subscriptions%ROWTYPE;
  v_plan     public.subscription_plans%ROWTYPE;
  v_vehicles bigint := 0;
  v_users    bigint := 0;
  v_api_keys bigint := 0;
BEGIN
  SELECT * INTO v_sub FROM public.org_subscriptions
   WHERE organisation_id IS NOT DISTINCT FROM v_org ORDER BY created_at LIMIT 1;
  SELECT * INTO v_plan FROM public.subscription_plans WHERE code = COALESCE(v_sub.plan_code, 'trial');
  IF to_regclass('public.vehicle_fleet') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.vehicle_fleet WHERE $1 IS NULL OR organisation_id IS NULL OR organisation_id = $1'
      INTO v_vehicles USING v_org;
  END IF;
  IF to_regclass('public.profiles') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.profiles WHERE $1 IS NULL OR org_id IS NULL OR org_id = $1'
      INTO v_users USING v_org;
  END IF;
  IF to_regclass('public.api_keys') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.api_keys WHERE $1 IS NULL OR organisation_id IS NULL OR organisation_id = $1'
      INTO v_api_keys USING v_org;
  END IF;
  RETURN jsonb_build_object(
    'organisation_id', v_org,
    'subscription', CASE WHEN v_sub.id IS NULL THEN
        jsonb_build_object('plan_code','trial','status','trialing','billing_interval','monthly',
          'seats',1,'cancel_at_period_end',false,'trial_ends_at', NULL,'current_period_end', NULL,'provisioned', false)
      ELSE
        jsonb_build_object('id', v_sub.id,'plan_code', v_sub.plan_code,'status', v_sub.status,
          'billing_interval', v_sub.billing_interval,'seats', v_sub.seats,
          'cancel_at_period_end', v_sub.cancel_at_period_end,'trial_ends_at', v_sub.trial_ends_at,
          'current_period_start', v_sub.current_period_start,'current_period_end', v_sub.current_period_end,'provisioned', true)
      END,
    'plan', to_jsonb(v_plan),
    'usage', jsonb_build_object('vehicles', v_vehicles,'users', v_users,'api_keys', v_api_keys),
    'limits', jsonb_build_object('vehicles', v_plan.max_vehicles,'users', v_plan.max_users,
      'api_keys', v_plan.max_api_keys,'storage_gb', v_plan.max_storage_gb),
    'generated_at', now());
END $function$;

CREATE OR REPLACE FUNCTION public.org_can_add(p_resource text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_over jsonb := public.get_subscription_overview();
  v_limit numeric;
  v_usage numeric;
BEGIN
  v_limit := NULLIF(v_over -> 'limits' ->> p_resource, '')::numeric;
  IF v_limit IS NULL THEN RETURN true; END IF;
  v_usage := COALESCE((v_over -> 'usage' ->> p_resource)::numeric, 0);
  RETURN v_usage < v_limit;
END $function$;

CREATE OR REPLACE FUNCTION public.ensure_org_subscription()
 RETURNS org_subscriptions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org uuid := public.app_current_org();
  v_row public.org_subscriptions%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.org_subscriptions
   WHERE organisation_id IS NOT DISTINCT FROM v_org ORDER BY created_at LIMIT 1;
  IF NOT FOUND THEN
    INSERT INTO public.org_subscriptions
      (organisation_id, plan_code, status, billing_interval, seats,
       trial_ends_at, current_period_start, current_period_end)
    VALUES (v_org, 'trial', 'trialing', 'monthly', 1,
       now() + interval '14 days', now(), now() + interval '14 days')
    ON CONFLICT (organisation_id) DO NOTHING;
    SELECT * INTO v_row FROM public.org_subscriptions
     WHERE organisation_id IS NOT DISTINCT FROM v_org ORDER BY created_at LIMIT 1;
  END IF;
  RETURN v_row;
END $function$;

CREATE OR REPLACE FUNCTION public.enforce_plan_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_resource text := TG_ARGV[0];
  v_org uuid;
  v_block boolean := false;
  v_label text;
begin
  begin
    if auth.uid() is null or auth.role() is distinct from 'authenticated' then
      return NEW;
    end if;
    v_org := public.app_current_org();
    if v_org is null then
      return NEW;
    end if;
    if not exists (select 1 from public.org_subscriptions s where s.organisation_id = v_org) then
      return NEW;
    end if;
    if public.org_can_add(v_resource) = false then
      v_block := true;
    end if;
  exception when others then
    return NEW;
  end;

  if v_block then
    v_label := case v_resource when 'api_keys' then 'API keys' else v_resource end;
    raise exception 'Plan limit reached for %. Upgrade your plan to add more.', v_label
      using errcode = 'check_violation',
            hint = 'Your current subscription plan does not allow additional ' || v_label || '. Contact your administrator to upgrade.';
  end if;
  return NEW;
end;
$function$;

CREATE OR REPLACE FUNCTION public.stamp_import_default_org()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_setting text := nullif(btrim(coalesce(current_setting('tp.import_org', true), '')), '');
  v_org uuid;
begin
  if new.organisation_id is not null then
    return new;
  end if;
  if v_setting is not null then
    begin
      v_org := v_setting::uuid;
    exception when invalid_text_representation then
      raise exception 'tp.import_org is not a valid uuid' using errcode = 'PT409';
    end;
    if not exists (select 1 from public.organisations o where o.id = v_org) then
      raise exception 'tp.import_org does not name an existing organisation' using errcode = 'PT409';
    end if;
    new.organisation_id := v_org;
  elsif coalesce((select value from public.system_config where key = 'single_tenant_mode'), 'false') = 'true' then
    new.organisation_id := '00000000-0000-0000-0000-000000000001'::uuid;
  else
    raise exception 'Import refused: organisation_id is null, tp.import_org is not set and single_tenant_mode is off' using errcode = 'PT409';
  end if;
  return new;
end
$function$;

create table public.site_aliases(alias text primary key, canonical text not null, created_at timestamptz not null default now());
insert into public.site_aliases(alias, canonical) values ('NHC-ST', 'NHC'), ('DHABAN-ST', 'DHAHBAN'), ('REDSEA', 'RED SEA');
create table public.brand_aliases(id bigserial primary key, alias text not null unique, canonical text not null, created_at timestamptz default now());
insert into public.brand_aliases(alias, canonical) values ('traingle', 'TRIANGLE');

CREATE OR REPLACE FUNCTION public.normalize_site()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_canon text;
begin
  if new.site is null then return new; end if;
  new.site := upper(btrim(regexp_replace(new.site, '\\s+', ' ', 'g')));
  select a.canonical into v_canon from public.site_aliases a where a.alias = new.site;
  if v_canon is not null then
    new.site := v_canon;
  elsif new.site ~ '[_-]ST$' then
    new.site := regexp_replace(new.site, '[_-]ST$', '');
  end if;
  return new;
end $function$;

create table public.sites(id uuid primary key default gen_random_uuid(), organisation_id uuid default public.app_current_org(),
  country text, name text);

CREATE OR REPLACE FUNCTION public.normalize_site_name()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_canon text;
begin
  if new.name is null then return new; end if;
  new.name := upper(regexp_replace(btrim(new.name), '\\s+', ' ', 'g'));
  select a.canonical into v_canon from public.site_aliases a where a.alias = new.name;
  if v_canon is not null then
    new.name := v_canon;
  elsif new.name ~ '[_-]ST$' then
    new.name := regexp_replace(new.name, '[_-]ST$', '');
  end if;

  if tg_op = 'INSERT' and exists (
    select 1 from public.sites s
    where s.organisation_id is not distinct from new.organisation_id
      and s.country is not distinct from new.country
      and upper(s.name) = upper(new.name)
  ) then
    return null;
  end if;
  return new;
end $function$;
create trigger trg_normalize_site_name before insert or update on public.sites for each row execute function public.normalize_site_name();

CREATE OR REPLACE FUNCTION public.normalize_brand(raw text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$\r\n  select coalesce(\r\n    (select canonical from public.brand_aliases\r\n      where alias = lower(trim(raw)) limit 1),\r\n    initcap(trim(raw))\r\n  )\r\n$function$;

-- vehicle_fleet triggers in live firing (name) order.
create trigger trg_enforce_plan_limit before insert on public.vehicle_fleet for each row execute function public.enforce_plan_limit('vehicles');
create trigger trg_normalize_site before insert or update on public.vehicle_fleet for each row execute function public.normalize_site();
create trigger trg_stamp_import_default_org before insert on public.vehicle_fleet for each row execute function public.stamp_import_default_org();
alter table public.vehicle_fleet enable row level security;
create policy vehicle_fleet_org_isolation on public.vehicle_fleet as restrictive for all to authenticated
  using (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()))
  with check (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()));
create policy vehicle_fleet_read on public.vehicle_fleet for select to authenticated using ((select public.app_is_active()));
create policy vehicle_fleet_insert on public.vehicle_fleet for insert to authenticated with check ((select public.app_is_active()));

-- A table whose writes are gated ONLY by app_user_can (the shape of the *_cap_* policies).
create table public.tyre_records(id uuid primary key default gen_random_uuid(), organisation_id uuid default public.app_current_org(),
  country text, serial_no text, site text);
alter table public.tyre_records enable row level security;
create policy tyre_records_org_isolation on public.tyre_records as restrictive for all to authenticated
  using (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()))
  with check (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()));
create policy tyre_records_read on public.tyre_records for select to authenticated using ((select public.app_is_active()));
create policy tyre_records_cap_insert on public.tyre_records for insert to authenticated with check (public.app_user_can('tyre_records', 'create'));

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  -- Sign-up metadata is written by the client: only a known country is honoured,
  -- anything else (or nothing) falls back to the default.
  v_region text := case upper(btrim(coalesce(new.raw_user_meta_data->>'region','')))
                     when 'KSA' then 'KSA'
                     when 'UAE' then 'UAE'
                     when 'EGYPT' then 'Egypt'
                     else 'KSA' end;
  v_req    text;
  v_approved boolean := false;
begin
  select value into v_req from public.system_config where key = 'require_approval';
  -- Default = require approval (pending). Only an explicit off value auto-approves.
  if v_req is not null and lower(btrim(v_req)) in ('false','0','off','no') then
    v_approved := true;
  end if;

  insert into public.profiles (id, username, full_name, role, region, employee_id, email,
                               org_id, organisation_id, country, approved)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'full_name',
    'Reporter',
    v_region,
    nullif(new.raw_user_meta_data->>'employee_id',''),
    new.email,
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    ARRAY[v_region],
    v_approved
  )
  on conflict (id) do nothing;
  return new;
end $function$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- ---- staging pipes (verbatim) and their stubs ---------------------------------------------------
create function public.erp_is_footer(p text) returns boolean language sql immutable as $$ select coalesce(p ilike 'GRAND TOTAL%', false) $$;
create function public.erp_parse_date(p text) returns date language sql immutable as $$ select nullif(p, '')::date $$;
create function public._to_num(p text) returns numeric language sql immutable as $$ select nullif(p, '')::numeric $$;
create table public.stg_wo_lines(work_order_no text, country text, asset_no text, site text, opened_date text, work_type text,
  task text, detail text, action text, qty text, source_row text);
create table public.work_order_line_items(id uuid primary key default gen_random_uuid(), organisation_id uuid, country text,
  work_order_no text, asset_no text, site text, opened_date date, work_type text, task text, detail text, action text, qty numeric, source_row int);

CREATE OR REPLACE FUNCTION public.process_stg_wo_lines()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_org uuid; v_src int;
begin
  if public.erp_is_footer(NEW.work_order_no) then return null; end if;
  if coalesce(btrim(NEW.work_order_no),'')='' then return null; end if;
  v_org := coalesce(public.app_current_org(), '00000000-0000-0000-0000-000000000001'::uuid);
  v_src := nullif(regexp_replace(coalesce(NEW.source_row,''),'[^0-9-]','','g'),'')::int;
  -- idempotent: skip an identical line already loaded for this card in this country
  if exists (
     select 1 from public.work_order_line_items l
     where l.organisation_id = v_org
       and l.country is not distinct from NEW.country
       and lower(btrim(l.work_order_no)) = lower(btrim(NEW.work_order_no))
       and l.source_row is not distinct from v_src
       and coalesce(l.task,'') = coalesce(NEW.task,'')
       and coalesce(l.action,'') = coalesce(NEW.action,'')
  ) then return null; end if;
  insert into public.work_order_line_items
    (organisation_id, country, work_order_no, asset_no, site, opened_date,
     work_type, task, detail, action, qty, source_row)
  values (v_org, NEW.country, NEW.work_order_no, NEW.asset_no, NEW.site,
     public.erp_parse_date(NEW.opened_date), NEW.work_type, NEW.task, NEW.detail,
     NEW.action, public._to_num(NEW.qty), v_src);
  return null;
end; $function$;
create trigger trg_process_stg_wo_lines before insert on public.stg_wo_lines for each row execute function public.process_stg_wo_lines();

create table public.expenses_import("Country" text, "Issue Number" text, "Work Order Number" text, "Transaction Type" text,
  "Asset Code" text, "Asset Description" text, "Asset Type" text, "Store Code" text, "Cost Center" text, "Itemcode" text, "Qty" text,
  "Item Description" text, "Values" text, "Spare Parts" text, "Trye" text, "Oil" text, "Total Parts Consumption" text, "#" text);
create table public.parts_consumption(id uuid primary key default gen_random_uuid(), organisation_id uuid, country text, issue_number text,
  work_order_no text, txn_date text, asset_code text, asset_description text, asset_type text, store_code text, cost_center text,
  item_code text, qty text, item_description text, value_amount text, spare_parts_amount text, tyre_amount text, oil_amount text,
  total_amount text, source_row text);

CREATE OR REPLACE FUNCTION public.process_expenses_import()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if public.erp_is_footer(NEW."Item Description") or public.erp_is_footer(NEW."Work Order Number") then return null; end if;
  if coalesce(btrim(NEW."Item Description"),'')='' and coalesce(btrim(NEW."Values"),'')='' then return null; end if;
  insert into public.parts_consumption
    (organisation_id, country, issue_number, work_order_no, txn_date, asset_code, asset_description,
     asset_type, store_code, cost_center, item_code, qty, item_description,
     value_amount, spare_parts_amount, tyre_amount, oil_amount, total_amount, source_row)
  values (coalesce(public.app_current_org(),'00000000-0000-0000-0000-000000000001'::uuid),
     nullif(btrim(NEW."Country"),''), NEW."Issue Number", NEW."Work Order Number", NEW."Transaction Type",
     NEW."Asset Code", NEW."Asset Description", NEW."Asset Type", NEW."Store Code", NEW."Cost Center",
     NEW."Itemcode", NEW."Qty", NEW."Item Description", NEW."Values", NEW."Spare Parts", NEW."Trye",
     NEW."Oil", NEW."Total Parts Consumption", NEW."#");
  return null;
end; $function$;
create trigger trg_process_expenses_import before insert on public.expenses_import for each row execute function public.process_expenses_import();

create table public.material_master(organisation_id uuid, country text, item_code text, category text, reviewed boolean default false);

CREATE OR REPLACE FUNCTION public.material_category_for(p_country text, p_item_code text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- Only a REVIEWED decision is authoritative. NULL means "fall back to the patterns".
  select m.category
    from public.material_master m
   where m.organisation_id = coalesce(public.app_current_org(),
                                      '00000000-0000-0000-0000-000000000001'::uuid)
     and m.country = p_country
     and (p_country is null or public.app_can_see_country(p_country) is not false)
     and m.item_code = upper(btrim(coalesce(p_item_code, '')))
     and m.reviewed
   limit 1;
$function$;

-- ---- STAND-INS: live signature + live literal count, small body ---------------------------------
create function public.extract_tyre_freetext_candidates(p_dry_run boolean default true) returns uuid language plpgsql security definer set search_path=public as $f$
declare v_org uuid; begin
  v_org := coalesce(public.app_current_org(), '${LIT}'::uuid);
  return v_org; end $f$;
create function public.get_login_showcase() returns jsonb language plpgsql stable security definer set search_path=public as $f$
declare
  v_org uuid := '${LIT}';
  v jsonb;
begin
  select jsonb_build_object('vehicles', (select count(*) from public.vehicle_fleet where organisation_id = v_org), 'org', v_org) into v;
  return v; end $f$;
create table public.stg_monthly_tyres_audit(id bigserial primary key, organisation_id uuid, reason text, resolved_at timestamptz);
create function public.list_tyre_import_reviews(p_country text default null, p_include_resolved boolean default false, p_limit integer default 200)
 returns bigint language plpgsql stable security definer set search_path=public as $f$
declare v_org uuid := public.app_current_org(); n bigint; begin
  select count(*) into n from public.stg_monthly_tyres_audit a
   where coalesce(a.organisation_id, '${LIT}'::uuid) = v_org;
  return n; end $f$;
create function public.resolve_tyre_import_review(p_id bigint, p_action text) returns jsonb language plpgsql security definer set search_path=public as $f$
declare v_org uuid := public.app_current_org(); a record; begin
  select * into a from public.stg_monthly_tyres_audit where id = p_id;
  if coalesce(a.organisation_id, '${LIT}'::uuid) <> v_org then
    return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  return jsonb_build_object('ok', true); end $f$;
create function public.material_master_coverage() returns uuid language plpgsql security definer set search_path=public as $f$
declare v_org uuid := public.app_current_org(); begin
  v_org := coalesce(v_org, '${LIT}'::uuid);
  return v_org; end $f$;
create function public.material_master_derive() returns uuid language plpgsql security definer set search_path=public as $f$
declare v_org uuid := public.app_current_org(); begin
  v_org := coalesce(v_org, '${LIT}'::uuid);
  return v_org; end $f$;
create function public.material_master_set(p_country text, p_item_code text, p_category text, p_subcategory text default null,
  p_brand text default null, p_uom text default null, p_notes text default null, p_reviewed boolean default true)
 returns uuid language plpgsql security definer set search_path=public as $f$
declare
  v_org  uuid := coalesce(public.app_current_org(), '${LIT}'::uuid);
begin return v_org; end $f$;
create function public.material_master_set_bulk(p_items jsonb) returns uuid language plpgsql security definer set search_path=public as $f$
declare
  v_org       uuid := coalesce(public.app_current_org(), '${LIT}'::uuid);
begin return v_org; end $f$;
create function public.reclassify_from_master(p_dry_run boolean default true) returns uuid language plpgsql security definer set search_path=public as $f$
declare
  v_org   uuid := coalesce(public.app_current_org(), '${LIT}'::uuid);
begin return v_org; end $f$;
-- Trigger stand-ins write the org they resolved into stg_probe so a test can read it back.
create table public.stg_probe(fn text, org uuid);
create function public.process_daily_km() returns trigger language plpgsql security definer set search_path=public as $f$
declare v_org uuid; begin
  v_org := coalesce(public.app_current_org(), '${LIT}'::uuid);
  insert into public.stg_probe values ('process_daily_km', v_org); return null; end $f$;
create function public.process_expenses_country() returns trigger language plpgsql security definer set search_path=public as $f$
declare v_org uuid; begin
  v_org := coalesce(public.app_current_org(), '${LIT}'::uuid);
  insert into public.stg_probe values ('process_expenses_country', v_org); return null; end $f$;
create function public.process_stg_job_cards() returns trigger language plpgsql security definer set search_path=public as $f$
declare
  v_org uuid := coalesce(public.app_current_org(), '${LIT}'::uuid);
begin insert into public.stg_probe values ('process_stg_job_cards', v_org); return null; end $f$;
create function public.process_stg_open_wo() returns trigger language plpgsql security definer set search_path=public as $f$
declare v_org uuid; begin
  v_org := coalesce(public.app_current_org(), '${LIT}'::uuid);
  insert into public.stg_probe values ('process_stg_open_wo', v_org); return null; end $f$;
create table public.stg_monthly_tyres(organisation_id uuid, veh_no text);
create function public.process_stg_monthly_tyres() returns trigger language plpgsql security definer set search_path=public as $f$
begin
  insert into public.stg_probe values ('process_stg_monthly_tyres',
      coalesce(new.organisation_id, '${LIT}'::uuid));
  perform coalesce(new.organisation_id, '${LIT}'::uuid);
  return null; end $f$;
create trigger trg_process_stg_monthly_tyres before insert on public.stg_monthly_tyres for each row execute function public.process_stg_monthly_tyres();
create table public.cpk_asset_meter(organisation_id uuid, asset_no text);
create function public.sync_ksa_kms_to_meter() returns trigger language plpgsql security definer set search_path=public as $f$
declare v_org uuid; begin
  select coalesce(
           (
             select min(c2.organisation_id)
             from public.cpk_asset_meter c2
           ),
           '${LIT}'::uuid
         )
    into v_org;
  insert into public.stg_probe values ('sync_ksa_kms_to_meter', v_org); return null; end $f$;

create table public.console_sessions(id uuid primary key default gen_random_uuid(), admin_id uuid, action text, target_id uuid,
  target_type text, details jsonb, created_at timestamptz default now());

grant usage on schema public, auth to authenticated, anon, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage on all sequences in schema public to authenticated;

-- ---- seed ----------------------------------------------------------------------------------------
insert into public.organisations(id, name, slug, settings) values
  ('${ORG_A}', 'Company A', 'company-a',
   '{"app_settings":{"permission_overrides":"{\\"overrides\\":{\\"Manager\\":{\\"tyre_records\\":{\\"create\\":true,\\"edit\\":true}},\\"Fleet Supervisor\\":{\\"tyre_records\\":{\\"create\\":true}}}}"}}'::jsonb),
  ('${ORG_B}', 'Tenant B', 'tenant-b', '{}'::jsonb),
  ('${ORG_C}', 'Tenant C', 'tenant-c', '{}'::jsonb);
insert into public.custom_roles(organisation_id, name) values ('${ORG_A}', 'Fleet Supervisor'), ('${ORG_B}', 'Fleet Supervisor');
insert into public.profiles(id, username, role, org_id, approved, is_super_admin, country) values
  ('${U.superadmin}', 'super',   'Admin',            '${ORG_A}', true, true,  null),
  ('${U.adminA}',     'admin_a', 'Admin',            '${ORG_A}', true, false, '{KSA}'),
  ('${U.managerA}',   'mgr_a',   'Manager',          '${ORG_A}', true, false, '{KSA}'),
  ('${U.tyremanA}',   'tyre_a',  'Tyre Man',         '${ORG_A}', true, false, '{KSA}'),
  ('${U.supervisorA}','sup_a',   'Fleet Supervisor', '${ORG_A}', true, false, '{KSA}'),
  ('${U.reporterA}',  'rep_a',   'Reporter',         '${ORG_A}', true, false, '{KSA}'),
  ('${U.adminB}',     'admin_b', 'Admin',            '${ORG_B}', true, false, '{KSA}'),
  ('${U.managerB}',   'mgr_b',   'Manager',          '${ORG_B}', true, false, '{KSA}'),
  ('${U.supervisorB}','sup_b',   'Fleet Supervisor', '${ORG_B}', true, false, '{KSA}'),
  ('${U.adminC}',     'admin_c', 'Admin',            '${ORG_C}', true, false, '{KSA}'),
  ('${U.managerC}',   'mgr_c',   'Manager',          '${ORG_C}', true, false, '{KSA}');
insert into public.module_permissions(module_key, role, org_id, enabled) values
  ('tyre_records', 'Manager', null, true), ('scheduled_reports', 'Manager', null, true), ('fleet_master', 'Manager', null, true),
  ('vehicle_washing', 'Manager', null, true), ('tyre_records', 'Tyre Man', null, true), ('tyre_records', 'Reporter', null, false),
  ('tyre_records', 'Fleet Supervisor', null, true), ('scheduled_reports', 'Fleet Supervisor', null, true);
insert into public.user_access_grants(user_id, module_key, capability, effect) values
  ('${U.tyremanA}', 'tyre_records', 'create', 'grant'), ('${U.managerA}', 'fleet_master', 'view', 'revoke');
`

/** A database holding the baseline only (production as it is today). */
export async function createBaselineDb ({ mutateBaseline = s => s } = {}) {
  const db = new PGlite()
  await db.exec(mutateBaseline(BASELINE))
  return db
}

/** Apply one draft inside a transaction, exactly as a migration runner would. */
export async function applyDraft (db, name, { mutate = s => s } = {}) {
  try {
    await db.exec(`begin;\n${mutate(draftSql(name))}\ncommit;`)
  } catch (e) {
    await db.exec('rollback').catch(() => {})
    throw e
  }
}

/** Baseline plus the named drafts, in the required apply order. */
export async function createDb (drafts = [], opts = {}) {
  const db = await createBaselineDb(opts)
  for (const d of drafts) await applyDraft(db, d)
  return db
}

/** Run fn as `uid` under the authenticated role (RLS applies). */
export async function asClient (db, uid, fn) {
  await db.exec(`set test.uid = '${uid}'; set role authenticated`)
  try { return await fn() } finally { await db.exec('reset role; reset test.uid') }
}

/** Seed n vehicles for an organisation as the owner (no RLS, no plan trigger: uid is unset). */
export async function seedVehicles (db, org, n, prefix = 'V') {
  await db.exec(`insert into public.vehicle_fleet(organisation_id, country, asset_no)
    select '${org}', 'KSA', '${prefix}' || g from generate_series(1, ${n}) g`)
}

export const one = async (db, sql) => (await db.query(sql)).rows[0]
export const val = async (db, sql) => Object.values((await db.query(sql)).rows[0])[0]

/** role x module x capability matrix of app_user_can for a list of users, as one comparable string. */
export async function capabilityMatrix (db, users) {
  const keys = ['tyre_records', 'scheduled_reports', 'fleet_master', 'vehicle_washing', 'unknown_module']
  const caps = ['view', 'create', 'edit', 'delete', 'approve']
  const out = []
  for (const [name, uid] of Object.entries(users)) {
    for (const k of keys) {
      for (const c of caps) {
        const v = await asClient(db, uid, () => val(db, `select public.app_user_can('${k}', '${c}')`))
        out.push(`${name}:${k}:${c}=${v}`)
      }
    }
  }
  return out.join('\n')
}
