-- get_work_orders_page: materialise the scope narrow, plan with the real arguments (PERF-2)
-- STATUS: APPLIED LIVE 2026-11-12 on jhssdmeruxtrlqnwfksc (schema_migrations 20261112080030).
--
-- MEASURED BEFORE (approved KSA-only Manager, RLS on, warm, KSA 2026 YTD, limit 20):
--   shared buffers 15,408 (hit 10,742 + read 4,666), temp 3,455 read + 3,455 written, 923 ms.
--   CTE `scoped` selected w.* and was referenced twice, so every column of all 28,241 matching rows
--   was materialised and spilled ~27 MB to temp on every page click. The function was LANGUAGE sql,
--   which on PostgreSQL 17 always runs a generic plan (plan_cache_mode has no effect there), so the
--   date and country arguments could never drive an index and the table was read whole.
-- MEASURED AFTER (same user, same call):
--   KSA 2026 YTD  : shared 25,520 hits (index scan, one hit per row; 0 disk reads), temp 0, 97-100 ms
--   KSA Oct 2026  : shared 1,786, temp 0                         (was a full read + spill as above)
--   All, no dates : shared 15,525, temp 297                      (seq scan; spill 3,455 -> 297)
--   The shared figure for a whole-year window is HIGHER as a count because an index scan pins a
--   page once per row; what went away is the disk read, the 27 MB spill and 89% of the time.
--   The count still has to visit every matching row, so the finding's "under 2,000 buffers" target
--   is met for month-sized windows only.
--
-- WHAT CHANGED: LANGUAGE sql -> plpgsql (so force_custom_plan applies and constant filters fold);
-- `scoped` holds id + the one sort key; the page ids are joined back to work_orders for the
-- <= 200 rows returned. SECURITY INVOKER, STABLE, search_path, plan_cache_mode, signature and
-- grants are unchanged (anon cannot execute; authenticated can).
--
-- OUTPUT PROVEN IDENTICAL (md5 of the whole jsonb, old vs new in one transaction): 8 parameter
-- sets as the KSA Manager and 8 as a super admin - every sort column, both directions, search,
-- status/priority/type filters, limit clamp, deep offset, empty result. 16 of 16 equal.
--
-- ROLLBACK: re-create the function from MIGRATIONS_V587_WORK_ORDERS_PAGED_READ.sql, then
--   alter function public.get_work_orders_page(text,text,text,text,text,text,text,text,text,integer,integer)
--     set plan_cache_mode = force_custom_plan;

create or replace function public.get_work_orders_page(p_country text default null::text, p_from text default null::text, p_to text default null::text, p_search text default null::text, p_status text default null::text, p_priority text default null::text, p_type text default null::text, p_sort text default 'opened_at'::text, p_dir text default 'desc'::text, p_limit integer default 20, p_offset integer default 0)
 returns jsonb
 language plpgsql
 stable
 set search_path to 'public'
 set plan_cache_mode to 'force_custom_plan'
as $function$
declare
  v_q       text := nullif(btrim(coalesce(p_search,'')), '');
  v_sort    text := case when p_sort in ('work_order_no','asset_no','work_type','priority',
                                         'status','technician_name','opened_at',
                                         'target_completion','total_cost')
                         then p_sort else 'opened_at' end;
  v_asc     boolean := lower(coalesce(p_dir,'')) = 'asc';
  v_lim     integer := greatest(1, least(coalesce(p_limit, 20), 200));
  v_off     integer := greatest(0, coalesce(p_offset, 0));
  v_all_c   boolean := (p_country is null or p_country = 'All');
  v_from    timestamptz := p_from::timestamptz;
  v_to      timestamptz := (p_to || 'T23:59:59.999Z')::timestamptz;
  v_out     jsonb;
begin
  -- The scope is materialised NARROW (id + the one sort key). The old body
  -- materialised w.* for every matching row and spilled ~27 MB to temp per call.
  with scoped as materialized (
    select w.id,
      case v_sort
        when 'total_cost'        then w.total_cost
        when 'opened_at'         then extract(epoch from w.opened_at)::numeric
        when 'target_completion' then extract(epoch from w.target_completion)::numeric
      end as sort_num,
      case v_sort
        when 'work_order_no'   then w.work_order_no
        when 'asset_no'        then w.asset_no
        when 'work_type'       then w.work_type
        when 'priority'        then w.priority
        when 'status'          then public.wo_status_canonical(w.status)
        when 'technician_name' then w.technician_name
      end as sort_text
    from public.work_orders w
    where (v_all_c or w.country = p_country)
      and (v_from is null or w.opened_at >= v_from)
      and (v_to   is null or w.opened_at <= v_to)
      and (p_priority is null or p_priority = 'All' or w.priority  = p_priority)
      and (p_type     is null or p_type     = 'All' or w.work_type = p_type)
      and (p_status   is null or p_status   = 'All'
           or public.wo_status_canonical(w.status) = p_status)
      and (v_q is null or (
            w.work_order_no  ilike '%' || v_q || '%'
         or w.asset_no        ilike '%' || v_q || '%'
         or w.tyre_serial     ilike '%' || v_q || '%'
         or w.description     ilike '%' || v_q || '%'
         or w.technician_name ilike '%' || v_q || '%'))
  ),
  page as (
    select s.id, s.sort_num, s.sort_text
    from scoped s
    order by
      case when v_asc     then s.sort_num  end asc  nulls last,
      case when not v_asc then s.sort_num  end desc nulls last,
      case when v_asc     then s.sort_text end asc  nulls last,
      case when not v_asc then s.sort_text end desc nulls last,
      s.id                        -- sort keys are NOT unique; without this a page
                                  -- boundary inside a tie group skips or repeats rows
    limit  v_lim
    offset v_off
  )
  select jsonb_build_object(
    'total', (select count(*) from scoped),
    'rows',  coalesce((
      select jsonb_agg(
               to_jsonb(w) || jsonb_build_object('canon', public.wo_status_canonical(w.status))
               order by
                 case when v_asc     then p.sort_num  end asc  nulls last,
                 case when not v_asc then p.sort_num  end desc nulls last,
                 case when v_asc     then p.sort_text end asc  nulls last,
                 case when not v_asc then p.sort_text end desc nulls last,
                 p.id)
      from page p
      join public.work_orders w on w.id = p.id), '[]'::jsonb)
  ) into v_out;
  return v_out;
end
$function$;
