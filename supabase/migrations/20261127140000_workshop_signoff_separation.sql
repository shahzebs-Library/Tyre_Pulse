-- STATUS: APPLIED LIVE 2026-11-27 (owner approved in plain words) and verified by
-- impersonation in rolled-back transactions. See VERIFY below.
--
-- Owner rules applied here:
--   A. Open the mobile Workshop module to the workshop supervisors and area/PMV managers.
--   B. "Approval stays with the supervisor when the work has to stop and the vehicle goes
--      to waiting / parts": supervisors may approve / issue / reject parts requests in
--      their org/country/site scope, but never a request they raised themselves.
--   C. Checklist sign-off: the doer and the signer must be different people. A sheet a
--      supervisor filled goes to another supervisor or the area manager.
--
-- Nothing here deletes or rewrites data. Every function edit is an anchored replace of
-- the LIVE definition that aborts unless the anchor is found exactly once.


-- A. mobile:workshop for the supervisory roles (global rows, Title Case = profiles.role).
insert into public.module_permissions (role, module_key, enabled, org_id)
select r, 'mobile:workshop', true, null
  from unnest(array['Workshop Supervisor','Workshop Maintenance Area Manager',
                    'Workshop Area Manager','PMV Manager','Maintenance Supervisor']) r
on conflict do nothing;

-- B. Parts requests: supervisor decision rights.
create or replace function public.app_is_parts_approver()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and coalesce(p.approved, false) and not coalesce(p.locked, false)
       and p.role = any (array['Workshop Supervisor','Workshop Maintenance Area Manager',
                               'Workshop Area Manager','PMV Manager','Maintenance Supervisor']));
$$;
revoke all on function public.app_is_parts_approver() from public;
revoke all on function public.app_is_parts_approver() from anon;
grant execute on function public.app_is_parts_approver() to authenticated, service_role;

-- Permissive UPDATE for those roles. The RESTRICTIVE org / country / site write policies
-- already on the table still bound it to the supervisor's own scope.
create policy parts_requests_supervisor_decide on public.parts_requests
  for update to authenticated
  using ((select public.app_is_parts_approver()) and requested_by is distinct from auth.uid())
  with check ((select public.app_is_parts_approver()) and requested_by is distinct from auth.uid());

-- Guard: nobody but an Admin / super admin decides their own request, and a supervisor
-- (not otherwise elevated) may only move the status and the decision stamps.
create or replace function public.guard_parts_request_decision()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
begin
  if v_uid is null then return new; end if;            -- service / cron
  if new.status is not distinct from old.status then return new; end if;
  select role into v_role from public.profiles where id = v_uid;
  if public.is_super_admin() or v_role = 'Admin' then
    if new.status = 'approved' and new.approved_by is null then new.approved_by := v_uid; end if;
    return new;
  end if;
  if new.status in ('approved','rejected','issued')
     and old.requested_by is not distinct from v_uid then
    raise exception 'You raised this parts request, so another supervisor has to decide it.'
      using errcode = '42501';
  end if;
  if not public.app_is_elevated() then
    -- supervisor path: only decision columns may change
    if (to_jsonb(new) - array['status','approved_by','approved_at','issued_at','fulfilled_at',
                              'rejected_reason','notes','updated_at'])
       is distinct from
       (to_jsonb(old) - array['status','approved_by','approved_at','issued_at','fulfilled_at',
                              'rejected_reason','notes','updated_at']) then
      raise exception 'A supervisor can only decide a parts request, not change its details.'
        using errcode = '42501';
    end if;
    if new.status not in ('approved','rejected','issued') then
      raise exception 'A supervisor can approve, issue or reject a parts request.'
        using errcode = '42501';
    end if;
  end if;
  if new.status = 'approved' then
    new.approved_by := v_uid;
    new.approved_at := coalesce(new.approved_at, now());
  elsif new.status = 'issued' then
    new.issued_at := coalesce(new.issued_at, now());
  end if;
  return new;
end;
$$;
revoke all on function public.guard_parts_request_decision() from public;
revoke all on function public.guard_parts_request_decision() from anon;
create trigger trg_guard_parts_request_decision
  before update on public.parts_requests
  for each row execute function public.guard_parts_request_decision();

-- C1. decide_checklist_approval: refuse the submitter. Anchored on the live body.
do $do$
declare
  v_def text := pg_get_functiondef('public.decide_checklist_approval(uuid,text,text,text)'::regprocedure);
  a1 text := E'  v_both      boolean := false;\n';
  a2 text := E'  if v_status not in (''pending'', ''pending_area_manager'') then';
begin
  if v_def like '%v_submitter%' then raise notice 'already patched'; return; end if;
  if (length(v_def) - length(replace(v_def, a1, ''))) / length(a1) <> 1 then
    raise exception 'anchor a1 not found exactly once'; end if;
  if (length(v_def) - length(replace(v_def, a2, ''))) / length(a2) <> 1 then
    raise exception 'anchor a2 not found exactly once'; end if;
  v_def := replace(v_def, a1, a1 || E'  v_submitter uuid;\n');
  v_def := replace(v_def, a2,
    E'  select cs.submitted_by into v_submitter from public.checklist_submissions cs where cs.id = p_submission_id;\n'
    || E'  if v_submitter is not null and v_submitter = auth.uid() then\n'
    || E'    raise exception ''You filled this checklist, so another supervisor or the area manager has to sign it.'' using errcode = ''42501'';\n'
    || E'  end if;\n\n' || a2);
  execute v_def;
end
$do$;

-- C2. The same rule for the direct-UPDATE path (checklist_submissions_update is permissive
-- for supervisors), so no client can sidestep the RPC.
create or replace function public.guard_checklist_self_signoff()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.uid() is null then return new; end if;
  if old.approval_status in ('pending','pending_area_manager')
     and new.approval_status is distinct from old.approval_status
     and new.approval_status in ('approved','rejected','pending_area_manager')
     and old.submitted_by is not distinct from auth.uid() then
    raise exception 'You filled this checklist, so another supervisor or the area manager has to sign it.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_checklist_self_signoff() from public;
revoke all on function public.guard_checklist_self_signoff() from anon;
create trigger trg_guard_checklist_self_signoff
  before update on public.checklist_submissions
  for each row execute function public.guard_checklist_self_signoff();


-- VERIFY (rolled back, impersonating real users):
--   Workshop Supervisor approves a parts request raised by someone else  -> ok
--   Workshop Supervisor approves a parts request they raised             -> 42501
--   Workshop Supervisor signs a WDC sheet they submitted (RPC)           -> 42501
--   Workshop Supervisor signs a WDC sheet another supervisor submitted   -> ok
--   select role from module_permissions where module_key='mobile:workshop'; -> 5 rows
--
-- ROLLBACK:
--   drop trigger trg_guard_checklist_self_signoff on checklist_submissions;
--   drop trigger trg_guard_parts_request_decision on parts_requests;
--   drop policy parts_requests_supervisor_decide on parts_requests;
--   re-run decide_checklist_approval from the previous live definition (without v_submitter);
--   update module_permissions set enabled=false where module_key='mobile:workshop';
