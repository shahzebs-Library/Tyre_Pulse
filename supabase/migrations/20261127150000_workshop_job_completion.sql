-- STATUS: AUTHORED, NOT APPLIED. Needs the owner's go-ahead before it is applied.
--
-- Workshop job completion: the technician finishes a job on the phone, and a
-- SUPERVISOR passes or returns it. Nothing here closes a job.
--
-- Checked against the schema before writing (supabase/staging/baseline):
--   work_orders has status, qc_status, completed_at, parts_used jsonb, notes,
--   odometer, assigned_owner_id. It has NO column for completion evidence
--   (photos, technician signature, what was done, meters at completion), and
--   a technician cannot update work_orders directly (job cards are writable
--   by Admin / capability grants only). So the evidence gets its own table
--   and the state change goes through one SECURITY DEFINER RPC that checks
--   the caller is actually assigned to the job.
--
-- Flow (matches web Workshop Live, src/lib/workshopTasks.js qcOutcome):
--   technician submit  -> work_orders.status 'Quality Inspection', qc_status 'pending'
--   supervisor QC pass -> status 'Completed',  qc_status 'passed'  (web setQcOutcome)
--   supervisor QC fail -> status 'In Progress', qc_status 'failed' (returned)
--
-- Owner rule: the technician cannot approve their own job. Enforced in the
-- database by trg_guard_job_completion_self_qc, so no client (web or phone)
-- can sidestep it.
--
-- Rollback (at the bottom) drops only what this file creates.

-- 1. Evidence table ------------------------------------------------------
create table if not exists public.work_order_completions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default public.app_current_org(),
  country text,
  site text,
  job_id uuid not null references public.work_orders(id) on delete cascade,
  task_id uuid,
  asset_no text,
  submitted_by uuid not null default auth.uid(),
  work_done text not null check (length(btrim(work_done)) between 3 and 2000),
  quick_picks text[] not null default '{}',
  parts_used jsonb not null default '[]'::jsonb
    check (jsonb_typeof(parts_used) = 'array'),
  before_photos jsonb not null default '[]'::jsonb
    check (jsonb_typeof(before_photos) = 'array'),
  after_photos jsonb not null
    check (jsonb_typeof(after_photos) = 'array' and jsonb_array_length(after_photos) >= 1),
  km numeric check (km is null or km >= 0),
  engine_hours numeric check (engine_hours is null or engine_hours >= 0),
  signature text not null check (length(signature) > 30),
  completed_at timestamptz not null default now(),
  status text not null default 'submitted'
    check (status in ('submitted', 'approved', 'returned')),
  decided_by uuid,
  decided_at timestamptz,
  client_uuid text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists work_order_completions_client_uuid_uidx
  on public.work_order_completions (client_uuid);
create index if not exists work_order_completions_job_idx
  on public.work_order_completions (job_id, created_at desc);
create index if not exists work_order_completions_org_country_idx
  on public.work_order_completions (organisation_id, country);

alter table public.work_order_completions enable row level security;

create policy work_order_completions_org_isolation on public.work_order_completions
  as restrictive for all to authenticated
  using ((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()))
  with check ((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()));

create policy work_order_completions_country_isolation on public.work_order_completions
  as restrictive for select to authenticated
  using (public.app_can_see_country(country));

-- Read: the submitter, or anyone elevated / a parts-approver supervisor.
create policy work_order_completions_read on public.work_order_completions
  for select to authenticated
  using (
    submitted_by = auth.uid()
    or (select public.app_is_elevated())
    or (select public.app_is_parts_approver())
  );

-- No client INSERT / UPDATE / DELETE grant: writes only through the RPC and
-- the QC trigger below.
revoke all on public.work_order_completions from anon;
revoke insert, update, delete, truncate, trigger on public.work_order_completions from authenticated;
grant select on public.work_order_completions to authenticated;

