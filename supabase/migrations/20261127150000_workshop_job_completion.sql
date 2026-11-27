-- STATUS: AUTHORED, NOT APPLIED. Needs the owner's go-ahead before it is applied.
--         The VERIFY block at the bottom was run live inside a transaction that
--         was rolled back (nothing was kept).
--
-- Workshop job completion: the technician finishes a job on the phone, and a
-- SUPERVISOR passes or returns it. Nothing a technician does closes a job.
--
-- Checked against the LIVE schema before writing (2026-11-27):
--   * wo_write_guard requires work_order_can('qc') for ANY qc_status change.
--     Technician roles (Mechanic, Diesel Mechanic, Electrician, Tyre Man ...)
--     only hold {progress} scoped to jobs assigned to them, so the submit RPC
--     must NOT touch qc_status. It only sets status 'Quality Inspection' (a
--     progress key; work_order_is_closed('Quality Inspection') is false).
--     "Waiting for the supervisor" is carried by
--     work_order_completions.status = 'submitted'.
--   * work_order_can(p_action, p_org, p_country, p_site, p_is_tyre, p_job_id);
--     work_order_can_job(p_action, p_job_id) resolves the job's own scope.
--   * odometer_logs(odometer_km, reading_date, source, client_uuid unique),
--     engine_hours_logs(engine_hours, reading_date, source, client_uuid unique).
--   * wo_tasks.status in pending | in_progress | blocked | done | qc.
--   * workflow_notifications needs a domain_events row (event_id not null);
--     same pattern as tp_notify_action_assignee / workshop_status_notice_send,
--     delivered by the existing pg_cron deliverer with a pre-rendered push.
--   * storage tyre-photos is org-scoped by the object's OWNER
--     (storage_object_in_my_org(owner)), not by a path prefix. So a completion
--     photo must be tp-storage://tyre-photos/modules/workshop/... AND the object
--     must exist AND be owned by the technician who submits it.
--   * Data-desk roles that exist live: 'Data Monitor Officer' (custom role, 1
--     user) and 'Tyre Data Collector' (8 users). No 'Data Entry' role exists;
--     'Inventory Controller' is a stock role and is deliberately not included.
--
-- Flow:
--   technician submit  -> completion 'submitted', job status 'Quality Inspection'
--                         (qc_status untouched), task marked done, meters logged,
--                         the site's supervisors notified
--   supervisor pass    -> decide_job_completion(...,'pass')   -> job Completed,
--                         qc passed, completion approved, technician told
--   supervisor return  -> decide_job_completion(...,'return') -> job In Progress,
--                         qc failed, completion returned (note required). The
--                         assignment is KEPT as it is (no automatic re-assign,
--                         owner ruling 2026-11-27). The data desk of that
--                         site/country (Data Monitor Officer, Tyre Data
--                         Collector) is notified and sees it in their
--                         "Returned" queue with the reason; a supervisor or the
--                         data monitor reassigns. The technician is told too.
--   Review fixes (2026-11-27): photos fingerprinted at submit and locked in
--   storage; a pass is refused if they changed or tasks are still open; one
--   task done while others are open is kind 'partial' (job stays, nobody
--   asked); meter jumps past the flag_meter_regression bounds are held on the
--   completion instead of logged; the data desk never passes/closes and only
--   reads returned completions; a resubmit clears qc_status.
--   Web QC buttons that write work_orders directly still stamp the completion
--   through the decision trigger, so phone and web read one answer.
--
-- Owner rule: the person who submitted a completion, and anyone actively
-- assigned to the job, cannot pass, return or close it - unless Admin or an
-- area manager. Enforced in the database (trigger + RPC), so no client can
-- sidestep it.
--
-- Rollback (at the bottom) drops only what this file creates and restores
-- wo_write_guard from the copy this file keeps.

-- 0. Backup of the guard this file patches ---------------------------------
create table if not exists public._bak_wo_write_guard_20261127 (
  saved_at timestamptz not null default now(),
  definition text not null
);
alter table public._bak_wo_write_guard_20261127 enable row level security;
revoke all on public._bak_wo_write_guard_20261127 from public, anon, authenticated;
insert into public._bak_wo_write_guard_20261127 (definition)
select pg_get_functiondef('public.wo_write_guard()'::regprocedure)
 where not exists (select 1 from public._bak_wo_write_guard_20261127);

-- 1. Evidence table --------------------------------------------------------
create table if not exists public.work_order_completions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  country text,
  site text,
  job_id uuid not null references public.work_orders(id) on delete restrict,
  task_id uuid,
  asset_no text,
  submitted_by uuid not null,
  -- 'primary' moves the job to the supervisor; 'extra' is a second
  -- technician's evidence on a job already waiting for the supervisor;
  -- 'partial' is one task finished while other tasks of the job are still
  -- open (the job stays where it is and nobody is asked to pass it yet).
  kind text not null default 'primary' check (kind in ('primary', 'extra', 'partial')),
  work_done text not null check (length(btrim(work_done)) between 3 and 2000),
  quick_picks text[] not null default '{}' check (cardinality(quick_picks) <= 12),
  parts_used jsonb not null default '[]'::jsonb
    check (jsonb_typeof(parts_used) = 'array' and jsonb_array_length(parts_used) <= 50),
  before_photos jsonb not null default '[]'::jsonb
    check (jsonb_typeof(before_photos) = 'array' and jsonb_array_length(before_photos) <= 3),
  after_photos jsonb not null
    check (jsonb_typeof(after_photos) = 'array'
           and jsonb_array_length(after_photos) between 1 and 3),
  km numeric check (km is null or (km >= 0 and km < 100000000)),
  engine_hours numeric check (engine_hours is null or (engine_hours >= 0 and engine_hours < 10000000)),
  signature text not null check (length(signature) between 31 and 400000),
  -- Fingerprint of every photo object at submit time
  -- [{ref, object_id, version, etag, size, updated_at}]. A pass is refused
  -- when any of them no longer matches storage.objects (replaced or removed).
  evidence_objects jsonb not null default '[]'::jsonb
    check (jsonb_typeof(evidence_objects) = 'array'),
  -- Meter readings that jumped past the meter rules are NOT written to the
  -- meter logs (they would move current_km unreviewed); the values stay on
  -- km / engine_hours and the reason is kept here for the supervisor.
  meter_held jsonb check (meter_held is null or jsonb_typeof(meter_held) = 'object'),
  completed_at timestamptz not null,
  status text not null default 'submitted'
    check (status in ('submitted', 'approved', 'returned')),
  decided_by uuid,
  decided_at timestamptz,
  decision_note text check (decision_note is null or length(decision_note) <= 1000),
  decision_client_uuid text,
  client_uuid text not null check (length(client_uuid) between 8 and 120),
  created_at timestamptz not null default now()
);

