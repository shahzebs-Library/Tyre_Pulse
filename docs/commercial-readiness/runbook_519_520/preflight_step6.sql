\i runbook_519_520/preflight_reader_policy_drift.sql
select 'pre6 step2 resolver present' k, to_regprocedure('public.work_order_can_job(text,uuid)') is not null ok;
select 'pre6 ledger absent' k, to_regclass('public.work_order_cost_entries') is null and to_regclass('public.work_order_cost_entry_events') is null and to_regclass('public.v_work_order_cost_totals') is null ok;
select 'pre6 currency_for_country present' k, to_regprocedure('public.currency_for_country(text)') is not null ok;
