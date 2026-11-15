-- =====================================================================================
-- 20261116100000_clo_corrective_action_review.sql
-- STATUS: AUTHORED, NOT APPLIED. Draft for owner approval. Tested on local staging only
--         (PostgreSQL 16, synthetic companies Alpha/Beta/Gamma, database tp_closure).
--
-- WHAT IT DOES (owner decision 2026-11-15, corrective-action closure workflow)
--   1. closure_review_config: one row per company. Which roles review a corrective action,
--      whether a person may review their own submission, how many photographs are required,
--      which roles may record an exception. Seeded lazily with defaults (no row = defaults).
--   2. corrective_actions gains review columns. The status vocabulary is UNCHANGED
--      (Open / In Progress / Closed): 18 readers compare status to 'Open' or 'Closed', so a
--      new status such as 'Pending Review' would silently drop actions from open counts.
--      The review state lives in review_status instead
--      (submitted / returned / approved / exception_requested / exception; NULL = never reviewed).
--   2b. EXCEPTIONS ARE A REQUEST, NEVER A SELF-SERVICE CLOSE (owner decision 2026-11-15, round 2).
--      Anyone who may work on the action can ASK for an exception with a written reason. The
--      action stays open. A different person in an exception role approves (action closes as an
--      exception) or refuses (action returns to the worker). The person who asked, and the
--      person who submitted the completion, can never decide it. This rule has NO company
--      switch: ca_allow_self_review does not apply to exceptions, and it binds super admins too.
--   3. corrective_action_review_events: append-only history. Reviewer, time, evidence,
--      comment and a snapshot of the linked asset, tyre, inspection/checklist and job card.
--      UPDATE and DELETE are refused for everyone, including definer functions.
--   4. Writers (SECURITY DEFINER, each re-checks company, country and site):
--        corrective_action_worker_update   assigned worker records progress
--        corrective_action_submit_completion  assigned worker submits evidence
--        corrective_action_review          reviewer approves closure or returns it
--        corrective_action_request_exception  asks for a documented exception (does NOT close)
--        corrective_action_decide_exception   a DIFFERENT authorised person approves or refuses it
--        corrective_action_my_permissions  what the caller may do on one action (for the UI)
--        get_closure_review_config / save_closure_review_config
--   5. Guard trigger trg_ca_review_guard: review columns cannot be written outside the
--      writers; a worker can never set status Closed. A reviewer closing directly (the old
--      status dropdown, the Expo task list, the Action Center mirror) is still accepted
--      while ca_allow_direct_close is true, and is recorded as event 'direct_closed'.
--
-- WHY NOT THE APPROVAL ENGINE (approval_policies / approval_private.execution_decide)
--   That engine freezes the document while it is pending (guard_document raises on any
--   content change) and supports four entity types wired through nine private functions.
--   A corrective action must stay editable by its worker until evidence is submitted and
--   can be returned and resubmitted many times. Carrying it would mean rewriting the
--   private functions. This draft adds no engine: one state column, one event table and
--   four writers, using the same role, country and site helpers as the rest of the schema.
--
-- EXISTING ROWS: no existing corrective_actions value is changed. New columns are NULL on
--   every existing row. No action is closed, reopened or reassigned by this file.
--
-- VERIFY (rolled back):
--   begin;
--   select count(*), md5(string_agg(to_jsonb(c)::text, '' order by id)) from public.corrective_actions c;  -- before
--   \i this file
--   select count(*), md5(string_agg((to_jsonb(c) - array['review_status','submitted_by','submitted_at',
--     'completion_note','completion_photos','reviewed_by','reviewed_at','review_comment',
--     'exception_requested_by','exception_requested_at','exception_reason'])::text, '' order by id))
--     from public.corrective_actions c;                                                                      -- same
--   select has_function_privilege('anon', 'public.corrective_action_review(uuid,text,text)', 'execute');    -- f
--   rollback;
--
-- ROLLBACK (this section names the removal statements on purpose; nothing else in the file removes anything):
--   drop trigger if exists trg_ca_review_guard on public.corrective_actions;
--   drop function if exists public.corrective_action_review_guard(), public.corrective_action_worker_update(uuid,text,jsonb),
--     public.corrective_action_submit_completion(uuid,text,jsonb), public.corrective_action_review(uuid,text,text),
--     public.corrective_action_request_exception(uuid,text), public.corrective_action_decide_exception(uuid,text,text),
--     public.corrective_action_my_permissions(uuid),
--     public.get_closure_review_config(), public.save_closure_review_config(jsonb), public.closure_review_settings(uuid),
--     public.closure_role_in(text,text[]), public.corrective_action_is_assignee(uuid, uuid),
--     public._ca_review_event(public.corrective_actions,text,text,jsonb), public._ca_review_load(uuid),
--     public._ca_clean_photos(jsonb), public.closure_events_immutable();
--   drop table if exists public.corrective_action_review_events, public.closure_review_config;
--   alter table public.corrective_actions drop column if exists review_status, drop column if exists submitted_by,
--     drop column if exists submitted_at, drop column if exists completion_note, drop column if exists completion_photos,
--     drop column if exists reviewed_by, drop column if exists reviewed_at, drop column if exists review_comment,
--     drop column if exists exception_requested_by, drop column if exists exception_requested_at,
--     drop column if exists exception_reason;
-- =====================================================================================

