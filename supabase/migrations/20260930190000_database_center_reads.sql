-- Database Center (console /console/database) - read-only super-admin readers
-- plus a recorded restore test. Additive only: new functions, one new table in
-- the backups schema, two created_at indexes. No business row is changed.
--
-- Readers (all SECURITY DEFINER, search_path pinned, is_super_admin() gate in
-- the body, revoked from PUBLIC then anon, granted to authenticated):
--   admin_database_overview()          size, connections vs limit, cache hit,
--                                      migrations, nightly-backup job, largest tables
--   admin_table_detail(schema, table)  one table: rows, heap/index/toast size,
--                                      dead rows, vacuum/analyze times, indexes
--   admin_query_time_top(limit)        where database time goes, from
--                                      extensions.pg_stat_statements. Only DML/SELECT
--                                      shapes; quoted literals are masked so no value
--                                      (and never a password from a utility statement)
--                                      can reach the screen.
--   admin_query_time_reset(reason)     clears those counters, audited in console_sessions
--   admin_table_freshness()            newest row per core table (fixed list)
--   admin_run_restore_test(snapshot)   rebuilds every table of a nightly copy into a
--                                      throwaway temp table, counts, drops, records the
--                                      result in backups.restore_tests. Never touches
--                                      live tables.
--   admin_list_restore_tests(limit)
--
-- Indexes: parts_consumption(created_at) and production_logs(created_at) so the
-- freshness read is an index lookup instead of a 7 s scan (measured 30 Sep).
--
-- Rollback: drop the functions, drop table backups.restore_tests, drop the two
-- indexes. Nothing else depends on them.

create index if not exists parts_consumption_created_at_idx on public.parts_consumption (created_at);
create index if not exists production_logs_created_at_idx on public.production_logs (created_at);

create table if not exists backups.restore_tests (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid,
  snapshot_taken_at timestamptz,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  tables_tested int not null default 0,
  rows_expected bigint not null default 0,
  rows_restored bigint not null default 0,
  status text not null default 'running' check (status in ('running','passed','failed')),
  detail jsonb not null default '[]'::jsonb,
  error text,
  run_by uuid default auth.uid()
);
alter table backups.restore_tests enable row level security;
-- No policies: the table is read and written only through the DEFINER functions below.

-- ── overview ──────────────────────────────────────────────────────────────────
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
           greatest(coalesce(s.n_live_tup, c.reltuples::bigint), 0) as rows,
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

