-- =============================================================================
-- 20260924110000_dual_control.sql
-- Four-eyes (dual-control) approval for the most destructive super-admin
-- console actions.
--
-- STATUS: APPLIED LIVE 2026-09-24 (project jhssdmeruxtrlqnwfksc) via Supabase MCP
--         apply_migration as one migration named 'dual_control'.
--         Body below is exactly what was applied.
--
-- WHAT IT DOES
--   1. console_approval_requests: one row per request. RLS on, super-admin
--      SELECT only, NO client write grant; every write goes through the
--      SECURITY DEFINER RPCs below. A CHECK constraint makes the four-eyes rule
--      structural: decided_by can never equal requested_by.
--   2. system_config 'dual_control_enabled' seeded 'false' => the whole feature
--      is INERT until a super admin turns it on. A guard trigger stops the key
--      being flipped by a direct table write (the System Configuration page
--      upserts every key it loaded; an unchanged value still passes).
--   3. RPCs: admin_request_approval / admin_decide_approval /
--      admin_cancel_approval / admin_list_approvals / admin_set_dual_control,
--      plus the internal helpers _approval_canonical, _dual_control_on,
--      _consume_approval (the helpers are NOT executable by any client role).
--   4. Gates (section 7): admin_data_cleanup_run, backup_restore_missing and
--      admin_bulk_set_role each call _consume_approval(action, payload) right
--      after their own validation. When dual control is off the helper returns
--      NULL immediately, so behaviour is byte-for-byte what it was. When on, it
--      needs an approved, unexpired, unexecuted request whose canonical payload
--      matches exactly, made or approved by the caller, and marks it executed
--      in the same transaction (so a failed action leaves the approval unused).
--
-- LOCKOUT SAFETY (the owner must never be locked out)
--   * Default off. Turning it ON is refused unless there are at least two
--     active (approved, unlocked) super admins. At apply time there were 2.
--   * Turning it OFF needs an approved 'dual_control_disable' request, EXCEPT
--     when the caller is the only active super admin left (break-glass), in
--     which case it is allowed and logged.
--   * Only three destructive actions are gated; everything else is unaffected.
--
-- VERIFY (each as an impersonated super admin, in a rolled-back transaction):
--   select set_config('request.jwt.claims',
--     '{"sub":"d2d43a5f-0906-4f7a-9577-e36d89164914","role":"authenticated"}', true);
--   set local role authenticated;
--   -- off: gated fns behave as before; _consume_approval returns null
--   -- on : admin_bulk_set_role(array[...],'Admin') raises hint dual_control_required
--   --      admin_decide_approval(<own request>, true, null) raises 42501
--   --      after the SECOND super admin approves, the same call succeeds and the
--   --      request becomes status executed
--   -- as a non-super: every RPC raises 42501
--
-- ROLLBACK
--   -- 1. strip the gate lines (anchored, idempotent):
--   do $$ declare f text; d text; begin
--     foreach f in array array['admin_data_cleanup_run','backup_restore_missing','admin_bulk_set_role'] loop
--       select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--        where n.nspname='public' and p.proname=f;
--       d := regexp_replace(d, '\s*perform public\._consume_approval\([^;]*\);', '', 'g');
--       execute d;
--     end loop; end $$;
--   -- 2. drop the rest:
--   drop trigger if exists trg_guard_dual_control_config on public.system_config;
--   drop function if exists public.guard_dual_control_config();
--   drop function if exists public.admin_set_dual_control(boolean, text);
--   drop function if exists public.admin_list_approvals(text);
--   drop function if exists public.admin_cancel_approval(uuid);
--   drop function if exists public.admin_decide_approval(uuid, boolean, text);
--   drop function if exists public.admin_request_approval(text, jsonb, text);
--   drop function if exists public._consume_approval(text, jsonb);
--   drop function if exists public._dual_control_on();
--   drop function if exists public._approval_canonical(text, jsonb);
--   drop table if exists public.console_approval_requests;
--   delete from public.system_config where key = 'dual_control_enabled';
-- =============================================================================

