-- =====================================================================================================
-- 20261117120000_error_center_status_history.sql
-- STATUS: APPLIED to production 2026-11-17 (owner approved). Recorded in the ledger as `error_center_status_history`.
-- Applied with the DROP ... IF EXISTS lines omitted (none of these objects existed). Verified after: audit logs and
-- business records byte-identical to the pre-apply baseline; permissions and recurrence checked as real roles, rolled back.
-- Backup of the 4 replaced functions and the triage table: _bak.err_center_20261117_fn, _bak.err_center_20261117_state.
--
-- WHY
--   System Health's Resolve button and its CSV/Excel export used system_logs.resolved. system_logs is
--   immutable (prevent_audit_mutation_trigger raises 42501 on any UPDATE/DELETE), so Resolve always
--   failed and every export row said "Open", even for errors the Error Center had triaged.
--   The Error Center already keeps triage per error GROUP in error_group_state. This migration makes
--   that table the single source of status, without touching a single system_logs row.
--
-- WHAT
--   1. error_group_state.last_reason (reason that goes with the current status).
--   2. error_group_state_events: append-only history of every status change (from, to, actor,
--      reason, source, at). Super-admin read only, no client writes, immutable.
--   3. Trigger on error_group_state writes one event per status change. Every writer is covered,
--      including the regression trigger.
--   4. set_error_group_state / resolve_error_groups store the reason in last_reason.
--   5. Regression: a resolved or fixed_in_code group that recurs goes back to for_review AND its
--      resolved_at / notified_at are cleared, so it is never left looking resolved, and the next fix
--      can notify again. ignored and routine stay as set (a deliberate "not a problem" decision).
--   6. Read RPCs with the effective status per log: list_system_logs_with_status, system_log_open_counts.
--   7. resolve_system_log_groups(p_log_ids, p_module, p_severity, p_reason) resolves the GROUPS behind
--      logs; resolve_system_logs (same signature, same int return) now delegates to it.
--
-- SAFETY
--   * Aborts unless the four live function bodies are exactly the ones this file was written against.
--   * No row of system_logs is updated or deleted. No existing error_group_state row changes status.
--   * Status meaning: no state row or for_review / reviewed = open; fixed_in_code / resolved / ignored /
--     routine = closed. Mirrored in src/lib/errorStatus.js - change both together.
-- ROLLBACK: 20261117120000_error_center_status_history_ROLLBACK.sql
-- =====================================================================================================

begin;

do $guard$
declare r record;
begin
  for r in
    select * from (values
      ('set_error_group_state',  '42fa2d7c7357765557b4f98e0b5cd44a'),
      ('resolve_error_groups',   '5c262e9cbff74eac2fca4998d24c3b25'),
      ('error_group_regression', '61f89efa4daa963b8fe9dd3923154773'),
      ('resolve_system_logs',    'd7c8fb4591ac099b6cc45081593e0291')) v(fn, md)
  loop
    if (select md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = r.fn) is distinct from r.md then
      raise exception 'Live definition of % changed since this migration was written; re-check before applying', r.fn;
    end if;
  end loop;
end
$guard$;

-- 1. reason column ------------------------------------------------------------------------------------
alter table public.error_group_state add column if not exists last_reason text;

-- 2. history table ------------------------------------------------------------------------------------
create table if not exists public.error_group_state_events (
  id          bigserial primary key,
  group_key   text        not null,
  from_status text,
  to_status   text        not null,
  actor_id    uuid,
  reason      text,
  source      text        not null default 'console',
  at          timestamptz not null default now()
);
create index if not exists error_group_state_events_key_at on public.error_group_state_events (group_key, at desc);

alter table public.error_group_state_events enable row level security;
drop policy if exists error_group_state_events_read on public.error_group_state_events;
create policy error_group_state_events_read on public.error_group_state_events
  for select to authenticated using ((select public.is_super_admin()));
revoke all on public.error_group_state_events from anon, authenticated;
grant select on public.error_group_state_events to authenticated;
revoke all on sequence public.error_group_state_events_id_seq from anon, authenticated;

