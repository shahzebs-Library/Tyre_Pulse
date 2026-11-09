-- =====================================================================
-- 20261109100000  KSA tyre corrections: one price per tyre, one vehicle per
-- active tyre, latest upload wins, admin review of held import rows.
-- =====================================================================
-- Owner rules (2026-11-09):
--  * "one tyre one price": a physical tyre's purchase is charged once. A later
--    fitment of the same tyre carries no purchase price (no cost / zero is fine).
--  * "the latest tyre linked must be kept and the old one closed": a serial
--    active on two vehicles keeps the most recent fitment.
--  * "the last upload is the latest information about that wheel": a new
--    fitment dated the SAME day as the current one replaces it. An OLDER dated
--    one is still held for an admin to decide (it cannot be current).
--
-- Measured live before writing (KSA):
--  * Applied selections: 124 prices (SAR 135,583) and 28 older fitments
--    on 25 real serials.
--  * 124 later-fitment rows of the same tyre carry a purchase price again,
--    SAR 135,583. Left alone on purpose: 8 rows whose size differs from the
--    first fitment and 35 rows whose "serial" is a batch code / size text shared
--    by different tyres (they are different physical tyres).
--  * 31 serials active on two vehicles (26 clear + 5 same date). 3 batch-code
--    serials (17 rows) left alone. 0 exact duplicate tyre rows.
--
-- Everything is logged and reversible:
--   select public.tyre_cost_correction_undo('<batch>');      -- prices
--   select public.tyre_replacement_undo('<batch>');          -- closures
-- Previous function text is saved in _bak.fn_defs_20261109b.
-- =====================================================================

begin;

create schema if not exists _bak;
create table if not exists _bak.fn_defs_20261109b (
  fn text primary key, def text not null, saved_at timestamptz not null default now());
insert into _bak.fn_defs_20261109b (fn, def)
select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('_tyre_close_replaced', 'process_stg_monthly_tyres', 'tyre_price_backfill', 'tyre_import_reconcile')
on conflict (fn) do nothing;

-- ---------------------------------------------------------------------
-- 1. Is this text a real serial (one physical tyre) or a shared batch code /
--    size / placeholder? Only real serials are reconciled across rows.
-- ---------------------------------------------------------------------
create or replace function public.tyre_serial_is_strong(p_serial text)
returns boolean language sql immutable set search_path to 'public' as $$
  select coalesce(
    length(btrim(p_serial)) >= 6
    and upper(btrim(p_serial)) !~ '^(DOT|NULL|N/?A|-)'
    and upper(btrim(p_serial)) !~ '^[0-9]{3}/'
    and upper(btrim(p_serial)) !~ '[0-9]{2,3}/[0-9]{2}\s*R'
    and upper(btrim(p_serial)) !~ 'E\+[0-9]+$', false)
$$;

create or replace function public.tyre_size_key_loose(p_size text)
returns text language sql immutable set search_path to 'public' as $$
  select nullif(upper(regexp_replace(coalesce(p_size, ''), '\s', '', 'g')), '')
$$;

-- ---------------------------------------------------------------------
-- 2. Replacement rule: same-day fitment replaces (latest upload wins); a
--    forced mode for the admin review screen.
--    The 11-argument version is replaced by a 12-argument one (p_force).
-- ---------------------------------------------------------------------
drop function if exists public._tyre_close_replaced(uuid, text, text, text, text, date, numeric, numeric, text, uuid, boolean);

create or replace function public._tyre_close_replaced(
  p_org uuid, p_country text, p_asset text, p_position text, p_serial text,
  p_fit_date date, p_fit_km numeric, p_fit_hrs numeric,
  p_source text, p_batch uuid, p_dry_run boolean default false, p_force boolean default false)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_asset  text := nullif(upper(regexp_replace(coalesce(p_asset, ''), '\s+', '', 'g')), '');
  v_pos    text := nullif(upper(btrim(coalesce(p_position, ''))), '');
  v_serial text := nullif(upper(btrim(coalesce(p_serial, ''))), '');
  v_cnt int; v_prev public.tyre_records%rowtype; v_prev_date date; v_later int; v_rem_date date;
  v_rem_km numeric; v_rem_hrs numeric; v_total_km numeric; v_total_hrs numeric; v_new jsonb;
