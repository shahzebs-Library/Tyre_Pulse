-- V286 — System Configuration enforcement wiring
--
-- Context: the console System Configuration page (ConsoleSystemConfig.jsx) saved
-- every control into system_config, but several controls were never read/enforced.
-- This migration adds the backend pieces the app-layer enforcement needs.
--
-- (1) get_public_config(): anon-safe DEFINER reader for the PRE-AUTH subset only
--     (maintenance / registration / version / password policy). V281 revoked anon
--     table grants, so pre-auth screens (login, register, maintenance gate) cannot
--     read system_config directly; this RPC is the single sanctioned pre-auth
--     channel. It NEVER returns AI keys, budgets, emails, or any operational secret.
-- (2) cron_run_backup(): honor the backup_enabled switch (non-destructive skip),
--     so "Automated Backups OFF" actually stops the nightly snapshot.
--
-- Reversible; idempotent (CREATE OR REPLACE). Next free migration V287.

create or replace function public.get_public_config()
returns jsonb
language sql
security definer
set search_path to 'public'
stable
as $$
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
  from public.system_config
  where key = any (array[
    'maintenance_mode','maintenance_message','registration_open','allow_signups',
    'require_approval','app_version','session_timeout_hours','two_factor_required',
    'password_min_length','default_currency'
  ]);
$$;

revoke all on function public.get_public_config() from public;
grant execute on function public.get_public_config() to anon, authenticated;

-- Backup switch is now real: the nightly job skips when backup_enabled is off.
create or replace function public.cron_run_backup()
returns void
language plpgsql
security definer
set search_path to 'public,backups'
as $function$
declare v_on text;
begin
  select value into v_on from public.system_config where key = 'backup_enabled';
  -- Default ON when unset; only an explicit off value disables the nightly snapshot.
  if v_on is not null and lower(btrim(v_on)) in ('false','0','off','no') then
    return;
  end if;
  perform backups._do_snapshot('nightly', null);
  perform backups._purge(30);
end;
$function$;

-- (3) require_approval switch is now real: when explicitly OFF, a new self-
--     registered account is auto-approved; otherwise it stays pending (default).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_region text := coalesce(nullif(new.raw_user_meta_data->>'region',''), 'KSA');
  v_req    text;
  v_approved boolean := false;
begin
  select value into v_req from public.system_config where key = 'require_approval';
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

-- Rollback:
--   drop function if exists public.get_public_config();
--   (restore the prior 2-statement body of public.cron_run_backup())
--   (restore the prior body of public.handle_new_user() with a hardcoded approved=false)