-- 2. Submit RPC (queued command JOB_COMPLETION) -------------------------
-- Answers in the offline queue's RPC shape: {accepted:[uuid]} /
-- {duplicates:[uuid]} / {rejected:[{client_uuid, reason}]}. A refusal is a
-- plain sentence for the technician, never retried blindly.
create or replace function public.submit_job_completion(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_key text := nullif(btrim(p_payload->>'client_uuid'), '');
  v_job uuid;
  v_wo record;
  v_assigned boolean;
  v_after jsonb := coalesce(p_payload->'after_photos', '[]'::jsonb);
begin
  if v_uid is null then
    raise exception 'Sign in to complete a job.' using errcode = '42501';
  end if;
  if v_key is null then
    return jsonb_build_object('rejected', jsonb_build_array(
      jsonb_build_object('client_uuid', null, 'reason', 'This completion has no identity and was not sent.')));
  end if;
  if exists (select 1 from public.work_order_completions where client_uuid = v_key) then
    return jsonb_build_object('duplicates', jsonb_build_array(v_key));
  end if;

  begin
    v_job := (p_payload->>'job_id')::uuid;
  exception when others then
    v_job := null;
  end;
  select id, organisation_id, country, site, asset_no, status, assigned_owner_id
    into v_wo
    from public.work_orders
   where id = v_job
     and (organisation_id = public.app_current_org() or public.is_super_admin());
  if not found then
    return jsonb_build_object('rejected', jsonb_build_array(
      jsonb_build_object('client_uuid', v_key, 'reason', 'This job could not be found.')));
  end if;

  v_assigned := v_wo.assigned_owner_id = v_uid
    or exists (select 1 from public.wo_assignments a
                where a.job_id = v_job and a.user_id = v_uid and a.active);
  if not v_assigned then
    return jsonb_build_object('rejected', jsonb_build_array(
      jsonb_build_object('client_uuid', v_key, 'reason', 'This job is not assigned to you.')));
  end if;
  if lower(coalesce(v_wo.status, '')) in ('completed', 'closed', 'cancelled', 'canceled') then
    return jsonb_build_object('rejected', jsonb_build_array(
      jsonb_build_object('client_uuid', v_key, 'reason', 'This job is already closed.')));
  end if;
  if length(btrim(coalesce(p_payload->>'work_done', ''))) < 3 then
    return jsonb_build_object('rejected', jsonb_build_array(
      jsonb_build_object('client_uuid', v_key, 'reason', 'Describe what was done.')));
  end if;
  if jsonb_typeof(v_after) <> 'array' or jsonb_array_length(v_after) < 1 then
    return jsonb_build_object('rejected', jsonb_build_array(
      jsonb_build_object('client_uuid', v_key, 'reason', 'Add at least one photo of the finished work.')));
  end if;
  if length(coalesce(p_payload->>'signature', '')) <= 30 then
    return jsonb_build_object('rejected', jsonb_build_array(
      jsonb_build_object('client_uuid', v_key, 'reason', 'Sign the completion.')));
  end if;

  insert into public.work_order_completions (
    organisation_id, country, site, job_id, task_id, asset_no, submitted_by,
    work_done, quick_picks, parts_used, before_photos, after_photos,
    km, engine_hours, signature, completed_at, client_uuid)
  values (
    v_wo.organisation_id,
    coalesce(nullif(p_payload->>'country', ''), v_wo.country),
    coalesce(nullif(p_payload->>'site', ''), v_wo.site),
    v_job,
    nullif(p_payload->>'task_id', '')::uuid,
    coalesce(nullif(p_payload->>'asset_no', ''), v_wo.asset_no),
    v_uid,
    btrim(p_payload->>'work_done'),
    coalesce(array(select jsonb_array_elements_text(p_payload->'quick_picks')), '{}'),
    coalesce(p_payload->'parts_used', '[]'::jsonb),
    coalesce(p_payload->'before_photos', '[]'::jsonb),
    v_after,
    nullif(p_payload->>'km', '')::numeric,
    nullif(p_payload->>'engine_hours', '')::numeric,
    p_payload->>'signature',
    coalesce(nullif(p_payload->>'completed_at', '')::timestamptz, now()),
    v_key);

  -- To the supervisor, never straight to closed.
  update public.work_orders
     set status = 'Quality Inspection',
         qc_status = 'pending'
   where id = v_job;

  return jsonb_build_object('accepted', jsonb_build_array(v_key));
end;
$$;
revoke all on function public.submit_job_completion(jsonb) from public;
revoke all on function public.submit_job_completion(jsonb) from anon;
grant execute on function public.submit_job_completion(jsonb) to authenticated, service_role;

-- 3. QC decision guard + evidence status --------------------------------
-- The person who submitted the latest completion cannot pass or return it.
-- A decision also stamps the completion approved / returned, so the phone
-- and the web read one answer.
create or replace function public.guard_job_completion_self_qc()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_completion record;
begin
  if new.qc_status is not distinct from old.qc_status then return new; end if;
  if new.qc_status not in ('passed', 'failed') then return new; end if;

  select id, submitted_by into v_completion
    from public.work_order_completions
   where job_id = new.id and status = 'submitted'
   order by created_at desc
   limit 1;
  if not found then return new; end if;

  if v_uid is not null and v_completion.submitted_by = v_uid then
    raise exception 'You completed this job, so a supervisor has to approve it.'
      using errcode = '42501';
  end if;

  update public.work_order_completions
     set status = case when new.qc_status = 'passed' then 'approved' else 'returned' end,
         decided_by = v_uid,
         decided_at = now()
   where id = v_completion.id;
  return new;
end;
$$;
revoke all on function public.guard_job_completion_self_qc() from public;
revoke all on function public.guard_job_completion_self_qc() from anon;

create trigger trg_guard_job_completion_self_qc
  before update of qc_status on public.work_orders
  for each row execute function public.guard_job_completion_self_qc();

-- VERIFY (run in a rolled-back transaction, impersonating real users):
--   technician assigned to job J calls submit_job_completion -> accepted;
--     J.status = 'Quality Inspection', J.qc_status = 'pending'
--   same call again                                          -> duplicates
--   technician NOT assigned to J                             -> rejected 'not assigned'
--   no after photo / no signature                            -> rejected with the reason
--   technician sets J.qc_status = 'passed' (if they can)     -> 42501
--   supervisor sets qc_status 'passed'                       -> completion.status 'approved'
--   supervisor sets qc_status 'failed'                       -> completion.status 'returned'
--   anon has no execute on submit_job_completion
--
-- ROLLBACK:
--   drop trigger if exists trg_guard_job_completion_self_qc on public.work_orders;
--   drop function if exists public.guard_job_completion_self_qc();
--   drop function if exists public.submit_job_completion(jsonb);
--   drop table if exists public.work_order_completions;