-- ---------------------------------------------------------------- 1. per-company config
create table if not exists public.closure_review_config (
  organisation_id            uuid primary key references public.organisations(id),
  ca_reviewer_roles          text[]  not null default array['Admin','Manager','Workshop Supervisor','Maintenance Supervisor','Tyre Engineer','Tire Planning Engineer','PMV Manager','Workshop Area Manager','Workshop Maintenance Area Manager'],
  ca_allow_self_review       boolean not null default false,
  ca_min_photos              integer not null default 0 check (ca_min_photos between 0 and 6),
  ca_allow_direct_close      boolean not null default true,
  exception_roles            text[]  not null default array['Admin','Director','Manager','PMV Manager','Workshop Area Manager','Workshop Maintenance Area Manager'],
  checklist_final_signer_roles text[] not null default array[]::text[],
  checklist_allow_self_ack   boolean not null default false,
  updated_at                 timestamptz not null default now(),
  updated_by                 uuid
);
alter table public.closure_review_config enable row level security;
revoke all on public.closure_review_config from public, anon;
revoke insert, update, delete, truncate, references, trigger on public.closure_review_config from authenticated;
grant select on public.closure_review_config to authenticated;
create policy closure_review_config_org_isolation on public.closure_review_config as restrictive for all to authenticated
  using (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()))
  with check (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()));
create policy closure_review_config_read on public.closure_review_config for select to authenticated
  using ((select public.app_is_active()) is true);

create or replace function public.closure_role_in(p_role text, p_roles text[])
returns boolean language sql immutable set search_path to '' as $$
  select exists (select 1 from unnest(coalesce(p_roles, array[]::text[])) r
                  where lower(regexp_replace(btrim(r), '[\s_-]+', ' ', 'g'))
                      = lower(regexp_replace(btrim(coalesce(p_role, '')), '[\s_-]+', ' ', 'g'))
                    and btrim(coalesce(p_role, '')) <> '');
$$;
revoke all on function public.closure_role_in(text, text[]) from public;
revoke all on function public.closure_role_in(text, text[]) from anon;
grant execute on function public.closure_role_in(text, text[]) to authenticated;

-- Effective settings for one company: stored row over the column defaults. Internal: it
-- takes a company id, so it is not executable by anon or authenticated (V378 rule).
create or replace function public.closure_review_settings(p_org uuid)
returns public.closure_review_config language plpgsql stable security definer set search_path to 'public' as $$
declare c public.closure_review_config;
begin
  select * into c from public.closure_review_config where organisation_id = p_org;
  if not found then
    c.organisation_id := p_org;
    c.ca_reviewer_roles := array['Admin','Manager','Workshop Supervisor','Maintenance Supervisor','Tyre Engineer','Tire Planning Engineer','PMV Manager','Workshop Area Manager','Workshop Maintenance Area Manager'];
    c.ca_allow_self_review := false;
    c.ca_min_photos := 0;
    c.ca_allow_direct_close := true;
    c.exception_roles := array['Admin','Director','Manager','PMV Manager','Workshop Area Manager','Workshop Maintenance Area Manager'];
    c.checklist_final_signer_roles := array[]::text[];
    c.checklist_allow_self_ack := false;
    c.updated_at := null;
  end if;
  return c;
end $$;
revoke all on function public.closure_review_settings(uuid) from public;
revoke all on function public.closure_review_settings(uuid) from anon, authenticated;

create or replace function public.get_closure_review_config()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare c public.closure_review_config;
begin
  if auth.uid() is null or public.app_is_active() is not true then
    raise exception 'Sign in to read the review settings.' using errcode = '42501';
  end if;
  c := public.closure_review_settings(public.app_current_org());
  return to_jsonb(c) - 'updated_by';
end $$;
revoke all on function public.get_closure_review_config() from public;
revoke all on function public.get_closure_review_config() from anon;
grant execute on function public.get_closure_review_config() to authenticated;

