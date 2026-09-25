-- =============================================================================
-- Platform incidents: commander reassignment + postmortem.
--
-- STATUS: APPLIED LIVE 2026-09-25 (project jhssdmeruxtrlqnwfksc) via Supabase
--         MCP apply_migration 'incident_commander_postmortem'.
--
-- WHAT
--   incident_reassign_commander(p_id, p_user, p_reason)
--     Hands the incident to another super admin. Only a super admin can be a
--     commander: platform_incidents is super-admin SELECT only, so naming anybody
--     else would put a person in charge of a record they cannot open. The
--     reason is mandatory (5..500 chars). Writes a timeline entry (the CURRENT
--     status is kept, the change is a note), a console_sessions audit row and a
--     best-effort notification to the new commander.
--
--   incident_save_postmortem(p_id, p_summary, p_root_cause, p_actions jsonb)
--     Only on a RESOLVED incident (the status machine has no separate 'closed'
--     state; resolved is the terminal one). Editable: a second save updates it
--     and the timeline says "updated". A reopen keeps the postmortem so the
--     reasoning is not lost, and the next resolve can revise it.
--     p_actions = array (max 50) of {action text 1..500, owner text, due
--     'YYYY-MM-DD', done boolean}; normalised server-side, unknown keys dropped.
--
--   admin_list_incidents is re-created with the postmortem fields added; every
--   existing key is byte-identical.
--
-- SECURITY: DEFINER, search_path=public, is_super_admin() else 42501; revoke
-- PUBLIC, revoke anon by name, grant authenticated (V500 order).
--
-- VERIFIED LIVE 2026-09-25 (one DO block that raises at the end = rolled back):
-- as super admin d2d43a5f-...: reassign to 58787cc7 -> ok, commander changed,
-- updates 2 (open + handover), 1 incident_reassign_commander audit row; same
-- commander 22023; Manager target 22023; 2-char reason 22023; postmortem on an
-- open incident 22023; after resolve -> first=true, 2 actions kept of 3 (blank
-- dropped, done:"yes" read as false); second save first=false; due 'tomorrow'
-- 22023; 2 incident_save_postmortem audit rows; admin_list_incidents carries
-- postmortem_actions. As approved Manager 34793423: both RPCs 42501. anon
-- EXECUTE false on all three, authenticated true, all DEFINER search_path=public.
-- After rollback: 0 test incidents left.
--
-- ROLLBACK:
--   drop function if exists public.incident_reassign_commander(uuid, uuid, text);
--   drop function if exists public.incident_save_postmortem(uuid, text, text, jsonb);
--   alter table public.platform_incidents drop column if exists postmortem_summary,
--     drop column if exists postmortem_root_cause, drop column if exists postmortem_actions,
--     drop column if exists postmortem_at, drop column if exists postmortem_by;
--   then re-create admin_list_incidents from 20260924115000.
-- =============================================================================

alter table public.platform_incidents
  add column if not exists postmortem_summary    text,
  add column if not exists postmortem_root_cause text,
  add column if not exists postmortem_actions    jsonb not null default '[]'::jsonb,
  add column if not exists postmortem_at         timestamptz,
  add column if not exists postmortem_by         uuid references public.profiles(id) on delete set null;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'platform_incidents_postmortem_actions_array') then
    alter table public.platform_incidents
      add constraint platform_incidents_postmortem_actions_array
      check (jsonb_typeof(postmortem_actions) = 'array');
  end if;
end $$;

