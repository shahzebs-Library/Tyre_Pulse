-- COM-0: per-organisation settings store (foundation for the commercial-readiness fixes).
--
-- STATUS: AUTHORED, NOT APPLIED. Drafted 2026-11-12. Not applied to any database.
--         Tested on PGlite only (supabase/tests/commercial_notifications.test.mjs and
--         supabase/tests/commercial_tenant_settings.test.mjs).
--
-- ROOT CAUSE
--   Several things a company would expect to be its own are stored once for the whole
--   platform: public.system_config and public.settings have no organisation column. That is
--   harmless with one company and becomes a leak or a wrong default with two (accident mailbox,
--   company name and logo on public boards, approver role names, tyre life ceilings, accident
--   vocabulary). There is no per-organisation key/value store to move them to.
--
-- WHAT THIS ADDS (additive only, nothing existing is changed)
--   1. public.organisation_settings (organisation_id, key, value jsonb): one row per company
--      per setting. RESTRICTIVE organisation wall, read by active members, written by the
--      company's Admin (or a super admin).
--   2. system_config key 'legacy_settings_owner_org': names the ONE organisation that the
--      existing global values belong to (the current company). The resolvers in the later
--      COM migrations give the global value to that organisation only, so the current company
--      keeps reading exactly the rows its screens edit today, and every other organisation
--      gets its own setting or a neutral default, never the current company's value.
--   3. public.legacy_settings_owner_org() and public.org_setting(org, key): internal readers.
--      They take an organisation id, so they are NOT executable by anon or authenticated
--      (the V378 rule). public.my_org_setting(key) is the signed-in reader.
--
-- RISK TO THE CURRENT COMPANY: NONE. A new empty table, one new system_config row and three
--   new functions. No existing object is altered and nothing reads the new objects until the
--   later COM migrations are applied.
--
-- VERIFY (after applying; all read only)
--   select count(*) from public.organisation_settings;                          -- 0
--   select public.legacy_settings_owner_org();   -- 00000000-0000-0000-0000-000000000001
--   select has_function_privilege('authenticated','public.org_setting(uuid,text)','EXECUTE'); -- f
--   select has_function_privilege('anon','public.my_org_setting(text)','EXECUTE');            -- f
--   select count(*) from pg_policies where tablename = 'organisation_settings';  -- 4 or more
--
-- ROLLBACK (the table is empty at that point; run by hand, statement by statement)
--   remove the functions my_org_setting(text), org_setting(uuid,text),
--   legacy_settings_owner_org(); remove the table public.organisation_settings; remove the
--   system_config row with key 'legacy_settings_owner_org'.

create table if not exists public.organisation_settings (
  organisation_id uuid not null references public.organisations(id),
  key             text not null check (key ~ '^[a-z][a-z0-9_]{1,62}$'),
  value           jsonb not null,
  updated_by      uuid default auth.uid(),
  updated_at      timestamptz not null default now(),
  primary key (organisation_id, key)
);

comment on table public.organisation_settings is
  'Per-organisation settings (COM-0). One row per company per key. Global system_config values '
  'belong to the organisation named in system_config.legacy_settings_owner_org only.';

alter table public.organisation_settings enable row level security;

revoke all on public.organisation_settings from anon;
grant select, insert, update on public.organisation_settings to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                  and tablename = 'organisation_settings' and policyname = 'organisation_settings_org_isolation') then
    create policy organisation_settings_org_isolation on public.organisation_settings
      as restrictive for all to public
      using ((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()))
      with check ((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                  and tablename = 'organisation_settings' and policyname = 'organisation_settings_read') then
    create policy organisation_settings_read on public.organisation_settings
      for select to authenticated using ((select public.app_is_active()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                  and tablename = 'organisation_settings' and policyname = 'organisation_settings_insert') then
    create policy organisation_settings_insert on public.organisation_settings
      for insert to authenticated with check ((select public.app_is_org_admin()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                  and tablename = 'organisation_settings' and policyname = 'organisation_settings_update') then
    create policy organisation_settings_update on public.organisation_settings
      for update to authenticated
      using ((select public.app_is_org_admin())) with check ((select public.app_is_org_admin()));
  end if;
end $$;

-- The one organisation the existing global values belong to. Seeded only when that
-- organisation exists, so a fresh database gets no owner and every company starts neutral.
insert into public.system_config (key, value)
select 'legacy_settings_owner_org', '00000000-0000-0000-0000-000000000001'
 where exists (select 1 from public.organisations o
                where o.id = '00000000-0000-0000-0000-000000000001'::uuid)
on conflict (key) do nothing;

create or replace function public.legacy_settings_owner_org()
returns uuid
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_raw text;
begin
  select btrim(coalesce(value, ''), '"') into v_raw
    from public.system_config where key = 'legacy_settings_owner_org';
  if v_raw is null or v_raw !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return null;
  end if;
  return v_raw::uuid;
end
$function$;

create or replace function public.org_setting(p_org uuid, p_key text)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select s.value from public.organisation_settings s
   where s.organisation_id = p_org and s.key = p_key;
$function$;

create or replace function public.my_org_setting(p_key text)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select case when public.app_is_active()
              then public.org_setting(public.app_current_org(), p_key) end;
$function$;

-- Functions that accept an organisation id are internal: revoke from PUBLIC first (a revoke
-- from anon alone is a no-op against the PUBLIC grant), then grant only what is needed.
revoke all on function public.legacy_settings_owner_org() from public, anon, authenticated;
revoke all on function public.org_setting(uuid, text) from public, anon, authenticated;
revoke all on function public.my_org_setting(text) from public, anon;
grant execute on function public.legacy_settings_owner_org() to service_role;
grant execute on function public.org_setting(uuid, text) to service_role;
grant execute on function public.my_org_setting(text) to authenticated, service_role;

-- Rule from V102: any migration that creates a table re-applies the reader policies.
select anum_integration.apply_reader_policies();
