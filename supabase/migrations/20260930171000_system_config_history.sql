-- Control Center, Settings: record who changed a platform setting, the old and new
-- value, and why, from now on.
--
-- Before this, system_config.updated_by existed but was empty on all 46 keys and
-- console_sessions only logged "update_config" without the key or the old value.
--
-- Additive:
--   * new table public.system_config_history (append-only, super-admin read only)
--   * BEFORE INSERT/UPDATE trigger stamps updated_by = auth.uid() (when a person is
--     signed in) and updated_at = now() when the value changes
--   * AFTER INSERT/UPDATE/DELETE trigger appends one history row per real change
--   * admin_set_config(p_key, p_value, p_reason): super-admin write that carries a
--     reason into the history row. It goes through the table, so the existing
--     guard triggers (IP allowlist, dual control) still refuse those keys.
-- Existing rows and existing writers are unchanged; the trigger names sort after
-- the guard triggers so a refused write never records history.
--
-- Rollback:
--   drop trigger if exists trg_zz_system_config_stamp on public.system_config;
--   drop trigger if exists trg_zz_system_config_history on public.system_config;
--   drop function if exists public.system_config_stamp();
--   drop function if exists public.system_config_record_history();
--   drop function if exists public.admin_set_config(text, text, text);
--   drop table if exists public.system_config_history;

create table if not exists public.system_config_history (
  id          uuid primary key default gen_random_uuid(),
  key         text not null,
  action      text not null check (action in ('insert', 'update', 'delete')),
  old_value   text,
  new_value   text,
  changed_by  uuid,
  reason      text check (reason is null or length(reason) <= 500),
  changed_at  timestamptz not null default now()
);
create index if not exists system_config_history_key_idx on public.system_config_history (key, changed_at desc);

alter table public.system_config_history enable row level security;
revoke all on public.system_config_history from anon;
revoke insert, update, delete, truncate on public.system_config_history from authenticated;
grant select on public.system_config_history to authenticated;

drop policy if exists system_config_history_super_read on public.system_config_history;
create policy system_config_history_super_read on public.system_config_history
  for select to authenticated using ((select public.is_super_admin()));

create or replace function public.system_config_stamp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'INSERT' or NEW.value is distinct from OLD.value then
    NEW.updated_by := coalesce(auth.uid(), NEW.updated_by);
    NEW.updated_at := now();
  end if;
  return NEW;
end
$$;
revoke all on function public.system_config_stamp() from public;
revoke all on function public.system_config_stamp() from anon;

create or replace function public.system_config_record_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text := nullif(left(coalesce(current_setting('app.config_reason', true), ''), 500), '');
begin
  if TG_OP = 'INSERT' then
    insert into public.system_config_history(key, action, old_value, new_value, changed_by, reason)
    values (NEW.key, 'insert', null, NEW.value, auth.uid(), v_reason);
    return NEW;
  elsif TG_OP = 'UPDATE' then
    if NEW.value is distinct from OLD.value or NEW.key is distinct from OLD.key then
      insert into public.system_config_history(key, action, old_value, new_value, changed_by, reason)
      values (NEW.key, 'update', OLD.value, NEW.value, auth.uid(), v_reason);
    end if;
    return NEW;
  else
    insert into public.system_config_history(key, action, old_value, new_value, changed_by, reason)
    values (OLD.key, 'delete', OLD.value, null, auth.uid(), v_reason);
    return OLD;
  end if;
end
$$;
revoke all on function public.system_config_record_history() from public;
revoke all on function public.system_config_record_history() from anon;

drop trigger if exists trg_zz_system_config_stamp on public.system_config;
create trigger trg_zz_system_config_stamp
  before insert or update on public.system_config
  for each row execute function public.system_config_stamp();

drop trigger if exists trg_zz_system_config_history on public.system_config;
create trigger trg_zz_system_config_history
  after insert or update or delete on public.system_config
  for each row execute function public.system_config_record_history();

create or replace function public.admin_set_config(p_key text, p_value text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old text;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can change platform settings' using errcode = '42501';
  end if;
  if p_key is null or btrim(p_key) = '' then
    raise exception 'Choose a setting' using errcode = '22023';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'Give a short reason for this change' using errcode = '22023';
  end if;
  select value into v_old from public.system_config where key = p_key;
  perform set_config('app.config_reason', left(btrim(p_reason), 500), true);
  insert into public.system_config(key, value)
  values (p_key, p_value)
  on conflict (key) do update set value = excluded.value;
  return jsonb_build_object('ok', true, 'key', p_key, 'old_value', v_old, 'new_value', p_value);
end
$$;
revoke all on function public.admin_set_config(text, text, text) from public;
revoke all on function public.admin_set_config(text, text, text) from anon;
grant execute on function public.admin_set_config(text, text, text) to authenticated;

-- Trigger functions need no EXECUTE grant (applied as system_config_history_trigger_grants).
revoke execute on function public.system_config_stamp() from authenticated;
revoke execute on function public.system_config_record_history() from authenticated;