create or replace function public.incident_reassign_commander(p_id uuid, p_user uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_inc    public.platform_incidents%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_to     record;
  v_from_name text;
  v_to_name   text;
  v_upd    uuid;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can reassign an incident' using errcode = '42501';
  end if;
  if char_length(v_reason) < 5 or char_length(v_reason) > 500 then
    raise exception 'A reason of 5 to 500 characters is required' using errcode = '22023';
  end if;
  select * into v_inc from public.platform_incidents where id = p_id for update;
  if not found then raise exception 'Incident not found' using errcode = 'P0002'; end if;

  select id, coalesce(full_name, email) as name, coalesce(is_super_admin, false) as sup,
         coalesce(locked, false) as locked
    into v_to from public.profiles where id = p_user;
  if not found then raise exception 'That user does not exist' using errcode = 'P0002'; end if;
  if not v_to.sup or v_to.locked then
    raise exception 'The commander must be an unlocked super admin' using errcode = '22023';
  end if;
  if v_inc.commander is not distinct from p_user then
    raise exception 'That person is already the commander' using errcode = '22023';
  end if;

  select coalesce(full_name, email) into v_from_name from public.profiles where id = v_inc.commander;
  v_to_name := v_to.name;

  update public.platform_incidents
     set commander = p_user,
         acknowledged_at = coalesce(acknowledged_at, now())
   where id = p_id;

  insert into public.platform_incident_updates (incident_id, status, message, author)
  values (p_id, v_inc.status,
          left('Commander changed from ' || coalesce(v_from_name, 'nobody') || ' to '
               || coalesce(v_to_name, 'a super admin') || '. Reason: ' || v_reason, 4000),
          v_uid)
  returning id into v_upd;

  insert into public.console_sessions (admin_id, action, target_id, target_type, details)
  values (v_uid, 'incident_reassign_commander', p_id, 'platform_incident',
          jsonb_build_object('from', v_inc.commander, 'to', p_user, 'reason', v_reason, 'update_id', v_upd));

  if p_user is distinct from v_uid then
    begin
      insert into public.notifications (user_id, type, title, body, entity_type, entity_id)
      values (p_user, 'security', 'You are now incident commander: ' || v_inc.title,
              left('Reason: ' || v_reason, 500), 'platform_incident', p_id);
    exception when others then null;
    end;
  end if;

  return jsonb_build_object('ok', true, 'id', p_id, 'from', v_inc.commander, 'to', p_user, 'update_id', v_upd);
end $$;

create or replace function public.incident_save_postmortem(
  p_id uuid, p_summary text, p_root_cause text, p_actions jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_inc     public.platform_incidents%rowtype;
  v_summary text := btrim(coalesce(p_summary, ''));
  v_root    text := btrim(coalesce(p_root_cause, ''));
  v_in      jsonb := coalesce(p_actions, '[]'::jsonb);
  v_actions jsonb := '[]'::jsonb;
  v_el      jsonb;
  v_text    text;
  v_due     text;
  v_first   boolean;
  v_upd     uuid;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can write a postmortem' using errcode = '42501';
  end if;
  select * into v_inc from public.platform_incidents where id = p_id for update;
  if not found then raise exception 'Incident not found' using errcode = 'P0002'; end if;
  if v_inc.status <> 'resolved' then
    raise exception 'A postmortem can only be written once the incident is resolved' using errcode = '22023';
  end if;
  if char_length(v_summary) < 10 or char_length(v_summary) > 8000 then
    raise exception 'A summary of 10 to 8000 characters is required' using errcode = '22023';
  end if;
  if char_length(v_root) < 5 or char_length(v_root) > 4000 then
    raise exception 'A root cause of 5 to 4000 characters is required' using errcode = '22023';
  end if;
  if jsonb_typeof(v_in) <> 'array' then
    raise exception 'Actions must be a list' using errcode = '22023';
  end if;
  if jsonb_array_length(v_in) > 50 then
    raise exception 'A postmortem can carry at most 50 actions' using errcode = '22023';
  end if;

  for v_el in select value from jsonb_array_elements(v_in) loop
    if jsonb_typeof(v_el) <> 'object' then
      raise exception 'Each action must be an object' using errcode = '22023';
    end if;
    v_text := btrim(coalesce(v_el->>'action', ''));
    if v_text = '' then continue; end if;
    if char_length(v_text) > 500 then
      raise exception 'An action must be 500 characters or fewer' using errcode = '22023';
    end if;
    v_due := nullif(btrim(coalesce(v_el->>'due', '')), '');
    if v_due is not null and v_due !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'An action due date must be YYYY-MM-DD' using errcode = '22023';
    end if;
    v_actions := v_actions || jsonb_build_array(jsonb_build_object(
      'action', v_text,
      'owner', nullif(left(btrim(coalesce(v_el->>'owner', '')), 200), ''),
      'due', v_due,
      'done', case when jsonb_typeof(v_el->'done') = 'boolean' then (v_el->>'done')::boolean else false end));
  end loop;

  v_first := v_inc.postmortem_at is null;

  update public.platform_incidents
     set postmortem_summary = v_summary,
         postmortem_root_cause = v_root,
         postmortem_actions = v_actions,
         postmortem_at = now(),
         postmortem_by = v_uid
   where id = p_id;

  insert into public.platform_incident_updates (incident_id, status, message, author)
  values (p_id, 'resolved',
          case when v_first then 'Postmortem recorded.' else 'Postmortem updated.' end
            || ' ' || jsonb_array_length(v_actions) || ' follow-up action'
            || case when jsonb_array_length(v_actions) = 1 then '' else 's' end || '.',
          v_uid)
  returning id into v_upd;

  insert into public.console_sessions (admin_id, action, target_id, target_type, details)
  values (v_uid, 'incident_save_postmortem', p_id, 'platform_incident',
          jsonb_build_object('first', v_first, 'actions', jsonb_array_length(v_actions), 'update_id', v_upd));

  return jsonb_build_object('ok', true, 'id', p_id, 'first', v_first,
                            'actions', jsonb_array_length(v_actions), 'update_id', v_upd);
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
      'postmortem_summary', i.postmortem_summary,
      'postmortem_root_cause', i.postmortem_root_cause,
      'postmortem_actions', coalesce(i.postmortem_actions, '[]'::jsonb),
      'postmortem_at', i.postmortem_at,
      'postmortem_by', i.postmortem_by,
      'postmortem_by_name', (select coalesce(p.full_name, p.email) from public.profiles p where p.id = i.postmortem_by),
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

revoke all on function public.incident_reassign_commander(uuid, uuid, text) from public;
revoke all on function public.incident_reassign_commander(uuid, uuid, text) from anon;
grant execute on function public.incident_reassign_commander(uuid, uuid, text) to authenticated;

revoke all on function public.incident_save_postmortem(uuid, text, text, jsonb) from public;
revoke all on function public.incident_save_postmortem(uuid, text, text, jsonb) from anon;
grant execute on function public.incident_save_postmortem(uuid, text, text, jsonb) to authenticated;

revoke all on function public.admin_list_incidents(timestamptz, integer) from public;
revoke all on function public.admin_list_incidents(timestamptz, integer) from anon;
grant execute on function public.admin_list_incidents(timestamptz, integer) to authenticated;
