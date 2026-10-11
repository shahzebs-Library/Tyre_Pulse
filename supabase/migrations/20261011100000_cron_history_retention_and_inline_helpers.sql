-- 20261011100000 cron_history_retention_and_inline_helpers
-- STATUS: APPLIED LIVE 2026-10-11 (Supabase MCP) and verified.
--
-- 1) cron.job_run_details had 469,563 rows / 103 MB (never purged since
--    2026-07-02) and NO index on start_time; we cannot add one (owned by
--    supabase_admin). cron_health_watch (every 5 min) seq-scanned it: 3,114
--    calls x 779 ms = the single largest load on the database, competing with
--    every page. Purged rows older than 30 days (303,917) INTO
--    _bak.cron_run_details_20261011 first, so it is reversible. No screen shows
--    more than 30 days (_cron_health clamps p_days to 30). Daily job
--    cron-run-history-retention (01:47 UTC) keeps it at 30 days.
--    Measured: cron_health_watch 779 ms -> 340 ms before autovacuum.
--    Restore: insert into cron.job_run_details select * from _bak.cron_run_details_20261011;
--
-- 2) tyre_size_key / cpk_unit_for_asset_type carried SET search_path, which
--    blocks inlining and costs a GUC save/restore per call. get_tyre_running_life
--    calls them per row: single asset 116 -> 54 ms, 1,000-row page 655 -> 305 ms,
--    results byte-identical (md5 of both payloads). Bodies use only pg_catalog
--    built-ins, which are always searched first, so nothing can shadow them.
--    Rollback: alter function ... set search_path = public;
--
-- MEASURED AND REFUSED (do not re-add): pg_trgm GIN on work_orders
-- work_order_no/asset_no for global search - planner keeps the seq scan under
-- RLS (759 -> 804 ms on a no-match term). Partial index for rfr_no lists -
-- already 5 ms warm.

create schema if not exists _bak;
create table if not exists _bak.cron_run_details_20261011 as select * from cron.job_run_details where false;

create or replace function public.cron_purge_run_history(p_days int default 30, p_batch int default 50000)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_cut timestamptz := now() - make_interval(days => greatest(coalesce(p_days,30), 14)); v_n int;
begin
  with gone as (
    delete from cron.job_run_details
     where runid in (select runid from cron.job_run_details where start_time < v_cut order by runid limit p_batch)
    returning *)
  insert into _bak.cron_run_details_20261011 select * from gone;
  get diagnostics v_n = row_count;
  return jsonb_build_object('purged', v_n, 'before', v_cut);
end $$;
revoke all on function public.cron_purge_run_history(int,int) from public, anon, authenticated;

select cron.schedule('cron-run-history-retention', '47 1 * * *', $$select public.cron_purge_run_history(30, 20000)$$);

alter function public.tyre_size_key(text) reset search_path;
alter function public.cpk_unit_for_asset_type(text) reset search_path;
