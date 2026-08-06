-- V487 - what CAN be watched, so adding a feed is a dropdown and not a code change.
-- STATUS: APPLIED LIVE + verified (189 candidate tables, 12 already watched).
--
-- Returns every base table shaped like an upload target: it carries
-- organisation_id (so coverage can scope to the company) and country (so a
-- country that stops uploading is not hidden behind the ones that did not),
-- plus the date and site columns available on it. The console picker reads this;
-- upload_feeds' own validate trigger re-checks whatever is chosen, so a stale
-- pick still cannot inject a bad identifier.
--
-- ROLLBACK: drop function public.list_upload_feed_candidates();

create or replace function public.list_upload_feed_candidates()
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare v_out jsonb;
begin
  if not public.is_super_admin() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(x order by x.already desc, x.table_name), '[]'::jsonb)
    into v_out
  from (
    select t.table_name,
           exists (select 1 from public.upload_feeds f where f.table_name = t.table_name) as already,
           (select coalesce(jsonb_agg(c.column_name order by c.column_name), '[]'::jsonb)
              from information_schema.columns c
             where c.table_schema = 'public' and c.table_name = t.table_name
               and c.data_type in ('date', 'timestamp with time zone', 'timestamp without time zone')
           ) as date_columns,
           (select coalesce(jsonb_agg(c.column_name order by c.column_name), '[]'::jsonb)
              from information_schema.columns c
             where c.table_schema = 'public' and c.table_name = t.table_name
               and c.column_name in ('site', 'location', 'store_code', 'branch')
           ) as site_columns,
           (select n_live_tup from pg_stat_user_tables s
             where s.schemaname = 'public' and s.relname = t.table_name) as approx_rows
      from information_schema.tables t
     where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
       and exists (select 1 from information_schema.columns c
                    where c.table_schema = 'public' and c.table_name = t.table_name
                      and c.column_name = 'organisation_id')
       and exists (select 1 from information_schema.columns c
                    where c.table_schema = 'public' and c.table_name = t.table_name
                      and c.column_name = 'country')
       and exists (select 1 from information_schema.columns c
                    where c.table_schema = 'public' and c.table_name = t.table_name
                      and c.data_type in ('date', 'timestamp with time zone', 'timestamp without time zone'))
  ) x;

  return jsonb_build_object('ok', true, 'tables', v_out);
end $function$;

revoke all on function public.list_upload_feed_candidates() from public, anon;
grant execute on function public.list_upload_feed_candidates() to authenticated;
