\i runbook_519_520/preflight_reader_policy_drift.sql
select 'pre8 step7 applied' k, to_regclass('public.closure_review_config') is not null ok;
select 'pre8 status check is the 5-value one' k, pg_get_constraintdef(oid) = $c$CHECK ((approval_status = ANY (ARRAY['not_required'::text, 'pending'::text, 'pending_area_manager'::text, 'approved'::text, 'rejected'::text])))$c$ ok from pg_constraint where conname='checklist_submissions_approval_status_chk';
select 'pre8 checklist_is_area_manager md5 (rollback body matches d5993d23...)' k, md5(pg_get_functiondef('public.checklist_is_area_manager()'::regprocedure)) = 'd5993d23fe17f89fe8732256878bdfc3' ok;
select 'pre8 objects absent' k, to_regclass('public.checklist_decision_events') is null and to_regprocedure('public.acknowledge_checklist_faults(uuid,text,text)') is null ok;
select 'pre8 checklist_submissions by approval_status' k, approval_status, count(*) from public.checklist_submissions group by 2 order by 2;