create or replace function public.save_closure_review_config(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_org uuid := public.app_current_org(); c public.closure_review_config; v_roles text[];
begin
  if auth.uid() is null or public.app_is_active() is not true
     or not (public.is_super_admin() or public.get_my_role() = 'Admin') then
    raise exception 'Only an administrator can change who reviews and closes actions.' using errcode = '42501';
  end if;
  if v_org is null then raise exception 'No company is selected.' using errcode = '42501'; end if;
  c := public.closure_review_settings(v_org);
  if p ? 'ca_reviewer_roles' then
    select array_agg(distinct btrim(x)) into v_roles from jsonb_array_elements_text(p->'ca_reviewer_roles') x where btrim(x) <> '';
    if coalesce(cardinality(v_roles), 0) = 0 then
      raise exception 'Keep at least one reviewer role, otherwise no action could be closed.' using errcode = '22023';
    end if;
    c.ca_reviewer_roles := v_roles;
  end if;
  if p ? 'exception_roles' then
    select coalesce(array_agg(distinct btrim(x)), array[]::text[]) into c.exception_roles from jsonb_array_elements_text(p->'exception_roles') x where btrim(x) <> '';
  end if;
  if p ? 'checklist_final_signer_roles' then
    select coalesce(array_agg(distinct btrim(x)), array[]::text[]) into c.checklist_final_signer_roles from jsonb_array_elements_text(p->'checklist_final_signer_roles') x where btrim(x) <> '';
  end if;
  if p ? 'ca_allow_self_review' then c.ca_allow_self_review := (p->>'ca_allow_self_review')::boolean; end if;
  if p ? 'ca_allow_direct_close' then c.ca_allow_direct_close := (p->>'ca_allow_direct_close')::boolean; end if;
  if p ? 'checklist_allow_self_ack' then c.checklist_allow_self_ack := (p->>'checklist_allow_self_ack')::boolean; end if;
  if p ? 'ca_min_photos' then
    c.ca_min_photos := (p->>'ca_min_photos')::integer;
    if c.ca_min_photos not between 0 and 6 then raise exception 'Required photographs must be between 0 and 6.' using errcode = '22023'; end if;
  end if;
  insert into public.closure_review_config as t
    (organisation_id, ca_reviewer_roles, ca_allow_self_review, ca_min_photos, ca_allow_direct_close,
     exception_roles, checklist_final_signer_roles, checklist_allow_self_ack, updated_at, updated_by)
  values (v_org, c.ca_reviewer_roles, c.ca_allow_self_review, c.ca_min_photos, c.ca_allow_direct_close,
          c.exception_roles, c.checklist_final_signer_roles, c.checklist_allow_self_ack, now(), auth.uid())
  on conflict (organisation_id) do update set
    ca_reviewer_roles = excluded.ca_reviewer_roles, ca_allow_self_review = excluded.ca_allow_self_review,
    ca_min_photos = excluded.ca_min_photos, ca_allow_direct_close = excluded.ca_allow_direct_close,
    exception_roles = excluded.exception_roles, checklist_final_signer_roles = excluded.checklist_final_signer_roles,
    checklist_allow_self_ack = excluded.checklist_allow_self_ack, updated_at = now(), updated_by = auth.uid();
  return public.get_closure_review_config();
end $$;
revoke all on function public.save_closure_review_config(jsonb) from public;
revoke all on function public.save_closure_review_config(jsonb) from anon;
grant execute on function public.save_closure_review_config(jsonb) to authenticated;

-- ---------------------------------------------------------------- 2. review columns
alter table public.corrective_actions
  add column if not exists review_status     text,
  add column if not exists submitted_by      uuid,
  add column if not exists submitted_at      timestamptz,
  add column if not exists completion_note   text,
  add column if not exists completion_photos jsonb,
  add column if not exists reviewed_by       uuid,
  add column if not exists reviewed_at       timestamptz,
  add column if not exists review_comment    text,
  add column if not exists exception_requested_by uuid,
  add column if not exists exception_requested_at timestamptz,
  add column if not exists exception_reason       text;
alter table public.corrective_actions
  add constraint corrective_actions_review_status_chk
  check (review_status is null or review_status in ('submitted','returned','approved','exception_requested','exception'));
create index if not exists idx_corrective_actions_review_queue
  on public.corrective_actions (organisation_id, submitted_at) where review_status in ('submitted', 'exception_requested');

-- ---------------------------------------------------------------- 3. append-only history
create table if not exists public.corrective_action_review_events (
  id              bigint generated always as identity primary key,
  organisation_id uuid not null,
  action_id       uuid not null,            -- no foreign key: history outlives an administrator's removal of the action
  event_type      text not null check (event_type in ('progress','submitted','returned','approved','exception_requested','exception_refused','exception','direct_closed','reopened')),
  actor_id        uuid,
  actor_role      text,
  actor_name      text,                     -- the person's name at the time, so history reads "who" without a second lookup
  note            text,
  evidence        jsonb not null default '[]'::jsonb,
  linked          jsonb not null default '{}'::jsonb,  -- asset, tyre, source record, job card at the time
  country         text,
  site            text,
  created_at      timestamptz not null default now()
);
create index if not exists idx_ca_review_events_action on public.corrective_action_review_events (action_id, created_at);
create index if not exists idx_ca_review_events_org on public.corrective_action_review_events (organisation_id, created_at desc);
alter table public.corrective_action_review_events enable row level security;
revoke all on public.corrective_action_review_events from public, anon;
revoke insert, update, delete, truncate, references, trigger on public.corrective_action_review_events from authenticated;
grant select on public.corrective_action_review_events to authenticated;
create policy ca_review_events_org_isolation on public.corrective_action_review_events as restrictive for select to authenticated
  using (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()));