-- ── 1. table ─────────────────────────────────────────────────────────────────
create table if not exists public.console_approval_requests (
  id            uuid primary key default gen_random_uuid(),
  action        text not null
                check (action in ('admin_data_cleanup_run','backup_restore_missing',
                                  'admin_bulk_set_role','dual_control_disable')),
  payload       jsonb not null default '{}'::jsonb,
  reason        text not null check (char_length(btrim(reason)) between 5 and 1000),
  requested_by  uuid not null,
  requested_at  timestamptz not null default now(),
  status        text not null default 'pending'
                check (status in ('pending','approved','rejected','executed','expired','cancelled')),
  decided_by    uuid,
  decided_at    timestamptz,
  decision_note text check (decision_note is null or char_length(decision_note) <= 1000),
  executed_at   timestamptz,
  executed_by   uuid,
  expires_at    timestamptz not null default (now() + interval '24 hours'),
  constraint console_approval_four_eyes check (decided_by is null or decided_by <> requested_by)
);

create index if not exists console_approval_requests_status_idx
  on public.console_approval_requests (status, expires_at);
create index if not exists console_approval_requests_action_idx
  on public.console_approval_requests (action, status);
create index if not exists console_approval_requests_requested_at_idx
  on public.console_approval_requests (requested_at desc);

alter table public.console_approval_requests enable row level security;
drop policy if exists console_approval_requests_super_select on public.console_approval_requests;
create policy console_approval_requests_super_select on public.console_approval_requests
  for select to authenticated using ((select public.is_super_admin()));
revoke all on public.console_approval_requests from public, anon, authenticated;
grant select on public.console_approval_requests to authenticated;

-- ── 2. config key + guard ────────────────────────────────────────────────────
create or replace function public.guard_dual_control_config()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_rpc boolean := coalesce(current_setting('app.dual_control_rpc', true), '') = 'on';
        v_cur text;
begin
  if v_rpc then return coalesce(NEW, OLD); end if;
  if TG_OP = 'DELETE' then
    if OLD.key = 'dual_control_enabled' then
      raise exception 'Dual control can only be changed from Console, Approvals.' using errcode = '42501';
    end if;
    return OLD;
  end if;
  if TG_OP = 'INSERT' then
    if NEW.key = 'dual_control_enabled' then
      select value into v_cur from public.system_config where key = 'dual_control_enabled';
      -- an upsert of every loaded key re-sends the unchanged value: allow that
      if v_cur is null or v_cur is distinct from NEW.value then
        raise exception 'Dual control can only be changed from Console, Approvals.' using errcode = '42501';
      end if;
    end if;
    return NEW;
  end if;
  -- UPDATE
  if (OLD.key = 'dual_control_enabled' or NEW.key = 'dual_control_enabled')
     and (NEW.key is distinct from OLD.key or NEW.value is distinct from OLD.value) then
    raise exception 'Dual control can only be changed from Console, Approvals.' using errcode = '42501';
  end if;
  return NEW;
end $$;
revoke all on function public.guard_dual_control_config() from public, anon, authenticated;

drop trigger if exists trg_guard_dual_control_config on public.system_config;
create trigger trg_guard_dual_control_config
  before insert or update or delete on public.system_config
  for each row execute function public.guard_dual_control_config();

select set_config('app.dual_control_rpc', 'on', true);
insert into public.system_config (key, value, category, description)
values ('dual_control_enabled', 'false', 'security',
        'Four-eyes approval for destructive console actions (data cleanup, backup restore, bulk role change). Change it from Console, Approvals.')
on conflict (key) do nothing;
select set_config('app.dual_control_rpc', '', true);

-- ── 3. helpers ───────────────────────────────────────────────────────────────
create or replace function public._dual_control_on()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select lower(btrim(value, ' "')) from public.system_config
                    where key = 'dual_control_enabled'), 'false') = 'true'
