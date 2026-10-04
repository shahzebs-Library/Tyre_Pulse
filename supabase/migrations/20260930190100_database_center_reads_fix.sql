-- Database Center fix-up (applied right after 20260930190000):
--  * admin_query_time_top: Postgres regular expressions spell a word boundary
--    \y, not \b (\b is a backspace), so the shape filter matched nothing.
--  * admin_database_overview: row counts scaled from the current heap size
--    (the planner's own method) instead of the stale n_live_tup, which read
--    153,476 for audit_log_v2 against a true 546,437.
--  * admin_table_detail: adds an exact row count (tables under 300 MB) beside the estimate.
-- Grants are unchanged by create or replace.

create or replace function public.admin_database_overview()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v jsonb;
  v_conn jsonb;
  v_mig jsonb;
  v_tables jsonb;
  v_cron jsonb;
  v_cache numeric;
  v_table_count int;
  v_all_bytes bigint;
begin
  if not public.is_super_admin() then
    raise exception 'Permission denied: super admin required' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'total', count(*),
    'client_active', count(*) filter (where backend_type = 'client backend' and state = 'active'),
    'client_idle', count(*) filter (where backend_type = 'client backend' and state is distinct from 'active'),
    'background', count(*) filter (where backend_type is distinct from 'client backend'),
    'max', current_setting('max_connections')::int
  ) into v_conn
  from pg_stat_activity where datname = current_database() or datname is null;

  select round(100.0 * sum(blks_hit) / nullif(sum(blks_hit) + sum(blks_read), 0), 2)
    into v_cache from pg_stat_database where datname = current_database();

  begin
    select jsonb_build_object(
      'total', (select count(*) from supabase_migrations.schema_migrations),
      'today', (select count(*) from supabase_migrations.schema_migrations
                 where version like to_char(now() at time zone 'utc', 'YYYYMMDD') || '%'),
      'latest', (select coalesce(jsonb_agg(m order by m.version desc), '[]'::jsonb) from (
                   select version, name from supabase_migrations.schema_migrations
                   order by version desc limit 12) m)
    ) into v_mig;
  exception when others then
    v_mig := null;
  end;

  begin
    select jsonb_build_object('schedule', schedule, 'active', active) into v_cron
      from cron.job where jobname = 'nightly-backup' limit 1;
  exception when others then
    v_cron := null;
  end;

  select count(*), sum(pg_total_relation_size(c.oid)) into v_table_count, v_all_bytes
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where c.relkind in ('r','p') and n.nspname not in ('pg_catalog','information_schema','pg_toast')
     and n.nspname not like 'pg_temp%';

  select coalesce(jsonb_agg(t order by t.bytes desc), '[]'::jsonb) into v_tables from (
    select n.nspname as schema, c.relname as name,
           case when c.reltuples > 0 and c.relpages > 0
                then round(c.reltuples / c.relpages * (pg_relation_size(c.oid) / current_setting('block_size')::numeric))::bigint
                else greatest(coalesce(s.n_live_tup, 0), 0) end as rows,
           pg_total_relation_size(c.oid) as bytes,
           coalesce(s.n_dead_tup, 0) as dead_rows
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      left join pg_stat_all_tables s on s.relid = c.oid
     where c.relkind in ('r','p')
       and n.nspname not in ('pg_catalog','information_schema','pg_toast')
       and n.nspname not like 'pg_temp%'
     order by pg_total_relation_size(c.oid) desc
     limit 40
  ) t;

  v := jsonb_build_object(
    'generated_at', now(),
    'db_bytes', pg_database_size(current_database()),
    'connections', v_conn,
    'cache_hit_pct', v_cache,
    'migrations', v_mig,
    'nightly_backup_job', v_cron,
    'table_count', v_table_count,
    'all_table_bytes', v_all_bytes,
    'tables', v_tables
  );
  return v;
end;
$$;

