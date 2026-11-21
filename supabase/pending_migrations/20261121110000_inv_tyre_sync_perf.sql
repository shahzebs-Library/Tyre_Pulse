-- =============================================================================
-- 20261121110000_inv_tyre_sync_perf.sql
-- STATUS: AUTHORED, NOT APPLIED. Needs the owner's approval (new migration).
-- Requires 20261120105000 + 20261120107000 (applied in production 2026-11-20).
-- Rollback: 20261121110000_inv_tyre_sync_perf_ROLLBACK.sql (same folder)
-- Evidence and timings: docs/inventory/97_TYRE_SYNC_PERF.md
--
-- Defect (doc 96 section 7): inv_tyre_item_sync('KSA') does not finish within 55 s, so
-- the web "Refresh" hits the API statement timeout and the 6 KSA custody conflicts are
-- never materialised. Root cause in _inv_tyre_item_sync: _tc_derived ran NINE
-- correlated subqueries per serial key (counts, two exists, three ordered "limit 1"
-- picks, holding, decision) against UNINDEXED, UNANALYZED temp tables. For KSA that is
-- ~6,000 keys x ~6,600 rows x 9 sequential scans = several hundred million row visits.
-- The conflict insert also built three jsonb evidence objects (each again a scan of the
-- temp table) for EVERY key before filtering to the conflicting ones.
--
-- Fix (same results, same signature, same owner / SECURITY DEFINER / search_path / ACL):
--   * _tc_derived is set-based: one GROUP BY for the counts and flags, DISTINCT ON for
--     the last active / last / first-priced row (an id tiebreak makes ties deterministic;
--     the old "limit 1" picked an arbitrary row among exact ties), one join for marks and
--     the (unique) active holding; the disposition lookup stays a lateral over its index.
--   * the temp tables get (country, serial) indexes and ANALYZE.
--   * evidence is built only for keys that actually conflict.
--   * incremental at the write level: tyre_items rows are written only when a derived
--     value changed (tyre_records has no updated_at column and must not be modified, so
--     a source watermark is not available; the derivation itself reads every row, which
--     is now cheap). 'items' still reports the number of derived tyres; 'items_written'
--     is new. last_derived_at therefore moves only for tyres that changed.
--   * idempotent: conflicts keep ON CONFLICT DO NOTHING on the open-conflict key.
--   * repeat guard: an advisory lock per (company, country scope) serialises concurrent
--     refreshes; a request whose source fingerprint (tyre_records, scrap marks, holdings,
--     dispositions, conflicts) equals the last completed run within 60 s returns that
--     run's result with cached = true and new_conflicts = state_changes = 0 instead of
--     rescanning. A changed source always rescans. The fingerprint is taken BEFORE the
--     derivation; a run during which a source changed is stored as not cacheable.
--     public.inv_tyre_sync_runs is private to the function (no client grant or policy).
-- Writes nothing to tyre_records, tyre_status_marks, costs or CPK inputs.
-- Method: full CREATE OR REPLACE guarded by the live md5 92e69b6622a88dddc3358ddea0ff1276
-- (production 2026-11-21); original kept in _bak.inv_121110_snapshot; the rollback
-- executes it verbatim.
-- =============================================================================
begin;

create schema if not exists _bak;
create table if not exists _bak.inv_121110_snapshot (
  obj text primary key,
  def text not null,
  captured_at timestamptz not null default now()
);
revoke all on _bak.inv_121110_snapshot from public;

