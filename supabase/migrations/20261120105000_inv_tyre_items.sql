-- =============================================================================
-- 20261120105000_inv_tyre_items.sql
-- STATUS: APPLIED to production 2026-11-20 (ledger 20261120105000, owner order; applied text = sha256 e0934823b833867b at commit aefb9ee0 before this STATUS edit; see docs/inventory/96_PRODUCTION_RELEASE_RECORD.md). Inventory WP5 (P1). Requires 20261120100000..104000.
--         Rollback: 20261120105000_inv_tyre_items_ROLLBACK.sql
--
-- One authoritative custody state per physical tyre (strong serial per company
-- and country), DERIVED BY READING tyre_records / tyre_status_marks plus store
-- holdings and recorded dispositions. SQL mirror of
-- src/lib/inventory/tyreCustody.js deriveCustody() (docs/inventory/24_TYRE_CUSTODY_ENGINE.md).
-- Change both together.
--
--   * tyre_items            one row per strong serial: custody_state, basis, where.
--   * tyre_item_events      append-only history of derived state changes and decisions.
--   * tyre_custody_conflicts scrapped_but_active | fitted_and_in_stock | serial_on_two_assets,
--                            with evidence. NEVER auto-corrected (owner correction 4);
--                            only a person resolves or dismisses one, with a note.
--   * tyre_store_holdings / tyre_dispositions: the store and human-decision inputs.
--   * inv_tyre_item_sync(country): the derivation. It writes ONLY the tables
--     above; tyre_records and tyre_status_marks are never updated, and no money
--     edit is made (fitmentCpk / one-price-per-tyre / tyre km rules unchanged).
--   * trg_zz_inv_tyre_scrap_flag on tyre_records: a new or re-activated Active row
--     for a scrap-marked serial is FLAGGED into tyre_custody_conflicts. It never
--     blocks or alters the load (exceptions swallowed so imports keep working).
--   * v_tyre_stock_valuation: tyres in store states at their own purchase price
--     (specific identification); used tyres listed but not counted as stock value.
-- Holding period is not running life: nothing here feeds tyre km, life or CPK.
-- =============================================================================
begin;

create or replace function public.inv_canon_serial(p text)
returns text language sql immutable set search_path = public as $$
  select nullif(upper(regexp_replace(coalesce(p, ''), '\s+', '', 'g')), '')
$$;

create table if not exists public.tyre_items (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  country text not null default '',
  serial text not null,
  custody_state text not null check (custody_state in ('new_stock','reserved','in_transit','fitted','removed_pending',
    'reusable','under_repair','warranty','quarantine','scrapped','returned_supplier','unknown')),
  basis text not null,
  site text,
  location_id uuid references public.inventory_locations(id),
  item_id uuid references public.material_master(id),
  asset_no text, position text,
  last_asset_no text, last_position text, removed_at date,
  brand text, size text,
  fitments integer not null default 0,
  purchase_cost numeric, currency text,
  last_derived_at timestamptz not null default now(),
  unique (organisation_id, country, serial)
);
create index if not exists tyre_items_state_idx on public.tyre_items (organisation_id, custody_state);
select public._inv_secure_table('tyre_items', true, true);
drop policy if exists tyre_items_blind_count on public.tyre_items;
create policy tyre_items_blind_count on public.tyre_items as restrictive for select to authenticated
  using (not public.inv_blind_hides_balance(organisation_id, site, location_id, item_id));