begin
  if p_fit_date is null or v_asset is null or v_pos is null or v_pos = '0' then
    return jsonb_build_object('status', 'not_applicable');
  end if;
  select count(*) into v_cnt from public.tyre_records t
  where t.organisation_id is not distinct from p_org and coalesce(t.country, '') = coalesce(p_country, '')
    and upper(regexp_replace(coalesce(t.asset_no, t.asset_number, ''), '\s+', '', 'g')) = v_asset
    and upper(btrim(coalesce(t.tyre_position, t.position, ''))) = v_pos
    and public.tyre_status_is_active(t.status);
  if v_cnt = 0 then return jsonb_build_object('status', 'no_previous'); end if;
  if v_cnt > 1 then return jsonb_build_object('status', 'ambiguous_multiple_active'); end if;
  select t.* into v_prev from public.tyre_records t
  where t.organisation_id is not distinct from p_org and coalesce(t.country, '') = coalesce(p_country, '')
    and upper(regexp_replace(coalesce(t.asset_no, t.asset_number, ''), '\s+', '', 'g')) = v_asset
    and upper(btrim(coalesce(t.tyre_position, t.position, ''))) = v_pos
    and public.tyre_status_is_active(t.status)
  for update;
  if v_serial is not null and upper(btrim(coalesce(v_prev.serial_no, ''))) = v_serial then
    return jsonb_build_object('status', 'same_tyre', 'tyre_id', v_prev.id);
  end if;
  v_prev_date := coalesce(v_prev.issue_date, v_prev.fitment_date);
  if not p_force then
    if v_prev_date is null then return jsonb_build_object('status', 'ambiguous_previous_undated', 'tyre_id', v_prev.id); end if;
    -- Same day: the latest upload is the latest information about the wheel.
    if v_prev_date > p_fit_date then return jsonb_build_object('status', 'ambiguous_not_later', 'tyre_id', v_prev.id); end if;
    select count(*) into v_later from public.tyre_records t
    where t.organisation_id is not distinct from p_org and coalesce(t.country, '') = coalesce(p_country, '')
      and upper(regexp_replace(coalesce(t.asset_no, t.asset_number, ''), '\s+', '', 'g')) = v_asset
      and upper(btrim(coalesce(t.tyre_position, t.position, ''))) = v_pos
      and t.id <> v_prev.id and coalesce(t.issue_date, t.fitment_date) > p_fit_date;
    if v_later > 0 then return jsonb_build_object('status', 'ambiguous_backdated', 'tyre_id', v_prev.id); end if;
  end if;
  v_rem_date := greatest(p_fit_date, coalesce(v_prev_date, p_fit_date));
  if p_fit_km is not null and p_fit_km > 1 and (v_prev.km_at_fitment is null or p_fit_km >= v_prev.km_at_fitment) then
    v_rem_km := p_fit_km; end if;
  if p_fit_hrs is not null and p_fit_hrs > 0 and (v_prev.hrs_at_fitment is null or p_fit_hrs >= v_prev.hrs_at_fitment) then
    v_rem_hrs := p_fit_hrs; end if;
  v_total_km := public.tyre_km_life(v_prev.km_at_fitment, v_rem_km, null, v_prev.vehicle_type);
  if v_rem_hrs is not null and v_prev.hrs_at_fitment is not null then v_total_hrs := v_rem_hrs - v_prev.hrs_at_fitment; end if;
  v_new := jsonb_strip_nulls(jsonb_build_object('removal_date', v_rem_date, 'km_at_removal', v_rem_km,
    'hrs_at_removal', v_rem_hrs, 'total_km', v_total_km, 'total_hrs', v_total_hrs, 'status', 'Removed'));
  if p_dry_run then
    return jsonb_build_object('status', 'would_close', 'tyre_id', v_prev.id, 'old_serial', v_prev.serial_no, 'removal', v_new);
  end if;
  insert into public.tyre_replacement_log (organisation_id, batch_id, tyre_id, country, asset_no, position, old_serial, new_serial, replaced_on, old_values, new_values, source)
  values (p_org, p_batch, v_prev.id, v_prev.country, v_prev.asset_no, v_pos, v_prev.serial_no, p_serial, v_rem_date,
    jsonb_build_object('removal_date', v_prev.removal_date, 'km_at_removal', v_prev.km_at_removal, 'hrs_at_removal', v_prev.hrs_at_removal,
      'total_km', v_prev.total_km, 'total_hrs', v_prev.total_hrs, 'status', v_prev.status, 'extra_fields', v_prev.extra_fields),
    v_new, p_source);
  update public.tyre_records t set removal_date = v_rem_date, km_at_removal = coalesce(v_rem_km, t.km_at_removal),
    hrs_at_removal = coalesce(v_rem_hrs, t.hrs_at_removal), total_km = coalesce(t.total_km, v_total_km),
    total_hrs = coalesce(t.total_hrs, v_total_hrs), status = 'Removed',
    extra_fields = coalesce(t.extra_fields, '{}'::jsonb) || jsonb_build_object('replaced_by_serial', p_serial, 'replaced_on', v_rem_date, 'replacement_source', p_source, 'replacement_batch', p_batch)
  where t.id = v_prev.id;
  return jsonb_build_object('status', 'closed', 'tyre_id', v_prev.id, 'old_serial', v_prev.serial_no);