-- ── one table ─────────────────────────────────────────────────────────────────
create or replace function public.admin_table_detail(p_schema text, p_table text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_oid oid;
  v jsonb;
begin
  if not public.is_super_admin() then
    raise exception 'Permission denied: super admin required' using errcode = '42501';
  end if;
  select c.oid into v_oid from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = p_schema and c.relname = p_table and c.relkind in ('r','p');
  if v_oid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  select jsonb_build_object(
    'ok', true,
    'schema', p_schema, 'name', p_table,
    'rows', greatest(coalesce(s.n_live_tup, (select reltuples::bigint from pg_class where oid = v_oid)), 0),
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

-- ── where database time goes ──────────────────────────────────────────────────
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

create or replace function public.admin_query_time_reset(p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Permission denied: super admin required' using errcode = '42501';
  end if;
  if coalesce(length(btrim(p_reason)), 0) < 3 then
    raise exception 'A reason is required' using errcode = '22023';
  end if;
  perform extensions.pg_stat_statements_reset();
  insert into public.console_sessions (admin_id, action, target_type, details)
  values (auth.uid(), 'query_counters_reset', 'database', jsonb_build_object('reason', btrim(p_reason)));
  return jsonb_build_object('ok', true, 'reset_at', now());
end;
$$;

-- ── data freshness (fixed list, never a caller-supplied table) ────────────────
create or replace function public.admin_table_freshness()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v jsonb := '[]'::jsonb;
  r record;
  v_ts timestamptz;
begin
  if not public.is_super_admin() then
    raise exception 'Permission denied: super admin required' using errcode = '42501';
  end if;
  for r in select * from (values
      ('tyre_records', 'Tyre fitments'),
      ('inspections', 'Inspections'),
      ('parts_consumption', 'Expense lines'),
      ('work_orders', 'Job cards'),
      ('vehicle_fleet', 'Asset register'),
      ('production_logs', 'Concrete m3'),
      ('accidents', 'Accidents')) t(tbl, label)
  loop
    begin
      execute format('select max(created_at) from public.%I', r.tbl) into v_ts;
      v := v || jsonb_build_array(jsonb_build_object('table', r.tbl, 'label', r.label, 'last_row_at', v_ts));
    exception when others then
      v := v || jsonb_build_array(jsonb_build_object('table', r.tbl, 'label', r.label, 'last_row_at', null, 'unreadable', true));
    end;
  end loop;
  return jsonb_build_object('generated_at', now(), 'rows', v);
end;
$$;

-- ── restore test ──────────────────────────────────────────────────────────────
create or replace function public.admin_run_restore_test(p_snapshot_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, backups, pg_catalog
as $$
declare
  v_snap uuid := p_snapshot_id;
  v_taken timestamptz;
  v_test uuid;
  r record;
  v_tmp text;
  v_restored bigint;
  v_expected bigint := 0;
  v_total bigint := 0;
  v_detail jsonb := '[]'::jsonb;
  v_failed boolean := false;
  v_tables int := 0;
begin
  if not public.is_super_admin() then
    raise exception 'Permission denied: super admin required' using errcode = '42501';
  end if;
  if v_snap is null then
    select id, taken_at into v_snap, v_taken from backups.snapshots order by taken_at desc limit 1;
  else
    select taken_at into v_taken from backups.snapshots where id = v_snap;
  end if;
  if v_taken is null then
    return jsonb_build_object('ok', false, 'reason', 'no_snapshot');
  end if;

  insert into backups.restore_tests (snapshot_id, snapshot_taken_at) values (v_snap, v_taken) returning id into v_test;

  for r in
    select st.table_name, sum(st.row_count) filter (where st.status = 'ok') as expected,
           bool_or(st.status <> 'ok') as partial
      from backups.snapshot_tables st
     where st.snapshot_id = v_snap
     group by st.table_name order by st.table_name
  loop
    v_tables := v_tables + 1;
    v_tmp := 'restore_test_' || replace(v_test::text, '-', '') || '_' || v_tables;
    begin
      if to_regclass('public.' || quote_ident(r.table_name)) is null then
        raise exception 'table no longer exists';
      end if;
      execute format('create temp table %I (like public.%I)', v_tmp, r.table_name);
      execute format(
        'insert into %I select b.* from backups.snapshot_tables st
           cross join lateral jsonb_populate_recordset(null::public.%I, st.data) b
          where st.snapshot_id = %L and st.table_name = %L and st.status = ''ok''',
        v_tmp, r.table_name, v_snap, r.table_name);
      execute format('select count(*) from %I', v_tmp) into v_restored;
      execute format('drop table %I', v_tmp);
      v_expected := v_expected + coalesce(r.expected, 0);
      v_total := v_total + v_restored;
      if v_restored <> coalesce(r.expected, 0) then v_failed := true; end if;
      v_detail := v_detail || jsonb_build_array(jsonb_build_object(
        'table', r.table_name, 'expected', coalesce(r.expected, 0), 'restored', v_restored,
        'skipped_part', coalesce(r.partial, false),
        'ok', v_restored = coalesce(r.expected, 0)));
    exception when others then
      v_failed := true;
      begin execute format('drop table if exists %I', v_tmp); exception when others then null; end;
      v_detail := v_detail || jsonb_build_array(jsonb_build_object(
        'table', r.table_name, 'expected', coalesce(r.expected, 0), 'restored', 0, 'ok', false,
        'error', 'Rows could not be rebuilt from this copy'));
    end;
  end loop;

  update backups.restore_tests
     set finished_at = now(), tables_tested = v_tables, rows_expected = v_expected,
         rows_restored = v_total, detail = v_detail,
         status = case when v_failed or v_tables = 0 then 'failed' else 'passed' end
   where id = v_test;

  insert into public.console_sessions (admin_id, action, target_type, details)
  values (auth.uid(), 'restore_test_run', 'backup',
          jsonb_build_object('snapshot_id', v_snap, 'tables', v_tables, 'rows_expected', v_expected,
                             'rows_restored', v_total, 'passed', not (v_failed or v_tables = 0)));

  return jsonb_build_object('ok', true, 'test_id', v_test, 'snapshot_id', v_snap, 'snapshot_taken_at', v_taken,
    'tables_tested', v_tables, 'rows_expected', v_expected, 'rows_restored', v_total,
    'status', case when v_failed or v_tables = 0 then 'failed' else 'passed' end, 'detail', v_detail);
end;
$$;

create or replace function public.admin_list_restore_tests(p_limit int default 10)
returns jsonb
language plpgsql
security definer
set search_path = public, backups, pg_catalog
as $$
declare v jsonb;
begin
  if not public.is_super_admin() then
    raise exception 'Permission denied: super admin required' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(t order by t.started_at desc), '[]'::jsonb) into v from (
    select id, snapshot_id, snapshot_taken_at, started_at, finished_at, tables_tested,
           rows_expected, rows_restored, status, detail
      from backups.restore_tests order by started_at desc limit greatest(1, least(coalesce(p_limit, 10), 100))
  ) t;
  return v;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.admin_database_overview()',
    'public.admin_table_detail(text, text)',
    'public.admin_query_time_top(int)',
    'public.admin_query_time_reset(text)',
    'public.admin_table_freshness()',
    'public.admin_run_restore_test(uuid)',
    'public.admin_list_restore_tests(int)'
  ] loop
    execute format('revoke all on function %s from public', f);
    execute format('revoke all on function %s from anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
