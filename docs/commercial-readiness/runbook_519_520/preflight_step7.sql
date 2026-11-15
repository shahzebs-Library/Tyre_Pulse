\i runbook_519_520/preflight_reader_policy_drift.sql
select 'pre7 #519 ledger applied' k, to_regclass('public.work_order_cost_entries') is not null ok;
select 'pre7 objects absent' k, to_regclass('public.closure_review_config') is null and to_regclass('public.corrective_action_review_events') is null and not exists (select 1 from information_schema.columns where table_name='corrective_actions' and column_name='review_status') ok;
select 'pre7 trigger name free' k, not exists (select 1 from pg_trigger where tgname='trg_ca_review_guard') ok;
select 'pre7 corrective_actions statuses' k, status, count(*) from public.corrective_actions group by status order by 2;
