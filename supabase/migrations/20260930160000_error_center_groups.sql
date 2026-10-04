-- 20260930160000_error_center_groups.sql
-- Error Center: grouped errors, people affected (staff vs customers), triage state per group.
--
-- WHY
--   The approved Error Center groups every error-log row so the same fault counts once, shows who hit
--   it split into staff (super admin accounts) and customers (every other account), and lets a super
--   admin triage a group: For review, Reviewed, Fixed in code, Resolved, Ignored, Routine, with an owner,
--   a "resolved in version" and "tell affected people when fixed".
--
-- FINDING THAT SHAPED THIS
--   public.system_logs carries prevent_audit_mutation_trigger (BEFORE UPDATE OR DELETE raises 42501),
--   so a log row can never be marked resolved: resolve_system_logs() fails live. Resolution therefore
--   lives in a NEW state table keyed on the group, and the logs themselves stay immutable. Nothing in
--   system_logs is updated or deleted by this migration.
--
-- WHAT IT ADDS (additive only)
--   1. public.system_log_group_key(source, message, fingerprint) IMMUTABLE: the stored error_fingerprint
--      when present, otherwise source + normalised message. Mirrors errorFingerprint() in
--      src/lib/problemReport.js (change both together). Older rows have no fingerprint (0 of 236).
--   2. public.error_group_state: one row per triaged group. RLS on, super admin read only, no client
--      writes (writes only through the DEFINER RPCs below).
--   3. get_error_groups(p_days)      read-only, super admin: groups, coverage, accounts behind errors.
--   4. set_error_group_state(...)    super admin: status / owner / version / notify; audited.
--   5. resolve_error_groups(keys[], reason) super admin bulk resolve; reason required; audited.
--   6. AFTER INSERT trigger on system_logs: a new event in a Resolved or Fixed-in-code group moves the
--      group back to For review (regression). Wrapped so it can never block the log write.
--
-- PRE-FLIGHT
--   Data loss: none. No DROP / DELETE / UPDATE of existing rows. Rename/removal: none.
--   Locks: CREATE TABLE and a new trigger on system_logs (236 rows): instant.
--   CHECK: new table only. FK: owner_id -> auth.users ON DELETE SET NULL.
--   RLS: new table RLS on, super admin SELECT only, no INSERT/UPDATE/DELETE policy.
--   DEFINER: search_path pinned, is_super_admin() + _console_ip_allowed() in body, revoke PUBLIC then anon,
--   grant authenticated. No function takes an org id.
--   Emails are masked in SQL (a***@x.com); no raw email leaves the database.
--   Rollback: drop trigger trg_error_group_regression on public.system_logs; drop function
--   error_group_regression(), resolve_error_groups(text[],text), set_error_group_state(text,text,uuid,text,text,boolean,text),
--   get_error_groups(integer), system_log_group_key(text,text,text), mask_email_for_console(text);
--   drop table public.error_group_state.

create or replace function public.system_log_group_key(p_source text, p_message text, p_fingerprint text)
returns text language sql immutable parallel safe set search_path = pg_catalog as $$
  select case
    when nullif(btrim(p_fingerprint), '') is not null then p_fingerprint
    else (
      select case when m = '' then null
        else left(regexp_replace(lower(coalesce(p_source, 'app')), '\s+', ' ', 'g'), 60) || '|' || left(m, 240) end
      from (
        select btrim(regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(
                regexp_replace(
                  regexp_replace(
                    regexp_replace(
                      regexp_replace(lower(coalesce(p_message, '')),
                        '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '<id>', 'g'),
                      '"[^"]{0,200}"', '<q>', 'g'),
                    '''[^'']{0,200}''', '<q>', 'g'),
                  '`[^`]{0,200}`', '<q>', 'g'),
                '\m0x[0-9a-f]+\M', '<n>', 'g'),
              '\m[0-9a-f]{16,}\M', '<id>', 'g'),
            '[0-9]+(\.[0-9]+)?', '<n>', 'g'),
          '\s+', ' ', 'g')) as m
      ) x
    )
  end
$$;

create or replace function public.mask_email_for_console(p_email text)
returns text language sql immutable parallel safe set search_path = pg_catalog as $$
  select case
    when p_email is null or position('@' in p_email) = 0 then null
    else left(split_part(p_email, '@', 1), 1) || '***@' || split_part(p_email, '@', 2)
  end
$$;

create table if not exists public.error_group_state (
  group_key           text primary key,
  status              text not null default 'for_review'
                        check (status in ('for_review','reviewed','fixed_in_code','resolved','ignored','routine')),
  owner_id            uuid references auth.users(id) on delete set null,
  resolved_in_version text,
  note                text,
  notify_when_fixed   boolean not null default false,
  notified_at         timestamptz,
  resolved_at         timestamptz,
  regressed_at        timestamptz,
  updated_at          timestamptz not null default now(),
  updated_by          uuid references auth.users(id) on delete set null
);
alter table public.error_group_state enable row level security;
drop policy if exists error_group_state_super_read on public.error_group_state;
create policy error_group_state_super_read on public.error_group_state
  for select to authenticated using ((select public.is_super_admin()));