create table if not exists public.tyre_item_events (
  id bigserial primary key,
  organisation_id uuid not null references public.organisations(id),
  tyre_item_id uuid not null references public.tyre_items(id),
  event_type text not null check (event_type in ('derived_state_change','disposition','store_holding','conflict_detected',
    'conflict_resolved','conflict_dismissed')),
  from_state text, to_state text,
  evidence jsonb not null default '{}'::jsonb,
  actor_id uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists tyre_item_events_item_idx on public.tyre_item_events (tyre_item_id, id);
select public._inv_secure_table('tyre_item_events', false, false);

create or replace function public.inv_append_only_guard()
returns trigger language plpgsql set search_path = public as $fn$
begin
  raise exception '% is append-only.', tg_table_name using errcode = '42501';
end $fn$;
drop trigger if exists trg_tyre_item_events_append_only on public.tyre_item_events;
create trigger trg_tyre_item_events_append_only before update or delete on public.tyre_item_events
  for each row execute function public.inv_append_only_guard();

create table if not exists public.tyre_custody_conflicts (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  country text not null default '',
  serial text not null,
  conflict_type text not null check (conflict_type in ('scrapped_but_active','fitted_and_in_stock','serial_on_two_assets')),
  evidence jsonb not null default '{}'::jsonb,
  tyre_record_id uuid,
  detected_by text not null check (detected_by in ('sync','guard')),
  status text not null default 'open' check (status in ('open','resolved','dismissed')),
  detected_at timestamptz not null default now(),
  resolution_note text, resolved_by uuid, resolved_at timestamptz
);
create unique index if not exists tyre_custody_conflicts_open_uq on public.tyre_custody_conflicts
  (organisation_id, country, serial, conflict_type) where status = 'open';
select public._inv_secure_table('tyre_custody_conflicts', true, false);

create table if not exists public.tyre_store_holdings (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  country text not null default '',
  serial text not null,
  custody_state text not null check (custody_state in ('new_stock','reserved','in_transit','reusable','quarantine',
    'under_repair','warranty')),
  location_id uuid references public.inventory_locations(id),
  site text,
  purchase_cost numeric check (purchase_cost is null or purchase_cost >= 0), currency text,
  active boolean not null default true,
  recorded_by uuid default auth.uid(), recorded_at timestamptz not null default now()
);
create unique index if not exists tyre_store_holdings_active_uq on public.tyre_store_holdings (organisation_id, country, serial)
  where active;
select public._inv_secure_table('tyre_store_holdings', true, true);

create table if not exists public.tyre_dispositions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  country text not null default '',
  serial text not null,
  state text not null check (state in ('reusable','under_repair','warranty','quarantine','scrapped','returned_supplier')),
  reason text not null,
  decided_by uuid not null default auth.uid(), decided_at timestamptz not null default now()
);
create index if not exists tyre_dispositions_serial_idx on public.tyre_dispositions (organisation_id, country, serial);
select public._inv_secure_table('tyre_dispositions', true, false);

