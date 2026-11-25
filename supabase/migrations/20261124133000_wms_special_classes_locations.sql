-- =============================================================================
-- 20261124133000_wms_special_classes_locations.sql
--
-- STATUS: APPLIED LIVE 2026-11-24 on the owner's explicit yes, in order 090000, 091000, 130000, 131000,
--   132000, 133000, 120000, 135000 (135000 indexes built CONCURRENTLY first). Verified live: data unchanged,
--   Store Keeper bare receipt and count refused (42501). Recorded in supabase_migrations.
-- Original status: NOT APPLIED. Authored for the owner's review. Apply only on the owner's
-- yes, in one transaction, then run the VERIFY block at the end.
-- PROOF: see the "ROLLED-BACK PROOF" note at the end of this header (run on the
-- live database inside a DO block that ends in raise exception, so nothing
-- persisted).
--
-- WHAT IT DOES (special inventory classes, locations, auditing gaps)
--   A. Locations
--      * location_type gains receiving, inspection, service_van, workshop_store,
--        bulk_tank (quarantine, warranty, scrap, repairable, supplier_custody
--        already exist).
--      * inventory_locations gains capacity_qty, capacity_uom, restriction,
--        restriction_note, van_asset_no (service van -> the vehicle it is). A guard
--        trigger checks van_asset_no is a fleet asset of the company and only used on
--        a service_van location.
--      * _inv_location_upsert carries the new fields (anchored replacement of the
--        live body: aborts unless each anchor is found exactly once).
--      * v_inv_location_utilisation: on-hand vs capacity and restriction breaches
--        (REPORTED, not blocked: blocking would need a change inside _inv_post).
--   B. Tools
--      * equipment_custody (holder, due back, return) and equipment_calibrations
--        (certificate, result, next due). Writes only through:
--        equipment_issue / equipment_return (capability "issue") and
--        equipment_record_calibration (engineering_approve, or Admin/Manager/Director).
--        A tool is refused for issue when retired, in maintenance or its calibration
--        is overdue. Calibration updates equipment.calibration_due.
--   C. Lubricants
--      * material_master.lubricant_grade; inv_lubricant_set_grade (lubricants only,
--        optional base unit).
--      * inventory_lubricant_dispenses + inv_lubricant_dispense: issues the stock
--        through _inv_issue (ledger, valuation, shortage refusal unchanged) and
--        records the asset (must be a fleet asset) and the job card (must be that
--        asset's job card). Quantity is in the stock's own unit; no unit is invented.
--      * v_inv_lubricant_consumption: per asset per month per currency, in-app
--        dispenses (source 'app') and ERP oil lines from parts_consumption
--        (source 'erp'). A line with no cost stays unvalued (never 0).
--   D. Repairables
--      * inventory_unit_events (append-only, per serial): removed_from_asset,
--        installed_on_asset, sent_for_repair (vendor required), returned_from_repair,
--        beyond_repair, evaluated. inv_unit_event_record enforces the order
--        (return only after send; install only when not at a vendor and not on
--        another asset). Stock itself still moves through transfer / put-away.
--      * v_inv_unit_latest: current state per serial.
--   E. Scrap (non-tyre stock)
--      * inventory_scrap_requests: proposed -> engineering evaluation -> approval ->
--        posted -> disposed (with recovery value per currency, null when unknown).
--        RPCs inv_scrap_request, inv_scrap_cancel, inv_scrap_evaluate
--        (engineering_approve, not the proposer), inv_scrap_decide (scrap_approve,
--        not the proposer), inv_scrap_post (scrap_approve, not the proposer; posts
--        _inv_post type scrap with approval_ref = request id), inv_scrap_dispose.
--   Warranty replacement needs no object: a receipt posted with
--   source_doc_type 'warranty_claim' and source_doc_id = claim id links it.
--   Auditing (blind count, recount, discrepancy approval, close, serial
--   reconciliation) already exists and was verified read-only; nothing here.
--
-- ROLLED-BACK PROOF (2026-11-24, live project, DO block ending in raise exception)
--   Run 1 (whole migration + tests, as real users; two Store Keepers given the stock
--   capabilities inside the transaction; a test tool created inside it):
--     locations: service_van with fleet asset PL071 stored as PL071/EA/no_mixing; a van
--       that is not a fleet asset refused; capacity without a unit refused; receiving type
--       accepted; utilisation view lists both test locations.
--     tools: issue refused while calibration overdue; calibration recorded; issue to a
--       named colleague ok; same key replayed; second issue of an out tool refused PT409;
--       return ok.
--     lubricants: grade + unit set on a lubricant, refused on a non-lubricant; dispense 2
--       to TM586 against its own job card posted (one job_card issue movement); job card of
--       another asset refused; non-lubricant refused; unknown asset refused; same key
--       replayed; consumption view: 1 app row for TM586, 10,966 ERP oil rows for KSA.
--     scrap: proposer cannot evaluate; decide before evaluation refused; second person
--       evaluated + approved + posted (scrap movement carries approval_ref); recovery in
--       AED for a KSA line refused; recovery 10 stamped SAR. Stock 2074 -> 2071 (2 dispensed,
--       1 scrapped). anon EXECUTE false; authenticated INSERT on equipment_custody false.
--   Run 2 (unit events order, after switching ordering to the identity column seq):
--     install on PL071; send for repair while installed refused; removal + send ok; state
--     at_vendor, overdue true (expected back yesterday); install while at vendor refused;
--     return ok (state in_store, vendor carried); reinstall on TM586 ok.
--   Checked afterwards: no new table, location, tool, supplier or stock change persisted.
--
-- REVIEW FIXES + ROLLED-BACK PROOF, ROUND 2 (2026-11-24). All 8 files applied in order (090000, 091000, 130000,
-- 131000, 132000, 133000, 120000, 135000; the 135000 work_orders index build left out of the run because of its
-- SHARE lock) in ONE implicit transaction through the Supabase CLI, then a test block as real users (claims + role
-- authenticated) ending in RAISE EXCEPTION, so everything rolled back; re-checked afterwards: purchase_orders 0,
-- test suppliers 0, test grants 0, procurement_rfqs and _inv_job_card_resolve absent, purchase_orders.updated_by
-- absent. Users: super admin d2d43a5f (SA), Store Keeper 69faeb71 (SK), Managers 34793423 (M1) / ecdcdb9e (M2);
-- extra stock / fleet grants were given INSIDE the transaction. Script: scratchpad review_round2_proof.sql.
--   Changes here: versioned backup of _inv_location_upsert, skip when patched (A14); inv_scrap_post RAISES on a
--   shortage (A5); an approval expires after 30 days, the proposer cannot record the disposal (also a CHECK), an
--   expired approval may be cancelled (A18); inv_unit_event_record takes country / site from the fleet asset when no
--   stock line is named (A19); pct_used NULL unless every stocked line is in the capacity unit (A21);
--   v_inv_lubricant_consumption gains zero_cost_qty, value stays NULL when nothing is valued (A20); the lubricant
--   dispense job card goes through _inv_job_card_resolve (A10).
--   A5.1  post a scrap of 2 with 1 free                       -> 23514 raised;  A5.2 exception rows left = 0
--   A2.3  post a scrap of 1 (second person)                   -> posted
--   A18.1 proposer SK (financial_post granted) records disposal -> 42501;  A18.2 M2 -> disposed
--   A18.3 post an approval decided 31 days ago                -> 22023;  A18.4 SK cancels it -> cancelled
--   A19.1 install on GN187 with no stock line / no country     -> stored KSA / DIRIYAH-G2 (fleet register)
--   A19.2 same with country UAE (GN187 is also a UAE machine)   -> 42501 outside scope for a KSA user
-- ROLLBACK
--   drop view if exists public.v_inv_location_utilisation, public.v_inv_lubricant_consumption,
--     public.v_inv_unit_latest;
--   drop function if exists public.equipment_issue(jsonb), public.equipment_return(jsonb),
--     public.equipment_record_calibration(jsonb), public.inv_lubricant_set_grade(jsonb),
--     public.inv_lubricant_dispense(jsonb), public.inv_unit_event_record(jsonb),
--     public.inv_scrap_request(jsonb), public.inv_scrap_cancel(jsonb), public.inv_scrap_evaluate(jsonb),
--     public.inv_scrap_decide(jsonb), public.inv_scrap_post(jsonb), public.inv_scrap_dispose(jsonb);
--   drop table if exists public.inventory_scrap_requests, public.inventory_unit_events,
--     public.inventory_lubricant_dispenses, public.equipment_calibrations, public.equipment_custody;
--   do $u$ begin execute (select def from _bak.wms_special_fn_backup_20261124
--     where fn = 'public._inv_location_upsert(jsonb)' order by id desc limit 1); end $u$;
--   drop trigger if exists trg_inv_location_class_guard on public.inventory_locations;
--   drop function if exists public.inv_location_class_guard();
--   drop function if exists public._inv_scrap_lock(uuid);
--   alter table public.material_master drop column if exists lubricant_grade;
--   alter table public.inventory_locations drop column if exists capacity_qty, drop column if exists capacity_uom,
--     drop column if exists restriction, drop column if exists restriction_note, drop column if exists van_asset_no;
--   (restore the location_type CHECK without the five new types, only if no row uses them;
--    restore _inv_location_upsert from 20261122120000_inv_location_setup.sql)
-- =============================================================================

begin;

-- ── A. Locations ─────────────────────────────────────────────────────────────

alter table public.inventory_locations drop constraint inventory_locations_location_type_check;
alter table public.inventory_locations add constraint inventory_locations_location_type_check
  check (location_type = any (array['warehouse','zone','rack','shelf','bin','in_transit','quarantine','damaged',
    'scrap','warranty','repairable','supplier_custody','vehicle_custody','consignment',
    'receiving','inspection','service_van','workshop_store','bulk_tank']));

alter table public.inventory_locations
  add column if not exists capacity_qty numeric,
  add column if not exists capacity_uom text,
  add column if not exists restriction text,
  add column if not exists restriction_note text,
  add column if not exists van_asset_no text;

alter table public.inventory_locations
  add constraint inventory_locations_capacity_chk check (capacity_qty is null or capacity_qty > 0),
  add constraint inventory_locations_capacity_uom_chk check (capacity_uom is null or length(btrim(capacity_uom)) between 1 and 20),
  add constraint inventory_locations_restriction_chk check (restriction is null or restriction = any (array[
    'tyres_only','lubricants_only','hazardous','serial_tracked_only','no_mixing','quarantine_only'])),
  add constraint inventory_locations_restriction_note_chk check (restriction_note is null or length(restriction_note) <= 400),
  add constraint inventory_locations_van_asset_chk check (van_asset_no is null or length(btrim(van_asset_no)) between 1 and 60);

create or replace function public.inv_location_class_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  new.van_asset_no := nullif(upper(btrim(new.van_asset_no)), '');
  new.capacity_uom := nullif(upper(btrim(new.capacity_uom)), '');
  if new.van_asset_no is not null then
    if new.location_type <> 'service_van' then
      raise exception 'Only a service van location names a vehicle.' using errcode = '22023';
    end if;
    if not exists (select 1 from public.vehicle_fleet v where v.organisation_id = new.organisation_id
                    and upper(btrim(v.asset_no)) = new.van_asset_no
                    and (v.country is null or lower(v.country) = lower(new.country))) then
      raise exception 'The van must be a fleet asset of your company in this country.' using errcode = '22023';
    end if;
  end if;
  if new.capacity_qty is not null and new.capacity_uom is null then
    raise exception 'Say what the capacity is measured in.' using errcode = '22023';
  end if;
  return new;
end $$;

drop trigger if exists trg_inv_location_class_guard on public.inventory_locations;
create trigger trg_inv_location_class_guard before insert or update on public.inventory_locations
  for each row execute function public.inv_location_class_guard();

-- (review A14) versioned rollback copy of _inv_location_upsert: one row per apply, written only while the body is
-- still UNPATCHED, so the newest row is what was live just before the latest real apply.
create schema if not exists _bak;
revoke all on schema _bak from public, anon, authenticated;
create table if not exists _bak.wms_special_fn_backup_20261124 (
  id bigserial primary key, fn text not null, def text not null, saved_at timestamptz not null default now());
revoke all on _bak.wms_special_fn_backup_20261124 from public, anon, authenticated;
insert into _bak.wms_special_fn_backup_20261124(fn, def)
select 'public._inv_location_upsert(jsonb)', d
  from (select pg_get_functiondef('public._inv_location_upsert(jsonb)'::regprocedure) d) x
 where position('van_asset_no' in x.d) = 0;

do $$
declare v_def text; v_n int;
begin
  v_def := pg_get_functiondef('public._inv_location_upsert(jsonb)'::regprocedure);
  if position('van_asset_no' in v_def) > 0 then raise notice '133000: _inv_location_upsert already patched'; return; end if;
  v_n := (length(v_def) - length(replace(v_def, 'responsible_user_id, active)', ''))) / length('responsible_user_id, active)');
  if v_n <> 1 then raise exception '_inv_location_upsert insert-column anchor found % times', v_n; end if;
  v_n := (length(v_def) - length(replace(v_def, 'coalesce((p->>''active'')::boolean, true))', ''))) / length('coalesce((p->>''active'')::boolean, true))');
  if v_n <> 1 then raise exception '_inv_location_upsert insert-values anchor found % times', v_n; end if;
  v_n := (length(v_def) - length(replace(v_def, 'active = coalesce((p->>''active'')::boolean, active)', ''))) / length('active = coalesce((p->>''active'')::boolean, active)');
  if v_n <> 1 then raise exception '_inv_location_upsert update anchor found % times', v_n; end if;
  v_def := replace(v_def, 'responsible_user_id, active)',
    'responsible_user_id, active, capacity_qty, capacity_uom, restriction, restriction_note, van_asset_no)');
  v_def := replace(v_def, 'coalesce((p->>''active'')::boolean, true))',
    'coalesce((p->>''active'')::boolean, true), nullif(p->>''capacity_qty'', '''')::numeric, nullif(p->>''capacity_uom'', ''''), '
    || 'nullif(p->>''restriction'', ''''), nullif(p->>''restriction_note'', ''''), nullif(p->>''van_asset_no'', ''''))');
  v_def := replace(v_def, 'active = coalesce((p->>''active'')::boolean, active)',
    'active = coalesce((p->>''active'')::boolean, active),
      capacity_qty = case when p ? ''capacity_qty'' then nullif(p->>''capacity_qty'', '''')::numeric else capacity_qty end,
      capacity_uom = case when p ? ''capacity_uom'' then nullif(p->>''capacity_uom'', '''') else capacity_uom end,
      restriction = case when p ? ''restriction'' then nullif(p->>''restriction'', '''') else restriction end,
      restriction_note = case when p ? ''restriction_note'' then nullif(p->>''restriction_note'', '''') else restriction_note end,
      van_asset_no = case when p ? ''van_asset_no'' then nullif(p->>''van_asset_no'', '''') else van_asset_no end');
  execute v_def;
end $$;

create or replace view public.v_inv_location_utilisation with (security_invoker = on) as
-- (review A21) pct_used only when every stocked line is measured in the capacity unit; mixed units give NULL
-- (a percentage of litres against a capacity in pallets would be meaningless).
select l.id as location_id, l.organisation_id, l.country, l.site, l.code, l.name, l.location_type,
       l.capacity_qty, l.capacity_uom, l.restriction, l.restriction_note, l.responsible_user_id, l.van_asset_no,
       coalesce(sum(s.qty_on_hand), 0) as qty_on_hand,
       count(s.id) filter (where s.qty_on_hand > 0) as stock_lines,
       case when l.capacity_qty is null then null
            when bool_and(upper(btrim(coalesce(nullif(s.uom, ''), m.base_uom, m.uom, ''))) = l.capacity_uom)
                   filter (where s.qty_on_hand > 0) is false then null
            else round(coalesce(sum(s.qty_on_hand), 0) / l.capacity_qty * 100, 1) end as pct_used,
       count(s.id) filter (where s.qty_on_hand > 0 and (
            (l.restriction = 'tyres_only' and not coalesce(m.is_tyre, false))
         or (l.restriction = 'lubricants_only' and not coalesce(m.is_lubricant, false))
         or (l.restriction = 'serial_tracked_only' and not coalesce(m.serial_tracked, false))
         or (l.restriction = 'quarantine_only' and s.condition not in ('quarantine','damaged','repairable','scrap'))
       )) as restriction_breaches,
       case when l.restriction = 'no_mixing' then count(distinct s.item_id) filter (where s.qty_on_hand > 0) > 1
            else false end as mixing_breach
  from public.inventory_locations l
  left join public.stock_records s on s.location_id = l.id and s.organisation_id = l.organisation_id
  left join public.material_master m on m.id = s.item_id
 group by l.id;
grant select on public.v_inv_location_utilisation to authenticated;
revoke all on public.v_inv_location_utilisation from anon;

-- ── B. Tools: custody and calibration ────────────────────────────────────────

create table if not exists public.equipment_custody (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default public.app_current_org(),
  country         text,
  site            text,
  equipment_id    uuid not null references public.equipment(id) on delete restrict,
  holder_user_id  uuid references public.profiles(id),
  holder_name     text not null check (length(btrim(holder_name)) between 1 and 200),
  issued_at       timestamptz not null default now(),
  due_back_at     timestamptz,
  returned_at     timestamptz,
  condition_out   text check (condition_out is null or length(condition_out) <= 200),
  condition_in    text check (condition_in is null or length(condition_in) <= 200),
  issued_by       uuid not null default auth.uid(),
  returned_by     uuid,
  notes           text check (notes is null or length(notes) <= 2000),
  idempotency_key text not null check (length(idempotency_key) between 1 and 160),
  created_at      timestamptz not null default now(),
  unique (organisation_id, idempotency_key),
  constraint equipment_custody_due_chk check (due_back_at is null or due_back_at >= issued_at),
  constraint equipment_custody_return_chk check (returned_at is null or returned_at >= issued_at)
);
create unique index if not exists equipment_custody_one_open on public.equipment_custody (equipment_id) where returned_at is null;
create index if not exists equipment_custody_org_site on public.equipment_custody (organisation_id, country, site, issued_at desc);
select public._inv_secure_table('equipment_custody', true, true);

create table if not exists public.equipment_calibrations (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default public.app_current_org(),
  country         text,
  site            text,
  equipment_id    uuid not null references public.equipment(id) on delete restrict,
  calibrated_on   date not null,
  next_due        date,
  result          text not null check (result in ('pass','adjusted','fail')),
  certificate_ref text check (certificate_ref is null or length(certificate_ref) <= 120),
  provider        text check (provider is null or length(provider) <= 200),
  notes           text check (notes is null or length(notes) <= 2000),
  recorded_by     uuid not null default auth.uid(),
  recorded_at     timestamptz not null default now(),
  idempotency_key text not null check (length(idempotency_key) between 1 and 160),
  unique (organisation_id, idempotency_key),
  constraint equipment_calibrations_due_chk check (next_due is null or next_due > calibrated_on),
  constraint equipment_calibrations_pass_due_chk check (result = 'fail' or next_due is not null)
);
create index if not exists equipment_calibrations_eq on public.equipment_calibrations (equipment_id, calibrated_on desc);
select public._inv_secure_table('equipment_calibrations', true, true);

create or replace function public.equipment_issue(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare p jsonb := p_payload; v_org uuid := public.app_current_org();
  v_key text := nullif(btrim(p->>'idempotency_key'), ''); v_eq public.equipment%rowtype; v_id uuid;
  v_holder uuid := nullif(p->>'holder_user_id', '')::uuid; v_name text := nullif(btrim(p->>'holder_name'), '');
  v_due timestamptz := nullif(p->>'due_back_at', '')::timestamptz;
begin
  if not public.is_approved_and_unlocked() or not public.inv_can('issue') then
    raise exception 'Stock permission "issue" is required.' using errcode = '42501';
  end if;
  if v_key is null then raise exception 'An idempotency_key is required.' using errcode = '22023'; end if;
  select id into v_id from public.equipment_custody where organisation_id = v_org and idempotency_key = v_key;
  if found then return jsonb_build_object('status', 'ok', 'id', v_id, 'replayed', true); end if;
  select * into v_eq from public.equipment where id = nullif(p->>'equipment_id', '')::uuid and organisation_id = v_org for update;
  if v_eq.id is null then raise exception 'Choose a registered tool.' using errcode = '22023'; end if;
  if not public._inv_scope_ok(v_eq.country, v_eq.site) then
    raise exception 'This tool is outside your country or site scope.' using errcode = '42501';
  end if;
  if v_eq.status in ('retired', 'maintenance') then
    raise exception 'A tool that is % cannot be issued.', replace(v_eq.status, '_', ' ') using errcode = '22023';
  end if;
  if v_eq.calibration_due is not null and v_eq.calibration_due < current_date then
    raise exception 'Calibration is overdue (due %). Record a calibration before issuing this tool.', v_eq.calibration_due
      using errcode = '22023';
  end if;
  if v_holder is not null then
    if not exists (select 1 from public.profiles where id = v_holder and (organisation_id = v_org or org_id = v_org)) then
      raise exception 'The holder must belong to your company.' using errcode = '22023';
    end if;
    if v_name is null then select nullif(btrim(full_name), '') into v_name from public.profiles where id = v_holder; end if;
  end if;
  if v_name is null then raise exception 'Say who is taking the tool.' using errcode = '22023'; end if;
  if v_due is not null and v_due < now() then
    raise exception 'The due-back date must be in the future.' using errcode = '22023';
  end if;
  begin
    insert into public.equipment_custody (organisation_id, country, site, equipment_id, holder_user_id, holder_name,
      due_back_at, condition_out, notes, idempotency_key)
    values (v_org, v_eq.country, v_eq.site, v_eq.id, v_holder, left(v_name, 200), v_due,
      nullif(btrim(p->>'condition_out'), ''), nullif(btrim(p->>'notes'), ''), v_key)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'This tool is already out with someone. Record its return first.' using errcode = 'PT409';
  end;
  update public.equipment set status = 'in_use', updated_at = now() where id = v_eq.id;
  return jsonb_build_object('status', 'ok', 'id', v_id);
end $$;

create or replace function public.equipment_return(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.app_current_org(); v_c public.equipment_custody%rowtype;
  v_cond text := nullif(btrim(p_payload->>'condition_in'), '');
begin
  if not public.is_approved_and_unlocked() or not public.inv_can('issue') then
    raise exception 'Stock permission "issue" is required.' using errcode = '42501';
  end if;
  select * into v_c from public.equipment_custody
   where id = nullif(p_payload->>'custody_id', '')::uuid and organisation_id = v_org for update;
  if v_c.id is null then raise exception 'Custody record not found.' using errcode = 'P0002'; end if;
  if not public._inv_scope_ok(v_c.country, v_c.site) then
    raise exception 'This tool is outside your country or site scope.' using errcode = '42501';
  end if;
  if v_c.returned_at is not null then
    return jsonb_build_object('status', 'ok', 'id', v_c.id, 'replayed', true);
  end if;
  update public.equipment_custody set returned_at = now(), returned_by = auth.uid(), condition_in = v_cond
   where id = v_c.id;
  update public.equipment set status = case when lower(coalesce(v_cond, '')) in ('damaged', 'faulty', 'needs repair')
           then 'maintenance' else 'available' end, updated_at = now()
   where id = v_c.equipment_id and status = 'in_use';
  return jsonb_build_object('status', 'ok', 'id', v_c.id);
end $$;

create or replace function public.equipment_record_calibration(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare p jsonb := p_payload; v_org uuid := public.app_current_org();
  v_key text := nullif(btrim(p->>'idempotency_key'), ''); v_eq public.equipment%rowtype; v_id uuid;
  v_on date := nullif(p->>'calibrated_on', '')::date; v_due date := nullif(p->>'next_due', '')::date;
  v_res text := lower(nullif(btrim(p->>'result'), ''));
begin
  if not public.is_approved_and_unlocked() or not (public.inv_can('engineering_approve') or public.app_is_elevated()) then
    raise exception 'Recording a calibration needs engineering approval rights or an Admin, Manager or Director.' using errcode = '42501';
  end if;
  if v_key is null then raise exception 'An idempotency_key is required.' using errcode = '22023'; end if;
  select id into v_id from public.equipment_calibrations where organisation_id = v_org and idempotency_key = v_key;
  if found then return jsonb_build_object('status', 'ok', 'id', v_id, 'replayed', true); end if;
  select * into v_eq from public.equipment where id = nullif(p->>'equipment_id', '')::uuid and organisation_id = v_org for update;
  if v_eq.id is null then raise exception 'Choose a registered tool.' using errcode = '22023'; end if;
  if not public._inv_scope_ok(v_eq.country, v_eq.site) then
    raise exception 'This tool is outside your country or site scope.' using errcode = '42501';
  end if;
  if v_on is null or v_on > current_date then
    raise exception 'Give the calibration date (today or earlier).' using errcode = '22023';
  end if;
  if v_res is null or v_res not in ('pass', 'adjusted', 'fail') then
    raise exception 'Result must be pass, adjusted or fail.' using errcode = '22023';
  end if;
  if v_res <> 'fail' and (v_due is null or v_due <= v_on) then
    raise exception 'Give the next due date after the calibration date.' using errcode = '22023';
  end if;
  insert into public.equipment_calibrations (organisation_id, country, site, equipment_id, calibrated_on, next_due, result,
    certificate_ref, provider, notes, idempotency_key)
  values (v_org, v_eq.country, v_eq.site, v_eq.id, v_on, case when v_res = 'fail' then null else v_due end, v_res,
    nullif(btrim(p->>'certificate_ref'), ''), nullif(btrim(p->>'provider'), ''), nullif(btrim(p->>'notes'), ''), v_key)
  returning id into v_id;
  if v_res = 'fail' then
    update public.equipment set status = case when status = 'available' then 'maintenance' else status end,
      calibration_due = least(coalesce(calibration_due, v_on), v_on), updated_at = now() where id = v_eq.id;
  else
    update public.equipment set calibration_due = v_due, updated_at = now() where id = v_eq.id;
  end if;
  return jsonb_build_object('status', 'ok', 'id', v_id);
end $$;

-- ── C. Lubricants ────────────────────────────────────────────────────────────

alter table public.material_master add column if not exists lubricant_grade text;
alter table public.material_master add constraint material_master_lubricant_grade_chk
  check (lubricant_grade is null or length(btrim(lubricant_grade)) between 1 and 60);

create or replace function public.inv_lubricant_set_grade(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.app_current_org(); v_m public.material_master%rowtype;
  v_grade text := nullif(btrim(p_payload->>'lubricant_grade'), ''); v_uom text := nullif(upper(btrim(p_payload->>'base_uom')), '');
begin
  if not public.is_approved_and_unlocked() or not (public.inv_can('engineering_approve') or public.app_is_elevated()) then
    raise exception 'Setting a lubricant grade needs engineering approval rights or an Admin, Manager or Director.' using errcode = '42501';
  end if;
  select * into v_m from public.material_master where id = nullif(p_payload->>'item_id', '')::uuid and organisation_id = v_org for update;
  if v_m.id is null then raise exception 'Item not found.' using errcode = 'P0002'; end if;
  if not coalesce(v_m.is_lubricant, false) then raise exception 'Only a lubricant item has a grade.' using errcode = '22023'; end if;
  if not public.app_write_country_ok(v_m.country) then
    raise exception 'This item is outside your country scope.' using errcode = '42501';
  end if;
  if v_uom is not null and v_uom not in ('L', 'ML', 'KG', 'PAIL', 'DRUM', 'EA') then
    raise exception 'Unit must be L, ML, KG, PAIL, DRUM or EA.' using errcode = '22023';
  end if;
  update public.material_master set lubricant_grade = v_grade,
    base_uom = case when p_payload ? 'base_uom' then v_uom else base_uom end, updated_at = now()
   where id = v_m.id;
  return jsonb_build_object('status', 'ok', 'id', v_m.id);
end $$;

create table if not exists public.inventory_lubricant_dispenses (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default public.app_current_org(),
  country         text,
  site            text,
  stock_id        uuid not null references public.stock_records(id),
  item_id         uuid references public.material_master(id),
  movement_id     uuid not null unique references public.stock_movements(id),
  asset_no        text not null check (length(btrim(asset_no)) between 1 and 60),
  job_card_no     text check (job_card_no is null or length(job_card_no) <= 80),
  work_order_id   uuid references public.work_orders(id),
  qty             numeric not null check (qty > 0),
  uom             text,
  meter_reading   numeric check (meter_reading is null or meter_reading >= 0),
  meter_type      text check (meter_type is null or meter_type in ('km', 'hours')),
  note            text check (note is null or length(note) <= 400),
  dispensed_by    uuid not null default auth.uid(),
  dispensed_at    timestamptz not null default now(),
  idempotency_key text not null check (length(idempotency_key) between 1 and 160),
  unique (organisation_id, idempotency_key)
);
create index if not exists inventory_lubricant_dispenses_asset on public.inventory_lubricant_dispenses (organisation_id, asset_no, dispensed_at desc);
select public._inv_secure_table('inventory_lubricant_dispenses', true, true);

create or replace function public.inv_lubricant_dispense(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare p jsonb := p_payload; v_org uuid := public.app_current_org();
  v_key text := nullif(btrim(p->>'idempotency_key'), ''); v_rec public.stock_records%rowtype; v_m public.material_master%rowtype;
  v_asset text := nullif(upper(btrim(p->>'asset_no')), ''); v_jc text := nullif(btrim(p->>'job_card_no'), '');
  v_wo public.work_orders%rowtype; v_qty numeric; v_post jsonb; v_id uuid;
begin
  if not public.is_approved_and_unlocked() or not public.inv_can('issue') then
    raise exception 'Stock permission "issue" is required.' using errcode = '42501';
  end if;
  if v_key is null then raise exception 'An idempotency_key is required.' using errcode = '22023'; end if;
  select id into v_id from public.inventory_lubricant_dispenses where organisation_id = v_org and idempotency_key = v_key;
  if found then return jsonb_build_object('status', 'posted', 'id', v_id, 'replayed', true); end if;
  begin v_qty := (p->>'qty')::numeric; exception when others then v_qty := null; end;
  if v_qty is null or v_qty <= 0 then raise exception 'Enter a positive quantity.' using errcode = '22023'; end if;
  select * into v_rec from public.stock_records where id = nullif(p->>'stock_id', '')::uuid and organisation_id = v_org;
  if v_rec.id is null or v_rec.item_id is null then raise exception 'Choose a mapped stock line.' using errcode = '22023'; end if;
  select * into v_m from public.material_master where id = v_rec.item_id;
  if not coalesce(v_m.is_lubricant, false) then
    raise exception 'Only a lubricant can be dispensed here. Use Issue for other stock.' using errcode = '22023';
  end if;
  if not public._inv_scope_ok(v_rec.country, v_rec.site) then
    raise exception 'This stock is outside your country or site scope.' using errcode = '42501';
  end if;
  if v_asset is null or not exists (select 1 from public.vehicle_fleet v where v.organisation_id = v_org
       and upper(btrim(v.asset_no)) = v_asset and (v.country is null or lower(v.country) = lower(v_rec.country))) then
    raise exception 'Choose a fleet asset of your company in this country.' using errcode = '22023';
  end if;
  if v_jc is not null then
    -- (review A10) canonical job card of this company, the stock's country and the caller's scope
    v_jc := public._inv_job_card_resolve(v_org, v_jc, v_rec.country);
    select * into v_wo from public.work_orders w where w.organisation_id = v_org and w.work_order_no = v_jc limit 1;
    if v_wo.id is null then raise exception 'Job card % not found.', v_jc using errcode = '22023'; end if;
    if upper(btrim(coalesce(v_wo.asset_no, ''))) <> v_asset then
      raise exception 'Job card % is for asset %, not %.', v_jc, coalesce(v_wo.asset_no, 'none'), v_asset using errcode = '22023';
    end if;
  end if;
  v_post := public._inv_issue(jsonb_build_object('idempotency_key', 'lub:' || v_key, 'stock_id', v_rec.id, 'qty', v_qty,
    'reason', coalesce(nullif(btrim(p->>'note'), ''), 'Lubricant dispensed to ' || v_asset),
    'reference_no', coalesce(v_jc, v_asset),
    'source_doc_type', case when v_jc is null then 'asset' else 'job_card' end,
    'source_doc_id', coalesce(v_jc, v_asset)));
  if v_post->>'status' = 'refused_shortage' then return v_post; end if;
  insert into public.inventory_lubricant_dispenses (organisation_id, country, site, stock_id, item_id, movement_id, asset_no,
    job_card_no, work_order_id, qty, uom, meter_reading, meter_type, note, idempotency_key)
  values (v_org, v_rec.country, v_rec.site, v_rec.id, v_rec.item_id, (v_post->>'movement_id')::uuid, v_asset, v_jc, v_wo.id,
    v_qty, coalesce(nullif(v_rec.uom, ''), nullif(v_m.base_uom, ''), nullif(v_m.uom, '')),
    nullif(p->>'meter_reading', '')::numeric, nullif(p->>'meter_type', ''), nullif(btrim(p->>'note'), ''), v_key)
  on conflict (movement_id) do nothing
  returning id into v_id;
  return v_post || jsonb_build_object('dispense_id', v_id);
end $$;

create or replace view public.v_inv_lubricant_consumption with (security_invoker = on) as
-- (review A20) three kinds of quantity are kept apart: valued (value), zero_cost_qty (a line priced at 0, e.g.
-- free or warranty) and unvalued_qty (no cost known; never treated as 0). value is NULL when no line is valued.
select 'app'::text as source, d.organisation_id, d.country, d.site, d.asset_no,
       date_trunc('month', d.dispensed_at)::date as month, m.item_code, m.item_name, m.lubricant_grade,
       mv.currency, d.uom,
       sum(d.qty) as qty,
       case when public.inv_can('view_value') then sum(-mv.value_change) filter (where mv.value_change is not null) end as value,
       sum(-coalesce(mv.unvalued_qty_change, 0)) as unvalued_qty,
       count(*) as lines,
       coalesce(sum(d.qty) filter (where mv.value_change = 0 and coalesce(mv.unvalued_qty_change, 0) = 0), 0) as zero_cost_qty
  from public.inventory_lubricant_dispenses d
  join public.stock_movements mv on mv.id = d.movement_id
  left join public.material_master m on m.id = d.item_id
 group by d.organisation_id, d.country, d.site, d.asset_no, date_trunc('month', d.dispensed_at), m.item_code, m.item_name,
          m.lubricant_grade, mv.currency, d.uom
union all
select 'erp'::text, pc.organisation_id, pc.country, pc.site, upper(btrim(pc.asset_code)),
       date_trunc('month', pc.event_date)::date, pc.item_code, max(pc.item_description), null::text,
       pc.currency, pc.uom,
       sum(pc.qty_n),
       case when public.inv_can('view_value') then sum(pc.line_cost) end,
       sum(pc.qty_n) filter (where pc.line_cost is null),
       count(*),
       coalesce(sum(pc.qty_n) filter (where pc.line_cost = 0), 0)
  from public.parts_consumption pc
 where pc.cost_category = 'oil' and nullif(btrim(pc.asset_code), '') is not null
 group by pc.organisation_id, pc.country, pc.site, upper(btrim(pc.asset_code)), date_trunc('month', pc.event_date),
          pc.item_code, pc.currency, pc.uom;
grant select on public.v_inv_lubricant_consumption to authenticated;
revoke all on public.v_inv_lubricant_consumption from anon;

-- ── D. Repairables: unit events per serial ───────────────────────────────────

create table if not exists public.inventory_unit_events (
  id              uuid primary key default gen_random_uuid(),
  seq             bigint generated always as identity,
  organisation_id uuid not null default public.app_current_org(),
  country         text,
  site            text,
  item_id         uuid not null references public.material_master(id),
  stock_id        uuid references public.stock_records(id),
  serial          text not null check (length(serial) between 1 and 100),
  event_type      text not null check (event_type in ('removed_from_asset','installed_on_asset','sent_for_repair',
                    'returned_from_repair','beyond_repair','evaluated')),
  asset_no        text,
  job_card_no     text check (job_card_no is null or length(job_card_no) <= 80),
  supplier_id     uuid references public.suppliers(id),
  rma_ref         text check (rma_ref is null or length(rma_ref) <= 120),
  expected_back   date,
  condition       text check (condition is null or condition in ('new','good','serviceable','used','repairable','damaged','quarantine','scrap')),
  note            text check (note is null or length(note) <= 1000),
  actor_id        uuid not null default auth.uid(),
  event_at        timestamptz not null default clock_timestamp(),
  idempotency_key text not null check (length(idempotency_key) between 1 and 160),
  unique (organisation_id, idempotency_key)
);
create index if not exists inventory_unit_events_serial on public.inventory_unit_events (organisation_id, item_id, serial, seq desc);
select public._inv_secure_table('inventory_unit_events', true, true);

create or replace function public.inv_unit_event_record(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare p jsonb := p_payload; v_org uuid := public.app_current_org();
  v_key text := nullif(btrim(p->>'idempotency_key'), ''); v_type text := lower(nullif(btrim(p->>'event_type'), ''));
  v_serial text := upper(regexp_replace(coalesce(p->>'serial', ''), '\s+', '', 'g'));
  v_item public.material_master%rowtype; v_rec public.stock_records%rowtype; v_last public.inventory_unit_events%rowtype;
  v_country text; v_site text; v_asset text := nullif(upper(btrim(p->>'asset_no')), ''); v_sup uuid := nullif(p->>'supplier_id', '')::uuid;
  v_cap text; v_id uuid;
begin
  if v_type is null or v_type not in ('removed_from_asset','installed_on_asset','sent_for_repair','returned_from_repair','beyond_repair','evaluated') then
    raise exception 'Unknown event type.' using errcode = '22023';
  end if;
  v_cap := case when v_type in ('removed_from_asset','installed_on_asset') then 'issue'
                when v_type in ('sent_for_repair','returned_from_repair') then 'transfer'
                else 'engineering_approve' end;
  if not public.is_approved_and_unlocked() or not public.inv_can(v_cap) then
    raise exception 'Stock permission "%" is required.', v_cap using errcode = '42501';
  end if;
  if v_key is null then raise exception 'An idempotency_key is required.' using errcode = '22023'; end if;
  select id into v_id from public.inventory_unit_events where organisation_id = v_org and idempotency_key = v_key;
  if found then return jsonb_build_object('status', 'ok', 'id', v_id, 'replayed', true); end if;
  if v_serial = '' then raise exception 'Give the serial number.' using errcode = '22023'; end if;
  select * into v_item from public.material_master where id = nullif(p->>'item_id', '')::uuid and organisation_id = v_org;
  if v_item.id is null then raise exception 'Choose the item.' using errcode = '22023'; end if;
  if nullif(p->>'stock_id', '') is not null then
    select * into v_rec from public.stock_records where id = (p->>'stock_id')::uuid and organisation_id = v_org;
    if v_rec.id is null or v_rec.item_id is distinct from v_item.id then
      raise exception 'The stock line does not match this item.' using errcode = '22023';
    end if;
    v_country := v_rec.country; v_site := v_rec.site;
  elsif v_asset is not null then
    -- (review A19) no stock line: the unit is where the asset is (fleet register), never where the payload says
    select v.country, nullif(upper(btrim(v.site)), '') into v_country, v_site
      from public.vehicle_fleet v
     where v.organisation_id = v_org and upper(btrim(v.asset_no)) = v_asset
     order by (lower(coalesce(v.country, '')) = lower(coalesce(nullif(p->>'country', ''), v_item.country, ''))) desc, v.id
     limit 1;
    if not found then
      raise exception 'Choose a fleet asset of your company in this country.' using errcode = '22023';
    end if;
    v_country := coalesce(v_country, v_item.country);
  else
    v_country := coalesce(nullif(p->>'country', ''), v_item.country); v_site := nullif(upper(btrim(p->>'site')), '');
  end if;
  if not public._inv_scope_ok(v_country, v_site) then
    raise exception 'This is outside your country or site scope.' using errcode = '42501';
  end if;
  if v_type in ('removed_from_asset','installed_on_asset') then
    if v_asset is null or not exists (select 1 from public.vehicle_fleet v where v.organisation_id = v_org
         and upper(btrim(v.asset_no)) = v_asset and (v.country is null or lower(v.country) = lower(v_country))) then
      raise exception 'Choose a fleet asset of your company in this country.' using errcode = '22023';
    end if;
  end if;
  if v_type = 'sent_for_repair' and (v_sup is null or not exists (select 1 from public.suppliers s where s.id = v_sup
       and s.organisation_id = v_org)) then
    raise exception 'Choose the repair vendor (a supplier of your company).' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_org::text || ':unit:' || v_item.id::text || ':' || v_serial, 0));
  select * into v_last from public.inventory_unit_events
   where organisation_id = v_org and item_id = v_item.id and serial = v_serial and event_type <> 'evaluated'
   order by seq desc limit 1;
  if v_type = 'returned_from_repair' and coalesce(v_last.event_type, '') <> 'sent_for_repair' then
    raise exception 'This unit is not recorded as out for repair.' using errcode = '22023';
  end if;
  if v_type = 'sent_for_repair' and v_last.event_type = 'sent_for_repair' then
    raise exception 'This unit is already out for repair.' using errcode = '22023';
  end if;
  if v_type = 'sent_for_repair' and v_last.event_type = 'installed_on_asset' then
    raise exception 'This unit is still recorded on %. Record its removal first.', v_last.asset_no using errcode = '22023';
  end if;
  if v_type = 'installed_on_asset' and v_last.event_type in ('sent_for_repair', 'beyond_repair') then
    raise exception 'A unit that is % cannot be installed.', replace(v_last.event_type, '_', ' ') using errcode = '22023';
  end if;
  if v_type = 'installed_on_asset' and v_last.event_type = 'installed_on_asset' and v_last.asset_no is distinct from v_asset then
    raise exception 'This unit is still recorded on %. Record its removal first.', v_last.asset_no using errcode = '22023';
  end if;
  if v_type = 'removed_from_asset' and v_last.event_type = 'installed_on_asset' and v_last.asset_no is distinct from v_asset then
    raise exception 'This unit is recorded on %, not %.', v_last.asset_no, v_asset using errcode = '22023';
  end if;
  insert into public.inventory_unit_events (organisation_id, country, site, item_id, stock_id, serial, event_type, asset_no,
    job_card_no, supplier_id, rma_ref, expected_back, condition, note, idempotency_key)
  values (v_org, v_country, v_site, v_item.id, v_rec.id, v_serial, v_type, v_asset, nullif(btrim(p->>'job_card_no'), ''),
    case when v_type in ('sent_for_repair','returned_from_repair') then coalesce(v_sup, v_last.supplier_id) end,
    nullif(btrim(p->>'rma_ref'), ''), nullif(p->>'expected_back', '')::date, nullif(lower(btrim(p->>'condition')), ''),
    nullif(btrim(p->>'note'), ''), v_key)
  returning id into v_id;
  return jsonb_build_object('status', 'ok', 'id', v_id);
end $$;

create or replace view public.v_inv_unit_latest with (security_invoker = on) as
select distinct on (e.organisation_id, e.item_id, e.serial)
       e.organisation_id, e.country, e.site, e.item_id, m.item_code, m.item_name, e.serial, e.event_type as last_event,
       e.asset_no, e.supplier_id, e.rma_ref, e.expected_back, e.condition, e.event_at,
       case e.event_type when 'installed_on_asset' then 'installed' when 'sent_for_repair' then 'at_vendor'
            when 'beyond_repair' then 'beyond_repair' else 'in_store' end as unit_state,
       (e.event_type = 'sent_for_repair' and e.expected_back is not null and e.expected_back < current_date) as overdue_from_vendor
  from public.inventory_unit_events e
  left join public.material_master m on m.id = e.item_id
 where e.event_type <> 'evaluated'
 order by e.organisation_id, e.item_id, e.serial, e.seq desc;
grant select on public.v_inv_unit_latest to authenticated;
revoke all on public.v_inv_unit_latest from anon;

-- ── E. Scrap requests ────────────────────────────────────────────────────────

create table if not exists public.inventory_scrap_requests (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null default public.app_current_org(),
  country           text,
  site              text,
  stock_id          uuid not null references public.stock_records(id),
  item_id           uuid references public.material_master(id),
  qty               numeric not null check (qty > 0),
  reason            text not null check (length(btrim(reason)) between 5 and 1000),
  status            text not null default 'proposed' check (status in ('proposed','evaluated','not_scrap','approved','rejected',
                      'posted','disposed','cancelled')),
  proposed_by       uuid not null default auth.uid(),
  proposed_at       timestamptz not null default now(),
  evaluated_by      uuid,
  evaluated_at      timestamptz,
  evaluation_result text check (evaluation_result is null or evaluation_result in ('scrap','repair','return_to_supplier','reuse')),
  evaluation_note   text check (evaluation_note is null or length(evaluation_note) <= 1000),
  decided_by        uuid,
  decided_at        timestamptz,
  decision_note     text check (decision_note is null or length(decision_note) <= 1000),
  movement_id       uuid references public.stock_movements(id),
  posted_by         uuid,
  posted_at         timestamptz,
  disposal_method   text check (disposal_method is null or disposal_method in ('sold_as_scrap','returned_to_supplier','destroyed','recycled','other')),
  disposal_ref      text check (disposal_ref is null or length(disposal_ref) <= 120),
  disposed_at       timestamptz,
  disposed_by       uuid,
  recovery_value    numeric check (recovery_value is null or recovery_value >= 0),
  recovery_currency text check (recovery_currency is null or recovery_currency in ('SAR','AED','EGP')),
  idempotency_key   text not null check (length(idempotency_key) between 1 and 160),
  unique (organisation_id, idempotency_key),
  constraint inventory_scrap_requests_recovery_chk check (recovery_value is null or recovery_currency is not null),
  constraint inventory_scrap_requests_sod_eval check (evaluated_by is null or evaluated_by <> proposed_by),
  constraint inventory_scrap_requests_sod_decide check (decided_by is null or decided_by <> proposed_by),
  constraint inventory_scrap_requests_sod_post check (posted_by is null or posted_by <> proposed_by),
  constraint inventory_scrap_requests_sod_dispose check (disposed_by is null or disposed_by <> proposed_by)
);
create index if not exists inventory_scrap_requests_status on public.inventory_scrap_requests (organisation_id, status, proposed_at desc);
select public._inv_secure_table('inventory_scrap_requests', true, true);

create or replace function public._inv_scrap_lock(p_id uuid)
returns public.inventory_scrap_requests language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.inventory_scrap_requests%rowtype;
begin
  select * into v from public.inventory_scrap_requests where id = p_id and organisation_id = public.app_current_org() for update;
  if v.id is null then raise exception 'Scrap request not found.' using errcode = 'P0002'; end if;
  if not public._inv_scope_ok(v.country, v.site) then
    raise exception 'This scrap request is outside your country or site scope.' using errcode = '42501';
  end if;
  return v;
end $$;
revoke all on function public._inv_scrap_lock(uuid) from public, anon, authenticated;

create or replace function public.inv_scrap_request(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare p jsonb := p_payload; v_org uuid := public.app_current_org(); v_key text := nullif(btrim(p->>'idempotency_key'), '');
  v_rec public.stock_records%rowtype; v_qty numeric; v_id uuid; v_reason text := nullif(btrim(p->>'reason'), '');
begin
  if not public.is_approved_and_unlocked()
     or not (public.inv_can('issue') or public.inv_can('count') or public.inv_can('engineering_approve')) then
    raise exception 'Stock permission "issue" or "count" is required to propose a scrap.' using errcode = '42501';
  end if;
  if v_key is null then raise exception 'An idempotency_key is required.' using errcode = '22023'; end if;
  select id into v_id from public.inventory_scrap_requests where organisation_id = v_org and idempotency_key = v_key;
  if found then return jsonb_build_object('status', 'proposed', 'id', v_id, 'replayed', true); end if;
  begin v_qty := (p->>'qty')::numeric; exception when others then v_qty := null; end;
  if v_qty is null or v_qty <= 0 then raise exception 'Enter how many units to scrap.' using errcode = '22023'; end if;
  if v_reason is null or length(v_reason) < 5 then raise exception 'Give the reason for scrapping.' using errcode = '22023'; end if;
  select * into v_rec from public.stock_records where id = nullif(p->>'stock_id', '')::uuid and organisation_id = v_org;
  if v_rec.id is null then raise exception 'Choose the stock line to scrap.' using errcode = '22023'; end if;
  if not public._inv_scope_ok(v_rec.country, v_rec.site) then
    raise exception 'This stock is outside your country or site scope.' using errcode = '42501';
  end if;
  if v_qty > coalesce(v_rec.qty_on_hand, 0) - coalesce(v_rec.qty_reserved, 0) then
    raise exception 'Only % free units are on hand.', coalesce(v_rec.qty_on_hand, 0) - coalesce(v_rec.qty_reserved, 0) using errcode = '22023';
  end if;
  insert into public.inventory_scrap_requests (organisation_id, country, site, stock_id, item_id, qty, reason, idempotency_key)
  values (v_org, v_rec.country, v_rec.site, v_rec.id, v_rec.item_id, v_qty, left(v_reason, 1000), v_key)
  returning id into v_id;
  return jsonb_build_object('status', 'proposed', 'id', v_id);
end $$;

create or replace function public.inv_scrap_cancel(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.inventory_scrap_requests%rowtype;
begin
  if not public.is_approved_and_unlocked() then raise exception 'Your account is not active.' using errcode = '42501'; end if;
  v := public._inv_scrap_lock(nullif(p_payload->>'request_id', '')::uuid);
  if v.proposed_by <> auth.uid() and not public.app_is_elevated() then
    raise exception 'Only the proposer or a manager can cancel.' using errcode = '42501';
  end if;
  if v.status not in ('proposed', 'evaluated')
     and not (v.status = 'approved' and v.decided_at < now() - interval '30 days') then
    raise exception 'A % request cannot be cancelled.', v.status using errcode = '22023';
  end if;
  update public.inventory_scrap_requests set status = 'cancelled', decision_note = nullif(btrim(p_payload->>'note'), '') where id = v.id;
  return jsonb_build_object('status', 'cancelled', 'id', v.id);
end $$;

create or replace function public.inv_scrap_evaluate(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.inventory_scrap_requests%rowtype; v_res text := lower(nullif(btrim(p_payload->>'result'), ''));
  v_note text := nullif(btrim(p_payload->>'note'), '');
begin
  if not public.is_approved_and_unlocked() or not public.inv_can('engineering_approve') then
    raise exception 'Stock permission "engineering_approve" is required to evaluate.' using errcode = '42501';
  end if;
  v := public._inv_scrap_lock(nullif(p_payload->>'request_id', '')::uuid);
  if v.status <> 'proposed' then raise exception 'Only a proposed request can be evaluated (this one is %).', v.status using errcode = '22023'; end if;
  if v.proposed_by = auth.uid() then raise exception 'The proposer cannot evaluate their own request.' using errcode = '42501'; end if;
  if v_res is null or v_res not in ('scrap','repair','return_to_supplier','reuse') then
    raise exception 'Result must be scrap, repair, return_to_supplier or reuse.' using errcode = '22023';
  end if;
  if v_note is null or length(v_note) < 5 then raise exception 'Write the engineering finding.' using errcode = '22023'; end if;
  update public.inventory_scrap_requests set status = case when v_res = 'scrap' then 'evaluated' else 'not_scrap' end,
    evaluated_by = auth.uid(), evaluated_at = now(), evaluation_result = v_res, evaluation_note = left(v_note, 1000)
   where id = v.id;
  return jsonb_build_object('status', case when v_res = 'scrap' then 'evaluated' else 'not_scrap' end, 'id', v.id);
end $$;

create or replace function public.inv_scrap_decide(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.inventory_scrap_requests%rowtype; v_dec text := lower(nullif(btrim(p_payload->>'decision'), ''));
  v_note text := nullif(btrim(p_payload->>'note'), '');
begin
  if not public.is_approved_and_unlocked() or not public.inv_can('scrap_approve') then
    raise exception 'Stock permission "scrap_approve" is required.' using errcode = '42501';
  end if;
  v := public._inv_scrap_lock(nullif(p_payload->>'request_id', '')::uuid);
  if v.status <> 'evaluated' then raise exception 'Only an evaluated request can be decided (this one is %).', v.status using errcode = '22023'; end if;
  if v.proposed_by = auth.uid() then raise exception 'You cannot approve your own scrap request.' using errcode = '42501'; end if;
  if v_dec not in ('approve', 'reject') then raise exception 'Decision must be approve or reject.' using errcode = '22023'; end if;
  if v_dec = 'reject' and v_note is null then raise exception 'Give the reason for rejecting.' using errcode = '22023'; end if;
  update public.inventory_scrap_requests set status = case when v_dec = 'approve' then 'approved' else 'rejected' end,
    decided_by = auth.uid(), decided_at = now(), decision_note = left(v_note, 1000) where id = v.id;
  return jsonb_build_object('status', case when v_dec = 'approve' then 'approved' else 'rejected' end, 'id', v.id);
end $$;

create or replace function public.inv_scrap_post(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.inventory_scrap_requests%rowtype; v_post jsonb;
begin
  if not public.is_approved_and_unlocked() or not public.inv_can('scrap_approve') then
    raise exception 'Stock permission "scrap_approve" is required.' using errcode = '42501';
  end if;
  v := public._inv_scrap_lock(nullif(p_payload->>'request_id', '')::uuid);
  if v.status = 'posted' or v.status = 'disposed' then
    return jsonb_build_object('status', v.status, 'id', v.id, 'movement_id', v.movement_id, 'replayed', true);
  end if;
  if v.status <> 'approved' then raise exception 'Only an approved request can be posted (this one is %).', v.status using errcode = '22023'; end if;
  if v.proposed_by = auth.uid() then raise exception 'The proposer cannot post their own scrap.' using errcode = '42501'; end if;
  -- (review A18) an approval is good for 30 days; after that the request must be cancelled and proposed again
  if v.decided_at < now() - interval '30 days' then
    raise exception 'This scrap approval is older than 30 days. Cancel the request and propose it again.' using errcode = '22023';
  end if;
  v_post := public._inv_post(jsonb_build_object('idempotency_key', 'scrapreq:' || v.id, 'stock_id', v.stock_id,
    'movement_type', 'scrap', 'qty_change', -v.qty, 'reason', v.reason, 'approval_ref', v.id::text,
    'source_doc_type', 'scrap_request', 'source_doc_id', v.id::text, 'reference_no', 'SCRAP-' || left(v.id::text, 8)), false);
  if v_post->>'status' = 'refused_shortage' then
    -- (review A5) raise, so the shortage exception row written by _inv_post rolls back with this call
    raise exception 'Not enough free stock to scrap % (only % available). Nothing was posted.', v.qty,
      coalesce(v_post->>'qty_available', '0') using errcode = '23514';
  end if;
  update public.inventory_scrap_requests set status = 'posted', movement_id = (v_post->>'movement_id')::uuid,
    posted_by = auth.uid(), posted_at = now() where id = v.id;
  return v_post || jsonb_build_object('id', v.id, 'request_status', 'posted');
end $$;

create or replace function public.inv_scrap_dispose(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.inventory_scrap_requests%rowtype; v_method text := lower(nullif(btrim(p_payload->>'disposal_method'), ''));
  v_val numeric; v_cur text := nullif(upper(btrim(p_payload->>'recovery_currency')), ''); v_expected text;
begin
  if not public.is_approved_and_unlocked() or not (public.inv_can('scrap_approve') or public.inv_can('financial_post')) then
    raise exception 'Stock permission "scrap_approve" or "financial_post" is required.' using errcode = '42501';
  end if;
  v := public._inv_scrap_lock(nullif(p_payload->>'request_id', '')::uuid);
  if v.status <> 'posted' then raise exception 'Only a posted scrap can be disposed (this one is %).', v.status using errcode = '22023'; end if;
  -- (review A18) the person who proposed the scrap does not record what was recovered from it
  if v.proposed_by = auth.uid() then
    raise exception 'The proposer cannot record the disposal of their own scrap.' using errcode = '42501';
  end if;
  if v_method is null or v_method not in ('sold_as_scrap','returned_to_supplier','destroyed','recycled','other') then
    raise exception 'Choose how it was disposed.' using errcode = '22023';
  end if;
  begin v_val := nullif(p_payload->>'recovery_value', '')::numeric; exception when others then
    raise exception 'Recovery value must be a number.' using errcode = '22023'; end;
  if v_val is not null and v_val < 0 then raise exception 'Recovery value cannot be negative.' using errcode = '22023'; end if;
  v_expected := case upper(coalesce(v.country, '')) when 'KSA' then 'SAR' when 'UAE' then 'AED' when 'EGYPT' then 'EGP' end;
  if v_val is not null then
    v_cur := coalesce(v_cur, v_expected);
    if v_cur is null then raise exception 'Say the currency of the recovery value.' using errcode = '22023'; end if;
    if v_expected is not null and v_cur <> v_expected then
      raise exception 'Recovery for % is recorded in %, not %.', v.country, v_expected, v_cur using errcode = '22023';
    end if;
  else
    v_cur := null;
  end if;
  update public.inventory_scrap_requests set status = 'disposed', disposal_method = v_method,
    disposal_ref = nullif(btrim(p_payload->>'disposal_ref'), ''), disposed_at = now(), disposed_by = auth.uid(),
    recovery_value = v_val, recovery_currency = v_cur
   where id = v.id;
  return jsonb_build_object('status', 'disposed', 'id', v.id);
end $$;

-- grants: every new RPC is callable by signed-in users only; each re-checks org,
-- scope and capability itself.
do $$
declare f text;
begin
  foreach f in array array['equipment_issue(jsonb)','equipment_return(jsonb)','equipment_record_calibration(jsonb)',
    'inv_lubricant_set_grade(jsonb)','inv_lubricant_dispense(jsonb)','inv_unit_event_record(jsonb)',
    'inv_scrap_request(jsonb)','inv_scrap_cancel(jsonb)','inv_scrap_evaluate(jsonb)','inv_scrap_decide(jsonb)',
    'inv_scrap_post(jsonb)','inv_scrap_dispose(jsonb)'] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('revoke all on function public.%s from anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
  revoke all on function public.inv_location_class_guard() from public, anon, authenticated;
end $$;

commit;

-- VERIFY (after apply, read-only):
--   select count(*) from public.v_inv_location_utilisation;            -- = inventory_locations rows
--   select has_function_privilege('anon','public.equipment_issue(jsonb)','execute');   -- false
--   select pg_get_functiondef('public._inv_location_upsert(jsonb)'::regprocedure) ~ 'van_asset_no';  -- true