end;
$function$;
revoke all on function public._tyre_close_replaced(uuid, text, text, text, text, date, numeric, numeric, text, uuid, boolean, boolean) from public;
revoke all on function public._tyre_close_replaced(uuid, text, text, text, text, date, numeric, numeric, text, uuid, boolean, boolean) from anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. One active vehicle per tyre: fitting a real serial closes the same tyre
--    still active on ANOTHER vehicle with an earlier (or same) fitment date.
-- ---------------------------------------------------------------------
create or replace function public._tyre_close_serial_elsewhere(
  p_org uuid, p_country text, p_asset text, p_serial text, p_fit_date date,
  p_source text, p_batch uuid, p_dry_run boolean default false)
returns int language plpgsql security definer set search_path to 'public' as $function$
declare
  v_asset text := nullif(upper(regexp_replace(coalesce(p_asset, ''), '\s+', '', 'g')), '');
  r public.tyre_records%rowtype; v_n int := 0;
begin
  if p_fit_date is null or v_asset is null or not public.tyre_serial_is_strong(p_serial) then return 0; end if;
  for r in
    select t.* from public.tyre_records t
    where t.organisation_id is not distinct from p_org and coalesce(t.country, '') = coalesce(p_country, '')
      and upper(btrim(t.serial_no)) = upper(btrim(p_serial))
      and upper(regexp_replace(coalesce(t.asset_no, t.asset_number, ''), '\s+', '', 'g')) <> v_asset
      and public.tyre_status_is_active(t.status)
      and coalesce(t.issue_date, t.fitment_date, p_fit_date) <= p_fit_date
    for update
  loop
    v_n := v_n + 1;
    if p_dry_run then continue; end if;
    insert into public.tyre_replacement_log (organisation_id, batch_id, tyre_id, country, asset_no, position, old_serial, new_serial, replaced_on, old_values, new_values, source)
    values (p_org, p_batch, r.id, r.country, r.asset_no, upper(btrim(coalesce(r.tyre_position, r.position, ''))), r.serial_no, p_serial, p_fit_date,
      jsonb_build_object('removal_date', r.removal_date, 'km_at_removal', r.km_at_removal, 'hrs_at_removal', r.hrs_at_removal,
        'total_km', r.total_km, 'total_hrs', r.total_hrs, 'status', r.status, 'extra_fields', r.extra_fields),
      jsonb_build_object('removal_date', p_fit_date, 'status', 'Removed', 'moved_to_asset', p_asset), p_source);
    update public.tyre_records t set removal_date = p_fit_date, status = 'Removed',
      extra_fields = coalesce(t.extra_fields, '{}'::jsonb) || jsonb_build_object('moved_to_asset', p_asset,
        'replaced_on', p_fit_date, 'replacement_source', p_source, 'replacement_batch', p_batch)
    where t.id = r.id;
  end loop;
  return v_n;