-- ---------------------------------------------------------------------------
-- Derivation (mirror of deriveCustody)
-- ---------------------------------------------------------------------------
create or replace function public.inv_tyre_item_sync(p_country text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v_org uuid := public.app_current_org(); v_items int := 0; v_changed int := 0; v_conf int := 0; v_weak int;
begin
  if not public.is_approved_and_unlocked() or not (public.app_is_elevated() or public.inv_can('audit_create')) then
    raise exception 'Not authorised to derive tyre custody.' using errcode = '42501';
  end if;
  if v_org is null then raise exception 'No organisation.' using errcode = '42501'; end if;
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
  -- own country only when no record exists (PG17 rehearsal 2026-11-20: live mark for the
  -- UAE tyre YMA4* / TM204 RHF1 is stamped KSA and was missed by a country-equal match).
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

  create temp table _tc_derived on commit drop as
  with k as (select * from _tc_keys),
  agg as (
    select k.country, k.serial,
      (select count(*) from _tc_rows r where r.country = k.country and r.serial = k.serial) as fitments,
      (select count(*) from _tc_rows r where r.country = k.country and r.serial = k.serial and r.is_active) as active_n,
      (select count(distinct upper(btrim(r.asset_no))) from _tc_rows r where r.country = k.country and r.serial = k.serial
        and r.is_active and nullif(btrim(r.asset_no), '') is not null) as active_assets,
      exists (select 1 from _tc_marks m where m.country = k.country and m.serial = k.serial)
        or exists (select 1 from _tc_rows r where r.country = k.country and r.serial = k.serial and r.is_scrapped) as scrapped,
      exists (select 1 from _tc_marks m where m.country = k.country and m.serial = k.serial) as has_mark,
      (select h from public.tyre_store_holdings h where h.organisation_id = v_org and h.active and h.country = k.country
        and h.serial = k.serial limit 1) as holding,
      (select r from _tc_rows r where r.country = k.country and r.serial = k.serial and r.is_active
        order by coalesce(r.issue_date, r.created_at::date) desc nulls last, r.created_at desc nulls last limit 1) as last_active,
      (select r from _tc_rows r where r.country = k.country and r.serial = k.serial
        order by coalesce(r.issue_date, r.created_at::date) desc nulls last, r.created_at desc nulls last limit 1) as last_row,
      (select r.cost_per_tyre from _tc_rows r where r.country = k.country and r.serial = k.serial and r.cost_per_tyre > 0
        order by coalesce(r.issue_date, r.created_at::date) asc nulls last limit 1) as first_price
    from k
  )
  select a.*,
    (a.scrapped and a.active_n > 0) as c_scrapped_active,
    (a.active_n > 0 and (a.holding).id is not null) as c_fitted_stock,
    (a.active_assets > 1) as c_two_assets,
    (select d from public.tyre_dispositions d where d.organisation_id = v_org and d.country = a.country and d.serial = a.serial
       and ((a.last_row).removal_date is null or d.decided_at::date >= (a.last_row).removal_date)
     order by d.decided_at desc limit 1) as decision
  from agg a;

  -- Conflicts with evidence (never auto-resolved).
  insert into public.tyre_custody_conflicts(organisation_id, country, serial, conflict_type, evidence, detected_by)
  select v_org, d.country, d.serial, c.t, c.ev, 'sync'
    from _tc_derived d
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
  on conflict (organisation_id, country, serial, conflict_type) where status = 'open' do nothing;
  get diagnostics v_conf = row_count;

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

  insert into public.tyre_item_events(organisation_id, tyre_item_id, event_type, from_state, to_state, evidence, actor_id)
  select v_org, t.id, 'derived_state_change', t.custody_state, f.state, jsonb_build_object('basis', f.basis), auth.uid()
    from _tc_final f join public.tyre_items t on t.organisation_id = v_org and t.country = f.country and t.serial = f.serial
   where t.custody_state is distinct from f.state;
  get diagnostics v_changed = row_count;

  insert into public.tyre_items(organisation_id, country, serial, custody_state, basis, site, location_id, asset_no, position,
    last_asset_no, last_position, removed_at, brand, size, fitments, purchase_cost, currency, last_derived_at)
  select v_org, f.country, f.serial, f.state, f.basis, upper(btrim(f.site)), f.location_id, f.asset_no, f.position,
    f.last_asset_no, f.last_position, f.removed_at, f.brand, f.size, f.fitments, f.purchase_cost, f.currency, now()
  from _tc_final f
  on conflict (organisation_id, country, serial) do update set custody_state = excluded.custody_state, basis = excluded.basis,
    site = excluded.site, location_id = excluded.location_id, asset_no = excluded.asset_no, position = excluded.position,
    last_asset_no = excluded.last_asset_no, last_position = excluded.last_position, removed_at = excluded.removed_at,
    brand = excluded.brand, size = excluded.size, fitments = excluded.fitments, purchase_cost = excluded.purchase_cost,
    currency = excluded.currency, last_derived_at = now();
  get diagnostics v_items = row_count;

  insert into public.tyre_item_events(organisation_id, tyre_item_id, event_type, to_state, evidence, actor_id)
  select v_org, t.id, 'derived_state_change', t.custody_state, jsonb_build_object('basis', t.basis, 'first_derivation', true), auth.uid()
    from public.tyre_items t
   where t.organisation_id = v_org and not exists (select 1 from public.tyre_item_events e where e.tyre_item_id = t.id);

  return jsonb_build_object('items', v_items, 'state_changes', v_changed, 'new_conflicts', v_conf, 'weak_serial_rows', v_weak,
    'tyre_records_written', 0);
end $fn$;

-- Store holding / disposition inputs (human decisions, never inferred).
create or replace function public.inv_tyre_store_holding(p jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v_org uuid := public.app_current_org(); v_id uuid; v_serial text := public.inv_canon_serial(p->>'serial');
  v_loc public.inventory_locations%rowtype;
begin
  if not public.is_approved_and_unlocked() or not public.inv_can('receive') then
    raise exception 'Stock permission "receive" is required.' using errcode = '42501';
  end if;
  if not public.tyre_serial_is_strong(v_serial) then
    raise exception 'A weak serial cannot be held as an individual tyre.' using errcode = '22023';
  end if;
  select * into v_loc from public.inventory_locations where id = (p->>'location_id')::uuid and organisation_id = v_org;
  if v_loc.id is null then raise exception 'Location not found.' using errcode = 'P0002'; end if;
  if not public._inv_scope_ok(v_loc.country, v_loc.site) then raise exception 'Outside your scope.' using errcode = '42501'; end if;
  update public.tyre_store_holdings set active = false
   where organisation_id = v_org and country = upper(v_loc.country) and serial = v_serial and active;
  insert into public.tyre_store_holdings(organisation_id, country, serial, custody_state, location_id, site, purchase_cost, currency)
  values (v_org, upper(v_loc.country), v_serial, p->>'custody_state', v_loc.id, v_loc.site,
    nullif(p->>'purchase_cost', '')::numeric, coalesce(nullif(p->>'currency', ''), public.currency_for_country(v_loc.country)))
  returning id into v_id;
  return v_id;
end $fn$;

create or replace function public.inv_tyre_disposition_record(p_serial text, p_country text, p_state text, p_reason text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v_id uuid;
begin
  if not public.is_approved_and_unlocked()
     or not (public.app_is_elevated() or public.inv_can(case when p_state = 'scrapped' then 'scrap_approve' else 'discrepancy_review' end)) then
    raise exception 'Not authorised to record a tyre disposition.' using errcode = '42501';
  end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'A disposition needs a reason.' using errcode = '22023'; end if;
  if not public._inv_scope_ok(p_country, null) then raise exception 'Outside your scope.' using errcode = '42501'; end if;
  insert into public.tyre_dispositions(organisation_id, country, serial, state, reason)
  values (public.app_current_org(), upper(btrim(coalesce(p_country, ''))), public.inv_canon_serial(p_serial), p_state, btrim(p_reason))
  returning id into v_id;
  return v_id;
end $fn$;

-- A person closes a conflict with evidence; tyre history is still never edited here.
create or replace function public.inv_tyre_conflict_decide(p_conflict uuid, p_status text, p_note text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare c public.tyre_custody_conflicts%rowtype; v_item uuid;
begin
  if not public.is_approved_and_unlocked() or not (public.app_is_elevated() or public.inv_can('discrepancy_review')) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  if p_status not in ('resolved','dismissed') or nullif(btrim(p_note), '') is null then
    raise exception 'Choose resolved or dismissed and give the evidence-based reason.' using errcode = '22023';
  end if;
  update public.tyre_custody_conflicts set status = p_status, resolution_note = btrim(p_note), resolved_by = auth.uid(), resolved_at = now()
   where id = p_conflict and organisation_id = public.app_current_org() and status = 'open' returning * into c;
  if not found then raise exception 'Open conflict not found.' using errcode = 'P0002'; end if;
  select id into v_item from public.tyre_items where organisation_id = c.organisation_id and country = c.country and serial = c.serial;
  if v_item is not null then
    insert into public.tyre_item_events(organisation_id, tyre_item_id, event_type, evidence)
    values (c.organisation_id, v_item, case when p_status = 'resolved' then 'conflict_resolved' else 'conflict_dismissed' end,
      jsonb_build_object('conflict_id', c.id, 'type', c.conflict_type, 'note', c.resolution_note));
  end if;
  return to_jsonb(c);
end $fn$;

-- Flag, never block: a load creating an Active row for a scrap-marked serial.
create or replace function public.inv_tyre_scrap_flag()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  begin
    if lower(coalesce(new.status, '')) = 'active' and new.removal_date is null
       and public.tyre_serial_is_strong(new.serial_no)
       and (tg_op = 'INSERT' or lower(coalesce(old.status, '')) <> 'active' or old.removal_date is not null)
       and exists (select 1 from public.tyre_status_marks m where m.organisation_id = new.organisation_id and m.mark_type = 'scrap'
                   and public.inv_canon_serial(m.serial) = public.inv_canon_serial(new.serial_no)) then
      insert into public.tyre_custody_conflicts(organisation_id, country, serial, conflict_type, evidence, tyre_record_id, detected_by)
      values (new.organisation_id, upper(btrim(coalesce(new.country, ''))), public.inv_canon_serial(new.serial_no), 'scrapped_but_active',
        jsonb_build_object('tyre_record_id', new.id, 'asset_no', new.asset_no, 'position', new.tyre_position,
          'issue_date', new.issue_date, 'operation', lower(tg_op),
          'scrapMarks', (select jsonb_agg(jsonb_build_object('created_at', m.created_at, 'reason', m.reason))
                           from public.tyre_status_marks m where m.organisation_id = new.organisation_id and m.mark_type = 'scrap'
                            and public.inv_canon_serial(m.serial) = public.inv_canon_serial(new.serial_no))),
        new.id, 'guard')
      on conflict (organisation_id, country, serial, conflict_type) where status = 'open' do nothing;
    end if;
  exception when others then
    raise warning 'inv_tyre_scrap_flag skipped: %', sqlerrm;
  end;
  return null;
end $fn$;
drop trigger if exists trg_zz_inv_tyre_scrap_flag on public.tyre_records;
create trigger trg_zz_inv_tyre_scrap_flag after insert or update of status, removal_date on public.tyre_records
  for each row execute function public.inv_tyre_scrap_flag();

create or replace view public.v_tyre_stock_valuation with (security_invoker = on) as
select t.id as tyre_item_id, t.organisation_id, t.country, t.site, t.serial, t.custody_state, t.location_id, t.brand, t.size,
       t.currency,
       t.custody_state in ('new_stock','reserved','in_transit','quarantine') as counts_as_stock_value,
       case when (select public.inv_can('view_value')) then t.purchase_cost end as purchase_cost,
       case when (select public.inv_can('view_value')) and t.custody_state in ('new_stock','reserved','in_transit','quarantine')
            then t.purchase_cost end as stock_value,
       t.purchase_cost is null as unvalued
  from public.tyre_items t;
revoke all on public.v_tyre_stock_valuation from anon;
grant select on public.v_tyre_stock_valuation to authenticated;

revoke all on function public.inv_tyre_scrap_flag(), public.inv_append_only_guard() from public, anon, authenticated;
revoke all on function public.inv_tyre_item_sync(text), public.inv_tyre_store_holding(jsonb),
  public.inv_tyre_disposition_record(text, text, text, text), public.inv_tyre_conflict_decide(uuid, text, text) from public, anon;
grant execute on function public.inv_tyre_item_sync(text), public.inv_tyre_store_holding(jsonb),
  public.inv_tyre_disposition_record(text, text, text, text), public.inv_tyre_conflict_decide(uuid, text, text) to authenticated;

do $$ begin
  if to_regprocedure('anum_integration.apply_reader_policies()') is not null then
    perform anum_integration.apply_reader_policies();
  end if;
end $$;

commit;