-- Last completed sync per company and country scope. PRIVATE to the SECURITY DEFINER
-- function: RLS on, no client policy, no client grant (review P1 on PR #574).
create table if not exists public.inv_tyre_sync_runs (
  organisation_id uuid not null references public.organisations(id),
  scope text not null,
  fingerprint text not null,
  finished_at timestamptz not null,
  duration_ms integer,
  result jsonb not null,
  primary key (organisation_id, scope)
);
alter table public.inv_tyre_sync_runs enable row level security;
revoke all on public.inv_tyre_sync_runs from public, anon, authenticated;

do $do$
declare
  v_sig constant text := 'public._inv_tyre_item_sync(text)';
  v_md5_expected constant text := '92e69b6622a88dddc3358ddea0ff1276';
  v_def text; v_md5 text;
begin
  if to_regprocedure(v_sig) is null then
    raise exception '121110: % is missing; apply 20261120105000..107000 first.', v_sig;
  end if;
  v_def := pg_get_functiondef(to_regprocedure(v_sig));
  if position('inv_tyre_sync_runs' in v_def) > 0 then
    raise notice '121110: % already set-based; left as is.', v_sig;
    return;
  end if;
  v_md5 := md5(replace(v_def, chr(13), ''));
  if v_md5 <> v_md5_expected then
    raise exception '121110: % differs from the reviewed definition (md5 % expected %); refusing to replace.',
      v_sig, v_md5, v_md5_expected;
  end if;
  insert into _bak.inv_121110_snapshot(obj, def) values (v_sig, v_def) on conflict (obj) do nothing;
end $do$;

create or replace function public._inv_tyre_item_sync(p_country text default null::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare v_org uuid := public.app_current_org(); v_items int := 0; v_written int := 0; v_changed int := 0; v_conf int := 0; v_weak int;
  v_scope text := coalesce(upper(btrim(p_country)), '*'); v_fp text; v_t0 timestamptz := clock_timestamp();
  v_last public.inv_tyre_sync_runs%rowtype; v_res jsonb; v_src0 text; v_src1 text;
  v_cf_n0 bigint; v_cf_h0 numeric; v_cf_n1 bigint; v_cf_h1 numeric; v_ins_h numeric;
begin
  if not public.is_approved_and_unlocked() or not (public.app_is_elevated() or public.inv_can('audit_create')) then
    raise exception 'Not authorised to derive tyre custody.' using errcode = '42501';
  end if;
  if v_org is null then raise exception 'No organisation.' using errcode = '42501'; end if;

  -- One refresh at a time per company and scope; a second click waits, then sees the result.
  perform pg_advisory_xact_lock(hashtextextended('inv_tyre_sync:' || v_org::text || ':' || v_scope, 0));
  -- Source fingerprint captured BEFORE the derivation (review P2 on PR #574).
  v_src0 := md5(concat_ws('|',
    (select count(*) || ':' || coalesce(sum(hashtextextended(concat_ws('~', r.id, r.serial_no, r.country, r.asset_no,
        r.tyre_position, r.status, r.issue_date, r.removal_date, r.created_at, r.brand, r.size, r.site, r.cost_per_tyre), 0)), 0)
       from public.tyre_records r where r.organisation_id = v_org),
    (select count(*) || ':' || coalesce(sum(hashtextextended(to_jsonb(m)::text, 0)), 0)
       from public.tyre_status_marks m where m.organisation_id = v_org and m.mark_type = 'scrap'),
    (select count(*) || ':' || coalesce(sum(hashtextextended(to_jsonb(h)::text, 0)), 0)
       from public.tyre_store_holdings h where h.organisation_id = v_org),
    (select count(*) || ':' || coalesce(sum(hashtextextended(to_jsonb(d)::text, 0)), 0)
       from public.tyre_dispositions d where d.organisation_id = v_org)));
  select count(*), coalesce(sum(hashtextextended(c.id::text || c.status, 0)), 0)
       from public.tyre_custody_conflicts c where c.organisation_id = v_org into v_cf_n0, v_cf_h0;
  v_fp := md5(v_src0 || '|' || v_cf_n0 || ':' || v_cf_h0);
  select * into v_last from public.inv_tyre_sync_runs s where s.organisation_id = v_org and s.scope = v_scope;
  if found and v_last.fingerprint = v_fp and v_last.finished_at > now() - interval '60 seconds' then
    return v_last.result || jsonb_build_object('cached', true, 'new_conflicts', 0, 'state_changes', 0, 'items_written', 0,
      'last_run_at', v_last.finished_at);
  end if;

  -- Re-runnable in one transaction (on commit drop alone fails a second call: V368a lesson).
  drop table if exists _tc_rows, _tc_marks, _tc_keys, _tc_derived, _tc_final;

  create temp table _tc_rows on commit drop as
    select upper(btrim(coalesce(r.country, ''))) as country, public.inv_canon_serial(r.serial_no) as serial, r.id,
           r.asset_no, r.tyre_position, r.status, r.issue_date, r.removal_date, r.created_at, r.brand, r.size, r.site,
           r.cost_per_tyre,
           (lower(coalesce(r.status, '')) = 'active' and r.removal_date is null) as is_active,
           (lower(coalesce(r.status, '')) = 'scrapped') as is_scrapped
      from public.tyre_records r
     where r.organisation_id = v_org and public.tyre_serial_is_strong(r.serial_no)
       and (p_country is null or lower(r.country) = lower(p_country));
  select count(*) into v_weak from public.tyre_records r
   where r.organisation_id = v_org and not public.tyre_serial_is_strong(r.serial_no)
     and (p_country is null or lower(r.country) = lower(p_country));
  -- A scrap mark is keyed by serial (unique (serial, mark_type)), not by country: a mark
  -- stamped with another country than the tyre record still marks that tyre. The mark
  -- therefore takes the country of the company's tyre record(s) for the serial, and its
  -- own country only when no record exists (PG17 rehearsal 2026-11-20).
  create temp table _tc_marks on commit drop as
    with rc as (
      select distinct upper(btrim(coalesce(r.country, ''))) as country, public.inv_canon_serial(r.serial_no) as serial
        from public.tyre_records r
       where r.organisation_id = v_org and public.tyre_serial_is_strong(r.serial_no)),
    mk as (
      select upper(btrim(coalesce(m.country, ''))) as mark_country, public.inv_canon_serial(m.serial) as serial, m.created_at, m.reason
        from public.tyre_status_marks m
       where m.organisation_id = v_org and m.mark_type = 'scrap' and public.tyre_serial_is_strong(m.serial))
    select coalesce(rc.country, mk.mark_country) as country, mk.serial, mk.created_at, mk.reason
      from mk left join rc on rc.serial = mk.serial
     where p_country is null or lower(coalesce(rc.country, mk.mark_country)) = lower(p_country);
  create temp table _tc_keys on commit drop as
    select country, serial from _tc_rows union select country, serial from _tc_marks
    union select country, serial from public.tyre_store_holdings h where h.organisation_id = v_org and h.active
      and (p_country is null or lower(h.country) = lower(p_country))
    union select country, serial from public.tyre_dispositions d where d.organisation_id = v_org
      and (p_country is null or lower(d.country) = lower(p_country));
  create index on _tc_rows (country, serial);
  create index on _tc_marks (country, serial);
  analyze _tc_rows; analyze _tc_marks; analyze _tc_keys;

  -- Set-based derivation (was nine correlated subqueries per key).
  create temp table _tc_derived on commit drop as
  with ra as (
    select r.country, r.serial, count(*) as fitments,
           count(*) filter (where r.is_active) as active_n,
           count(distinct upper(btrim(r.asset_no))) filter (where r.is_active and nullif(btrim(r.asset_no), '') is not null) as active_assets,
           bool_or(r.is_scrapped) as any_scrapped
      from _tc_rows r group by r.country, r.serial),
  la as (
    select distinct on (r.country, r.serial) r.country, r.serial, r as rec
      from _tc_rows r where r.is_active
     order by r.country, r.serial, coalesce(r.issue_date, r.created_at::date) desc nulls last, r.created_at desc nulls last, r.id),
  lr as (
    select distinct on (r.country, r.serial) r.country, r.serial, r as rec
      from _tc_rows r
     order by r.country, r.serial, coalesce(r.issue_date, r.created_at::date) desc nulls last, r.created_at desc nulls last, r.id),
  fpr as (
    select distinct on (r.country, r.serial) r.country, r.serial, r.cost_per_tyre
      from _tc_rows r where r.cost_per_tyre > 0
     order by r.country, r.serial, coalesce(r.issue_date, r.created_at::date) asc nulls last, r.id),
  mk as (select distinct m.country, m.serial from _tc_marks m),
  ho as (select h.country, h.serial, h as rec from public.tyre_store_holdings h where h.organisation_id = v_org and h.active),
  agg as (
    select k.country, k.serial,
      coalesce(ra.fitments, 0) as fitments,
      coalesce(ra.active_n, 0) as active_n,
      coalesce(ra.active_assets, 0) as active_assets,
      (mk.serial is not null or coalesce(ra.any_scrapped, false)) as scrapped,
      (mk.serial is not null) as has_mark,
      ho.rec as holding,
      la.rec as last_active,
      lr.rec as last_row,
      fpr.cost_per_tyre as first_price
    from _tc_keys k
    left join ra on ra.country = k.country and ra.serial = k.serial
    left join la on la.country = k.country and la.serial = k.serial
    left join lr on lr.country = k.country and lr.serial = k.serial
    left join fpr on fpr.country = k.country and fpr.serial = k.serial
    left join mk on mk.country = k.country and mk.serial = k.serial
    left join ho on ho.country = k.country and ho.serial = k.serial
  )
  select a.*,
    (a.scrapped and a.active_n > 0) as c_scrapped_active,
    (a.active_n > 0 and (a.holding).id is not null) as c_fitted_stock,
    (a.active_assets > 1) as c_two_assets,
    (select d from public.tyre_dispositions d where d.organisation_id = v_org and d.country = a.country and d.serial = a.serial
       and ((a.last_row).removal_date is null or d.decided_at::date >= (a.last_row).removal_date)
     order by d.decided_at desc limit 1) as decision
  from agg a;

  -- Conflicts with evidence (never auto-resolved). Evidence only for conflicting keys.
  with ins as (
  insert into public.tyre_custody_conflicts(organisation_id, country, serial, conflict_type, evidence, detected_by)
  select v_org, d.country, d.serial, c.t, c.ev, 'sync'
    from (select * from _tc_derived x where x.c_scrapped_active or x.c_fitted_stock or x.c_two_assets) d
    cross join lateral (values
      ('scrapped_but_active', d.c_scrapped_active, jsonb_build_object(
        'scrapMarks', coalesce((select jsonb_agg(jsonb_build_object('created_at', m.created_at, 'reason', m.reason))
          from _tc_marks m where m.country = d.country and m.serial = d.serial), '[]'::jsonb),
        'activeRows', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'asset_no', r.asset_no, 'position', r.tyre_position,
          'issue_date', r.issue_date, 'created_at', r.created_at,
          'createdAfterScrapMark', r.created_at > (select min(m.created_at) from _tc_marks m where m.country = d.country and m.serial = d.serial)))
          from _tc_rows r where r.country = d.country and r.serial = d.serial and r.is_active), '[]'::jsonb))),
      ('fitted_and_in_stock', d.c_fitted_stock, jsonb_build_object(
        'activeRows', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'asset_no', r.asset_no, 'position', r.tyre_position))
          from _tc_rows r where r.country = d.country and r.serial = d.serial and r.is_active), '[]'::jsonb),
        'holdings', jsonb_build_array(jsonb_build_object('location_id', (d.holding).location_id, 'custody_state', (d.holding).custody_state)))),
      ('serial_on_two_assets', d.c_two_assets, jsonb_build_object(
        'activeRows', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'asset_no', r.asset_no, 'issue_date', r.issue_date))
          from _tc_rows r where r.country = d.country and r.serial = d.serial and r.is_active), '[]'::jsonb)))
    ) as c(t, hit, ev)
   where c.hit
  on conflict (organisation_id, country, serial, conflict_type) where status = 'open' do nothing
  returning id, status)
  select count(*), coalesce(sum(hashtextextended(ins.id::text || ins.status, 0)), 0) into v_conf, v_ins_h from ins;

  create temp table _tc_final on commit drop as
  select d.country, d.serial, d.fitments,
    case when d.c_scrapped_active or d.c_fitted_stock or d.c_two_assets then 'unknown'
         when d.active_n > 0 then 'fitted'
         when d.scrapped then 'scrapped'
         when (d.holding).id is not null then (d.holding).custody_state
         when d.fitments > 0 then coalesce((d.decision).state, 'removed_pending')
         else 'unknown' end as state,
    case when d.c_scrapped_active or d.c_fitted_stock or d.c_two_assets then 'conflict'
         when d.active_n > 0 then 'active_fitment'
         when d.scrapped then case when d.has_mark then 'scrap_mark' else 'scrapped_status' end
         when (d.holding).id is not null then 'store_holding'
         when d.fitments > 0 then case when (d.decision).id is not null then 'recorded_disposition' else 'removed_no_decision' end
         else 'no_evidence' end as basis,
    (d.last_active).asset_no as asset_no, (d.last_active).tyre_position as position,
    case when d.active_n = 0 then (d.last_row).asset_no end as last_asset_no,
    case when d.active_n = 0 then (d.last_row).tyre_position end as last_position,
    case when d.active_n = 0 then (d.last_row).removal_date end as removed_at,
    (d.holding).location_id as location_id,
    coalesce((d.holding).site, (d.last_row).site) as site,
    (d.last_row).brand as brand, (d.last_row).size as size,
    coalesce((d.holding).purchase_cost, d.first_price) as purchase_cost,
    coalesce((d.holding).currency, public.currency_for_country(d.country)) as currency
  from _tc_derived d;
  select count(*) into v_items from _tc_final;

  insert into public.tyre_item_events(organisation_id, tyre_item_id, event_type, from_state, to_state, evidence, actor_id)
  select v_org, t.id, 'derived_state_change', t.custody_state, f.state, jsonb_build_object('basis', f.basis), auth.uid()
    from _tc_final f join public.tyre_items t on t.organisation_id = v_org and t.country = f.country and t.serial = f.serial
   where t.custody_state is distinct from f.state;
  get diagnostics v_changed = row_count;

  -- Write only tyres whose derived values changed.
  insert into public.tyre_items(organisation_id, country, serial, custody_state, basis, site, location_id, asset_no, position,
    last_asset_no, last_position, removed_at, brand, size, fitments, purchase_cost, currency, last_derived_at)
  select v_org, f.country, f.serial, f.state, f.basis, upper(btrim(f.site)), f.location_id, f.asset_no, f.position,
    f.last_asset_no, f.last_position, f.removed_at, f.brand, f.size, f.fitments, f.purchase_cost, f.currency, now()
  from _tc_final f
  on conflict (organisation_id, country, serial) do update set custody_state = excluded.custody_state, basis = excluded.basis,
    site = excluded.site, location_id = excluded.location_id, asset_no = excluded.asset_no, position = excluded.position,
    last_asset_no = excluded.last_asset_no, last_position = excluded.last_position, removed_at = excluded.removed_at,
    brand = excluded.brand, size = excluded.size, fitments = excluded.fitments, purchase_cost = excluded.purchase_cost,
    currency = excluded.currency, last_derived_at = now()
  where (tyre_items.custody_state, tyre_items.basis, tyre_items.site, tyre_items.location_id, tyre_items.asset_no,
         tyre_items.position, tyre_items.last_asset_no, tyre_items.last_position, tyre_items.removed_at, tyre_items.brand,
         tyre_items.size, tyre_items.fitments, tyre_items.purchase_cost, tyre_items.currency)
     is distinct from
        (excluded.custody_state, excluded.basis, excluded.site, excluded.location_id, excluded.asset_no,
         excluded.position, excluded.last_asset_no, excluded.last_position, excluded.removed_at, excluded.brand,
         excluded.size, excluded.fitments, excluded.purchase_cost, excluded.currency);
  get diagnostics v_written = row_count;

  insert into public.tyre_item_events(organisation_id, tyre_item_id, event_type, to_state, evidence, actor_id)
  select v_org, t.id, 'derived_state_change', t.custody_state, jsonb_build_object('basis', t.basis, 'first_derivation', true), auth.uid()
    from public.tyre_items t
   where t.organisation_id = v_org and not exists (select 1 from public.tyre_item_events e where e.tyre_item_id = t.id);

  v_res := jsonb_build_object('items', v_items, 'items_written', v_written, 'state_changes', v_changed, 'new_conflicts', v_conf,
    'weak_serial_rows', v_weak, 'tyre_records_written', 0, 'cached', false,
    'duration_ms', round(extract(epoch from clock_timestamp() - v_t0) * 1000));
  -- Cache only when nothing changed while deriving: the sources are byte-for-byte what they
  -- were BEFORE the derivation, and the conflicts differ only by the rows this run inserted.
  -- Otherwise (a change committed meanwhile, visible under READ COMMITTED) the run is
  -- recorded as not cacheable, so the next request rescans.
  v_src1 := md5(concat_ws('|',
    (select count(*) || ':' || coalesce(sum(hashtextextended(concat_ws('~', r.id, r.serial_no, r.country, r.asset_no,
        r.tyre_position, r.status, r.issue_date, r.removal_date, r.created_at, r.brand, r.size, r.site, r.cost_per_tyre), 0)), 0)
       from public.tyre_records r where r.organisation_id = v_org),
    (select count(*) || ':' || coalesce(sum(hashtextextended(to_jsonb(m)::text, 0)), 0)
       from public.tyre_status_marks m where m.organisation_id = v_org and m.mark_type = 'scrap'),
    (select count(*) || ':' || coalesce(sum(hashtextextended(to_jsonb(h)::text, 0)), 0)
       from public.tyre_store_holdings h where h.organisation_id = v_org),
    (select count(*) || ':' || coalesce(sum(hashtextextended(to_jsonb(d)::text, 0)), 0)
       from public.tyre_dispositions d where d.organisation_id = v_org)));
  select count(*), coalesce(sum(hashtextextended(c.id::text || c.status, 0)), 0)
       from public.tyre_custody_conflicts c where c.organisation_id = v_org into v_cf_n1, v_cf_h1;
  if v_src1 = v_src0 and v_cf_n1 = v_cf_n0 + v_conf and v_cf_h1 = v_cf_h0 + v_ins_h then
    v_fp := md5(v_src0 || '|' || v_cf_n1 || ':' || v_cf_h1);
  else
    v_fp := 'not-cacheable:' || gen_random_uuid()::text;
    v_res := v_res || jsonb_build_object('source_changed_during_sync', true);
  end if;
  insert into public.inv_tyre_sync_runs(organisation_id, scope, fingerprint, finished_at, duration_ms, result)
  values (v_org, v_scope, v_fp, now(), (v_res->>'duration_ms')::int, v_res)
  on conflict (organisation_id, scope) do update set fingerprint = excluded.fingerprint, finished_at = excluded.finished_at,
    duration_ms = excluded.duration_ms, result = excluded.result;
  return v_res;
end $function$;

-- CREATE OR REPLACE keeps the existing ACL; restate it defensively.
revoke all on function public._inv_tyre_item_sync(text) from public, anon, authenticated;

do $do$
begin
  if position('inv_tyre_sync_runs' in pg_get_functiondef('public._inv_tyre_item_sync(text)'::regprocedure)) = 0 then
    raise exception '121110: replacement did not take effect.';
  end if;
  if to_regprocedure('anum_integration.apply_reader_policies()') is not null then
    perform anum_integration.apply_reader_policies();
  end if;
end $do$;

commit;

-- VERIFY:
-- select position('inv_tyre_sync_runs' in pg_get_functiondef('public._inv_tyre_item_sync(text)'::regprocedure)) > 0; -- t
-- select has_function_privilege('authenticated', 'public._inv_tyre_item_sync(text)', 'EXECUTE');                     -- f
-- select has_function_privilege('authenticated', 'public.inv_tyre_item_sync(jsonb)', 'EXECUTE');                      -- t (unchanged)
-- select relrowsecurity from pg_class where oid = 'public.inv_tyre_sync_runs'::regclass;                              -- t
-- select count(*) from _bak.inv_121110_snapshot;                                                                       -- 1