end;
$function$;
revoke all on function public._tyre_close_serial_elsewhere(uuid, text, text, text, date, text, uuid, boolean) from public;
revoke all on function public._tyre_close_serial_elsewhere(uuid, text, text, text, date, text, uuid, boolean) from anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Staging pipe: also close the same tyre on another vehicle.
-- ---------------------------------------------------------------------
do $do$
declare v_def text;
  a1 text := E'      return null;\n    end if;\n  end if;\n\n  insert into public.tyre_records';
  r1 text := E'      return null;\n    end if;\n    perform public._tyre_close_serial_elsewhere(coalesce(new.organisation_id, ''00000000-0000-0000-0000-000000000001''::uuid),\n      public.normalize_country(new.country), new.veh_no, new.tyre_no, fd, ''stg_monthly_tyres'', gen_random_uuid(), false);\n  end if;\n\n  insert into public.tyre_records';
begin
  select pg_get_functiondef('public.process_stg_monthly_tyres'::regproc) into v_def;
  if position('_tyre_close_serial_elsewhere' in v_def) > 0 then return; end if;
  if (length(v_def) - length(replace(v_def, a1, ''))) / length(a1) <> 1 then
    raise exception 'process_stg_monthly_tyres: anchor not found exactly once (apply 20261109090000 first)'; end if;
  execute replace(v_def, a1, r1);
end $do$;

-- ---------------------------------------------------------------------
-- 5. In-app intake RPC: same rules, plus the serial-on-another-vehicle close.
-- ---------------------------------------------------------------------
create or replace function public.tyre_import_reconcile(p_rows jsonb, p_country text default null, p_dry_run boolean default true)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_org uuid := public.app_current_org();
  v_batch uuid := gen_random_uuid();
  v_country text := nullif(btrim(coalesce(p_country, '')), '');
  r jsonb; v_res jsonb; v_status text; v_moved int := 0;
  v_counts jsonb := '{}'::jsonb; v_review jsonb := '[]'::jsonb;
begin
  if v_org is null then raise exception 'No organisation in session' using errcode = '42501'; end if;
  if not public.app_is_elevated() then
    raise exception 'You do not have permission to reconcile tyre replacements' using errcode = '42501';
  end if;
  if v_country is not null and lower(v_country) = 'all' then v_country := null; end if;
  if v_country is null then return jsonb_build_object('ok', false, 'reason', 'country_required'); end if;
  v_country := public.normalize_country(v_country);
  if not public.app_can_see_country(v_country) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then return jsonb_build_object('ok', false, 'reason', 'rows_must_be_array'); end if;
  for r in
    select e from jsonb_array_elements(p_rows) e
    where nullif(btrim(coalesce(e->>'removal_date', '')), '') is null
    order by (e->>'issue_date') nulls last
  loop
    begin
      v_res := public._tyre_close_replaced(v_org, v_country, r->>'asset_no', coalesce(r->>'tyre_position', r->>'position'),
        r->>'serial_no', nullif(r->>'issue_date', '')::date,
        public._to_num(r->>'km_at_fitment'), public._to_num(r->>'hrs_at_fitment'), 'erp_intake', v_batch, p_dry_run, false);
      if v_res->>'status' in ('closed', 'no_previous', 'not_applicable', 'would_close') then
        v_moved := v_moved + public._tyre_close_serial_elsewhere(v_org, v_country, r->>'asset_no', r->>'serial_no',
          nullif(r->>'issue_date', '')::date, 'erp_intake', v_batch, p_dry_run);
      end if;
    exception when others then
      v_res := jsonb_build_object('status', 'error', 'message', sqlerrm);
    end;
    v_status := v_res->>'status';
    v_counts := jsonb_set(v_counts, array[v_status], to_jsonb(coalesce((v_counts->>v_status)::int, 0) + 1));
    -- Held rows go to the same admin review list as the staging pipe, in the
    -- staging payload shape so resolve_tyre_import_review can act on them.
    if not p_dry_run and (v_status like 'ambiguous%' or v_status = 'error') then
      insert into public.stg_monthly_tyres_audit(country, organisation_id, action, reason, payload, tyre_record_id)
      values (v_country, v_org, 'rejected', 'replacement_needs_review:' || v_status,
        jsonb_strip_nulls(jsonb_build_object('source', 'erp_intake', 'country', v_country,
          'veh_no', r->>'asset_no', 'tyre_position', coalesce(r->>'tyre_position', r->>'position'),
          'tyre_no', r->>'serial_no', 'tyre_fix_date', r->>'issue_date', 'fixed_km', r->>'km_at_fitment',
          'fixed_hrs', r->>'hrs_at_fitment', 'job_card_no', r->>'job_card', 'veh_type', r->>'vehicle_type',
          'item_tyre', r->>'size', 'brand', r->>'brand')),
        nullif(v_res->>'tyre_id', '')::uuid);
    end if;
    if (v_status like 'ambiguous%' or v_status in ('error', 'same_tyre')) and jsonb_array_length(v_review) < 200 then
      v_review := v_review || jsonb_build_array(jsonb_build_object('asset_no', r->>'asset_no',
        'position', coalesce(r->>'tyre_position', r->>'position'), 'serial_no', r->>'serial_no',
        'issue_date', r->>'issue_date', 'status', v_status));
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'dry_run', p_dry_run, 'batch_id', case when p_dry_run then null else v_batch end,
    'counts', v_counts, 'moved_from_other_vehicle', v_moved, 'review', v_review);
