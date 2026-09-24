-- =============================================================================
-- Platform Incident Management (super-admin console /console/incidents).
--
-- STATUS: APPLIED LIVE 2026-09-24 via Supabase MCP (migration name
--         platform_incidents), project jhssdmeruxtrlqnwfksc.
--
-- WHAT: platform_incidents is the record of a platform-level incident (an
-- outage or degradation of Tyre Pulse itself, not a fleet accident), with a
-- severity sev1..sev4 and a status that moves investigating -> identified ->
-- monitoring -> resolved. platform_incident_updates is the append-only timeline:
-- every status change or note is one row with its author and time.
--
-- The signals a super admin opens an incident FROM already exist and are reused,
-- not copied: system_logs (errors), trust_alerts (data trust), security scans.
-- source_type / source_ref record which signal an incident came from.
--
-- MTTA is measured from started_at to acknowledged_at, which the RPCs stamp the
-- first time anybody posts an update after opening (or moves the status on).
-- MTTR is started_at to resolved_at. A reopened incident clears resolved_at, so
-- a resolve is never counted twice and an open incident never has a duration.
--
-- SECURITY: RLS on, super-admin SELECT only, no client INSERT/UPDATE/DELETE on
-- either table. Writes only via SECURITY DEFINER RPCs (search_path=public) that
-- raise 42501 for anyone who is not is_super_admin(). Grant order: revoke
-- PUBLIC, revoke anon by name, grant authenticated (V500 lesson). Each RPC
-- writes a console_sessions audit row. Opening a sev1 or sev2 notifies every
-- unlocked super admin through the notifications table, the same shape the
-- break-glass trigger alert_console_break_glass() uses (type, title, body,
-- entity_type, entity_id). Platform-level tables, so no organisation_id.
--
-- VERIFIED LIVE 2026-09-24 (DO blocks that raise at the end = rolled back):
-- as super admin d2d43a5f-...: open sev2 -> 1 incident, 1 update, modules
-- '{Reports, reports ,accidents}' stored as {accidents,reports}; identified then
-- resolved -> resolved_at + acknowledged_at set; list = 1 incident with 3
-- updates; 3 console_sessions audit rows; 2 notifications (= 2 unlocked super
-- admins). Bogus status 22023; resolved -> monitoring 22023; reopen clears
-- resolved_at; a sev4 sends 0 notifications. As an approved non super admin:
-- open / list / update all 42501, SELECT 0 rows. anon EXECUTE false on all
-- three RPCs, anon SELECT false, authenticated INSERT false. After rollback:
-- 0 incidents, 0 incident_* audit rows, 0 incident notifications.
--
-- VERIFY (each in a rolled-back transaction):
--   1. as super admin d2d43a5f-0906-4f7a-9577-e36d89164914:
--      select public.admin_open_incident('Test','sev2','impact','{reports}');
--        -> uuid; 1 incident, 1 update, 1 console_sessions row, 1 notification
--           per unlocked super admin
--      select public.admin_post_incident_update(<id>,'resolved','fixed');
--        -> resolved_at set, acknowledged_at set
--      select public.admin_post_incident_update(<id>,'bogus','x'); -> 22023
--   2. as a non super admin: every RPC raises 42501; SELECT returns 0 rows
--   3. has_function_privilege('anon','public.admin_list_incidents(timestamptz,integer)','EXECUTE') -> false
--
-- ROLLBACK:
--   drop function if exists public.admin_list_incidents(timestamptz, integer);
--   drop function if exists public.admin_post_incident_update(uuid, text, text);
--   drop function if exists public.admin_open_incident(text, text, text, text[], timestamptz, uuid, text, text, text);
--   drop function if exists public.incident_status_allowed(text, text);
--   drop table if exists public.platform_incident_updates;
--   drop table if exists public.platform_incidents;
-- =============================================================================

create table if not exists public.platform_incidents (
  id               uuid primary key default gen_random_uuid(),
  title            text not null check (char_length(btrim(title)) between 3 and 200),
  severity         text not null check (severity in ('sev1','sev2','sev3','sev4')),
  status           text not null default 'investigating'
                   check (status in ('investigating','identified','monitoring','resolved')),
  impact           text check (impact is null or char_length(impact) <= 4000),
  affected_modules text[] not null default '{}',
  started_at       timestamptz not null default now(),
  acknowledged_at  timestamptz,
  resolved_at      timestamptz,
  commander        uuid references public.profiles(id) on delete set null,
  source_type      text check (source_type is null or source_type in ('system_log','trust_alert','security_scan','crash','manual')),
  source_ref       text,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  check ((status = 'resolved') = (resolved_at is not null)),
  check (resolved_at is null or resolved_at >= started_at)
);

