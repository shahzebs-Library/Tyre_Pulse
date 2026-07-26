-- V362 — Duplicate control: find, price, delete and UNDO duplicate import rows.
--
-- WHY THIS EXISTS
-- The staging import triggers (process_expenses_country, process_stg_*) do a bare
-- INSERT with no dedupe guard, and the browser importer retries a failed chunk.
-- When a chunk's insert actually succeeded server-side but the response was lost,
-- the retry inserted the same chunk again. Measured on live data at the time of
-- writing: parts_consumption carried 8,248 such rows (Egypt 4,993 / UAE 3,120 /
-- KSA 135), overstating Egypt's expense total by EGP 17.4M (18% of the country's
-- reported spend). Until now the only duplicate tooling in the product covered
-- tyre_records; the money table had none.
--
-- THE ONE HARD RULE ENCODED HERE
-- A repeated business key is NOT automatically a duplicate. The discriminator is
-- `source_row` (the source file's own line number):
--   * >1 distinct source_row in a group  -> GENUINE repeated lines in the source
--     file. Verified on work_order_line_items, where all 4,604 repeated groups
--     carry distinct source_row values (44,696 rows). These are NEVER deleted.
--   * 0 or 1 distinct source_row         -> a re-inserted row. Verified on
--     parts_consumption, where whole ~470-row chunks share an identical pair of
--     insertion timestamps ~110s apart (100% set overlap on the pair, 0% against
--     every other chunk).
-- Everything below refuses to delete a group the rule calls genuine.
--
-- SAFETY
--   * super-admin only (is_super_admin()), org-scoped for everyone else.
--   * every delete archives the FULL row as jsonb into dup_resolve_archive first
--     and is reversible with admin_dup_restore(batch_id). This does not rely on
--     create_backup_snapshot, whose curated table list does not include
--     parts_consumption or work_order_line_items.
--   * the scanned table + its business-key columns come from an IMMUTABLE
--     server-side safelist (_dup_scan_spec), never from the caller, so the
--     dynamic SQL has no injection surface.
--   * restore builds an explicit column list that EXCLUDES generated columns
--     (tyre_records.fitment_date, work_orders.total_cost) - a positional
--     `select *` insert would be rejected by Postgres, which is exactly how the
--     V320 approve_pending_upload path broke.
--
-- Reversible: see the footer.

-- ---------------------------------------------------------------------------
-- 1. Safelist. Adding a target here is the ONLY way to make it scannable.
-- ---------------------------------------------------------------------------
create or replace function public._dup_scan_spec(p_key text default null)
returns table(key text, tbl text, bkey_cols text[], date_col text,
              money_col text, src_col text, kind text, label text)
language sql
immutable
set search_path to 'public'
as $function$
  select s.key, s.tbl, s.bkey_cols, s.date_col, s.money_col, s.src_col, s.kind, s.label
  from (values
    ('parts_expense', 'parts_consumption',
     array['issue_number','work_order_no','item_code','item_description','qty',
           'value_amount','txn_date','asset_code'],
     'created_at', 'line_cost', 'source_row', 'money',
     'Expense grid lines (tyre / spare / oil)'),

    ('wo_lines', 'work_order_line_items',
     array['work_order_no','asset_no','task','detail','action','qty','opened_date'],
     'created_at', null, 'source_row', 'operational',
     'Work order task lines'),

    ('work_orders', 'work_orders',
     array['work_order_no','asset_no','description','opened_at'],
     'created_at', 'total_cost', null, 'operational',
     'Work orders / job cards'),

    -- tyre_position is ESSENTIAL here. `serial_no` is not reliably a unique tyre
    -- identifier in this data: it often carries a DOT batch code (DOT18E56) or even
    -- a size string ("235/70 R 16"), which every tyre from the same batch shares.
    -- Live example: BH021 / 2025-12-01 / DOT18EWHMAFL appears 4 times, on LHF1,
    -- LHF2, RHF1 and RHF2 - four real tyres, not one row imported four times.
    -- Without position in the key this tool would offer to delete 3 of every 4
    -- tyres on such a vehicle. (The older recon_duplicate_key_tyres() RPC shares
    -- this blind spot; it is only safe because its resolver refuses to delete
    -- anything that is not byte-identical.)
    ('tyre_records', 'tyre_records',
     array['serial_no','asset_no','issue_date','tyre_position','removal_date'],
     'created_at', 'cost_per_tyre', null, 'operational',
     'Tyre fitment records'),

    -- Kept: a second reading of the SAME asset on the SAME date with the SAME
    -- kilometre value carries no new information, and this is the landing table for
    -- the daily_km bulk import, which is the path most likely to be re-run.
    ('odometer_logs', 'odometer_logs',
     array['asset_no','reading_date','odometer_km'],
     'created_at', null, null, 'log',
     'Odometer / daily KM readings')

    -- DELIBERATELY NOT LISTED, each for a measured reason. The inclusion test is:
    -- a table belongs here ONLY if a repeated business key means the extra row
    -- carries NO new information.
    --   * inspections     - repeats carry DIFFERENT tyre_conditions (live: TM393 /
    --     2026-07-20 / Routine / same inspector, 3 rows, 3 different condition sets).
    --     Separate real inspections or corrected re-submissions; deleting the later
    --     one discards the corrected readings. A repeated key here is a CONFLICT to
    --     review, not a duplicate to delete.
    --   * accidents       - same reasoning: two similar same-day records still differ
    --     in their claim, fault and repair fields.
    --   * production_logs - a PER-TRIP log. A mixer delivering 12 m3 to the same site
    --     ten times in a day is ten real deliveries (live: TM514 -> Diriyah-G2,
    --     2026-07-05, 12 m3, 10 rows). Deleting would destroy the m3 denominator
    --     behind cost-per-m3, the metric the operating company runs the business on.
    -- All three stay visible read-only through Data Reconciliation. The two
    -- mobile-written ones already carry client_uuid for offline-retry idempotency,
    -- so the double-submit case is handled at write time anyway.
  ) as s(key, tbl, bkey_cols, date_col, money_col, src_col, kind, label)
  where p_key is null or s.key = p_key;
$function$;

revoke all on function public._dup_scan_spec(text) from public, anon;
grant execute on function public._dup_scan_spec(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Archive so every delete is undoable.
-- ---------------------------------------------------------------------------
create table if not exists public.dup_resolve_archive (
  id              uuid primary key default gen_random_uuid(),
  batch_id        uuid not null,
  organisation_id uuid,
  target_key      text not null,
  tbl             text not null,
  country         text,
  row_data        jsonb not null,
  reason          text,
  deleted_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  restored_at     timestamptz
);

create index if not exists dup_resolve_archive_batch_idx on public.dup_resolve_archive (batch_id);
create index if not exists dup_resolve_archive_created_idx on public.dup_resolve_archive (created_at desc);

alter table public.dup_resolve_archive enable row level security;

-- Read-only to super admins; only the DEFINER functions below ever write.
drop policy if exists dup_resolve_archive_select on public.dup_resolve_archive;
create policy dup_resolve_archive_select on public.dup_resolve_archive
  for select to authenticated
  using ((select public.is_super_admin()));

revoke all on public.dup_resolve_archive from anon;
grant select on public.dup_resolve_archive to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Helpers
-- ---------------------------------------------------------------------------

-- Business-key expression for a target, e.g. coalesce(a::text,'')||'|'||...
create or replace function public._dup_bkey_expr(p_cols text[])
returns text
language sql
immutable
set search_path to 'public'
as $function$
  select string_agg(format('coalesce(%I::text,%L)', c, ''), $delim$ || '|' || $delim$)
  from unnest(p_cols) as c;
$function$;

revoke all on function public._dup_bkey_expr(text[]) from public, anon;

-- ---------------------------------------------------------------------------
-- 4. List the scannable targets.
-- ---------------------------------------------------------------------------
create or replace function public.admin_dup_targets()
returns table(key text, tbl text, label text, kind text, has_source_row boolean)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_super_admin() then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;

  return query
  select s.key, s.tbl, s.label, s.kind, (s.src_col is not null)
  from public._dup_scan_spec(null) s
  order by (s.kind = 'money') desc, s.label;
end $function$;

revoke all on function public.admin_dup_targets() from public, anon;
grant execute on function public.admin_dup_targets() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Preview: how many extras, and what money do they carry?
--    Never mutates. Split by verdict so the caller sees what is protected.
-- ---------------------------------------------------------------------------
create or replace function public.admin_dup_preview(p_key text, p_country text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_spec   record;
  v_bkey   text;
  v_src    text;
  v_org    uuid := public.app_current_org();
  v_money  text;
  v_out    jsonb;
begin
  if not public.is_super_admin() then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;

  select * into v_spec from public._dup_scan_spec(p_key);
  if v_spec.key is null then
    raise exception 'Unknown duplicate target.' using errcode = '22023';
  end if;

  v_bkey  := public._dup_bkey_expr(v_spec.bkey_cols);
  v_src   := case when v_spec.src_col is null then 'null::text'
                  else format('%I::text', v_spec.src_col) end;
  v_money := case when v_spec.money_col is null then '0::numeric'
                  else format('coalesce(%I::numeric,0)', v_spec.money_col) end;

  execute format($f$
    with g as (
      select %s as bkey, %I as ts, %s as src, %s as money, id
        from public.%I
       where (organisation_id = $1 or $2)
         and ($3 is null or country = $3)
    ), grp as (
      select bkey, count(*) as n, count(distinct src) as dsrc
        from g group by bkey having count(*) > 1
    ), ranked as (
      select g.id, g.money, grp.dsrc,
             row_number() over (partition by g.bkey order by g.ts, g.id) as rn
        from g join grp on grp.bkey = g.bkey
    )
    select jsonb_build_object(
      'groups_total',      (select count(*) from grp),
      'groups_deletable',  (select count(*) from grp where dsrc <= 1),
      'groups_protected',  (select count(*) from grp where dsrc > 1),
      'extra_deletable',   (select count(*) from ranked where rn > 1 and dsrc <= 1),
      'extra_protected',   (select count(*) from ranked where rn > 1 and dsrc > 1),
      'money_deletable',   (select round(coalesce(sum(money),0),2) from ranked where rn > 1 and dsrc <= 1)
    )
  $f$, v_bkey, v_spec.date_col, v_src, v_money, v_spec.tbl)
  into v_out
  using v_org, public.is_super_admin(), nullif(btrim(coalesce(p_country,'')), '');

  return coalesce(v_out, '{}'::jsonb)
         || jsonb_build_object('key', v_spec.key, 'tbl', v_spec.tbl,
                               'label', v_spec.label, 'country', p_country,
                               'money_col', v_spec.money_col);
end $function$;

revoke all on function public.admin_dup_preview(text, text) from public, anon;
grant execute on function public.admin_dup_preview(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Scan: the actual groups, so a human can eyeball them before deleting.
-- ---------------------------------------------------------------------------
create or replace function public.admin_dup_scan(p_key text, p_country text default null,
                                                 p_limit int default 200)
returns table(bkey text, copies bigint, distinct_source_rows bigint,
              verdict text, first_seen timestamptz, last_seen timestamptz,
              money numeric, sample_country text)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_spec  record;
  v_bkey  text;
  v_src   text;
  v_money text;
  v_org   uuid := public.app_current_org();
begin
  if not public.is_super_admin() then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;

  select * into v_spec from public._dup_scan_spec(p_key);
  if v_spec.key is null then
    raise exception 'Unknown duplicate target.' using errcode = '22023';
  end if;

  v_bkey  := public._dup_bkey_expr(v_spec.bkey_cols);
  v_src   := case when v_spec.src_col is null then 'null::text'
                  else format('%I::text', v_spec.src_col) end;
  v_money := case when v_spec.money_col is null then '0::numeric'
                  else format('coalesce(%I::numeric,0)', v_spec.money_col) end;

  return query execute format($f$
    with g as (
      select %s as bkey, %I as ts, %s as src, %s as money, country
        from public.%I
       where (organisation_id = $1 or $2)
         and ($3 is null or country = $3)
    )
    select g.bkey,
           count(*) as copies,
           count(distinct g.src) as distinct_source_rows,
           case when count(distinct g.src) > 1 then 'genuine' else 'duplicate' end as verdict,
           min(g.ts) as first_seen,
           max(g.ts) as last_seen,
           round(sum(g.money) - (min(g.money)), 2) as money,
           min(g.country) as sample_country
      from g
     group by g.bkey
    having count(*) > 1
     order by count(*) desc, sum(g.money) desc nulls last
     limit $4
  $f$, v_bkey, v_spec.date_col, v_src, v_money, v_spec.tbl)
  using v_org, public.is_super_admin(),
        nullif(btrim(coalesce(p_country,'')), ''), greatest(1, least(coalesce(p_limit,200), 2000));
end $function$;

revoke all on function public.admin_dup_scan(text, text, int) from public, anon;
grant execute on function public.admin_dup_scan(text, text, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Resolve: archive then delete the extras. Keeps the EARLIEST row of each
--    group. Refuses any group the source_row rule calls genuine.
-- ---------------------------------------------------------------------------
create or replace function public.admin_dup_resolve(p_key text, p_country text default null,
                                                    p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_spec    record;
  v_bkey    text;
  v_src     text;
  v_org     uuid := public.app_current_org();
  v_batch   uuid := gen_random_uuid();
  v_deleted bigint := 0;
begin
  if not public.is_super_admin() then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;

  select * into v_spec from public._dup_scan_spec(p_key);
  if v_spec.key is null then
    raise exception 'Unknown duplicate target.' using errcode = '22023';
  end if;

  v_bkey := public._dup_bkey_expr(v_spec.bkey_cols);
  v_src  := case when v_spec.src_col is null then 'null::text'
                 else format('%I::text', v_spec.src_col) end;

  -- One statement: rank each group by insertion order, delete everything after
  -- the first, and archive the deleted rows via the DELETE ... RETURNING output.
  -- `count(distinct src) <= 1` is what protects genuine repeated source lines.
  execute format($f$
    with g as (
      select id, %s as bkey, %I as ts, %s as src
        from public.%I
       where (organisation_id = $1 or $2)
         and ($3 is null or country = $3)
    ), grp as (
      select bkey from g group by bkey
      having count(*) > 1 and count(distinct src) <= 1
    ), ranked as (
      select g.id, row_number() over (partition by g.bkey order by g.ts, g.id) as rn
        from g join grp on grp.bkey = g.bkey
    ), gone as (
      delete from public.%I t
       where t.id in (select id from ranked where rn > 1)
      returning t.*
    )
    insert into public.dup_resolve_archive
      (batch_id, organisation_id, target_key, tbl, country, row_data, reason)
    select $4, $1, $5, $6, (to_jsonb(gone.*) ->> 'country'), to_jsonb(gone.*), $7
      from gone
  $f$, v_bkey, v_spec.date_col, v_src, v_spec.tbl, v_spec.tbl)
  using v_org, public.is_super_admin(), nullif(btrim(coalesce(p_country,'')), ''),
        v_batch, v_spec.key, v_spec.tbl,
        coalesce(nullif(btrim(coalesce(p_reason,'')), ''), 'Duplicate import rows removed');

  select count(*) into v_deleted from public.dup_resolve_archive where batch_id = v_batch;

  insert into public.system_logs (severity, source, message, detail)
  values ('warning', 'duplicate-control',
          format('Removed %s duplicate row(s) from %s', v_deleted, v_spec.tbl),
          jsonb_build_object('batch_id', v_batch, 'target', v_spec.key,
                             'country', p_country, 'deleted', v_deleted));

  return jsonb_build_object('ok', true, 'batch_id', v_batch, 'deleted', v_deleted,
                            'tbl', v_spec.tbl, 'target', v_spec.key);
end $function$;

revoke all on function public.admin_dup_resolve(text, text, text) from public, anon;
grant execute on function public.admin_dup_resolve(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Undo. Builds an explicit column list EXCLUDING generated columns.
-- ---------------------------------------------------------------------------
create or replace function public.admin_dup_restore(p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tbl      text;
  v_cols     text;
  v_sel      text;
  v_restored bigint := 0;
begin
  if not public.is_super_admin() then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;

  select distinct tbl into v_tbl
    from public.dup_resolve_archive
   where batch_id = p_batch_id and restored_at is null;

  if v_tbl is null then
    return jsonb_build_object('ok', false, 'reason', 'nothing to restore');
  end if;

  -- Generated columns must NOT appear in the insert list: Postgres rejects an
  -- insert that targets one (this is how the V320 approve_pending_upload broke).
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position),
         string_agg('r.' || quote_ident(column_name), ', ' order by ordinal_position)
    into v_cols, v_sel
    from information_schema.columns
   where table_schema = 'public' and table_name = v_tbl
     and is_generated = 'NEVER';

  execute format($f$
    insert into public.%I (%s)
    select %s
      from public.dup_resolve_archive a
      cross join lateral jsonb_populate_record(null::public.%I, a.row_data) as r
     where a.batch_id = $1 and a.restored_at is null
  $f$, v_tbl, v_cols, v_sel, v_tbl)
  using p_batch_id;

  update public.dup_resolve_archive
     set restored_at = now()
   where batch_id = p_batch_id and restored_at is null;

  select count(*) into v_restored
    from public.dup_resolve_archive where batch_id = p_batch_id;

  insert into public.system_logs (severity, source, message, detail)
  values ('info', 'duplicate-control',
          format('Restored %s row(s) into %s', v_restored, v_tbl),
          jsonb_build_object('batch_id', p_batch_id, 'restored', v_restored));

  return jsonb_build_object('ok', true, 'restored', v_restored, 'tbl', v_tbl);
end $function$;

revoke all on function public.admin_dup_restore(uuid) from public, anon;
grant execute on function public.admin_dup_restore(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- REVERSIBLE
--   drop function if exists public.admin_dup_restore(uuid);
--   drop function if exists public.admin_dup_resolve(text, text, text);
--   drop function if exists public.admin_dup_scan(text, text, int);
--   drop function if exists public.admin_dup_preview(text, text);
--   drop function if exists public.admin_dup_targets();
--   drop function if exists public._dup_bkey_expr(text[]);
--   drop function if exists public._dup_scan_spec(text);
--   -- keep dup_resolve_archive: it is the undo record for anything already deleted.
-- ---------------------------------------------------------------------------
