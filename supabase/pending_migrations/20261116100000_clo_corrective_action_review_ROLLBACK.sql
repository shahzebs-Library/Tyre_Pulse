-- ROLLBACK for 20261116100000_clo_corrective_action_review.sql
--
-- STATUS: AUTHORED, NOT APPLIED. Rehearsed on a local copy of the staging database (tp_runbook,
--         on top of the six #519 drafts): apply, verify, this rollback, then a schema and data
--         fingerprint equal to the one taken before the apply. See
--         docs/commercial-readiness/RELEASE_RUNBOOK_519_520.md (on the #519 branch), step 7.
-- ORDER:  roll back 20261116102000 and 20261116101000 first (101000 reads closure_review_config).
-- STOP FIRST: this removes every review, submission and exception recorded through the new
--         workflow (the review columns and the event history). Count before running:
--           select review_status, count(*) from public.corrective_actions group by 1;
--           select count(*) from public.corrective_action_review_events;
--         If either is not empty, export them first. The status column (Open / In Progress /
--         Closed) is never touched, so open and closed counts do not move.
-- CONTAINS the word "drop": the Supabase MCP tool waits for a human confirmation.

begin;

do $do$
begin
  if to_regclass('public.checklist_decision_events') is not null then
    raise exception 'Rollback aborted: roll back 20261116101000 first.';
  end if;
end
$do$;

drop trigger if exists trg_ca_review_guard on public.corrective_actions;
drop function if exists public.corrective_action_review_guard();
drop function if exists public.corrective_action_worker_update(uuid, text, jsonb);
drop function if exists public.corrective_action_submit_completion(uuid, text, jsonb);
drop function if exists public.corrective_action_review(uuid, text, text);
drop function if exists public.corrective_action_request_exception(uuid, text);
drop function if exists public.corrective_action_decide_exception(uuid, text, text);
drop function if exists public.corrective_action_my_permissions(uuid);
drop function if exists public.get_closure_review_config();
drop function if exists public.save_closure_review_config(jsonb);
drop function if exists public.closure_review_settings(uuid);
drop function if exists public.corrective_action_is_assignee(uuid, uuid);
drop function if exists public._ca_review_event(public.corrective_actions, text, text, jsonb);
drop function if exists public._ca_review_load(uuid);
drop function if exists public._ca_clean_photos(jsonb);
drop table if exists public.corrective_action_review_events;
drop function if exists public.closure_events_immutable();
drop function if exists public.closure_role_in(text, text[]);
drop table if exists public.closure_review_config;
drop index if exists public.idx_corrective_actions_review_queue;
alter table public.corrective_actions drop constraint if exists corrective_actions_review_status_chk;
alter table public.corrective_actions
  drop column if exists review_status,
  drop column if exists submitted_by,
  drop column if exists submitted_at,
  drop column if exists completion_note,
  drop column if exists completion_photos,
  drop column if exists reviewed_by,
  drop column if exists reviewed_at,
  drop column if exists review_comment,
  drop column if exists exception_requested_by,
  drop column if exists exception_requested_at,
  drop column if exists exception_reason;

commit;