create policy ca_review_events_scope on public.corrective_action_review_events as restrictive for select to authenticated
  using ((select public.app_is_active()) is true and public.app_write_country_ok(country) and public.app_can_see_site(site) is not false);
create policy ca_review_events_read on public.corrective_action_review_events for select to authenticated using (true);

create or replace function public.closure_events_immutable()
returns trigger language plpgsql set search_path to '' as $$
begin
  raise exception 'Review history cannot be changed or removed.' using errcode = '42501';
end $$;
revoke all on function public.closure_events_immutable() from public;
revoke all on function public.closure_events_immutable() from anon, authenticated;
create trigger trg_ca_review_events_immutable before update or delete on public.corrective_action_review_events
  for each row execute function public.closure_events_immutable();
create trigger trg_ca_review_events_no_truncate before truncate on public.corrective_action_review_events
  for each statement execute function public.closure_events_immutable();

create or replace function public._ca_review_event(a public.corrective_actions, p_type text, p_note text, p_evidence jsonb)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  insert into public.corrective_action_review_events
    (organisation_id, action_id, event_type, actor_id, actor_role, actor_name, note, evidence, linked, country, site)
  values (a.organisation_id, a.id, p_type, auth.uid(), public.get_my_role(),
          (select nullif(btrim(coalesce(p.full_name, p.username, '')), '') from public.profiles p where p.id = auth.uid()),
          nullif(btrim(coalesce(p_note, '')), ''),
          coalesce(p_evidence, '[]'::jsonb),
          jsonb_strip_nulls(jsonb_build_object('asset_no', a.asset_no, 'tyre_serial', a.tyre_serial,
            'source_type', a.source_type, 'source_id', a.source_id, 'source_detail', a.source_detail,
            'work_order_id', a.work_order_id, 'title', left(a.title, 300))),
          a.country, a.site);
end $$;
revoke all on function public._ca_review_event(public.corrective_actions, text, text, jsonb) from public;
revoke all on function public._ca_review_event(public.corrective_actions, text, text, jsonb) from anon, authenticated;