create index if not exists platform_incidents_started_idx on public.platform_incidents (started_at desc);
create index if not exists platform_incidents_open_idx on public.platform_incidents (severity) where status <> 'resolved';

create table if not exists public.platform_incident_updates (
  id          uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.platform_incidents(id) on delete cascade,
  status      text not null check (status in ('investigating','identified','monitoring','resolved')),
  message     text not null check (char_length(btrim(message)) between 1 and 4000),
  author      uuid,
  created_at  timestamptz not null default now()
);

create index if not exists platform_incident_updates_incident_idx
  on public.platform_incident_updates (incident_id, created_at);

alter table public.platform_incidents enable row level security;
alter table public.platform_incident_updates enable row level security;

drop policy if exists platform_incidents_select on public.platform_incidents;
create policy platform_incidents_select on public.platform_incidents
  for select to authenticated using ((select public.is_super_admin()));

drop policy if exists platform_incident_updates_select on public.platform_incident_updates;
create policy platform_incident_updates_select on public.platform_incident_updates
  for select to authenticated using ((select public.is_super_admin()));

revoke all on public.platform_incidents from public;
revoke all on public.platform_incidents from anon;
revoke insert, update, delete, truncate, trigger, references on public.platform_incidents from authenticated;
grant select on public.platform_incidents to authenticated;

revoke all on public.platform_incident_updates from public;
revoke all on public.platform_incident_updates from anon;
revoke insert, update, delete, truncate, trigger, references on public.platform_incident_updates from authenticated;
grant select on public.platform_incident_updates to authenticated;

-- The status machine, in one place. Mirrored by NEXT_STATUS in src/lib/platformIncidents.js
-- (change both). Posting the SAME status is allowed: it is a progress note.
create or replace function public.incident_status_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_from = p_to or case p_from
    when 'investigating' then p_to in ('identified','monitoring','resolved')
    when 'identified'    then p_to in ('investigating','monitoring','resolved')
    when 'monitoring'    then p_to in ('investigating','identified','resolved')
    when 'resolved'      then p_to in ('investigating')
    else false end
$$;

create or replace function public.admin_open_incident(
  p_title text,
  p_severity text,
  p_impact text default null,
  p_affected_modules text[] default '{}',
  p_started_at timestamptz default null,
  p_commander uuid default null,
  p_source_type text default null,
  p_source_ref text default null,
  p_message text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_id      uuid;
  v_sev     text := lower(btrim(coalesce(p_severity, '')));
  v_title   text := btrim(coalesce(p_title, ''));
  v_start   timestamptz := coalesce(p_started_at, now());
  v_mods    text[];
  v_who     text;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can open an incident' using errcode = '42501';
  end if;
  if char_length(v_title) < 3 or char_length(v_title) > 200 then
    raise exception 'An incident needs a title of 3 to 200 characters' using errcode = '22023';
  end if;
  if v_sev not in ('sev1','sev2','sev3','sev4') then
    raise exception 'Severity must be sev1, sev2, sev3 or sev4' using errcode = '22023';
  end if;
  if v_start > now() + interval '5 minutes' then
    raise exception 'An incident cannot start in the future' using errcode = '22023';
  end if;
  if p_source_type is not null and p_source_type not in ('system_log','trust_alert','security_scan','crash','manual') then
    raise exception 'Unknown incident source' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct m order by m), '{}') into v_mods
    from unnest(coalesce(p_affected_modules, '{}')) as u(m0),
         lateral (select lower(btrim(m0)) as m) x
   where m <> '';

  insert into public.platform_incidents
    (title, severity, impact, affected_modules, started_at, commander, source_type, source_ref, created_by)
  values
    (v_title, v_sev, nullif(btrim(coalesce(p_impact, '')), ''), v_mods, v_start,
     coalesce(p_commander, v_uid), p_source_type, nullif(btrim(coalesce(p_source_ref, '')), ''), v_uid)
  returning id into v_id;

  insert into public.platform_incident_updates (incident_id, status, message, author)
  values (v_id, 'investigating', coalesce(nullif(btrim(coalesce(p_message, '')), ''), 'Incident opened.'), v_uid);

  insert into public.console_sessions (admin_id, action, target_id, target_type, details)
  values (v_uid, 'incident_open', v_id, 'platform_incident',
          jsonb_build_object('severity', v_sev, 'title', v_title, 'source_type', p_source_type, 'source_ref', p_source_ref));

  if v_sev in ('sev1','sev2') then
    select coalesce(full_name, email) into v_who from public.profiles where id = v_uid;
    begin
      insert into public.notifications (user_id, type, title, body, entity_type, entity_id)
      select p.id, 'security',
             upper(v_sev) || ' incident opened: ' || v_title,
             coalesce(v_who, 'A super admin') || ' opened it at '
               || to_char(v_start at time zone 'Asia/Riyadh', 'DD Mon YYYY HH24:MI') || ' (Riyadh).',
             'platform_incident', v_id
        from public.profiles p
       where coalesce(p.is_super_admin, false) and not coalesce(p.locked, false);
    exception when others then
      -- A failed alert must never lose the incident record itself.
      null;
    end;
  end if;

  return v_id;