end;
$function$;
revoke all on function public.tyre_import_reconcile(jsonb, text, boolean) from public;
revoke all on function public.tyre_import_reconcile(jsonb, text, boolean) from anon;
grant execute on function public.tyre_import_reconcile(jsonb, text, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 6. One price per tyre on every new fitment row. The incoming price is kept
--    (never thrown away) in extra_fields.repeat_purchase_price so it can be
--    audited; cost_per_tyre stays empty because the tyre is already charged.
-- ---------------------------------------------------------------------
create or replace function public.tyre_one_price_per_tyre()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  if coalesce(new.cost_per_tyre, 0) > 0 and public.tyre_serial_is_strong(new.serial_no)
     and exists (
       select 1 from public.tyre_records e
       where e.organisation_id is not distinct from new.organisation_id
         and coalesce(e.country, '') = coalesce(public.normalize_country(new.country), '')
         and upper(btrim(e.serial_no)) = upper(btrim(new.serial_no))
         and e.cost_per_tyre > 0
         and (public.tyre_size_key_loose(e.size) is null or public.tyre_size_key_loose(new.size) is null
              or public.tyre_size_key_loose(e.size) = public.tyre_size_key_loose(new.size))) then
    new.extra_fields := coalesce(new.extra_fields, '{}'::jsonb)
      || jsonb_build_object('repeat_purchase_price', new.cost_per_tyre,
                            'repeat_purchase_note', 'tyre already priced on an earlier fitment; charged once');
    new.cost_per_tyre := null;
  end if;
  return new;
end;
$function$;
drop trigger if exists trg_zz_one_price_per_tyre on public.tyre_records;
create trigger trg_zz_one_price_per_tyre before insert on public.tyre_records
  for each row execute function public.tyre_one_price_per_tyre();

-- price backfill: the own-job-card rung also respects one price per tyre.
do $do$
declare v_def text;
  a1 text := E'     or (g.work_order_no is not null and g.total_value / g.total_qty > 0)';
  r1 text := E'     or (g.work_order_no is not null and g.total_value / g.total_qty > 0 and not n.refit_of_priced)';
begin
  select pg_get_functiondef('public.tyre_price_backfill'::regproc) into v_def;
  if position('total_qty > 0 and not n.refit_of_priced' in v_def) > 0 then return; end if;
  if (length(v_def) - length(replace(v_def, a1, ''))) / length(a1) <> 1 then
    raise exception 'tyre_price_backfill: own_jobcard anchor not found exactly once'; end if;
  execute replace(v_def, a1, r1);
end $do$;

-- ---------------------------------------------------------------------
-- 7. Admin review of held import rows.
-- ---------------------------------------------------------------------
alter table public.stg_monthly_tyres_audit
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by uuid,
  add column if not exists resolution text;

create or replace function public.list_tyre_import_reviews(p_country text default null, p_include_resolved boolean default false, p_limit int default 500)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare v_org uuid := public.app_current_org();
begin
  if v_org is null or not public.app_is_elevated() then
    raise exception 'You do not have permission to review tyre imports' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(row_to_json(z) order by z.logged_at desc) from (
      select a.id, a.logged_at, a.country, a.reason, a.resolution, a.resolved_at,
             a.payload->>'veh_no' as asset_no, a.payload->>'tyre_position' as position,
             a.payload->>'tyre_no' as serial_no, a.payload->>'tyre_fix_date' as fitment_date,
             a.payload->>'fixed_km' as fitment_km, a.payload->>'job_card_no' as job_card,
             t.serial_no as current_serial, coalesce(t.issue_date, t.fitment_date) as current_fitment_date,
             t.km_at_fitment as current_fitment_km
      from public.stg_monthly_tyres_audit a
      left join public.tyre_records t on t.id = a.tyre_record_id
      where a.reason like 'replacement_needs_review%'
        and coalesce(a.organisation_id, '00000000-0000-0000-0000-000000000001'::uuid) = v_org
        and (p_include_resolved or a.resolved_at is null)
        and (nullif(btrim(coalesce(p_country, '')), '') is null or lower(p_country) = 'all'
             or public.normalize_country(a.country) = public.normalize_country(p_country))
        and (a.country is null or public.app_can_see_country(public.normalize_country(a.country)))
      order by a.logged_at desc
      limit greatest(1, least(coalesce(p_limit, 500), 2000))) z), '[]'::jsonb);