$$;

-- One canonical payload per action, so a request and the later execution are
-- compared field for field whatever order or spelling the client used.
create or replace function public._approval_canonical(p_action text, p_payload jsonb)
returns jsonb language plpgsql stable set search_path = public as $$
declare v jsonb := coalesce(p_payload, '{}'::jsonb); v_ids jsonb;
begin
  if p_action = 'admin_data_cleanup_run' then
    if nullif(btrim(v->>'key'), '') is null or nullif(btrim(v->>'before'), '') is null then
      raise exception 'A cleanup approval needs a target and a cutoff date.' using errcode = '22023';
    end if;
    return jsonb_build_object('key', btrim(v->>'key'), 'before', (v->>'before')::date::text);
  elsif p_action = 'backup_restore_missing' then
    if nullif(btrim(v->>'snapshot_id'), '') is null or nullif(btrim(v->>'table'), '') is null then
      raise exception 'A restore approval needs a snapshot and a table.' using errcode = '22023';
    end if;
    return jsonb_build_object('snapshot_id', (v->>'snapshot_id')::uuid::text, 'table', btrim(v->>'table'));
  elsif p_action = 'admin_bulk_set_role' then
    if nullif(btrim(v->>'role'), '') is null or jsonb_typeof(v->'user_ids') is distinct from 'array' then
      raise exception 'A role-change approval needs a role and a list of users.' using errcode = '22023';
    end if;
    select coalesce(jsonb_agg(u order by u), '[]'::jsonb) into v_ids
      from (select distinct lower(e::uuid::text) u from jsonb_array_elements_text(v->'user_ids') e) s;
    if jsonb_array_length(v_ids) = 0 then
      raise exception 'A role-change approval needs at least one user.' using errcode = '22023';
    end if;
    return jsonb_build_object('role', btrim(v->>'role'), 'user_ids', v_ids);
  elsif p_action = 'dual_control_disable' then
    return '{}'::jsonb;
  end if;
  raise exception 'This action cannot be sent for approval.' using errcode = '22023';
end $$;