end $$;

create or replace function public.admin_post_incident_update(
  p_incident_id uuid, p_status text, p_message text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_inc   public.platform_incidents%rowtype;
  v_to    text := lower(btrim(coalesce(p_status, '')));
  v_msg   text := btrim(coalesce(p_message, ''));
  v_upd   uuid;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can update an incident' using errcode = '42501';
  end if;
  if char_length(v_msg) < 1 or char_length(v_msg) > 4000 then
    raise exception 'An update needs a message' using errcode = '22023';
  end if;
  select * into v_inc from public.platform_incidents where id = p_incident_id for update;
  if not found then
    raise exception 'Incident not found' using errcode = 'P0002';
  end if;
  if v_to not in ('investigating','identified','monitoring','resolved') then
    raise exception 'Unknown incident status' using errcode = '22023';
  end if;
  if not public.incident_status_allowed(v_inc.status, v_to) then
    raise exception 'An incident cannot move from % to %', v_inc.status, v_to using errcode = '22023';
  end if;

  update public.platform_incidents
     set status = v_to,
         acknowledged_at = coalesce(acknowledged_at, now()),
         resolved_at = case
           when v_to = 'resolved' and v_inc.status <> 'resolved' then greatest(now(), started_at)
           when v_to = 'resolved' then resolved_at
           else null end
   where id = p_incident_id;

  insert into public.platform_incident_updates (incident_id, status, message, author)
  values (p_incident_id, v_to, v_msg, v_uid)
  returning id into v_upd;

  insert into public.console_sessions (admin_id, action, target_id, target_type, details)
  values (v_uid, 'incident_update', p_incident_id, 'platform_incident',
          jsonb_build_object('from', v_inc.status, 'to', v_to, 'update_id', v_upd));

  return jsonb_build_object('id', v_upd, 'from', v_inc.status, 'to', v_to);
end $$;

create or replace function public.admin_list_incidents(
  p_since timestamptz default null, p_limit integer default 200
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_out jsonb;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can list incidents' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(s.j order by s.started_at desc), '[]'::jsonb) into v_out
  from (
    select jsonb_build_object(
      'id', i.id, 'title', i.title, 'severity', i.severity, 'status', i.status,
      'impact', i.impact, 'affected_modules', to_jsonb(i.affected_modules),
      'started_at', i.started_at, 'acknowledged_at', i.acknowledged_at, 'resolved_at', i.resolved_at,
      'commander', i.commander,
      'commander_name', (select coalesce(p.full_name, p.email) from public.profiles p where p.id = i.commander),
      'source_type', i.source_type, 'source_ref', i.source_ref,
      'created_by', i.created_by, 'created_at', i.created_at,
      'updates', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', u.id, 'status', u.status, 'message', u.message, 'author', u.author,
                 'author_name', (select coalesce(p.full_name, p.email) from public.profiles p where p.id = u.author),
                 'created_at', u.created_at) order by u.created_at)
          from public.platform_incident_updates u where u.incident_id = i.id), '[]'::jsonb)
    ) as j, i.started_at
    from public.platform_incidents i
    where p_since is null or i.started_at >= p_since or i.status <> 'resolved'
    order by i.started_at desc
    limit greatest(1, least(coalesce(p_limit, 200), 1000))
  ) s;
  return v_out;
end $$;

revoke all on function public.incident_status_allowed(text, text) from public;
revoke all on function public.incident_status_allowed(text, text) from anon;
grant execute on function public.incident_status_allowed(text, text) to authenticated;

revoke all on function public.admin_open_incident(text, text, text, text[], timestamptz, uuid, text, text, text) from public;
revoke all on function public.admin_open_incident(text, text, text, text[], timestamptz, uuid, text, text, text) from anon;
grant execute on function public.admin_open_incident(text, text, text, text[], timestamptz, uuid, text, text, text) to authenticated;

revoke all on function public.admin_post_incident_update(uuid, text, text) from public;
revoke all on function public.admin_post_incident_update(uuid, text, text) from anon;
grant execute on function public.admin_post_incident_update(uuid, text, text) to authenticated;

revoke all on function public.admin_list_incidents(timestamptz, integer) from public;
revoke all on function public.admin_list_incidents(timestamptz, integer) from anon;
grant execute on function public.admin_list_incidents(timestamptz, integer) to authenticated;