end;
$function$;
revoke all on function public.list_tyre_import_reviews(text, boolean, int) from public;
revoke all on function public.list_tyre_import_reviews(text, boolean, int) from anon;
grant execute on function public.list_tyre_import_reviews(text, boolean, int) to authenticated, service_role;

-- p_action: 'make_current' (latest upload wins: close the tyre on the wheel,
-- fit the uploaded one), 'add_as_history' (record it as a past fitment that
-- ended when the next recorded tyre went on), 'dismiss'.
create or replace function public.resolve_tyre_import_review(p_id bigint, p_action text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_org uuid := public.app_current_org();
  a public.stg_monthly_tyres_audit%rowtype;
  p jsonb; v_country text; v_fd date; v_next date; v_res jsonb; v_batch uuid := gen_random_uuid(); v_id uuid;
begin
  if v_org is null or not public.app_is_elevated() then
    raise exception 'You do not have permission to resolve tyre imports' using errcode = '42501';
  end if;
  select * into a from public.stg_monthly_tyres_audit where id = p_id for update;
  if not found or a.reason not like 'replacement_needs_review%' then
    return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if coalesce(a.organisation_id, '00000000-0000-0000-0000-000000000001'::uuid) <> v_org then
    return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if a.resolved_at is not null then return jsonb_build_object('ok', false, 'reason', 'already_resolved'); end if;
  p := a.payload;
  v_country := public.normalize_country(coalesce(a.country, p->>'country'));
  if v_country is not null and not public.app_can_see_country(v_country) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  v_fd := public.erp_parse_date(p->>'tyre_fix_date');

  if p_action = 'dismiss' then
    null;
  elsif p_action = 'make_current' then
    v_res := public._tyre_close_replaced(v_org, v_country, p->>'veh_no', p->>'tyre_position', p->>'tyre_no',
      v_fd, public._to_num(p->>'fixed_km'), public._to_num(p->>'fixed_hrs'), 'admin_review', v_batch, false, true);
    if v_res->>'status' not in ('closed', 'no_previous') then
      return jsonb_build_object('ok', false, 'reason', v_res->>'status'); end if;
    perform public._tyre_close_serial_elsewhere(v_org, v_country, p->>'veh_no', p->>'tyre_no', v_fd, 'admin_review', v_batch, false);
    insert into public.tyre_records (organisation_id, country, serial_no, asset_no, job_card, vehicle_type, size, position, tyre_position,
       issue_date, km_at_fitment, hrs_at_fitment, status, brand, extra_fields)
    values (v_org, v_country, p->>'tyre_no', p->>'veh_no', p->>'job_card_no', p->>'veh_type', p->>'item_tyre', p->>'tyre_position', p->>'tyre_position',
       v_fd, public._to_num(p->>'fixed_km'), public._to_num(p->>'fixed_hrs'), 'Active', nullif(btrim(p->>'brand'), ''),
       jsonb_build_object('resolved_from_review', p_id))
    returning id into v_id;
  elsif p_action = 'add_as_history' then
    select min(coalesce(t.issue_date, t.fitment_date)) into v_next from public.tyre_records t
    where t.organisation_id = v_org and coalesce(t.country, '') = coalesce(v_country, '')
      and upper(regexp_replace(coalesce(t.asset_no, ''), '\s+', '', 'g')) = upper(regexp_replace(coalesce(p->>'veh_no', ''), '\s+', '', 'g'))
      and upper(btrim(coalesce(t.tyre_position, t.position, ''))) = upper(btrim(coalesce(p->>'tyre_position', '')))
      and coalesce(t.issue_date, t.fitment_date) > v_fd;
    if v_next is null then return jsonb_build_object('ok', false, 'reason', 'no_later_fitment_use_make_current'); end if;
    insert into public.tyre_records (organisation_id, country, serial_no, asset_no, job_card, vehicle_type, size, position, tyre_position,
       issue_date, km_at_fitment, hrs_at_fitment, removal_date, status, brand, extra_fields)
    values (v_org, v_country, p->>'tyre_no', p->>'veh_no', p->>'job_card_no', p->>'veh_type', p->>'item_tyre', p->>'tyre_position', p->>'tyre_position',
       v_fd, public._to_num(p->>'fixed_km'), public._to_num(p->>'fixed_hrs'), v_next, 'Removed', nullif(btrim(p->>'brand'), ''),
       jsonb_build_object('resolved_from_review', p_id, 'removal_inferred_from_next_fitment', true))
    returning id into v_id;
  else
    return jsonb_build_object('ok', false, 'reason', 'unknown_action');
  end if;

  update public.stg_monthly_tyres_audit set resolved_at = now(), resolved_by = auth.uid(), resolution = p_action where id = p_id;
  return jsonb_build_object('ok', true, 'action', p_action, 'tyre_id', v_id, 'batch_id', v_batch);
end;
$function$;
revoke all on function public.resolve_tyre_import_review(bigint, text) from public;
revoke all on function public.resolve_tyre_import_review(bigint, text) from anon;
grant execute on function public.resolve_tyre_import_review(bigint, text) to authenticated, service_role;

create or replace function public.list_tyre_replacement_batches(p_limit int default 50)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare v_org uuid := public.app_current_org();
begin
  if v_org is null or not public.app_is_elevated() then
    raise exception 'You do not have permission to view tyre replacements' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(row_to_json(z) order by z.last_at desc) from (
    select batch_id, source, min(country) as country, count(*) as rows_closed,
           count(*) filter (where undone_at is not null) as rows_undone, max(created_at) as last_at
    from public.tyre_replacement_log where organisation_id = v_org
    group by batch_id, source order by max(created_at) desc
    limit greatest(1, least(coalesce(p_limit, 50), 500))) z), '[]'::jsonb);