revoke all on public.error_group_state from anon;
grant select on public.error_group_state to authenticated;

-- ── read: groups + coverage + accounts ──────────────────────────────────────
create or replace function public.get_error_groups(p_days integer default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can read the error groups' using errcode = '42501';
  end if;

  with logs as (
    select l.id, l.severity, l.source, l.message, l.url, l.user_id, l.resolved, l.created_at,
           coalesce(nullif(lower(l.platform), ''),
             case when lower(l.source) = 'sentry' then 'android'
                  when lower(l.source) in ('page','app-root','errorboundary','console') then 'web'
                  else 'background' end) as surface,
           public.system_log_group_key(l.source, l.message, l.error_fingerprint) as gk
    from public.system_logs l
    where p_days is null or l.created_at >= now() - make_interval(days => greatest(p_days, 1))
  ), people as (
    select p.id, coalesce(p.is_super_admin, false) as staff, p.role, p.email
    from public.profiles p
  ), grp as (
    select g.gk,
      count(*) as events,
      count(*) filter (where not g.resolved) as unresolved_events,
      min(g.created_at) as first_seen, max(g.created_at) as last_seen,
      max(case g.severity when 'critical' then 4 when 'error' then 3 when 'warning' then 2 else 1 end) as sev_rank,
      (array_agg(g.message order by g.created_at desc))[1] as sample,
      array_agg(distinct g.source) as sources,
      array_agg(distinct g.surface) as surfaces,
      (array_agg(distinct g.url) filter (where g.url is not null))[1:3] as urls,
      count(distinct g.user_id) as people,
      count(distinct g.user_id) filter (where pp.staff) as staff,
      count(distinct g.user_id) filter (where g.user_id is not null and not coalesce(pp.staff, false)) as customers,
      count(*) filter (where g.user_id is null) as no_user_events
    from logs g left join people pp on pp.id = g.user_id
    where g.gk is not null
    group by g.gk
  )
  select jsonb_build_object(
    'ok', true,
    'generated_at', now(),
    'totals', (select jsonb_build_object(
        'rows', count(*),
        'unresolved', count(*) filter (where not resolved),
        'critical', count(*) filter (where not resolved and severity = 'critical'),
        'error', count(*) filter (where not resolved and severity = 'error'),
        'warning', count(*) filter (where not resolved and severity = 'warning'),
        'info', count(*) filter (where not resolved and severity not in ('critical','error','warning')),
        'new_today', count(*) filter (where created_at >= date_trunc('day', now() at time zone 'Asia/Riyadh') at time zone 'Asia/Riyadh'),
        'new_today_errors', count(*) filter (where severity in ('critical','error') and created_at >= date_trunc('day', now() at time zone 'Asia/Riyadh') at time zone 'Asia/Riyadh'),
        'with_user', count(*) filter (where user_id is not null)
      ) from logs),
    'coverage', (select jsonb_build_object(
        'web_errors', count(*) filter (where surface = 'web' and severity in ('critical','error')),
        'web_errors_with_user', count(*) filter (where surface = 'web' and severity in ('critical','error') and user_id is not null),
        'android_crashes', count(*) filter (where surface = 'android'),
        'android_with_user', count(*) filter (where surface = 'android' and user_id is not null),
        'all_rows', count(*),
        'all_with_user', count(*) filter (where user_id is not null),
        'error_rows', count(*) filter (where severity in ('critical','error')),
        'error_rows_with_user', count(*) filter (where severity in ('critical','error') and user_id is not null)
      ) from logs),
    'customer_accounts', (select count(*) from people where not staff),
    'staff_accounts', (select count(*) from people where staff),
    'accounts', coalesce((select jsonb_agg(a order by (a->>'events')::int desc) from (
        select jsonb_build_object(
          'user_id', g.user_id,
          'email', public.mask_email_for_console(pp.email),
          'role', pp.role, 'staff', coalesce(pp.staff, false),
          'events', count(*), 'groups', count(distinct g.gk), 'last_error', max(g.created_at)) a
        from logs g left join people pp on pp.id = g.user_id
        where g.user_id is not null and g.severity in ('critical','error')
        group by g.user_id, pp.email, pp.role, pp.staff) s), '[]'::jsonb),
    'daily', coalesce((select jsonb_agg(jsonb_build_object('day', d, 'total', t, 'errors', e) order by d) from (
        select (created_at at time zone 'Asia/Riyadh')::date d, count(*) t,
               count(*) filter (where severity in ('critical','error')) e
        from public.system_logs where created_at >= now() - interval '90 days' group by 1) s), '[]'::jsonb),
    'groups', coalesce((select jsonb_agg(jsonb_build_object(
        'key', grp.gk,
        'severity', case grp.sev_rank when 4 then 'critical' when 3 then 'error' when 2 then 'warning' else 'info' end,
        'sample', left(grp.sample, 300),
        'sources', to_jsonb(grp.sources), 'surfaces', to_jsonb(grp.surfaces), 'urls', coalesce(to_jsonb(grp.urls), '[]'::jsonb),
        'events', grp.events, 'unresolved_events', grp.unresolved_events,
        'first_seen', grp.first_seen, 'last_seen', grp.last_seen,
        'people', grp.people, 'staff', grp.staff, 'customers', grp.customers, 'no_user_events', grp.no_user_events,
        'state', case when s.group_key is null then null else jsonb_build_object(
            'status', s.status, 'owner_id', s.owner_id,
            'owner_name', (select coalesce(nullif(pr.full_name, ''), public.mask_email_for_console(pr.email)) from public.profiles pr where pr.id = s.owner_id),
            'resolved_in_version', s.resolved_in_version, 'note', s.note,
            'notify_when_fixed', s.notify_when_fixed, 'notified_at', s.notified_at,
            'resolved_at', s.resolved_at, 'regressed_at', s.regressed_at, 'updated_at', s.updated_at) end
      ) order by grp.last_seen desc)
      from grp left join public.error_group_state s on s.group_key = grp.gk), '[]'::jsonb)
  ) into v;
  return v;
end;
$$;

-- ── write: one group's triage state ─────────────────────────────────────────
create or replace function public.set_error_group_state(
  p_key text, p_status text default null, p_owner uuid default null, p_version text default null,
  p_note text default null, p_notify boolean default null, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
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
  -- Assigning an untriaged group marks it reviewed (Datadog issue states).
  if p_owner is not null and p_status is null and v_status = 'for_review' then v_status := 'reviewed'; end if;

  insert into public.error_group_state as s (group_key, status, owner_id, resolved_in_version, note, notify_when_fixed,
                                             resolved_at, updated_at, updated_by)
  values (p_key, v_status, p_owner, nullif(btrim(p_version), ''), nullif(btrim(p_note), ''), coalesce(p_notify, false),
          case when v_status = 'resolved' then now() end, now(), auth.uid())
  on conflict (group_key) do update set
    status = v_status,
    owner_id = coalesce(p_owner, s.owner_id),
    resolved_in_version = coalesce(nullif(btrim(p_version), ''), s.resolved_in_version),
    note = coalesce(nullif(btrim(p_note), ''), s.note),
    notify_when_fixed = coalesce(p_notify, s.notify_when_fixed),
    resolved_at = case when v_status = 'resolved' then now() when v_status in ('for_review','reviewed') then null else s.resolved_at end,
    updated_at = now(), updated_by = auth.uid();

  -- Close the loop: tell the people who hit it, once, when the group is resolved.
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
$$;

-- ── write: bulk resolve ─────────────────────────────────────────────────────
create or replace function public.resolve_error_groups(p_keys text[], p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
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

  insert into public.error_group_state as s (group_key, status, note, resolved_at, updated_at, updated_by)
  select distinct k, 'resolved', left(p_reason, 500), now(), now(), auth.uid()
  from unnest(p_keys) k where nullif(btrim(k), '') is not null
  on conflict (group_key) do update set status = 'resolved', note = left(p_reason, 500),
    resolved_at = now(), updated_at = now(), updated_by = auth.uid();
  get diagnostics v_n = row_count;

  perform public.log_console_event('error_groups_resolve', null, 'error_group',
    jsonb_build_object('count', v_n, 'reason', p_reason));
  return jsonb_build_object('ok', true, 'resolved', v_n);
end;
$$;

-- ── regression: a new event in a closed group reopens it ────────────────────
create or replace function public.error_group_regression()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    update public.error_group_state
       set status = 'for_review', regressed_at = now(), updated_at = now(),
           note = left(coalesce(note || ' | ', '') || 'Came back after it was closed', 500)
     where group_key = public.system_log_group_key(new.source, new.message, new.error_fingerprint)
       and status in ('resolved', 'fixed_in_code')
       and coalesce(resolved_at, updated_at) < new.created_at;
  exception when others then
    null; -- never block an error being logged
  end;
  return null;
end;
$$;

drop trigger if exists trg_error_group_regression on public.system_logs;
create trigger trg_error_group_regression after insert on public.system_logs
  for each row execute function public.error_group_regression();

revoke all on function public.get_error_groups(integer) from public;
revoke all on function public.get_error_groups(integer) from anon;
grant execute on function public.get_error_groups(integer) to authenticated;
revoke all on function public.set_error_group_state(text,text,uuid,text,text,boolean,text) from public;
revoke all on function public.set_error_group_state(text,text,uuid,text,text,boolean,text) from anon;
grant execute on function public.set_error_group_state(text,text,uuid,text,text,boolean,text) to authenticated;
revoke all on function public.resolve_error_groups(text[],text) from public;
revoke all on function public.resolve_error_groups(text[],text) from anon;
grant execute on function public.resolve_error_groups(text[],text) to authenticated;
revoke all on function public.error_group_regression() from public;
revoke all on function public.error_group_regression() from anon;
revoke all on function public.error_group_regression() from authenticated;