create unique index if not exists work_order_completions_submitter_key_uidx
  on public.work_order_completions (submitted_by, client_uuid);
create index if not exists work_order_completions_job_idx
  on public.work_order_completions (job_id, created_at desc);
create index if not exists work_order_completions_open_idx
  on public.work_order_completions (organisation_id, status, created_at desc);
-- Used by the storage lock (is this photo referenced by a completion?).
create index if not exists work_order_completions_after_photos_gin
  on public.work_order_completions using gin (after_photos jsonb_path_ops);
create index if not exists work_order_completions_before_photos_gin
  on public.work_order_completions using gin (before_photos jsonb_path_ops);

-- The data desk that picks up a returned job (owner ruling 2026-11-27).
create or replace function public._job_completion_return_desk_roles()
returns text[]
language sql
immutable
set search_path = public
as $$ select array['Data Monitor Officer', 'Tyre Data Collector']::text[] $$;

create or replace function public._job_completion_is_return_desk()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select p.role = any (public._job_completion_return_desk_roles())
      from public.profiles p
     where p.id = auth.uid() and coalesce(p.approved, false) and not coalesce(p.locked, false)
  ), false);
$$;

alter table public.work_order_completions enable row level security;

create policy work_order_completions_org_isolation on public.work_order_completions
  as restrictive for all to authenticated
  using ((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()))
  with check ((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()));

create policy work_order_completions_country_isolation on public.work_order_completions
  as restrictive for select to authenticated
  using ((country is null) or (select public.is_super_admin()) or (select public.app_sees_all_countries())
         or (lower(btrim(country)) = any (coalesce((select public.app_country_scope()), '{}'::text[]))));

create policy work_order_completions_site_isolation on public.work_order_completions
  as restrictive for select to authenticated
  using ((site is null) or (btrim(site) = '') or (select public.app_sees_all_sites())
         or (upper(btrim(site)) = any (coalesce((select public.app_site_scope()), '{}'::text[]))));