end;
$function$;
revoke all on function public.list_tyre_replacement_batches(int) from public;
revoke all on function public.list_tyre_replacement_batches(int) from anon;
grant execute on function public.list_tyre_replacement_batches(int) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 8. One-time KSA corrections (idempotent, logged, reversible).
-- ---------------------------------------------------------------------
do $do$
declare v_batch uuid := gen_random_uuid();
begin
  if exists (select 1 from public.tyre_cost_corrections where reason = 'refit_repeat_purchase_price_cleared') then return; end if;
  create temp table _repeat_price on commit drop as
  with r as (select t.*, upper(btrim(t.serial_no)) s from public.tyre_records t
             where t.country = 'KSA' and t.cost_per_tyre > 0 and public.tyre_serial_is_strong(t.serial_no)),
  x as (select r.*,
          row_number() over (partition by r.organisation_id, r.s order by coalesce(r.issue_date, r.fitment_date) nulls last, r.created_at, r.id) fit_rn,
          first_value(public.tyre_size_key_loose(r.size)) over (partition by r.organisation_id, r.s order by coalesce(r.issue_date, r.fitment_date) nulls last, r.created_at, r.id) first_size
        from r)
  select id, organisation_id, country, serial_no, cost_per_tyre from x
  where fit_rn > 1
    and (first_size is null or public.tyre_size_key_loose(size) is null or public.tyre_size_key_loose(size) = first_size);
  insert into public.tyre_cost_corrections (organisation_id, batch_id, tyre_id, country, serial_no, old_cost, new_cost, reason)
  select organisation_id, v_batch, id, country, serial_no, cost_per_tyre, null, 'refit_repeat_purchase_price_cleared' from _repeat_price;
  update public.tyre_records t set cost_per_tyre = null,
    extra_fields = coalesce(t.extra_fields, '{}'::jsonb) || jsonb_build_object('repeat_purchase_price', f.cost_per_tyre,
      'repeat_purchase_note', 'tyre already priced on an earlier fitment; charged once', 'correction_batch', v_batch)
  from _repeat_price f where t.id = f.id;