-- ---------------------------------------------------------------- 4. who is the assigned worker
-- The person the Action Center mirror is assigned to (the only place a user id is stored for
-- an assignment); when nobody is assigned, the person who raised the action.
create or replace function public.corrective_action_is_assignee(p_action uuid, p_user uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select p_user is not null and exists (
    select 1 from public.corrective_actions a
     where a.id = p_action
       and ( exists (select 1 from public.action_items i
                      where i.source = 'corrective:' || a.id::text
                        and i.organisation_id is not distinct from a.organisation_id
                        and i.assigned_user_id = p_user)
          or ( a.created_by = p_user
               and not exists (select 1 from public.action_items i
                                where i.source = 'corrective:' || a.id::text
                                  and i.organisation_id is not distinct from a.organisation_id
                                  and i.assigned_user_id is not null) ) ) );
$$;
revoke all on function public.corrective_action_is_assignee(uuid, uuid) from public;
revoke all on function public.corrective_action_is_assignee(uuid, uuid) from anon, authenticated;

-- Loads one action for a writer and applies the company, country and site walls. Raises a
-- plain refusal otherwise. Row is locked so two reviewers cannot decide at once.
create or replace function public._ca_review_load(p_id uuid)
returns public.corrective_actions language plpgsql security definer set search_path to 'public' as $$
declare a public.corrective_actions;
begin
  if auth.uid() is null or public.app_is_active() is not true then
    raise exception 'Sign in to work on corrective actions.' using errcode = '42501';
  end if;
  select * into a from public.corrective_actions c
   where c.id = p_id
     and (c.organisation_id = public.app_current_org() or public.is_super_admin())
     and public.app_write_country_ok(c.country)
     and public.app_can_see_site(c.site) is not false
   for update;
  if not found then
    raise exception 'That action does not exist or is outside your company, country or sites.' using errcode = '42501';
  end if;
  return a;
end $$;
revoke all on function public._ca_review_load(uuid) from public;
revoke all on function public._ca_review_load(uuid) from anon, authenticated;

create or replace function public._ca_clean_photos(p jsonb)
returns jsonb language plpgsql immutable set search_path to '' as $$
declare v jsonb := coalesce(p, '[]'::jsonb); x jsonb;
begin
  if jsonb_typeof(v) <> 'array' then raise exception 'Photographs must be a list.' using errcode = '22023'; end if;
  if jsonb_array_length(v) > 6 then raise exception 'Attach at most 6 photographs.' using errcode = '22023'; end if;
  for x in select * from jsonb_array_elements(v) loop
    if jsonb_typeof(x) <> 'string' or length(x #>> '{}') = 0 then
      raise exception 'A photograph is empty.' using errcode = '22023';
    end if;
    if length(x #>> '{}') > 900000 then
      raise exception 'A photograph is too large. Take it again at a lower size.' using errcode = '22023';
    end if;
  end loop;
  return v;
end $$;
revoke all on function public._ca_clean_photos(jsonb) from public;
revoke all on function public._ca_clean_photos(jsonb) from anon, authenticated;

-- ---------------------------------------------------------------- 5. writers
create or replace function public.corrective_action_my_permissions(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare a public.corrective_actions; c public.closure_review_config; v_role text := public.get_my_role();
  v_assignee boolean; v_reviewer boolean; v_self boolean; v_closed boolean;
  v_exc_role boolean; v_exc_pending boolean; v_exc_self boolean; v_waiting boolean;
begin
  if auth.uid() is null or public.app_is_active() is not true then
    return jsonb_build_object('ok', false);
  end if;
  select * into a from public.corrective_actions x
   where x.id = p_id and (x.organisation_id = public.app_current_org() or public.is_super_admin())
     and public.app_write_country_ok(x.country) and public.app_can_see_site(x.site) is not false;
  if not found then return jsonb_build_object('ok', false); end if;
  c := public.closure_review_settings(a.organisation_id);
  v_assignee := public.corrective_action_is_assignee(a.id, auth.uid());
  v_reviewer := public.is_super_admin() or public.closure_role_in(v_role, c.ca_reviewer_roles);
  v_self := a.submitted_by is not distinct from auth.uid();
  v_closed := a.status = 'Closed';
  v_exc_role := public.is_super_admin() or public.closure_role_in(v_role, c.exception_roles);
  v_exc_pending := coalesce(a.review_status = 'exception_requested', false);   -- a never-submitted action has review_status NULL
  -- The person who asked for the exception, or who submitted the completion, never decides it.
  v_exc_self := a.exception_requested_by is not distinct from auth.uid() or a.submitted_by is not distinct from auth.uid();
  v_waiting := coalesce(a.review_status, '') in ('submitted', 'exception_requested');
  return jsonb_build_object(
    'ok', true,
    'is_assignee', v_assignee,
    'is_reviewer', v_reviewer,
    'can_update', not v_closed and not v_waiting and (v_assignee or v_reviewer),
    'can_submit', not v_closed and not v_waiting and (v_assignee or v_reviewer),
    'can_review', not v_closed and a.review_status = 'submitted' and v_reviewer and (not v_self or c.ca_allow_self_review),
    'self_review_blocked', a.review_status = 'submitted' and v_reviewer and v_self and not c.ca_allow_self_review,
    'can_request_exception', not v_closed and not v_exc_pending and (v_assignee or v_reviewer or v_exc_role),
    'can_decide_exception', not v_closed and v_exc_pending and v_exc_role and not v_exc_self,
    'exception_self_blocked', not v_closed and v_exc_pending and v_exc_role and v_exc_self,
    'waiting_on', case when v_closed then null when a.review_status = 'submitted' then 'reviewer'
                       when v_exc_pending then 'exception_decider' else 'worker' end,
    'min_photos', c.ca_min_photos,
    'review_status', a.review_status);
end $$;
revoke all on function public.corrective_action_my_permissions(uuid) from public;
revoke all on function public.corrective_action_my_permissions(uuid) from anon;
grant execute on function public.corrective_action_my_permissions(uuid) to authenticated;

create or replace function public.corrective_action_worker_update(p_id uuid, p_note text, p_photos jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare a public.corrective_actions; c public.closure_review_config; v_photos jsonb;
begin
  a := public._ca_review_load(p_id);
  c := public.closure_review_settings(a.organisation_id);
  if not (public.corrective_action_is_assignee(a.id, auth.uid())
          or public.is_super_admin() or public.closure_role_in(public.get_my_role(), c.ca_reviewer_roles)) then
    raise exception 'Only the person this action is assigned to can update it.' using errcode = '42501';
  end if;
  if a.status = 'Closed' then raise exception 'This action is closed.' using errcode = 'PT409'; end if;
  if a.review_status = 'submitted' then
    raise exception 'This action is waiting for review. It can be updated again if it is returned.' using errcode = 'PT409';
  end if;
  if a.review_status = 'exception_requested' then
    raise exception 'An exception has been requested on this action. It can be updated again once that is decided.' using errcode = 'PT409';
  end if;
  if length(btrim(coalesce(p_note, ''))) < 3 then
    raise exception 'Write a short note on what was done.' using errcode = '22023';
  end if;
  v_photos := public._ca_clean_photos(p_photos);
  perform set_config('tp.ca_review', 'on', true);
  update public.corrective_actions set status = 'In Progress' where id = a.id and status = 'Open';
  perform set_config('tp.ca_review', '', true);
  perform public._ca_review_event(a, 'progress', p_note, v_photos);
  return jsonb_build_object('ok', true, 'status', 'In Progress');
end $$;
revoke all on function public.corrective_action_worker_update(uuid, text, jsonb) from public;
revoke all on function public.corrective_action_worker_update(uuid, text, jsonb) from anon;
grant execute on function public.corrective_action_worker_update(uuid, text, jsonb) to authenticated;

create or replace function public.corrective_action_submit_completion(p_id uuid, p_note text, p_photos jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare a public.corrective_actions; c public.closure_review_config; v_photos jsonb;
begin
  a := public._ca_review_load(p_id);
  c := public.closure_review_settings(a.organisation_id);
  if not (public.corrective_action_is_assignee(a.id, auth.uid())
          or public.is_super_admin() or public.closure_role_in(public.get_my_role(), c.ca_reviewer_roles)) then
    raise exception 'Only the person this action is assigned to can submit it for review.' using errcode = '42501';
  end if;
  if a.status = 'Closed' then raise exception 'This action is already closed.' using errcode = 'PT409'; end if;
  if a.review_status = 'submitted' then
    raise exception 'This action has already been submitted and is waiting for review.' using errcode = 'PT409';
  end if;
  if a.review_status = 'exception_requested' then
    raise exception 'An exception has been requested on this action. It can be submitted again once that is decided.' using errcode = 'PT409';
  end if;
  if length(btrim(coalesce(p_note, ''))) < 5 then
    raise exception 'Describe what was done to complete this action.' using errcode = '22023';
  end if;
  v_photos := public._ca_clean_photos(p_photos);
  -- Resubmitting after a return without new photographs keeps the ones already stored: a
  -- correction note must not silently drop the evidence. New photographs replace the stored
  -- set (the earlier set stays in the history either way).
  if jsonb_array_length(v_photos) = 0 and a.review_status = 'returned'
     and jsonb_typeof(a.completion_photos) = 'array' and jsonb_array_length(a.completion_photos) > 0 then
    v_photos := a.completion_photos;
  end if;
  if jsonb_array_length(v_photos) < c.ca_min_photos then
    raise exception 'Attach at least % photograph(s) as completion evidence.', c.ca_min_photos using errcode = '22023';
  end if;
  perform set_config('tp.ca_review', 'on', true);
  update public.corrective_actions
     set status = 'In Progress', review_status = 'submitted', submitted_by = auth.uid(), submitted_at = now(),
         completion_note = btrim(p_note), completion_photos = v_photos,
         reviewed_by = null, reviewed_at = null, review_comment = null
   where id = a.id;
  perform set_config('tp.ca_review', '', true);
  perform public._ca_review_event(a, 'submitted', p_note, v_photos);
  return jsonb_build_object('ok', true, 'review_status', 'submitted');
end $$;
revoke all on function public.corrective_action_submit_completion(uuid, text, jsonb) from public;
revoke all on function public.corrective_action_submit_completion(uuid, text, jsonb) from anon;
grant execute on function public.corrective_action_submit_completion(uuid, text, jsonb) to authenticated;

create or replace function public.corrective_action_review(p_id uuid, p_decision text, p_comment text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare a public.corrective_actions; c public.closure_review_config; v_decision text := lower(btrim(coalesce(p_decision, '')));
begin
  a := public._ca_review_load(p_id);
  c := public.closure_review_settings(a.organisation_id);
  if v_decision not in ('approve', 'return') then
    raise exception 'Decision must be approve or return.' using errcode = '22023';
  end if;
  if not (public.is_super_admin() or public.closure_role_in(public.get_my_role(), c.ca_reviewer_roles)) then
    raise exception 'Your role is not set up to review corrective actions in this company.' using errcode = '42501';
  end if;
  if a.status = 'Closed' then raise exception 'This action is already closed.' using errcode = 'PT409'; end if;
  if a.review_status is distinct from 'submitted' then
    raise exception 'Nothing has been submitted for review on this action yet.' using errcode = 'PT409';
  end if;
  if a.submitted_by = auth.uid() and not c.ca_allow_self_review then
    raise exception 'You submitted this action, so another reviewer has to decide it.' using errcode = '42501';
  end if;
  if v_decision = 'return' and length(btrim(coalesce(p_comment, ''))) < 5 then
    raise exception 'Say what has to be corrected before returning the action.' using errcode = '22023';
  end if;
  perform set_config('tp.ca_review', 'on', true);
  if v_decision = 'approve' then
    update public.corrective_actions
       set status = 'Closed', review_status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(),
           review_comment = nullif(btrim(coalesce(p_comment, '')), ''),
           closed_at = now(), closed_by = auth.uid(), resolved_at = coalesce(resolved_at, now()),
           verified_at = now(), verified_by = auth.uid(),
           verification_note = coalesce(nullif(btrim(coalesce(p_comment, '')), ''), 'Closure approved on review')
     where id = a.id;
  else
    update public.corrective_actions
       set status = 'In Progress', review_status = 'returned', reviewed_by = auth.uid(), reviewed_at = now(),
           review_comment = btrim(p_comment)
     where id = a.id;
  end if;
  perform set_config('tp.ca_review', '', true);
  perform public._ca_review_event(a, case when v_decision = 'approve' then 'approved' else 'returned' end, p_comment,
                                  coalesce(a.completion_photos, '[]'::jsonb));
  return jsonb_build_object('ok', true, 'decision', v_decision,
                            'status', case when v_decision = 'approve' then 'Closed' else 'In Progress' end);
end $$;
revoke all on function public.corrective_action_review(uuid, text, text) from public;
revoke all on function public.corrective_action_review(uuid, text, text) from anon;
grant execute on function public.corrective_action_review(uuid, text, text) to authenticated;

-- An exception is a REQUEST. Asking never closes the action.
create or replace function public.corrective_action_request_exception(p_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare a public.corrective_actions; c public.closure_review_config; v_role text := public.get_my_role();
begin
  a := public._ca_review_load(p_id);
  c := public.closure_review_settings(a.organisation_id);
  if not (public.corrective_action_is_assignee(a.id, auth.uid()) or public.is_super_admin()
          or public.closure_role_in(v_role, c.ca_reviewer_roles) or public.closure_role_in(v_role, c.exception_roles)) then
    raise exception 'Only the person this action is assigned to, a reviewer or an exception approver can ask for an exception.' using errcode = '42501';
  end if;
  if a.status = 'Closed' then raise exception 'This action is already closed.' using errcode = 'PT409'; end if;
  if a.review_status = 'exception_requested' then
    raise exception 'An exception has already been requested on this action and is waiting for a decision.' using errcode = 'PT409';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'An exception needs a written reason of at least 10 characters.' using errcode = '22023';
  end if;
  perform set_config('tp.ca_review', 'on', true);
  update public.corrective_actions
     set status = case when status = 'Open' then 'In Progress' else status end,
         review_status = 'exception_requested',
         exception_requested_by = auth.uid(), exception_requested_at = now(), exception_reason = btrim(p_reason),
         reviewed_by = null, reviewed_at = null, review_comment = null
   where id = a.id;
  perform set_config('tp.ca_review', '', true);
  perform public._ca_review_event(a, 'exception_requested', p_reason, coalesce(a.completion_photos, '[]'::jsonb));
  return jsonb_build_object('ok', true, 'review_status', 'exception_requested');
end $$;
revoke all on function public.corrective_action_request_exception(uuid, text) from public;
revoke all on function public.corrective_action_request_exception(uuid, text) from anon;
grant execute on function public.corrective_action_request_exception(uuid, text) to authenticated;

-- Deciding an exception. The person who asked for it, and the person who submitted the
-- completion, can NEVER decide it. No company setting relaxes this and it binds super admins.
create or replace function public.corrective_action_decide_exception(p_id uuid, p_decision text, p_comment text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare a public.corrective_actions; c public.closure_review_config; v_decision text := lower(btrim(coalesce(p_decision, '')));
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  a := public._ca_review_load(p_id);
  c := public.closure_review_settings(a.organisation_id);
  if v_decision not in ('approve', 'refuse') then
    raise exception 'Decision must be approve or refuse.' using errcode = '22023';
  end if;
  if not (public.is_super_admin() or public.closure_role_in(public.get_my_role(), c.exception_roles)) then
    raise exception 'Your role is not authorised to decide an exception.' using errcode = '42501';
  end if;
  if a.status = 'Closed' then raise exception 'This action is already closed.' using errcode = 'PT409'; end if;
  if a.review_status is distinct from 'exception_requested' then
    raise exception 'No exception has been requested on this action.' using errcode = 'PT409';
  end if;
  if a.exception_requested_by is not distinct from auth.uid() then
    raise exception 'You asked for this exception, so another authorised person has to decide it.' using errcode = '42501';
  end if;
  if a.submitted_by is not distinct from auth.uid() then
    raise exception 'You submitted this action, so another authorised person has to decide its exception.' using errcode = '42501';
  end if;
  if v_decision = 'refuse' and length(coalesce(v_comment, '')) < 5 then
    raise exception 'Say why the exception is refused.' using errcode = '22023';
  end if;
  perform set_config('tp.ca_review', 'on', true);
  if v_decision = 'approve' then
    update public.corrective_actions
       set status = 'Closed', review_status = 'exception', reviewed_by = auth.uid(), reviewed_at = now(),
           review_comment = a.exception_reason, closed_at = now(), closed_by = auth.uid()
     where id = a.id;
  else
    update public.corrective_actions
       set status = 'In Progress', review_status = 'returned', reviewed_by = auth.uid(), reviewed_at = now(),
           review_comment = v_comment
     where id = a.id;
  end if;
  perform set_config('tp.ca_review', '', true);
  perform public._ca_review_event(a, case when v_decision = 'approve' then 'exception' else 'exception_refused' end,
    case when v_decision = 'approve'
         then a.exception_reason || coalesce(E'\nDecision note: ' || v_comment, '')
         else v_comment end, '[]'::jsonb);
  return jsonb_build_object('ok', true, 'decision', v_decision,
                            'status', case when v_decision = 'approve' then 'Closed' else 'In Progress' end,
                            'review_status', case when v_decision = 'approve' then 'exception' else 'returned' end);
end $$;
revoke all on function public.corrective_action_decide_exception(uuid, text, text) from public;
revoke all on function public.corrective_action_decide_exception(uuid, text, text) from anon;
grant execute on function public.corrective_action_decide_exception(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------- 6. guard
create or replace function public.corrective_action_review_guard()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare c public.closure_review_config; v_via boolean := coalesce(current_setting('tp.ca_review', true), '') = 'on';
  v_reviewer boolean;
begin
  if v_via then return new; end if;

  -- Review columns belong to the writers.
  if (new.review_status, new.submitted_by, new.submitted_at, new.completion_note, new.completion_photos,
      new.reviewed_by, new.reviewed_at, new.review_comment,
      new.exception_requested_by, new.exception_requested_at, new.exception_reason)
     is distinct from
     (old.review_status, old.submitted_by, old.submitted_at, old.completion_note, old.completion_photos,
      old.reviewed_by, old.reviewed_at, old.review_comment,
      old.exception_requested_by, old.exception_requested_at, old.exception_reason) then
    raise exception 'Review details are recorded by the review steps and cannot be edited directly.' using errcode = '42501';
  end if;

  if new.status is not distinct from old.status then return new; end if;
  -- Imports, scheduled jobs and other callers with no signed-in person keep today's behaviour.
  if auth.uid() is null then return new; end if;

  c := public.closure_review_settings(new.organisation_id);
  v_reviewer := public.is_super_admin() or public.closure_role_in(public.get_my_role(), c.ca_reviewer_roles);

  if new.status = 'Closed' then
    if not v_reviewer then
      raise exception 'Closing an action needs a reviewer. Submit your completion evidence and a reviewer will close it.' using errcode = '42501';
    end if;
    if not c.ca_allow_direct_close then
      raise exception 'Close this action through review: submit completion evidence, then approve it.' using errcode = '42501';
    end if;
    -- A requested exception is decided by the exception step only, never through the status field.
    if old.review_status = 'exception_requested' then
      raise exception 'An exception has been requested on this action. Approve or refuse the exception first.' using errcode = 'PT409';
    end if;
    if old.review_status = 'submitted' and old.submitted_by = auth.uid() and not c.ca_allow_self_review then
      raise exception 'You submitted this action, so another reviewer has to close it.' using errcode = '42501';
    end if;
    new.review_status := 'approved';
    new.reviewed_by := auth.uid();
    new.reviewed_at := now();
    new.closed_by := coalesce(new.closed_by, auth.uid());
    new.closed_at := coalesce(new.closed_at, now());
    perform public._ca_review_event(new, 'direct_closed', 'Closed directly by a reviewer, without a submitted completion.',
                                    coalesce(old.completion_photos, '[]'::jsonb));
    return new;
  end if;

  if old.status = 'Closed' then
    if not v_reviewer then
      raise exception 'Only a reviewer can reopen a closed action.' using errcode = '42501';
    end if;
    new.review_status := null;
    perform public._ca_review_event(new, 'reopened', 'Reopened after closure.', '[]'::jsonb);
    return new;
  end if;

  -- Open <-> In Progress while a submission is waiting would pull it out from under the reviewer.
  if old.review_status = 'submitted' then
    raise exception 'This action is waiting for review. Approve it or return it first.' using errcode = 'PT409';
  end if;
  if old.review_status = 'exception_requested' then
    raise exception 'An exception has been requested on this action. Approve or refuse the exception first.' using errcode = 'PT409';
  end if;
  return new;
end $$;
revoke all on function public.corrective_action_review_guard() from public;
revoke all on function public.corrective_action_review_guard() from anon, authenticated;
create trigger trg_ca_review_guard before update on public.corrective_actions
  for each row execute function public.corrective_action_review_guard();

select anum_integration.apply_reader_policies();