create or replace function public.admin_table_detail(p_schema text, p_table text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_oid oid;
  v jsonb;
  v_exact bigint;
begin
  if not public.is_super_admin() then
    raise exception 'Permission denied: super admin required' using errcode = '42501';
  end if;
  select c.oid into v_oid from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = p_schema and c.relname = p_table and c.relkind in ('r','p');
  if v_oid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  -- Exact row count for one table on demand, only for tables under 300 MB so
  -- the read stays inside the API statement timeout. Larger tables show the
  -- size-scaled estimate and say so. Planner figures go stale on rarely
  -- analysed tables (audit_log_v2 read 152,700 against a true 546,437).
  if pg_total_relation_size(v_oid) < 300 * 1024 * 1024 then
    begin
      execute format('select count(*) from %I.%I', p_schema, p_table) into v_exact;
    exception when others then
      v_exact := null;
    end;
  end if;
  select jsonb_build_object(
    'ok', true,
    'schema', p_schema, 'name', p_table,
    'rows', v_exact,
    'rows_estimate', (select case when c.reltuples > 0 and c.relpages > 0
                       then round(c.reltuples / c.relpages * (pg_relation_size(c.oid) / current_setting('block_size')::numeric))::bigint
                       else greatest(coalesce(s.n_live_tup, 0), 0) end from pg_class c where c.oid = v_oid),
    'dead_rows', coalesce(s.n_dead_tup, 0),
    'total_bytes', pg_total_relation_size(v_oid),
    'heap_bytes', pg_relation_size(v_oid),
    'index_bytes', pg_indexes_size(v_oid),
    'toast_bytes', greatest(pg_total_relation_size(v_oid) - pg_relation_size(v_oid) - pg_indexes_size(v_oid), 0),
    'columns', (select count(*) from pg_attribute a where a.attrelid = v_oid and a.attnum > 0 and not a.attisdropped),
    'last_vacuum', greatest(s.last_vacuum, s.last_autovacuum),
    'last_analyze', greatest(s.last_analyze, s.last_autoanalyze),
    'inserts', coalesce(s.n_tup_ins, 0), 'updates', coalesce(s.n_tup_upd, 0), 'deletes', coalesce(s.n_tup_del, 0),
    'seq_scans', coalesce(s.seq_scan, 0), 'index_scans', coalesce(s.idx_scan, 0),
    'rls', (select relrowsecurity from pg_class where oid = v_oid),
    'in_nightly_copy', case when p_schema = 'public' then (p_table = any (backups._core_tables())) else false end,
    'indexes', (select coalesce(jsonb_agg(jsonb_build_object(
                  'name', ic.relname, 'bytes', pg_relation_size(ic.oid),
                  'scans', coalesce(si.idx_scan, 0), 'unique', i.indisunique) order by pg_relation_size(ic.oid) desc), '[]'::jsonb)
                  from pg_index i join pg_class ic on ic.oid = i.indexrelid
                  left join pg_stat_all_indexes si on si.indexrelid = i.indexrelid
                 where i.indrelid = v_oid)
  ) into v
  from (select 1) x left join pg_stat_all_tables s on s.relid = v_oid;
  return v;
end;
$$;

create or replace function public.admin_query_time_top(p_limit int default 12)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_total double precision;
  v_since timestamptz;
  v_rows jsonb;
begin
  if not public.is_super_admin() then
    raise exception 'Permission denied: super admin required' using errcode = '42501';
  end if;
  begin
    select stats_reset into v_since from extensions.pg_stat_statements_info();
    select sum(total_exec_time) into v_total from extensions.pg_stat_statements(true);
  exception when others then
    return jsonb_build_object('ok', false, 'reason', 'unavailable');
  end;

  select coalesce(jsonb_agg(r order by r.total_ms desc), '[]'::jsonb) into v_rows from (
    select q.queryid::text as id,
           q.calls,
           round(q.total_exec_time::numeric, 1) as total_ms,
           round(q.mean_exec_time::numeric, 2) as mean_ms,
           round((100.0 * q.total_exec_time / nullif(v_total, 0))::numeric, 2) as share_pct,
           -- Normalised shape only. pg_stat_statements already replaces constants
           -- with $n; quoted text that survives is masked, whitespace collapsed,
           -- and the shape is cut to 220 characters.
           left(regexp_replace(regexp_replace(q.query, '''[^'']*''', '''?''', 'g'), '\s+', ' ', 'g'), 220) as shape
      from extensions.pg_stat_statements(true) q
     where q.query ~* '^\s*(select|insert|update|delete|with)\y'
     order by q.total_exec_time desc
     limit greatest(1, least(coalesce(p_limit, 12), 50))
  ) r;

  return jsonb_build_object('ok', true, 'since', v_since, 'total_ms', round(coalesce(v_total, 0)::numeric, 1), 'rows', v_rows);
end;
$$;

