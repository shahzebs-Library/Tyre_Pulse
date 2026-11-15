-- ROLLBACK for 20261116101000_clo_checklist_acknowledge_exception.sql
--
-- STATUS: AUTHORED, NOT APPLIED. Rehearsed on a local copy of the staging database (tp_runbook,
--         on top of the six #519 drafts and 20261116100000): apply, verify, this rollback, then a
--         schema and data fingerprint equal to the one taken before the apply. See
--         docs/commercial-readiness/RELEASE_RUNBOOK_519_520.md (on the #519 branch), step 8.
-- ORDER:  roll back 20261116102000 first; run before the 20261116100000 rollback.
-- REFUSES to run when any sheet is 'acknowledged': the narrower status check would fail and the
--         acknowledgement record would be lost. Decide with the owner first.
-- PRE-CHECK on production: the restored body of checklist_is_area_manager() below is the body
--         read on the staging baseline (md5 of pg_get_functiondef d5993d23fe17f89fe8732256878bdfc3).
--         Record the production md5 in the preflight of step 8; if it differs, replace the body
--         below with the production one before running.
-- CONTAINS the word "drop": the Supabase MCP tool waits for a human confirmation.

begin;

do $do$
begin
  if exists (select 1 from public.checklist_submissions where approval_status = 'acknowledged') then
    raise exception 'Rollback aborted: at least one sheet is acknowledged. Keep the status value.';
  end if;
end
$do$;

drop trigger if exists trg_guard_checklist_acknowledge on public.checklist_submissions;
drop trigger if exists trg_zz_checklist_decision_event on public.checklist_submissions;
drop view if exists public.v_checklist_fault_compliance;
drop function if exists public.acknowledge_checklist_faults(uuid, text, text);
drop function if exists public.guard_checklist_acknowledge();
drop function if exists public.checklist_decision_event();
drop table if exists public.checklist_decision_events;
drop function if exists public.checklist_blocking_answers(public.checklist_submissions);

create or replace function public.checklist_is_area_manager()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select public.is_super_admin() or public.get_my_role() = any (array[
    'Admin','Director','PMV Manager','Workshop Area Manager','Workshop Maintenance Area Manager'
  ]);
$function$;

alter table public.checklist_submissions
  drop constraint checklist_submissions_approval_status_chk,
  add constraint checklist_submissions_approval_status_chk
    check (approval_status = any (array['not_required','pending','pending_area_manager','approved','rejected']));

alter table public.checklist_submissions
  drop column if exists acknowledged_by,
  drop column if exists acknowledged_at,
  drop column if exists acknowledged_name,
  drop column if exists acknowledged_signature,
  drop column if exists acknowledgement_note;

commit;
