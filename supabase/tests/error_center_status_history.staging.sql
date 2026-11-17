-- Staging verification for 20261117120000_error_center_status_history.sql (rolled back, never commits).
-- The migration's own begin/commit must be stripped first so everything stays in this one rolled-back
-- transaction:
--   sed '/^begin;$/d;/^commit;$/d' supabase/pending_migrations/20261117120000_error_center_status_history.sql > /tmp/ec_body.sql
--   psql -d tp_mirror2 -At -F ' | ' -f supabase/tests/error_center_status_history.staging.sql
-- Expected results are listed at the end of this file.
\set ON_ERROR_STOP 1
begin;
\i /tmp/ec_body.sql
\echo '--- applied'
-- seed: two logs in two groups, as service (insert allowed for postgres)
insert into system_logs (id, organisation_id, module_id, severity, source, message, created_at)
values ('11111111-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000001','tyres','error','page','tyreStockBySize is not defined', now() - interval '2 hours'),
       ('11111111-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000001','tyres','critical','sentry','fatal crash: anr', now() - interval '2 hours');

create temp table t_out(k text, v text);
grant all on t_out to authenticated;

-- A. immutability preserved
do $$ begin
  begin update system_logs set resolved = true where id='11111111-0000-4000-8000-000000000001';
        insert into t_out values ('A_update_logs','ALLOWED');
  exception when others then insert into t_out values ('A_update_logs','refused: '||sqlerrm); end;
end $$;

-- B. Manager: can read status, cannot resolve
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"63e831d7-f511-5432-976d-439af4ccaf18","role":"authenticated"}',true);
insert into t_out select 'B_mgr_list', string_agg(source||'='||group_status||'/'||is_open, ',') from list_system_logs_with_status(null,null,null,null,50) where id::text like '11111111%';
insert into t_out select 'B_mgr_counts', system_log_open_counts(now()-interval '1 day')::text;
do $$ begin
  begin perform resolve_system_log_groups(array['11111111-0000-4000-8000-000000000001']::uuid[], null, null, 'test reason');
        insert into t_out values ('B_mgr_resolve','ALLOWED');
  exception when others then insert into t_out values ('B_mgr_resolve','refused: '||sqlerrm); end;
  begin perform resolve_system_logs(null,null); insert into t_out values ('B_mgr_resolve_old','ALLOWED');
  exception when others then insert into t_out values ('B_mgr_resolve_old','refused: '||sqlerrm); end;
  begin perform 1 from error_group_state_events; insert into t_out select 'B_mgr_history_rows', count(*)::text from error_group_state_events;
  exception when others then insert into t_out values ('B_mgr_history','refused: '||sqlerrm); end;
end $$;
-- Tyre Man: no access to status
select set_config('request.jwt.claims','{"sub":"88ffa1f3-b090-5725-b4d0-7b8fa6c0912c","role":"authenticated"}',true);
insert into t_out select 'C_tyreman_status', coalesce(error_group_status('page|x'),'NULL');

-- D. super admin resolves with reason; missing reason refused
select set_config('request.jwt.claims','{"sub":"5eacf3d3-29af-5995-bc52-bcef51b82c38","role":"authenticated","aal":"aal2"}',true);
do $$ begin
  begin perform resolve_system_log_groups(array['11111111-0000-4000-8000-000000000001']::uuid[], null, null, '');
        insert into t_out values ('D_no_reason','ALLOWED');
  exception when others then insert into t_out values ('D_no_reason','refused: '||sqlerrm); end;
