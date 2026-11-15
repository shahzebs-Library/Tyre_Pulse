\pset format unaligned
\pset tuples_only on
select 'work_orders', count(*), md5(coalesce(string_agg(id::text||':'||coalesce(parts_cost::text,'null'),',' order by id),'')) from public.work_orders;
select 'wo_parts_cost_no_lines', count(*) from public.work_orders w where coalesce(w.parts_cost,0)>0 and not exists (select 1 from public.work_order_line_items l where l.work_order_no = w.work_order_no);
select 'parts_consumption', count(*) from public.parts_consumption;
select 'corrective_actions', count(*), md5(coalesce(string_agg(id::text||':'||coalesce(status,''),',' order by id),'')) from public.corrective_actions;
select 'checklist_submissions', count(*), md5(coalesce(string_agg(id::text||':'||coalesce(approval_status,''),',' order by id),'')) from public.checklist_submissions;
select 'erp_lock', string_agg(proname||'='||coalesce(proacl::text,'')||'#'||md5(prosrc), ' ' order by proname) from pg_proc where proname in ('observation_erp_decide','confirm_observation_erp_link','reject_observation_erp_link');