drop trigger if exists error_group_state_events_immutable on public.error_group_state_events;
create trigger error_group_state_events_immutable
  before update or delete on public.error_group_state_events
  for each row execute function public.prevent_audit_mutation();

-- 3. history writer -----------------------------------------------------------------------------------
create or replace function public.log_error_group_state_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.error_group_state_events (group_key, from_status, to_status, actor_id, reason, source)
    values (new.group_key,
            case when tg_op = 'UPDATE' then old.status end,
            new.status,
            new.updated_by,
            left(new.last_reason, 500),
            coalesce(nullif(current_setting('tp.error_status_source', true), ''), 'console'));
  end if;
  return null;
end;
$$;
revoke all on function public.log_error_group_state_change() from public, anon, authenticated;

drop trigger if exists trg_error_group_state_history on public.error_group_state;
create trigger trg_error_group_state_history
  after insert or update on public.error_group_state
  for each row execute function public.log_error_group_state_change();

-- 4a. set_error_group_state: store the reason ---------------------------------------------------------
create or replace function public.set_error_group_state(p_key text, p_status text default null, p_owner uuid default null,
  p_version text default null, p_note text default null, p_notify boolean default null, p_reason text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_old public.error_group_state;
  v_status text;
  v_notified int := 0;
begin
  if not public._console_ip_allowed() then
    raise exception 'Console access is not allowed from this network' using errcode = '42501';
  end if;
  if not public.is_super_admin() then
    raise exception 'Only a super admin can triage errors' using errcode = '42501';
  end if;
  if nullif(btrim(p_key), '') is null then
    raise exception 'Choose an error group first' using errcode = '22023';
  end if;
  if p_status is not null and p_status not in ('for_review','reviewed','fixed_in_code','resolved','ignored','routine') then
    raise exception 'That status is not recognised' using errcode = '22023';
  end if;
  if p_status in ('resolved','ignored') and length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'A reason is required to resolve or ignore an error group' using errcode = '22023';
  end if;

  select * into v_old from public.error_group_state where group_key = p_key;
  v_status := coalesce(p_status, v_old.status, 'for_review');
  if p_owner is not null and p_status is null and v_status = 'for_review' then v_status := 'reviewed'; end if;

  insert into public.error_group_state as s (group_key, status, owner_id, resolved_in_version, note, notify_when_fixed,
                                             resolved_at, updated_at, updated_by, last_reason)
  values (p_key, v_status, p_owner, nullif(btrim(p_version), ''), nullif(btrim(p_note), ''), coalesce(p_notify, false),
          case when v_status = 'resolved' then now() end, now(), auth.uid(), nullif(left(btrim(p_reason), 500), ''))
  on conflict (group_key) do update set
    status = v_status,
    owner_id = coalesce(p_owner, s.owner_id),
    resolved_in_version = coalesce(nullif(btrim(p_version), ''), s.resolved_in_version),
    note = coalesce(nullif(btrim(p_note), ''), s.note),
    notify_when_fixed = coalesce(p_notify, s.notify_when_fixed),
    resolved_at = case when v_status = 'resolved' then now() when v_status in ('for_review','reviewed') then null else s.resolved_at end,
    last_reason = case when v_status is distinct from s.status then nullif(left(btrim(p_reason), 500), '')
                       else coalesce(nullif(left(btrim(p_reason), 500), ''), s.last_reason) end,
    updated_at = now(), updated_by = auth.uid();

  if v_status = 'resolved' and coalesce(p_notify, v_old.notify_when_fixed, false)
     and (v_old.notified_at is null) then
    insert into public.notifications (user_id, type, title, body, entity_type)
    select distinct l.user_id, 'system', 'A problem you hit has been fixed',
      'An error you ran into has been fixed' ||
        coalesce(' in version ' || nullif(btrim(coalesce(p_version, v_old.resolved_in_version)), ''), '') ||
        '. Reload the app to get the fix.',
      'error_group'
    from public.system_logs l
    where l.user_id is not null
      and public.system_log_group_key(l.source, l.message, l.error_fingerprint) = p_key;
    get diagnostics v_notified = row_count;
    update public.error_group_state set notified_at = now() where group_key = p_key;
  end if;

  perform public.log_console_event('error_group_state', null, 'error_group',
    jsonb_build_object('group_key', left(p_key, 300), 'from', v_old.status, 'to', v_status,
      'owner_id', p_owner, 'version', p_version, 'notify', p_notify, 'reason', p_reason, 'notified', v_notified));

  return jsonb_build_object('ok', true, 'status', v_status, 'notified', v_notified);
end;
$function$;

-- 4b. resolve_error_groups: store the reason ----------------------------------------------------------
create or replace function public.resolve_error_groups(p_keys text[], p_reason text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_n int := 0;
begin
  if not public._console_ip_allowed() then
    raise exception 'Console access is not allowed from this network' using errcode = '42501';
  end if;
  if not public.is_super_admin() then
    raise exception 'Only a super admin can resolve errors' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'A reason is required to resolve error groups' using errcode = '22023';
  end if;
  if p_keys is null or cardinality(p_keys) = 0 then
    return jsonb_build_object('ok', true, 'resolved', 0);
  end if;
  if cardinality(p_keys) > 500 then
    raise exception 'Resolve at most 500 groups at a time' using errcode = '22023';
  end if;

  insert into public.error_group_state as s (group_key, status, note, resolved_at, updated_at, updated_by, last_reason)
  select distinct k, 'resolved', left(p_reason, 500), now(), now(), auth.uid(), left(btrim(p_reason), 500)
  from unnest(p_keys) k where nullif(btrim(k), '') is not null
  on conflict (group_key) do update set status = 'resolved', note = left(p_reason, 500),
    resolved_at = now(), updated_at = now(), updated_by = auth.uid(), last_reason = left(btrim(p_reason), 500);
  get diagnostics v_n = row_count;

  perform public.log_console_event('error_groups_resolve', null, 'error_group',
    jsonb_build_object('count', v_n, 'reason', p_reason));
  return jsonb_build_object('ok', true, 'resolved', v_n);
end;
$function$;

-- 5. regression: reopen fully -------------------------------------------------------------------------
create or replace function public.error_group_regression()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  begin
    perform set_config('tp.error_status_source', 'regression', true);
    update public.error_group_state
       set status = 'for_review', regressed_at = now(), updated_at = now(),
           resolved_at = null, notified_at = null, updated_by = null,
           last_reason = 'Recurred after it was closed',
           note = left(coalesce(note || ' | ', '') || 'Came back after it was closed', 500)
     where group_key = public.system_log_group_key(new.source, new.message, new.error_fingerprint)
       and status in ('resolved', 'fixed_in_code')
       and coalesce(resolved_at, updated_at) < new.created_at;
    perform set_config('tp.error_status_source', '', true);
  exception when others then
    null;
  end;
  return null;
end;
$function$;

-- 6. effective status readers -------------------------------------------------------------------------
-- Status of one group, for callers who may read system logs. Returns only the status word.
create or replace function public.error_group_status(p_key text)
returns text language sql stable security definer set search_path = public as $$
  select case
    when not (public.is_super_admin() or public.app_is_elevated()) then null
    else coalesce((select s.status from public.error_group_state s where s.group_key = p_key), 'for_review')
  end
$$;
revoke all on function public.error_group_status(text) from public, anon;
grant execute on function public.error_group_status(text) to authenticated;

-- Logs with their group key and effective status. SECURITY INVOKER: system_logs RLS decides which
-- rows the caller sees, exactly as the old direct table read did.
create or replace function public.list_system_logs_with_status(
  p_severity text default null, p_module text default null, p_status text default null,
  p_since timestamptz default null, p_limit int default 200)
returns table (
  id uuid, organisation_id uuid, module_id text, severity text, source text, message text, detail jsonb,
  reference_id text, url text, user_id uuid, user_email text, created_at timestamptz,
  group_key text, group_status text, is_open boolean)
language sql stable security invoker set search_path = public as $$
  with l as (
    select s.*, public.system_log_group_key(s.source, s.message, s.error_fingerprint) as gk
    from public.system_logs s
    where (p_severity is null or s.severity = p_severity)
      and (p_module is null or s.module_id = p_module)
      and (p_since is null or s.created_at >= p_since)
  ), x as (
    select l.*, coalesce(public.error_group_status(l.gk), 'for_review') as st from l
  )
  select x.id, x.organisation_id, x.module_id, x.severity, x.source, x.message, x.detail,
         x.reference_id, x.url, x.user_id, x.user_email, x.created_at,
         x.gk, x.st, x.st in ('for_review', 'reviewed')
  from x
  where p_status is null
     or (p_status = 'open' and x.st in ('for_review', 'reviewed'))
     or (p_status = 'closed' and x.st not in ('for_review', 'reviewed'))
  order by x.created_at desc
  limit least(greatest(coalesce(p_limit, 200), 1), 1000)
$$;
revoke all on function public.list_system_logs_with_status(text, text, text, timestamptz, int) from public, anon;
grant execute on function public.list_system_logs_with_status(text, text, text, timestamptz, int) to authenticated;

-- Open counts by severity (for the System Health tiles).
create or replace function public.system_log_open_counts(p_since timestamptz default null)
returns jsonb language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_object_agg(severity, n), '{}'::jsonb) from (
    select s.severity, count(*) as n
    from public.system_logs s
    where (p_since is null or s.created_at >= p_since)
      and coalesce(public.error_group_status(public.system_log_group_key(s.source, s.message, s.error_fingerprint)), 'for_review')
          in ('for_review', 'reviewed')
    group by s.severity
  ) t
$$;
revoke all on function public.system_log_open_counts(timestamptz) from public, anon;
grant execute on function public.system_log_open_counts(timestamptz) to authenticated;

-- 7. resolve by log ------------------------------------------------------------------------------------
create or replace function public.resolve_system_log_groups(
  p_log_ids uuid[] default null, p_module text default null, p_severity text default null, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.app_current_org();
  v_keys text[];
begin
  if not public._console_ip_allowed() then
    raise exception 'Console access is not allowed from this network' using errcode = '42501';
  end if;
  if not public.is_super_admin() then
    raise exception 'Only a super admin can resolve errors' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'A reason is required to resolve errors' using errcode = '22023';
  end if;

  select array_agg(distinct k) into v_keys
  from (
    select public.system_log_group_key(l.source, l.message, l.error_fingerprint) as k
    from public.system_logs l
    where case when p_log_ids is not null then l.id = any (p_log_ids)
               else (l.organisation_id is not distinct from v_org
                     and (p_module is null or l.module_id = p_module)
                     and (p_severity is null or l.severity = p_severity)) end
  ) q
  where k is not null
    and coalesce((select s.status from public.error_group_state s where s.group_key = q.k), 'for_review')
        in ('for_review', 'reviewed');

  if v_keys is null then
    return jsonb_build_object('ok', true, 'resolved', 0);
  end if;
  return public.resolve_error_groups(v_keys[1:500], p_reason);
end;
$$;
revoke all on function public.resolve_system_log_groups(uuid[], text, text, text) from public, anon;
grant execute on function public.resolve_system_log_groups(uuid[], text, text, text) to authenticated;

-- Same signature and return type as before, so old clients keep working. It no longer tries to
-- update the immutable log table; it resolves the matching open groups instead.
create or replace function public.resolve_system_logs(p_module text default null, p_severity text default null)
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare v_res jsonb;
begin
  v_res := public.resolve_system_log_groups(null, p_module, p_severity, 'Resolved from System Health');
  return coalesce((v_res ->> 'resolved')::int, 0);
end; $function$;

select anum_integration.apply_reader_policies();

commit;
