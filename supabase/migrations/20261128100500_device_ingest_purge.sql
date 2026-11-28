-- Device ingest retention: follow-up to 20261128100000_device_ingest.sql.
--
-- STATUS: APPLIED 2026-11-28 to jhssdmeruxtrlqnwfksc (migration name device_ingest_purge), after
-- 20261128100000. Kept separate
-- because the function body contains DELETE statements, which make an MCP
-- apply pause for a destructive-statement confirmation. The migration only
-- creates the function; it deletes nothing itself.
--
-- device_ingest_purge(days): usage minutes are only needed for the current
-- minute; rejected ledger rows are monitoring only. Not scheduled here; call
-- from a cron job (service_role) when wanted.
--
-- VERIFY: select has_function_privilege('authenticated','public.device_ingest_purge(int)','execute'); -> false
-- ROLLBACK: drop function if exists public.device_ingest_purge(int);

begin;

-- Retention: usage minutes are only needed for the current minute; rejected
-- ledger rows are monitoring only. Not scheduled here; call from a cron job.
create or replace function public.device_ingest_purge(p_days int default 90)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_u int; v_r int;
begin
  delete from public.device_ingest_usage where minute < now() - interval '1 day';
  get diagnostics v_u = row_count;
  delete from public.device_ingest_messages
   where status = 'rejected' and received_at < now() - make_interval(days => least(greatest(coalesce(p_days, 90), 7), 3650));
  get diagnostics v_r = row_count;
  return jsonb_build_object('usage_rows', v_u, 'rejected_rows', v_r);
end $$;

do $g$
begin
  execute 'revoke execute on function public.device_ingest_purge(int) from public';
  execute 'revoke execute on function public.device_ingest_purge(int) from anon';
  execute 'revoke execute on function public.device_ingest_purge(int) from authenticated';
  execute 'grant execute on function public.device_ingest_purge(int) to service_role';
end $g$;

commit;
