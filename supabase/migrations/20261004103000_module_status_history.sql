-- Module Control: record who took a module out of service, when, and why.
--
-- Before this, modules.updated_by was only the insert default (one seeding
-- account on all 194 rows) and a status change wrote no history at all, so the
-- console could not answer "who switched this off".
--
-- Additive:
--   * public.module_status_history (append-only; Admin and super admin read)
--   * BEFORE UPDATE trigger stamps updated_by = auth.uid() (when a person is
--     signed in) and last_updated = now() when status or the maintenance
--     window changes
--   * AFTER UPDATE trigger appends one history row per real change; the reason
--     comes from the transaction setting app.module_reason (set by the RPC)
--   * admin_set_module_status(ids, status, until, note, reason): super-admin
--     write that carries a reason. Max 500 modules per call.
-- Existing writers (direct table updates, the scheduled flag_changes cron) are
-- unchanged; their rows are recorded with no reason.
--
-- Rollback:
--   drop trigger if exists trg_zz_modules_stamp on public.modules;
--   drop trigger if exists trg_zz_modules_history on public.modules;
--   drop function if exists public.modules_stamp();
--   drop function if exists public.modules_record_history();
--   drop function if exists public.admin_set_module_status(text[], text, timestamptz, text, text);
--   drop table if exists public.module_status_history;

create table if not exists public.module_status_history (
  id          uuid primary key default gen_random_uuid(),
  module_id   text not null,
  old_status  text,
  new_status  text,
  old_until   timestamptz,
  new_until   timestamptz,
  note        text,
  changed_by  uuid,
  reason      text check (reason is null or length(reason) <= 500),
  changed_at  timestamptz not null default now()
);
create index if not exists module_status_history_module_idx on public.module_status_history (module_id, changed_at desc);
create index if not exists module_status_history_at_idx on public.module_status_history (changed_at desc);

alter table public.module_status_history enable row level security;
revoke all on public.module_status_history from anon;
revoke insert, update, delete, truncate on public.module_status_history from authenticated;
grant select on public.module_status_history to authenticated;

drop policy if exists module_status_history_admin_read on public.module_status_history;
create policy module_status_history_admin_read on public.module_status_history
  for select to authenticated
  using ((select public.is_super_admin()) or (select public.get_my_role()) = 'Admin');

create or replace function public.modules_stamp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.status is distinct from OLD.status
     or NEW.maintenance_until is distinct from OLD.maintenance_until
     or NEW.maintenance_note is distinct from OLD.maintenance_note then
    NEW.updated_by := coalesce(auth.uid(), NEW.updated_by);
    NEW.last_updated := now();
  end if;
  return NEW;
end
$$;
revoke all on function public.modules_stamp() from public;
revoke all on function public.modules_stamp() from anon;
revoke execute on function public.modules_stamp() from authenticated;

create or replace function public.modules_record_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text := nullif(left(coalesce(current_setting('app.module_reason', true), ''), 500), '');
begin
  if NEW.status is distinct from OLD.status or NEW.maintenance_until is distinct from OLD.maintenance_until then
    insert into public.module_status_history(module_id, old_status, new_status, old_until, new_until, note, changed_by, reason)
    values (NEW.module_id, OLD.status, NEW.status, OLD.maintenance_until, NEW.maintenance_until, NEW.maintenance_note, auth.uid(), v_reason);
  end if;
  return NEW;
end
$$;
revoke all on function public.modules_record_history() from public;
revoke all on function public.modules_record_history() from anon;
revoke execute on function public.modules_record_history() from authenticated;

drop trigger if exists trg_zz_modules_stamp on public.modules;
create trigger trg_zz_modules_stamp
  before update on public.modules
  for each row execute function public.modules_stamp();

drop trigger if exists trg_zz_modules_history on public.modules;
create trigger trg_zz_modules_history
  after update on public.modules
  for each row execute function public.modules_record_history();

create or replace function public.admin_set_module_status(
  p_ids text[], p_status text, p_until timestamptz, p_note text, p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
  v_maint boolean := p_status = 'maintenance';
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can change module status' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('live', 'maintenance', 'disabled', 'beta') then
    raise exception 'Choose Live, Maintenance or Off' using errcode = '22023';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    raise exception 'Choose at least one module' using errcode = '22023';
  end if;
  if cardinality(p_ids) > 500 then
    raise exception 'At most 500 modules at a time' using errcode = '22023';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'Give a short reason for this change' using errcode = '22023';
  end if;
  perform set_config('app.module_reason', left(btrim(p_reason), 500), true);
  update public.modules
     set status = p_status,
         maintenance_until = case when v_maint then p_until else null end,
         maintenance_note = case when v_maint then nullif(left(btrim(coalesce(p_note, '')), 200), '') else null end
   where module_id = any(p_ids);
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'updated', v_n, 'status', p_status);
end
$$;
revoke all on function public.admin_set_module_status(text[], text, timestamptz, text, text) from public;
revoke all on function public.admin_set_module_status(text[], text, timestamptz, text, text) from anon;
grant execute on function public.admin_set_module_status(text[], text, timestamptz, text, text) to authenticated;