-- Read: the technician who submitted it; whoever may record the quality
-- check on that job (the job's own org/country/site/tyre scope); and the
-- data desk for RETURNED completions only (country/site still bound above).
-- The data desk never passes or closes, so it does not get the quality-check
-- branch even when an Access Control grant gives it work_orders edit.
create policy work_order_completions_read on public.work_order_completions
  for select to authenticated
  using (submitted_by = auth.uid()
         or (public.work_order_can_job('qc', job_id)
             and not (select public._job_completion_is_return_desk()))
         or (status = 'returned' and (select public._job_completion_is_return_desk())));

-- No client INSERT / UPDATE / DELETE: writes only through the two RPCs and
-- the decision trigger below.
revoke all on public.work_order_completions from public, anon;
revoke insert, update, delete, truncate, trigger, references on public.work_order_completions from authenticated;
grant select on public.work_order_completions to authenticated;

-- 2. wo_write_guard: one narrow pass-through for the submit RPC ------------
-- submit_job_completion checks the assignment itself (including an
-- assignment released after the work was done, which work_order_can no
-- longer sees) and then moves the job to Quality Inspection. The guard lets
-- that one change through ONLY when the transaction-local flag names this
-- job, the only columns changed are status (to Quality Inspection) and
-- qc_status cleared to null (a resubmit after a return must not carry the
-- old 'failed'). Patched by anchored replacement of the LIVE body (never
-- retyped); aborts unless the anchor occurs exactly once.
do $patch$
declare
  v_def text := pg_get_functiondef('public.wo_write_guard()'::regprocedure);
  v_anchor constant text := '(  NEW\.created_at := OLD\.created_at;\r?\n)';
  v_block constant text :=
    E'\n  -- Job completion submit (submit_job_completion, 20261127150000): status to\n'
    || E'  -- Quality Inspection and qc_status cleared only; assignment checked by the RPC.\n'
    || E'  if current_setting(''tp.job_completion_submit'', true) = OLD.id::text\n'
    || E'     and (to_jsonb(NEW) - c_ignore - ''status'' - ''qc_status'') = (to_jsonb(OLD) - c_ignore - ''status'' - ''qc_status'')\n'
    || E'     and (NEW.qc_status is null or NEW.qc_status is not distinct from OLD.qc_status)\n'
    || E'     and lower(btrim(NEW.status::text)) = ''quality inspection''\n'
    || E'     and not public.work_order_is_closed(OLD.status::text) then\n'
    || E'    return NEW;\n'
    || E'  end if;\n';
begin
  if position('tp.job_completion_submit' in v_def) > 0 then
    return; -- already patched
  end if;
  if regexp_count(v_def, v_anchor) <> 1 then
    raise exception 'wo_write_guard anchor not found exactly once; refusing to patch';
  end if;
  execute regexp_replace(v_def, v_anchor, '\1' || replace(v_block, '\', '\\'));
end
$patch$;

-- 3. Helpers ---------------------------------------------------------------
-- Admin, super admin or an area manager may decide a job they are on.
create or replace function public._job_completion_decider_exempt(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select coalesce(p.is_super_admin, false)
        or p.role in ('Admin', 'Workshop Area Manager', 'Workshop Maintenance Area Manager')
      from public.profiles p
     where p.id = p_uid
  ), false);
$$;

-- True when p_uid finished work on, or is currently working, job p_job.
create or replace function public._job_completion_is_party(p_job uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_uid is not null and (
    exists (select 1 from public.work_order_completions c
             where c.job_id = p_job and c.submitted_by = p_uid
               and (c.status = 'submitted' or c.decided_at = now()))
    or exists (select 1 from public.work_orders w where w.id = p_job and w.assigned_owner_id = p_uid)
    or exists (select 1 from public.wo_assignments a
                where a.job_id = p_job and a.user_id = p_uid and a.active is true)
    or exists (select 1 from public.wo_tasks t where t.job_id = p_job and t.assignee_user_id = p_uid));
$$;

-- In-app notice + phone push to one person. Never raises: a notice that
-- cannot be sent must not undo the business write.
create or replace function public._job_completion_notify(
  p_org uuid, p_user uuid, p_title text, p_body text, p_job uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tokens jsonb;
  v_event bigint;
begin
  if p_user is null then return; end if;
  begin
    insert into public.notifications (user_id, type, title, body, entity_type, entity_id)
    values (p_user, 'work_order', left(p_title, 140), left(p_body, 500), 'work_order', p_job);
    if to_regprocedure('public._user_push_tokens(uuid)') is not null then
      select coalesce(jsonb_agg(jsonb_build_object('user_id', p_user, 'push_token', t.tok)), '[]'::jsonb)
        into v_tokens from public._user_push_tokens(p_user) as t(tok);
      if jsonb_array_length(v_tokens) > 0 then
        insert into public.domain_events (event_type, entity_type, entity_id, organisation_id, payload, status, processed_at)
        values ('workshop.job_completion', 'work_order', p_job::text, p_org,
                jsonb_build_object('user_id', p_user), 'processed', clock_timestamp())
        returning id into v_event;
        insert into public.workflow_notifications
          (event_id, organisation_id, instance_id, event_type, payload, recipient_count, status)
        values (v_event, p_org, null, 'workshop.job_completion',
                jsonb_build_object('event_type', 'workshop.job_completion',
                  'entity_type', 'work_order', 'entity_id', p_job,
                  'push', jsonb_build_object('title', left(p_title, 140), 'body', left(p_body, 500)),
                  'recipients', v_tokens),
                jsonb_array_length(v_tokens), 'pending');
      end if;
    end if;
  exception when others then
    null;
  end;
end;
$$;

-- People in the job's org who may see the job's country and site, by role.
create or replace function public._job_completion_people(
  p_org uuid, p_country text, p_site text, p_exclude uuid, p_supervisors boolean)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.id
    from public.profiles p
   where p.id is distinct from p_exclude
     and coalesce(p.approved, false) and not coalesce(p.locked, false)
     and (p.org_id = p_org or p.organisation_id = p_org)
     and (
       (p_supervisors
        -- The data desk never passes or closes a job, so it is never asked to.
        and not (p.role = any (public._job_completion_return_desk_roles()))
        and exists (
          select 1 from public.work_order_role_rules r
           where r.active and lower(btrim(r.role)) = lower(btrim(p.role))
             and (r.organisation_id is null or r.organisation_id = p_org)
             and 'qc' = any (r.actions) and 'close' = any (r.actions)
             and r.scope = 'all'))
       or (not p_supervisors and p.role = any (public._job_completion_return_desk_roles())))
     and (p_country is null or exists (
          select 1 from unnest(coalesce(p.country, '{}'::text[])) c
           where lower(btrim(c)) in (lower(btrim(p_country)), 'all')))
     and (coalesce(btrim(p_site), '') = '' or exists (
          select 1 from unnest(coalesce(p.sites, '{}'::text[])) s
           where upper(btrim(s)) in ('ALL', '*', upper(btrim(p_site)))))
   limit 50;
$$;

-- Tasks of the job still open (anything not 'done'), optionally ignoring one.
create or replace function public._job_completion_open_tasks(p_job uuid, p_except uuid default null)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int from public.wo_tasks t
   where t.job_id = p_job and t.status <> 'done'
     and t.id is distinct from p_except;
$$;

-- Fingerprint of one tp-storage photo as it is now (null when missing).
create or replace function public._job_completion_photo_print(p_ref text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
           'ref', p_ref, 'object_id', o.id, 'version', o.version,
           'etag', o.metadata->>'eTag', 'size', o.metadata->>'size',
           'updated_at', o.updated_at)
    from storage.objects o
   where o.bucket_id = 'tyre-photos'
     and o.name = substring(p_ref from '^tp-storage://tyre-photos/(.+)$')
   limit 1;
$$;

-- True when any photo of a completion waiting on job p_job no longer matches
-- the fingerprint taken at submit (replaced, re-uploaded or removed).
create or replace function public._job_completion_evidence_changed(p_job uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.work_order_completions c
      cross join lateral jsonb_array_elements(c.evidence_objects) e
     where c.job_id = p_job and c.status = 'submitted'
       and public._job_completion_photo_print(e->>'ref') is distinct from e);
$$;

-- Storage lock: a workshop photo referenced by a completion may not be
-- overwritten or deleted, except by Admin / super admin.
create or replace function public._job_completion_photo_locked(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_name like 'modules/workshop/%'
     and not coalesce((select coalesce(p.is_super_admin, false) or p.role = 'Admin'
                         from public.profiles p where p.id = auth.uid()), false)
     and exists (
       select 1 from public.work_order_completions c
        where c.after_photos @> jsonb_build_array('tp-storage://tyre-photos/' || p_name)
           or c.before_photos @> jsonb_build_array('tp-storage://tyre-photos/' || p_name));
$$;

-- Same bounds as flag_meter_regression (20261111107000, 20261122211000):
--   km    implausible: > 3x the current km AND > +20,000 km, or a first
--         reading above 2,000,000 km; big jump: more than
--         system_config.meter_max_km_per_day (default 500) km per day since
--         the last accepted reading, and more than that in total.
--   hours big jump: more than 24 h AND more than 24 h per elapsed day + 2.
-- Returns the reason (held for the supervisor) or null (safe to log).
create or replace function public._job_completion_meter_reason(
  p_kind text, p_org uuid, p_country text, p_asset text, p_value numeric, p_day date)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_prev numeric; v_last numeric; v_last_day date; v_days numeric; v_max numeric;
begin
  if p_value is null or btrim(coalesce(p_asset, '')) = '' then return null; end if;
  if p_kind = 'km' then
    select vf.current_km into v_prev from public.vehicle_fleet vf
     where btrim(vf.asset_no) = btrim(p_asset)
       and vf.organisation_id is not distinct from p_org
       and (p_country is null or vf.country is null or lower(btrim(vf.country)) = lower(btrim(p_country)))
     limit 1;
    if (v_prev is not null and v_prev > 0 and p_value > v_prev * 3 and p_value > v_prev + 20000)
       or (v_prev is null and p_value > 2000000) then
      return format('Odometer %s km against current %s km looks wrong (extra digit?).',
                    p_value, coalesce(v_prev::text, 'none'));
    end if;
    select o.odometer_km, o.reading_date into v_last, v_last_day
      from public.odometer_logs o
     where btrim(o.asset_no) = btrim(p_asset)
       and o.organisation_id is not distinct from p_org
       and (p_country is null or o.country is null or lower(btrim(o.country)) = lower(btrim(p_country)))
       and o.odometer_km is not null
       and not (coalesce(o.flagged, false) and coalesce(o.flag_reason, '') like 'Implausible reading%')
       and coalesce(o.reading_date, current_date) <= p_day
     order by o.reading_date desc nulls last, o.created_at desc
     limit 1;
    if v_last is not null and p_value > v_last then
      v_days := greatest(1, p_day - coalesce(v_last_day, p_day));
      begin
        select nullif(btrim(value::text, '" '), '')::numeric into v_max
          from public.system_config where key = 'meter_max_km_per_day';
      exception when others then v_max := null;
      end;
      v_max := coalesce(v_max, 500);
      if p_value - v_last > v_max and (p_value - v_last) / v_days > v_max then
        return format('Odometer +%s km in %s day(s) since the last reading (%s km) is more than %s km a day.',
                      round(p_value - v_last), v_days, v_last, v_max);
      end if;
    end if;
  elsif p_kind = 'hours' then
    select e.engine_hours, e.reading_date into v_last, v_last_day
      from public.engine_hours_logs e
     where btrim(e.asset_no) = btrim(p_asset)
       and e.organisation_id is not distinct from p_org
       and e.engine_hours is not null
       and coalesce(e.reading_date, current_date) <= p_day
     order by e.reading_date desc nulls last, e.created_at desc limit 1;
    if v_last is not null and p_value > v_last then
      v_days := greatest(1, p_day - coalesce(v_last_day, p_day));
      if p_value - v_last > 24 and p_value - v_last > v_days * 24 + 2 then
        return format('Hour meter +%s h in %s day(s) since the last reading (%s h) is more than the hours in that time.',
                      round(p_value - v_last, 1), v_days, v_last);
      end if;
    end if;
  end if;
  return null;
end;
$$;

-- 4. Submit RPC (queued command JOB_COMPLETION) ----------------------------
-- Answers in the offline queue's RPC shape: {accepted:[key]} /
-- {duplicates:[key]} / {rejected:[{client_uuid, reason}]}. A refusal is a
-- plain sentence the phone shows as "Failed: <reason>".
create or replace function public.submit_job_completion(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_key text;
  v_job uuid;
  v_task uuid;
  v_km numeric;
  v_hours numeric;
  v_at timestamptz;
  v_work text;
  v_sig text;
  v_picks text[] := '{}';
  v_parts jsonb := '[]'::jsonb;
  v_before jsonb := '[]'::jsonb;
  v_after jsonb := '[]'::jsonb;
  v_wo record;
  v_kind text := 'primary';
  v_moved boolean := false;
  v_item jsonb;
  v_ref text;
  v_path text;
  v_name text;
  v_tech_name text;
  v_person uuid;
  v_print jsonb;
  v_evidence jsonb := '[]'::jsonb;
  v_held jsonb := '{}'::jsonb;
  v_reason text;
  c_ref constant text := '^tp-storage://tyre-photos/(modules/workshop/[A-Za-z0-9_-]{1,40}/[A-Za-z0-9._-]{1,120})$';
begin
  if v_uid is null then
    raise exception 'Sign in to complete a job.' using errcode = '42501';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return jsonb_build_object('rejected', jsonb_build_array(
      jsonb_build_object('client_uuid', null, 'reason', 'This completion could not be read.')));
  end if;
  v_key := nullif(btrim(p_payload->>'client_uuid'), '');
  if v_key is null or length(v_key) not between 8 and 120 then
    return jsonb_build_object('rejected', jsonb_build_array(
      jsonb_build_object('client_uuid', v_key, 'reason', 'This completion has no identity and was not sent.')));
  end if;
  -- Idempotency is per technician: another user's key never matches.
  if exists (select 1 from public.work_order_completions
              where submitted_by = v_uid and client_uuid = v_key) then
    return jsonb_build_object('duplicates', jsonb_build_array(v_key));
  end if;

  -- 4a. Read and validate the payload. Any bad cast or shape is a refusal,
  --     never a 500.
  begin
    v_job := (p_payload->>'job_id')::uuid;
    v_task := nullif(btrim(coalesce(p_payload->>'task_id', '')), '')::uuid;
    v_km := nullif(btrim(coalesce(p_payload->>'km', '')), '')::numeric;
    v_hours := nullif(btrim(coalesce(p_payload->>'engine_hours', '')), '')::numeric;
    v_at := coalesce(nullif(btrim(coalesce(p_payload->>'completed_at', '')), '')::timestamptz, now());
    v_work := btrim(coalesce(p_payload->>'work_done', ''));
    v_sig := coalesce(p_payload->>'signature', '');

    if coalesce(jsonb_typeof(p_payload->'quick_picks'), 'null') not in ('array', 'null')
       or coalesce(jsonb_typeof(p_payload->'parts_used'), 'null') not in ('array', 'null')
       or coalesce(jsonb_typeof(p_payload->'before_photos'), 'null') not in ('array', 'null')
       or coalesce(jsonb_typeof(p_payload->'after_photos'), 'null') not in ('array', 'null') then
      raise exception using errcode = '22023', message = 'shape';
    end if;
    if jsonb_array_length(coalesce(nullif(p_payload->'quick_picks', 'null'::jsonb), '[]')) > 12
       or jsonb_array_length(coalesce(nullif(p_payload->'parts_used', 'null'::jsonb), '[]')) > 50
       or jsonb_array_length(coalesce(nullif(p_payload->'before_photos', 'null'::jsonb), '[]')) > 3
       or jsonb_array_length(coalesce(nullif(p_payload->'after_photos', 'null'::jsonb), '[]')) > 3 then
      raise exception using errcode = '22023', message = 'size';
    end if;
    select coalesce(array_agg(left(btrim(x), 40)), '{}')
      into v_picks
      from jsonb_array_elements_text(coalesce(nullif(p_payload->'quick_picks', 'null'::jsonb), '[]')) x
     where btrim(x) <> '';
    for v_item in select * from jsonb_array_elements(coalesce(nullif(p_payload->'parts_used', 'null'::jsonb), '[]')) loop
      v_name := btrim(coalesce(v_item->>'name', ''));
      if jsonb_typeof(v_item) <> 'object' or v_name = '' or length(v_name) > 200
         or (v_item ? 'qty' and ((v_item->>'qty')::numeric <= 0 or (v_item->>'qty')::numeric > 100000)) then
        raise exception using errcode = '22023', message = 'part';
      end if;
      v_parts := v_parts || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'name', v_name,
        'qty', coalesce((v_item->>'qty')::numeric, 1),
        'request_id', nullif(v_item->>'request_id', '')::uuid)));
    end loop;
  exception when others then
    return jsonb_build_object('rejected', jsonb_build_array(
      jsonb_build_object('client_uuid', v_key, 'reason', 'This completion could not be read. Open the job and finish it again.')));
  end;

  if v_at > now() + interval '10 minutes' then v_at := now(); end if;
  if length(v_work) < 3 or length(v_work) > 2000 then
    return jsonb_build_object('rejected', jsonb_build_array(
      jsonb_build_object('client_uuid', v_key, 'reason', 'Describe what was done.')));
  end if;
  if length(v_sig) < 31 or length(v_sig) > 400000 or left(v_sig, 11) <> 'data:image/' then
    return jsonb_build_object('rejected', jsonb_build_array(
      jsonb_build_object('client_uuid', v_key, 'reason', 'Sign the completion.')));
  end if;
  if (v_km is not null and (v_km < 0 or v_km >= 100000000))
     or (v_hours is not null and (v_hours < 0 or v_hours >= 10000000)) then
    return jsonb_build_object('rejected', jsonb_build_array(
      jsonb_build_object('client_uuid', v_key, 'reason', 'A meter reading is not valid.')));
  end if;

  -- 4b. The job: country / site / asset come from the work order only.
  select id, organisation_id, country, site, asset_no, status, assigned_owner_id, work_order_no
    into v_wo
    from public.work_orders
   where id = v_job
     and (organisation_id = public.app_current_org() or public.is_super_admin())
   for update;
  if not found then
    return jsonb_build_object('rejected', jsonb_build_array(
      jsonb_build_object('client_uuid', v_key, 'reason', 'This job could not be found.')));
  end if;
  if public.work_order_is_closed(v_wo.status::text) then
    return jsonb_build_object('rejected', jsonb_build_array(
      jsonb_build_object('client_uuid', v_key, 'reason', 'This job was closed before your completion arrived.')));
  end if;

  -- Assigned when the work was done: owner, an assignment active at
  -- completed_at (even if released since), or the task's assignee.
  if not (v_wo.assigned_owner_id is not distinct from v_uid
     or exists (select 1 from public.wo_assignments a
                 where a.job_id = v_job and a.user_id = v_uid
                   and a.assigned_at <= v_at
                   and (a.active is true or a.released_at is null or a.released_at >= v_at))
     or exists (select 1 from public.wo_tasks t
                 where t.job_id = v_job and t.assignee_user_id = v_uid)) then
    return jsonb_build_object('rejected', jsonb_build_array(
      jsonb_build_object('client_uuid', v_key, 'reason', 'This job was not assigned to you when the work was done.')));
  end if;
  if v_task is not null and not exists (
       select 1 from public.wo_tasks t where t.id = v_task and t.job_id = v_job) then
    return jsonb_build_object('rejected', jsonb_build_array(
      jsonb_build_object('client_uuid', v_key, 'reason', 'This task does not belong to the job.')));
  end if;

  -- Photos: our own workshop uploads only, already on the server.
  for v_ref in select x from jsonb_array_elements_text(coalesce(nullif(p_payload->'after_photos', 'null'::jsonb), '[]')) x loop
    v_path := substring(v_ref from c_ref);
    if v_path is null or not exists (
         select 1 from storage.objects o
          where o.bucket_id = 'tyre-photos' and o.name = v_path and o.owner = v_uid) then
      return jsonb_build_object('rejected', jsonb_build_array(
        jsonb_build_object('client_uuid', v_key, 'reason', 'A photo of the finished work is missing on the server. Take it again.')));
    end if;
    v_after := v_after || to_jsonb(v_ref);
    v_print := public._job_completion_photo_print(v_ref);
    if v_print is not null then v_evidence := v_evidence || jsonb_build_array(v_print); end if;
  end loop;
  for v_ref in select x from jsonb_array_elements_text(coalesce(nullif(p_payload->'before_photos', 'null'::jsonb), '[]')) x loop
    v_path := substring(v_ref from c_ref);
    if v_path is null or not exists (
         select 1 from storage.objects o
          where o.bucket_id = 'tyre-photos' and o.name = v_path and o.owner = v_uid) then
      return jsonb_build_object('rejected', jsonb_build_array(
        jsonb_build_object('client_uuid', v_key, 'reason', 'A before photo is missing on the server. Take it again.')));
    end if;
    v_before := v_before || to_jsonb(v_ref);
    v_print := public._job_completion_photo_print(v_ref);
    if v_print is not null then v_evidence := v_evidence || jsonb_build_array(v_print); end if;
  end loop;
  if jsonb_array_length(v_after) < 1 then
    return jsonb_build_object('rejected', jsonb_build_array(
      jsonb_build_object('client_uuid', v_key, 'reason', 'Add at least one photo of the finished work.')));
  end if;

  -- Already waiting for the supervisor with someone's completion: this one
  -- is extra evidence and does not change the job.
  if lower(btrim(coalesce(v_wo.status::text, ''))) = 'quality inspection'
     and exists (select 1 from public.work_order_completions c
                  where c.job_id = v_job and c.status = 'submitted') then
    v_kind := 'extra';
  -- Other tasks of the job are still open: this task is done, the job is not.
  elsif public._job_completion_open_tasks(v_job, v_task) > 0 then
    v_kind := 'partial';
  end if;

  -- Meter readings past the meter rules are held, not logged (see
  -- _job_completion_meter_reason). Checked before any write.
  if v_wo.asset_no is not null and btrim(v_wo.asset_no::text) <> '' then
    v_reason := public._job_completion_meter_reason('km', v_wo.organisation_id, v_wo.country::text,
                                                    v_wo.asset_no::text, v_km, v_at::date);
    if v_reason is not null then v_held := v_held || jsonb_build_object('km', v_reason); end if;
    v_reason := public._job_completion_meter_reason('hours', v_wo.organisation_id, v_wo.country::text,
                                                    v_wo.asset_no::text, v_hours, v_at::date);
    if v_reason is not null then v_held := v_held || jsonb_build_object('hours', v_reason); end if;
  end if;

  -- 4c. Write. One block: a guard refusal undoes the evidence too.
  begin
    insert into public.work_order_completions (
      organisation_id, country, site, job_id, task_id, asset_no, submitted_by, kind,
      work_done, quick_picks, parts_used, before_photos, after_photos,
      km, engine_hours, signature, evidence_objects, meter_held, completed_at, client_uuid)
    values (
      v_wo.organisation_id, v_wo.country, v_wo.site, v_job, v_task, v_wo.asset_no, v_uid, v_kind,
      v_work, v_picks, v_parts, v_before, v_after,
      v_km, v_hours, v_sig, v_evidence, nullif(v_held, '{}'::jsonb), v_at, v_key);

    if v_task is not null then
      update public.wo_tasks set status = 'done'
       where id = v_task and status <> 'done';
    end if;

    if v_kind = 'primary'
       and lower(btrim(coalesce(v_wo.status::text, ''))) <> 'quality inspection'
       and public._job_completion_open_tasks(v_job) = 0 then
      -- qc_status is cleared too, so a resubmit after a return does not carry
      -- the old 'failed' into the new check.
      perform set_config('tp.job_completion_submit', v_job::text, true);
      update public.work_orders set status = 'Quality Inspection', qc_status = null where id = v_job;
      perform set_config('tp.job_completion_submit', '', true);
      v_moved := true;
    end if;

    -- Meter readings, same transaction. Skip when the same reading for the
    -- asset on that day is already there, or when it was held above.
    if v_wo.asset_no is not null and btrim(v_wo.asset_no::text) <> '' then
      if v_km is not null and not (v_held ? 'km') and not exists (
           select 1 from public.odometer_logs o
            where btrim(o.asset_no) = btrim(v_wo.asset_no::text)
              and o.organisation_id = v_wo.organisation_id
              and o.reading_date = v_at::date and o.odometer_km = v_km) then
        insert into public.odometer_logs (organisation_id, country, site, asset_no, odometer_km,
                                          reading_date, source, notes, created_by, client_uuid)
        values (v_wo.organisation_id, v_wo.country, v_wo.site, v_wo.asset_no, v_km,
                v_at::date, 'job_completion', 'Job ' || coalesce(v_wo.work_order_no::text, v_job::text),
                v_uid, v_key || '_km')
        on conflict (client_uuid) do nothing;
      end if;
      if v_hours is not null and not (v_held ? 'hours') and not exists (
           select 1 from public.engine_hours_logs e
            where btrim(e.asset_no) = btrim(v_wo.asset_no::text)
              and e.organisation_id = v_wo.organisation_id
              and e.reading_date = v_at::date and e.engine_hours = v_hours) then
        insert into public.engine_hours_logs (organisation_id, country, site, asset_no, engine_hours,
                                              reading_date, source, notes, created_by, client_uuid)
        values (v_wo.organisation_id, v_wo.country, v_wo.site, v_wo.asset_no, v_hours,
                v_at::date, 'job_completion', 'Job ' || coalesce(v_wo.work_order_no::text, v_job::text),
                v_uid, v_key || '_hrs')
        on conflict (client_uuid) do nothing;
      end if;
    end if;
  exception
    -- Two sends of the same completion racing past the duplicate check.
    when unique_violation then
      return jsonb_build_object('duplicates', jsonb_build_array(v_key));
    when insufficient_privilege or check_violation or raise_exception then
      return jsonb_build_object('rejected', jsonb_build_array(
        jsonb_build_object('client_uuid', v_key, 'reason', left(sqlerrm, 300))));
  end;

  -- 4d. Tell the site's supervisors the job is waiting for them.
  if v_moved then
    select coalesce(nullif(btrim(full_name), ''), 'A technician') into v_tech_name
      from public.profiles where id = v_uid;
    for v_person in
      select * from public._job_completion_people(
        v_wo.organisation_id, v_wo.country::text, v_wo.site::text, v_uid, true)
    loop
      perform public._job_completion_notify(
        v_wo.organisation_id, v_person,
        'Job ready to check',
        'Job ' || coalesce(v_wo.work_order_no::text, '') ||
          coalesce(' (' || nullif(btrim(v_wo.asset_no::text), '') || ')', '') ||
          ' was finished by ' || coalesce(v_tech_name, 'a technician') || '. Pass it or return it.',
        v_job);
    end loop;
  end if;

  return jsonb_build_object('accepted', jsonb_build_array(v_key));
end;
$$;

-- 5. Decision guard: no self-approval, completions stamped -----------------
-- Fires on any QC result or any move to a closed status. When the job has a
-- completion waiting (or decided in this same transaction), the person
-- deciding must not be its submitter nor anyone on the job, unless Admin or
-- an area manager. The waiting completions are then stamped approved /
-- returned, so a web QC button and the phone read one answer.
create or replace function public.guard_job_completion_decision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_pass boolean;
  v_fail boolean;
begin
  -- coalesce: a qc_status cleared to null must read as "no decision", not as
  -- an unknown that skips the early return below.
  v_pass := coalesce((new.qc_status is distinct from old.qc_status and new.qc_status = 'passed')
         or (new.status is distinct from old.status and public.work_order_is_closed(new.status::text)
             and lower(btrim(new.status::text)) not in ('cancelled', 'canceled')), false);
  v_fail := coalesce(new.qc_status is distinct from old.qc_status and new.qc_status = 'failed', false);
  if not (v_pass or v_fail) then return new; end if;
  if not exists (select 1 from public.work_order_completions c
                  where c.job_id = new.id and (c.status = 'submitted' or c.decided_at = now())) then
    return new;
  end if;

  if v_uid is not null and public._job_completion_is_return_desk() then
    raise exception 'The data desk reassigns returned jobs; a supervisor passes or returns them.'
      using errcode = '42501';
  end if;
  if v_uid is not null
     and not public._job_completion_decider_exempt(v_uid)
     and public._job_completion_is_party(new.id, v_uid) then
    raise exception 'You worked on this job, so another supervisor has to pass or return it.'
      using errcode = '42501';
  end if;
  if v_pass and public._job_completion_open_tasks(new.id) > 0 then
    raise exception 'This job still has open tasks. Finish them before passing it.'
      using errcode = '42501';
  end if;
  if v_pass and public._job_completion_evidence_changed(new.id) then
    raise exception 'Evidence photos were changed after submit.'
      using errcode = '42501';
  end if;

  update public.work_order_completions
     set status = case when v_fail then 'returned' else 'approved' end,
         decided_by = v_uid,
         decided_at = now(),
         decision_note = nullif(current_setting('tp.job_completion_note', true), '')
   where job_id = new.id and status = 'submitted';
  return new;
end;
$$;

create or replace trigger trg_guard_job_completion_decision
  before update of qc_status, status on public.work_orders
  for each row execute function public.guard_job_completion_decision();

-- 6. Supervisor decision RPC (phone "Jobs to check", web Workshop Live) -----
-- {ok:true, status, job_status} or {ok:false, reason}. One decision only;
-- the same p_client_uuid again returns the stored answer.
create or replace function public.decide_job_completion(
  p_completion_id uuid, p_decision text, p_note text, p_client_uuid text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_dec text := lower(btrim(coalesce(p_decision, '')));
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_key text := nullif(btrim(coalesce(p_client_uuid, '')), '');
  v_c record;
  v_wo record;
  v_tyre boolean;
  v_who text;
  v_new_status text;
  v_label text;
  v_person uuid;
begin
  if v_uid is null then
    raise exception 'Sign in to check a job.' using errcode = '42501';
  end if;
  if v_dec not in ('pass', 'return') then
    return jsonb_build_object('ok', false, 'reason', 'Choose pass or return.');
  end if;
  -- The data desk only reads returned jobs and reassigns them.
  if public._job_completion_is_return_desk() then
    return jsonb_build_object('ok', false, 'reason',
      'The data desk reassigns returned jobs; a supervisor passes or returns them.');
  end if;
  if v_dec = 'return' and (v_note is null or length(v_note) < 3) then
    return jsonb_build_object('ok', false, 'reason', 'Say why the job is returned.');
  end if;
  if v_note is not null and length(v_note) > 1000 then
    return jsonb_build_object('ok', false, 'reason', 'The note is too long.');
  end if;

  select * into v_c from public.work_order_completions
   where id = p_completion_id
     and (organisation_id = public.app_current_org() or public.is_super_admin())
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'This completion could not be found.');
  end if;
  if v_c.status <> 'submitted' then
    if v_key is not null and v_c.decision_client_uuid = v_key then
      return jsonb_build_object('ok', true, 'duplicate', true, 'status', v_c.status);
    end if;
    select coalesce(nullif(btrim(full_name), ''), 'another supervisor') into v_who
      from public.profiles where id = v_c.decided_by;
    return jsonb_build_object('ok', false, 'reason',
      'Already ' || case when v_c.status = 'approved' then 'passed' else 'returned' end
      || ' by ' || coalesce(v_who, 'another supervisor') || '.');
  end if;

  select id, organisation_id, country, site, status, work_type, tyre_serial, tyre_position,
         work_order_no, asset_no, assigned_owner_id
    into v_wo from public.work_orders where id = v_c.job_id for update;
  if public.work_order_is_closed(v_wo.status::text) then
    return jsonb_build_object('ok', false, 'reason', 'This job is already closed.');
  end if;
  v_tyre := public.work_order_is_tyre(v_wo.work_type::text, v_wo.tyre_serial::text, v_wo.tyre_position::text);
  if not public.work_order_can('qc', v_wo.organisation_id, v_wo.country::text, v_wo.site::text, v_tyre, v_wo.id)
     or (v_dec = 'pass' and not public.work_order_can('close', v_wo.organisation_id, v_wo.country::text, v_wo.site::text, v_tyre, v_wo.id)) then
    return jsonb_build_object('ok', false, 'reason', 'You are not allowed to pass or return this job.');
  end if;
  if not public._job_completion_decider_exempt(v_uid)
     and (v_c.submitted_by = v_uid or public._job_completion_is_party(v_wo.id, v_uid)) then
    return jsonb_build_object('ok', false, 'reason', 'You worked on this job, so another supervisor has to pass or return it.');
  end if;
  if v_dec = 'pass' and public._job_completion_open_tasks(v_wo.id) > 0 then
    return jsonb_build_object('ok', false, 'reason', 'This job still has open tasks. Finish them before passing it.');
  end if;
  if v_dec = 'pass' and public._job_completion_evidence_changed(v_wo.id) then
    return jsonb_build_object('ok', false, 'reason', 'Evidence photos were changed after submit.');
  end if;

  update public.work_order_completions
     set status = case when v_dec = 'pass' then 'approved' else 'returned' end,
         decided_by = v_uid, decided_at = now(), decision_note = v_note,
         decision_client_uuid = v_key
   where id = v_c.id;

  v_new_status := case when v_dec = 'pass' then 'Completed' else 'In Progress' end;
  perform set_config('tp.job_completion_note', coalesce(v_note, ''), true);
  -- The assignment is left exactly as it is (owner ruling 2026-11-27).
  update public.work_orders
     set status = v_new_status,
         qc_status = case when v_dec = 'pass' then 'passed' else 'failed' end
   where id = v_wo.id;
  perform set_config('tp.job_completion_note', '', true);

  v_label := 'Job ' || coalesce(v_wo.work_order_no::text, '') ||
             coalesce(' (' || nullif(btrim(v_wo.asset_no::text), '') || ')', '');

  -- The technician always hears the answer.
  perform public._job_completion_notify(
    v_wo.organisation_id, v_c.submitted_by,
    case when v_dec = 'pass' then 'Job approved' else 'Job returned' end,
    v_label || case when v_dec = 'pass' then ' was passed by the supervisor.'
                    else ' was returned: ' || v_note end,
    v_wo.id);

  -- A returned job goes to the site's data desk to be reassigned.
  if v_dec = 'return' then
    for v_person in
      select * from public._job_completion_people(
        v_wo.organisation_id, v_wo.country::text, v_wo.site::text, v_uid, false)
    loop
      perform public._job_completion_notify(
        v_wo.organisation_id, v_person,
        'Returned job to reassign',
        v_label || ' was returned: ' || v_note || '. Reassign it or send it back to the technician.',
        v_wo.id);
    end loop;
  end if;

  return jsonb_build_object('ok', true,
    'status', case when v_dec = 'pass' then 'approved' else 'returned' end,
    'job_status', v_new_status);
end;
$$;

-- 7. Grants ------------------------------------------------------------------
revoke all on function public.submit_job_completion(jsonb) from public, anon;
grant execute on function public.submit_job_completion(jsonb) to authenticated, service_role;
revoke all on function public.decide_job_completion(uuid, text, text, text) from public, anon;
grant execute on function public.decide_job_completion(uuid, text, text, text) to authenticated, service_role;
revoke all on function public.guard_job_completion_decision() from public, anon, authenticated;
revoke all on function public._job_completion_notify(uuid, uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public._job_completion_people(uuid, text, text, uuid, boolean) from public, anon, authenticated;
revoke all on function public._job_completion_is_party(uuid, uuid) from public, anon, authenticated;
revoke all on function public._job_completion_decider_exempt(uuid) from public, anon, authenticated;
-- Used inside the read policy, so authenticated keeps execute on these two.
revoke all on function public._job_completion_is_return_desk() from public, anon;
grant execute on function public._job_completion_is_return_desk() to authenticated;
revoke all on function public._job_completion_return_desk_roles() from public, anon;
grant execute on function public._job_completion_return_desk_roles() to authenticated;
revoke all on function public._job_completion_open_tasks(uuid, uuid) from public, anon, authenticated;
revoke all on function public._job_completion_photo_print(text) from public, anon, authenticated;
revoke all on function public._job_completion_evidence_changed(uuid) from public, anon, authenticated;
revoke all on function public._job_completion_meter_reason(text, uuid, text, text, numeric, date) from public, anon, authenticated;
-- Used inside the storage policies below.
revoke all on function public._job_completion_photo_locked(text) from public, anon;
grant execute on function public._job_completion_photo_locked(text) to authenticated;

-- 8. Storage lock on completion evidence -----------------------------------
-- Safe to add: today no client policy lets anyone DELETE tyre-photos objects
-- (only the service role can), and the app uploads workshop photos with
-- upsert:false, so no app path overwrites one. The owner-may-update policy
-- ("Photo updates owner or elevated same org") is what lets a technician
-- overwrite a photo after the supervisor saw it; these RESTRICTIVE policies
-- close that for objects under modules/workshop/ that a completion
-- references. Admin / super admin keep it (e.g. to remove a wrong photo).
-- Everything else in storage is unaffected (first two OR terms).
-- The decision RPC also re-checks the fingerprint, so a change made with the
-- service role still blocks the pass.
create policy job_completion_photos_locked_update on storage.objects
  as restrictive for update to authenticated
  using (bucket_id <> 'tyre-photos' or name not like 'modules/workshop/%'
         or not public._job_completion_photo_locked(name))
  with check (bucket_id <> 'tyre-photos' or name not like 'modules/workshop/%'
         or not public._job_completion_photo_locked(name));
create policy job_completion_photos_locked_delete on storage.objects
  as restrictive for delete to authenticated
  using (bucket_id <> 'tyre-photos' or name not like 'modules/workshop/%'
         or not public._job_completion_photo_locked(name));

-- VERIFY (run live 2026-11-27 with supabase db query, migration + the script
-- supabase/tests/job_completion_verify.sql inside ONE transaction that ends in
-- RAISE + ROLLBACK; afterwards the table, RPC, guard patch and test jobs were
-- confirmed absent). Real users: Diesel Mechanic SHARIF KHAN (technician),
-- Diesel Mechanic SHOUKAT ALI (second technician), Helper Workshop ARMAN
-- HOSSAIN (never assigned), Workshop Supervisors Mahmoud and JAVED AHMAD,
-- Data Monitor Officer MAi Yousef.
--   01 mech submit                 -> accepted
--   02 same key again              -> duplicates
--   03 photo owned by someone else -> rejected 'A photo of the finished work is missing...'
--   04 job_id 'not-a-uuid'         -> rejected 'could not be read'
--   05 after_photos not an array   -> rejected 'could not be read'
--   06 job closed meanwhile        -> rejected 'This job was closed before your completion arrived.'
--   07 mech writes qc_status       -> 42501
--   09 job after submit            -> 'Quality Inspection' / qc_status null (no 42501 for the technician)
--   10 payload said UAE/FAKE       -> stored KSA/NHC from the work order
--   11/12 odometer + hours rows    -> 1 / 1 (source job_completion)
--   13 supervisors notified        -> 12
--   14 never-assigned helper       -> rejected 'not assigned to you when the work was done'
--   15 helper sees completions     -> 0
--   16/17 second technician in QI  -> accepted as kind 'extra', job unchanged
--   18 supervisor sees             -> 2
--   19 return with no note         -> ok:false 'Say why the job is returned.'
--   20 pass                        -> ok:true; 23 job Completed / qc passed; 24 both approved
--   21 again, new key              -> ok:false 'Already passed by Mahmoud.'
--   22 again, same key             -> ok:true duplicate
--   25 technician told             -> 1
--   27/28 supervisor assigned to the job -> ok:false / 42501 on a direct write
--   29/30 return                   -> In Progress / qc failed; 31 assignments kept (2 of 2)
--   32/33 data desk notified       -> DMO 1, desk total 8
--   34 DMO returned queue          -> 1, note 'Brake still squeaks'
--   35 DMO also sees non-returned  -> 2 (DMO holds work_orders edit in Access Control,
--                                     so work_order_can('qc') is true for them)
--   36 anon execute submit/decide  -> false/false
--
-- RE-RUN 2026-11-27 after the review fixes (execute_sql: migration + the
-- updated script in one batch ending in RAISE, so all rolled back; checked
-- afterwards: table, functions, trigger, storage policies, guard patch, test
-- jobs, storage objects and odometer rows all absent). Same users. Changes:
--   07 mech writes qc_status       -> 42501 (now from the decision guard)
--   13 supervisors notified 12; 13b data desk among them -> 0
--   13c evidence fingerprint stored -> 1 object (storage object id)
--   19a technician overwrites the photo after submit -> 0 rows changed (storage policy)
--   19b technician delete          -> 42501 (Storage API only, no client delete path)
--   19c photo changed behind the app, then pass -> ok:false 'Evidence photos were changed after submit.'
--   19d data desk calls decide     -> ok:false 'The data desk reassigns returned jobs; ...'
--   19e data desk direct web pass  -> 42501 same sentence
--   20-34 as before (pass, already passed by Mahmoud, return, assignments kept 2/2,
--         DMO notified 1, desk total 8, DMO returned queue 1)
--   35 DMO sees non-returned       -> 0 (was 2)
--   35a/35b resubmit after return  -> accepted; job Quality Inspection / qc_status null
--         (first re-run found a NULL-logic bug in the decision guard - a cleared
--          qc_status skipped the early return and refused the resubmit; fixed with
--          coalesce and confirmed in a second rolled-back run)
--   35c/35d one of two tasks done  -> accepted as kind 'partial', job stays In Progress
--   35d/35e km 5,000,000 vs current 159,320 -> held in meter_held, 0 odometer rows
--   35f supervisors asked for the partial job -> 0
--   35g pass with a task still open -> ok:false 'This job still has open tasks. ...'
--   A racing duplicate send (unique_violation) now answers {duplicates:[key]};
--   not reproducible in one session, code path only.
--
-- ROLLBACK (needs DROP, run by hand):
--   drop policy if exists job_completion_photos_locked_update on storage.objects;
--   drop policy if exists job_completion_photos_locked_delete on storage.objects;
--   drop function if exists public._job_completion_photo_locked(text);
--   drop function if exists public._job_completion_evidence_changed(uuid);
--   drop function if exists public._job_completion_photo_print(text);
--   drop function if exists public._job_completion_open_tasks(uuid, uuid);
--   drop function if exists public._job_completion_meter_reason(text, uuid, text, text, numeric, date);
--   drop trigger if exists trg_guard_job_completion_decision on public.work_orders;
--   drop function if exists public.guard_job_completion_decision();
--   drop function if exists public.decide_job_completion(uuid, text, text, text);
--   drop function if exists public.submit_job_completion(jsonb);
--   drop function if exists public._job_completion_people(uuid, text, text, uuid, boolean);
--   drop function if exists public._job_completion_notify(uuid, uuid, text, text, uuid);
--   drop function if exists public._job_completion_is_party(uuid, uuid);
--   drop function if exists public._job_completion_decider_exempt(uuid);
--   do $$ begin execute (select definition from public._bak_wo_write_guard_20261127 order by saved_at limit 1); end $$;
--   drop table if exists public.work_order_completions;
--   drop function if exists public._job_completion_is_return_desk();
--   drop function if exists public._job_completion_return_desk_roles();
--   drop table if exists public._bak_wo_write_guard_20261127;