end $$;
insert into t_out select 'D_resolve', resolve_system_log_groups(array['11111111-0000-4000-8000-000000000001']::uuid[], null, null, 'Fixed in release 2026-11-16')::text;
insert into t_out select 'D_list_after', string_agg(source||'='||group_status||'/'||is_open, ',' order by source) from list_system_logs_with_status(null,null,null,null,50) where id::text like '11111111%';
insert into t_out select 'D_open_filter', count(*)::text from list_system_logs_with_status(null,null,'open',now()-interval '1 day',50) where id::text like '11111111%';
insert into t_out select 'D_closed_filter', count(*)::text from list_system_logs_with_status(null,null,'closed',now()-interval '1 day',50) where id::text like '11111111%';
insert into t_out select 'D_history', string_agg(coalesce(from_status,'-')||'>'||to_status||' by '||left(actor_id::text,8)||' ['||reason||'] '||source, ' ; ') from error_group_state_events;
-- old RPC resolves the remaining critical group
insert into t_out select 'D_old_rpc', resolve_system_logs(null,'critical')::text;
insert into t_out select 'D_counts_after', system_log_open_counts(now()-interval '1 day')::text;
-- reviewed then ignored via set_error_group_state keeps reason
insert into t_out select 'D_set_state', set_error_group_state('sentry|fatal crash: anr','ignored',null,null,null,null,'Known Android OS issue')::text;
insert into t_out select 'D_last_reason', status||' ['||last_reason||']' from error_group_state where group_key like 'sentry|%';
reset role;

-- E. regression: same error recurs after resolve
insert into system_logs (organisation_id, module_id, severity, source, message, created_at)
values ('00000000-0000-0000-0000-000000000001','tyres','error','page','tyreStockBySize is not defined', now() + interval '1 minute');
insert into t_out select 'E_after_recur', status||' resolved_at='||coalesce(resolved_at::text,'null')||' notified='||coalesce(notified_at::text,'null')||' ['||last_reason||']' from error_group_state where group_key like 'page|%';
insert into t_out select 'E_history_last', coalesce(from_status,'-')||'>'||to_status||' actor='||coalesce(actor_id::text,'null')||' '||source||' ['||reason||']' from error_group_state_events where group_key like 'page|%' order by id desc limit 1;
-- ignored group does NOT reopen on recurrence
insert into system_logs (organisation_id, module_id, severity, source, message, created_at)
values ('00000000-0000-0000-0000-000000000001','tyres','critical','sentry','fatal crash: anr', now() + interval '1 minute');
insert into t_out select 'E_ignored_stays', status from error_group_state where group_key like 'sentry|%';

-- F. history immutable
do $$ begin
  begin update error_group_state_events set reason='x'; insert into t_out values ('F_history_update','ALLOWED');
  exception when others then insert into t_out values ('F_history_update','refused: '||sqlerrm); end;
  begin delete from error_group_state_events; insert into t_out values ('F_history_delete','ALLOWED');
  exception when others then insert into t_out values ('F_history_delete','refused: '||sqlerrm); end;
end $$;
-- logs untouched
insert into t_out select 'G_logs_resolved_col', count(*) filter (where resolved)::text || ' of ' || count(*) from system_logs where message in ('tyreStockBySize is not defined','fatal crash: anr');
select k, v from t_out order by k;
rollback;

-- Expected (verified 2026-11-16 on tp_mirror2, a byte-identical copy of the live functions):
-- A_update_logs        refused: Audit records are immutable.
-- B_mgr_list           page=for_review/true,sentry=for_review/true   (Manager can read status)
-- B_mgr_resolve        refused: Only a super admin can resolve errors
-- B_mgr_resolve_old    refused: Only a super admin can resolve errors
-- B_mgr_history_rows   0   (history is super admin only)
-- C_tyreman_status     NULL (no access to status)
-- D_no_reason          refused: A reason is required to resolve errors
-- D_resolve            {"ok": true, "resolved": 1}
-- D_list_after         page=resolved/false,sentry=for_review/true
-- D_history            ->resolved by <super admin> [Fixed in release 2026-11-16] console
-- D_last_reason        ignored [Known Android OS issue]
-- E_after_recur        for_review resolved_at=null notified=null [Recurred after it was closed]
-- E_history_last       resolved>for_review actor=null regression [Recurred after it was closed]
-- E_ignored_stays      ignored
-- F_history_update     refused: Audit records are immutable.
-- F_history_delete     refused: Audit records are immutable.
-- G_logs_resolved_col  0 of 4   (no log row was changed)