create or replace function public._consume_approval(p_action text, p_payload jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_canon jsonb; v_id uuid;
begin
  if not public.is_super_admin() then
    raise exception 'Permission denied: super admin required' using errcode = '42501';
  end if;
  if not public._dual_control_on() then
    return null;               -- dual control off: behave exactly as before
  end if;
  v_canon := public._approval_canonical(p_action, p_payload);

  update public.console_approval_requests set status = 'expired'
   where status in ('pending','approved') and expires_at <= now();

  select id into v_id from public.console_approval_requests
   where action = p_action and payload = v_canon and status = 'approved'
     and executed_at is null and expires_at > now()
     and (requested_by = auth.uid() or decided_by = auth.uid())
   order by decided_at
   limit 1
   for update skip locked;

  if v_id is null then
    raise exception 'This action needs a second super admin to approve it first. Request approval in Console, Approvals, then run it again.'
      using errcode = 'P0001', hint = 'dual_control_required';
  end if;

  update public.console_approval_requests
     set status = 'executed', executed_at = now(), executed_by = auth.uid()
   where id = v_id;
  perform public.log_console_event('dual_control_executed', v_id::text, 'console_approval',
                                   jsonb_build_object('action', p_action));
  return v_id;
end $$;

-- ── 4. request / decide / cancel ─────────────────────────────────────────────
create or replace function public.admin_request_approval(p_action text, p_payload jsonb, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_canon jsonb; v_id uuid; v_who text;
begin
  if not public.is_super_admin() then
    raise exception 'Permission denied: super admin required' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Give a reason of at least 5 characters.' using errcode = '22023';
  end if;
  v_canon := public._approval_canonical(p_action, p_payload);
  if p_action = 'dual_control_disable' and not public._dual_control_on() then
    raise exception 'Dual control is already off.' using errcode = '22023';
  end if;

  update public.console_approval_requests set status = 'expired'
   where status in ('pending','approved') and expires_at <= now();
  if exists (select 1 from public.console_approval_requests
              where action = p_action and payload = v_canon and requested_by = auth.uid()
                and status in ('pending','approved') and expires_at > now()) then
    raise exception 'You already have an open request for exactly this action.' using errcode = '22023';
  end if;

  insert into public.console_approval_requests (action, payload, reason, requested_by)
  values (p_action, v_canon, btrim(p_reason), auth.uid())
  returning id into v_id;

  perform public.log_console_event('dual_control_requested', v_id::text, 'console_approval',
                                   jsonb_build_object('action', p_action, 'payload', v_canon));

  select coalesce(full_name, email) into v_who from public.profiles where id = auth.uid();
  begin
    insert into public.notifications (user_id, type, title, body, entity_type, entity_id)
    select p.id, 'security', 'Console action waiting for your approval',
           coalesce(v_who, 'A super admin') || ' asked to run ' || replace(p_action, '_', ' ')
             || '. Reason: ' || left(btrim(p_reason), 200),
           'console_approval', v_id
      from public.profiles p
     where coalesce(p.is_super_admin, false) and coalesce(p.approved, false)
       and not coalesce(p.locked, false) and p.id <> auth.uid();
  exception when others then null;
  end;
  return v_id;
end $$;

create or replace function public.admin_decide_approval(p_id uuid, p_approve boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.console_approval_requests%rowtype;
begin
  if not public.is_super_admin() then
    raise exception 'Permission denied: super admin required' using errcode = '42501';
  end if;
  select * into r from public.console_approval_requests where id = p_id for update;
  if not found then raise exception 'Approval request not found.' using errcode = '22023'; end if;
  if r.requested_by = auth.uid() then
    raise exception 'You cannot decide your own request. A second super admin must do it.' using errcode = '42501';
  end if;
  if r.status <> 'pending' then
    raise exception 'This request has already been %.', r.status using errcode = '22023';
  end if;
  if r.expires_at <= now() then
    update public.console_approval_requests set status = 'expired' where id = p_id;
    return jsonb_build_object('id', p_id, 'status', 'expired');
  end if;
  if not coalesce(p_approve, false) and char_length(btrim(coalesce(p_note, ''))) < 3 then
    raise exception 'Say why you are rejecting it.' using errcode = '22023';
  end if;

  update public.console_approval_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_at = now(),
         decision_note = nullif(btrim(coalesce(p_note, '')), ''),
         -- an approval gives the requester a fresh 24-hour window to run it
         expires_at = case when p_approve then now() + interval '24 hours' else expires_at end
   where id = p_id;

  perform public.log_console_event(
    case when p_approve then 'dual_control_approved' else 'dual_control_rejected' end,
    p_id::text, 'console_approval',
    jsonb_build_object('action', r.action, 'requested_by', r.requested_by, 'note', nullif(btrim(coalesce(p_note, '')), '')));

  begin
    insert into public.notifications (user_id, type, title, body, entity_type, entity_id)
    values (r.requested_by, 'security',
            case when p_approve then 'Your console request was approved' else 'Your console request was rejected' end,
            replace(r.action, '_', ' ') || case when p_approve then ' can now be run for the next 24 hours.'
                                                else '. Note: ' || left(btrim(coalesce(p_note, '')), 200) end,
            'console_approval', p_id);
  exception when others then null;
  end;

  return jsonb_build_object('id', p_id, 'status', case when p_approve then 'approved' else 'rejected' end);
end $$;

create or replace function public.admin_cancel_approval(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.console_approval_requests%rowtype;
begin
  if not public.is_super_admin() then
    raise exception 'Permission denied: super admin required' using errcode = '42501';
  end if;
  select * into r from public.console_approval_requests where id = p_id for update;
  if not found then raise exception 'Approval request not found.' using errcode = '22023'; end if;
  if r.requested_by <> auth.uid() then
    raise exception 'Only the person who asked can cancel a request.' using errcode = '42501';
  end if;
  if r.status not in ('pending','approved') then
    raise exception 'This request is already %.', r.status using errcode = '22023';
  end if;
  update public.console_approval_requests set status = 'cancelled' where id = p_id;
  perform public.log_console_event('dual_control_cancelled', p_id::text, 'console_approval',
                                   jsonb_build_object('action', r.action));
  return jsonb_build_object('id', p_id, 'status', 'cancelled');
end $$;

-- ── 5. list + toggle ─────────────────────────────────────────────────────────
create or replace function public.admin_list_approvals(p_status text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_rows jsonb; v_supers int;
begin
  if not public.is_super_admin() then
    raise exception 'Permission denied: super admin required' using errcode = '42501';
  end if;
  update public.console_approval_requests set status = 'expired'
   where status in ('pending','approved') and expires_at <= now();

  select coalesce(jsonb_agg(to_jsonb(x) order by x.requested_at desc), '[]'::jsonb) into v_rows
    from (
      select a.*, rp.email as requested_by_email, coalesce(rp.full_name, rp.email) as requested_by_name,
             dp.email as decided_by_email, coalesce(dp.full_name, dp.email) as decided_by_name,
             (a.requested_by = auth.uid()) as is_mine
        from public.console_approval_requests a
        left join public.profiles rp on rp.id = a.requested_by
        left join public.profiles dp on dp.id = a.decided_by
       where p_status is null or p_status = '' or a.status = p_status
          or (p_status = 'open' and a.status in ('pending','approved'))
          or (p_status = 'decided' and a.status in ('approved','rejected','executed','expired','cancelled'))
       order by a.requested_at desc
       limit 500
    ) x;

  select count(*) into v_supers from public.profiles
   where coalesce(is_super_admin, false) and coalesce(approved, false) and not coalesce(locked, false);

  return jsonb_build_object('enabled', public._dual_control_on(), 'active_super_admins', v_supers,
                            'me', auth.uid(), 'rows', v_rows);
end $$;

create or replace function public.admin_set_dual_control(p_enabled boolean, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_on boolean := public._dual_control_on(); v_supers int; v_others int; v_breakglass boolean := false;
begin
  if not public.is_super_admin() then
    raise exception 'Permission denied: super admin required' using errcode = '42501';
  end if;
  select count(*) into v_supers from public.profiles
   where coalesce(is_super_admin, false) and coalesce(approved, false) and not coalesce(locked, false);
  select count(*) into v_others from public.profiles
   where coalesce(is_super_admin, false) and coalesce(approved, false) and not coalesce(locked, false)
     and id <> auth.uid();

  if coalesce(p_enabled, false) = v_on then
    return jsonb_build_object('enabled', v_on, 'changed', false);
  end if;

  if p_enabled then
    if v_supers < 2 then
      raise exception 'Dual control needs at least two active super admins. Add a second one first.' using errcode = '22023';
    end if;
  else
    if v_others >= 1 then
      perform public._consume_approval('dual_control_disable', '{}'::jsonb);
    else
      v_breakglass := true;    -- sole remaining super admin: never locked out
    end if;
  end if;

  perform set_config('app.dual_control_rpc', 'on', true);
  insert into public.system_config (key, value, category, description, updated_by, updated_at)
  values ('dual_control_enabled', case when p_enabled then 'true' else 'false' end, 'security',
          'Four-eyes approval for destructive console actions (data cleanup, backup restore, bulk role change). Change it from Console, Approvals.',
          auth.uid(), now())
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
  perform set_config('app.dual_control_rpc', '', true);

  perform public.log_console_event(case when p_enabled then 'dual_control_enabled' else 'dual_control_disabled' end,
    null, 'system_config',
    jsonb_build_object('reason', nullif(btrim(coalesce(p_reason, '')), ''), 'break_glass', v_breakglass,
                       'active_super_admins', v_supers));
  return jsonb_build_object('enabled', p_enabled, 'changed', true, 'break_glass', v_breakglass);
end $$;

-- ── 6. grants (order is load-bearing: PUBLIC, then anon, then authenticated) ─
revoke all on function public._dual_control_on() from public;
revoke all on function public._dual_control_on() from anon, authenticated;
revoke all on function public._approval_canonical(text, jsonb) from public;
revoke all on function public._approval_canonical(text, jsonb) from anon, authenticated;
revoke all on function public._consume_approval(text, jsonb) from public;
revoke all on function public._consume_approval(text, jsonb) from anon, authenticated;

revoke all on function public.admin_request_approval(text, jsonb, text) from public;
revoke all on function public.admin_request_approval(text, jsonb, text) from anon;
grant execute on function public.admin_request_approval(text, jsonb, text) to authenticated;
revoke all on function public.admin_decide_approval(uuid, boolean, text) from public;
revoke all on function public.admin_decide_approval(uuid, boolean, text) from anon;
grant execute on function public.admin_decide_approval(uuid, boolean, text) to authenticated;
revoke all on function public.admin_cancel_approval(uuid) from public;
revoke all on function public.admin_cancel_approval(uuid) from anon;
grant execute on function public.admin_cancel_approval(uuid) to authenticated;
revoke all on function public.admin_list_approvals(text) from public;
revoke all on function public.admin_list_approvals(text) from anon;
grant execute on function public.admin_list_approvals(text) to authenticated;
revoke all on function public.admin_set_dual_control(boolean, text) from public;
revoke all on function public.admin_set_dual_control(boolean, text) from anon;
grant execute on function public.admin_set_dual_control(boolean, text) to authenticated;

-- ── 7. gates: anchored edits of the LIVE definitions ─────────────────────────
do $do$
declare
  g record; d text; n int;
begin
  for g in
    select * from (values
      ('admin_data_cleanup_run',
       $p$(if\s+p_before\s*>\s*current_date\s+then\s+raise\s+exception\s+'cutoff date cannot be in the future'\s*;\s*end\s+if\s*;)$p$,
       $r$\1
  perform public._consume_approval('admin_data_cleanup_run', jsonb_build_object('key', p_key, 'before', p_before));$r$),
      ('backup_restore_missing',
       $p$(if\s+not\s+\(\s*p_table\s*=\s*any\s*\(\s*backups\._core_tables\(\)\s*\)\s*\)\s+then\s+raise\s+exception\s+'Unknown table'\s*;\s*end\s+if\s*;)$p$,
       $r$\1
  PERFORM public._consume_approval('backup_restore_missing', jsonb_build_object('snapshot_id', p_snapshot_id, 'table', p_table));$r$),
      ('admin_bulk_set_role',
       $p$(if\s+p_user_ids\s+is\s+null\s+then\s+return\s+0\s*;\s*end\s+if\s*;)$p$,
       $r$\1
  PERFORM public._consume_approval('admin_bulk_set_role', jsonb_build_object('role', p_role, 'user_ids', to_jsonb(p_user_ids)));$r$)
    ) t(fn, pat, rep)
  loop
    select pg_get_functiondef(p.oid) into d
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = g.fn;
    if d is null then
      raise notice 'skip %: function does not exist', g.fn;
      continue;
    end if;
    if d ilike '%_consume_approval%' then
      raise notice 'skip %: already gated', g.fn;
      continue;
    end if;
    select count(*) into n from regexp_matches(d, g.pat, 'gi');
    if n <> 1 then
      raise exception 'anchor for % matched % times (expected exactly 1) - aborting', g.fn, n;
    end if;
    d := regexp_replace(d, g.pat, g.rep, 'i');
    execute d;
  end loop;
end $do$;