end $do$;

do $do$
declare v_batch uuid := gen_random_uuid(); r record; v_n int := 0;
begin
  if exists (select 1 from public.tyre_replacement_log where source = 'serial_two_vehicles_cleanup') then return; end if;
  for r in
    with a as (select t.*, upper(btrim(t.serial_no)) s from public.tyre_records t
               where t.country = 'KSA' and public.tyre_status_is_active(t.status) and public.tyre_serial_is_strong(t.serial_no)),
    g as (select organisation_id, s from a group by 1, 2 having count(distinct upper(regexp_replace(coalesce(asset_no, ''), '\s+', '', 'g'))) > 1),
    x as (select a.*, row_number() over (partition by a.organisation_id, a.s order by coalesce(a.issue_date, a.fitment_date) desc nulls last, a.created_at desc, a.id desc) rn,
                 first_value(coalesce(a.issue_date, a.fitment_date)) over (partition by a.organisation_id, a.s order by coalesce(a.issue_date, a.fitment_date) desc nulls last, a.created_at desc, a.id desc) keep_date,
                 first_value(a.asset_no) over (partition by a.organisation_id, a.s order by coalesce(a.issue_date, a.fitment_date) desc nulls last, a.created_at desc, a.id desc) keep_asset
          from a join g using (organisation_id, s))
    select * from x where rn > 1 and keep_date is not null
  loop
    insert into public.tyre_replacement_log (organisation_id, batch_id, tyre_id, country, asset_no, position, old_serial, new_serial, replaced_on, old_values, new_values, source)
    values (r.organisation_id, v_batch, r.id, r.country, r.asset_no, upper(btrim(coalesce(r.tyre_position, r.position, ''))), r.serial_no, r.serial_no,
      greatest(r.keep_date, coalesce(r.issue_date, r.fitment_date, r.keep_date)),
      jsonb_build_object('removal_date', r.removal_date, 'km_at_removal', r.km_at_removal, 'hrs_at_removal', r.hrs_at_removal,
        'total_km', r.total_km, 'total_hrs', r.total_hrs, 'status', r.status, 'extra_fields', r.extra_fields),
      jsonb_build_object('removal_date', r.keep_date, 'status', 'Removed', 'moved_to_asset', r.keep_asset), 'serial_two_vehicles_cleanup');
    update public.tyre_records t set removal_date = greatest(r.keep_date, coalesce(r.issue_date, r.fitment_date, r.keep_date)), status = 'Removed',
      extra_fields = coalesce(t.extra_fields, '{}'::jsonb) || jsonb_build_object('moved_to_asset', r.keep_asset,
        'replacement_source', 'serial_two_vehicles_cleanup', 'replacement_batch', v_batch)
    where t.id = r.id;
    v_n := v_n + 1;
  end loop;
  raise notice 'closed % older active fitments, batch %', v_n, v_batch;
end $do$;

commit;
