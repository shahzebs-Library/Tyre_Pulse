-- V385. The real job card export carries 11 more columns than the sample.
--
-- Supabase refuses an import when a CSV header has no matching column, so every
-- one has to exist even if it carries nothing analytical. The names below are
-- VERBATIM from the export, including "Manpower H" and the ERP's internal
-- "JCD_ML_hidden10", because the importer matches on the literal header.
--
-- The two that matter are Waiting Part Hrs and Waiting Manpower Hrs. They split
-- waiting time by CAUSE - no part versus no technician - which the four
-- timestamps cannot do on their own: those give the length of the wait, these
-- give the reason for it. That is the difference between "the mixer waited 26
-- hours" and "the mixer waited 26 hours for a part", which is a procurement
-- problem rather than a workshop one.

alter table public.stg_job_cards
  add column if not exists "Waiting Part Hrs"        text,
  add column if not exists "Waiting Manpower Hrs"    text,
  add column if not exists "Manpower H"              text,
  add column if not exists "Manpower Cost"           text,
  add column if not exists "Total Parts Consumption" text,
  add column if not exists "Total Repair Cost"       text,
  add column if not exists "JCD_ML_hidden10"         text,
  add column if not exists "RFR Created By"          text,
  add column if not exists "RFR Created Date"        text,
  add column if not exists "Job Card Created By"     text,
  add column if not exists "Job Card Created Date"   text;

-- Tolerate the other spellings the same field appears under, so an export that
-- says "Manpower Hrs" or "Waiting Parts Hrs" imports without another migration.
alter table public.stg_job_cards
  add column if not exists "Manpower Hrs"        text,
  add column if not exists "Waiting Parts Hrs"   text,
  add column if not exists "Waiting Manpower Hours" text;

alter table public.work_orders
  add column if not exists waiting_parts_hours    numeric,
  add column if not exists waiting_manpower_hours numeric,
  add column if not exists manpower_hours         numeric;

comment on column public.work_orders.waiting_parts_hours is
  'Hours the job sat waiting for a part. A procurement signal, not a workshop one.';
comment on column public.work_orders.waiting_manpower_hours is
  'Hours the job sat waiting for a technician. A scheduling signal.';

create or replace function public.process_stg_job_cards()
returns trigger language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_org      uuid := coalesce(public.app_current_org(), '00000000-0000-0000-0000-000000000001'::uuid);
  v_country  text := nullif(btrim(coalesce(NEW.country, '')), '');
  v_jc       text := nullif(btrim(coalesce(NEW."Job Card No", '')), '');
  v_prod_out timestamptz;
  v_ws_in    timestamptz;
  v_ws_out   timestamptz;
  v_prod_in  timestamptz;
  v_target   timestamptz;
  v_status   text;
  v_type     text;
  v_bd       numeric;
  v_closed   boolean;
  v_wait_p   numeric;
  v_wait_m   numeric;
  v_mp_hrs   numeric;
  v_extra    jsonb;
begin
  if v_jc is null then return null; end if;
  if public.erp_is_footer(coalesce(NEW."RFR Number", '') || ' ' || v_jc) then return null; end if;

  v_prod_out := public.erp_parse_ts(NEW."Production Out");
  v_ws_in    := public.erp_parse_ts(NEW."Workshop In");
  v_ws_out   := public.erp_parse_ts(NEW."Workshop Out");
  v_prod_in  := public.erp_parse_ts(NEW."Production In");
  v_target   := public.erp_parse_ts(NEW."Excepted Job Date/Time");

  v_status := initcap(btrim(coalesce(NEW."Status", '')));
  if v_status not in ('Open','In Progress','Awaiting Parts','Completed','Closed','Cancelled') then
    v_status := case when v_prod_in is not null or v_ws_out is not null
                     then 'Completed' else 'Open' end;
  end if;

  v_type := lower(btrim(coalesce(NEW."Type", '')));
  v_type := case
    when v_type like '%break%'    then 'Emergency'
    when v_type like '%schedul%'  then 'Preventive Maintenance'
    when v_type like '%general%'
      or v_type like '%repair%'   then 'Repair'
    when v_type like '%servic%'   then 'Service'
    when v_type like '%tyre%'
      or v_type like '%tire%'     then 'Tyre Change'
    when v_type like '%inspect%'  then 'Inspection'
    when v_type = ''              then 'Other'
    else 'Other' end;

  v_closed := (v_prod_in is not null or v_ws_out is not null);
  v_bd := case when v_closed then public._to_num(NEW."Total Breakdown hours") end;

  -- The same guard as breakdown hours, for the same reason. That figure was
  -- PROVEN on this data to count to today for a card that never closed (an
  -- asset out since 2022 read 40,028 hours). These waiting figures come from
  -- the same report and the sample file did not carry them, so there was no way
  -- to measure whether they behave the same. Populating the typed columns only
  -- for a closed card keeps a running total out of every average; the raw value
  -- is kept below either way, so nothing is lost and an open card can still be
  -- read from custom_data.
  v_wait_p := case when v_closed then
      coalesce(public._to_num(NEW."Waiting Part Hrs"), public._to_num(NEW."Waiting Parts Hrs")) end;
  v_wait_m := case when v_closed then
      coalesce(public._to_num(NEW."Waiting Manpower Hrs"), public._to_num(NEW."Waiting Manpower Hours")) end;
  v_mp_hrs := case when v_closed then
      coalesce(public._to_num(NEW."Manpower H"), public._to_num(NEW."Manpower Hrs")) end;

  -- Cost stays reference-only. THE EXPENSE GRID IS THE COST SOURCE: writing
  -- these to labour_cost/parts_cost would move every existing workshop figure
  -- and create a second competing source.
  v_extra := jsonb_strip_nulls(jsonb_build_object(
    'erp_reported_cost', jsonb_strip_nulls(jsonb_build_object(
        'spare_parts',   public._to_num(NEW."Spare Parts"),
        'tyre',          public._to_num(NEW."Tyre"),
        'oil',           public._to_num(NEW."Oil"),
        'others',        public._to_num(NEW."Others"),
        'manpower',      public._to_num(NEW."Manpower Cost"),
        'total_parts',   public._to_num(NEW."Total Parts Consumption"),
        'total_repair',  public._to_num(NEW."Total Repair Cost"))),
    'erp_hours', jsonb_strip_nulls(jsonb_build_object(
        'breakdown',        public._to_num(NEW."Total Breakdown hours"),
        'waiting_parts',    coalesce(public._to_num(NEW."Waiting Part Hrs"), public._to_num(NEW."Waiting Parts Hrs")),
        'waiting_manpower', coalesce(public._to_num(NEW."Waiting Manpower Hrs"), public._to_num(NEW."Waiting Manpower Hours")),
        'manpower',         coalesce(public._to_num(NEW."Manpower H"), public._to_num(NEW."Manpower Hrs")))),
    'raised_by',   nullif(btrim(coalesce(NEW."RFR Created By", '')), ''),
    'raised_at',   nullif(btrim(coalesce(NEW."RFR Created Date", '')), ''),
    'card_by',     nullif(btrim(coalesce(NEW."Job Card Created By", '')), ''),
    'card_at',     nullif(btrim(coalesce(NEW."Job Card Created Date", '')), ''),
    'erp_type',              nullif(btrim(coalesce(NEW."Type", '')), ''),
    'erp_breakdown_hours',   public._to_num(NEW."Total Breakdown hours"),
    'still_open',            not v_closed,
    'mr_no',                 nullif(btrim(coalesce(NEW."MR NO", '')), ''),
    'sco_no',                nullif(btrim(coalesce(NEW."SCO NO", '')), ''),
    'asset_description',     nullif(btrim(coalesce(NEW."Asset Description", '')), ''),
    'truck_category',        nullif(btrim(coalesce(NEW."Truck Category", '')), ''),
    'head_tail',             nullif(btrim(coalesce(NEW."Head/Tail", '')), '')));

  insert into public.work_orders (
    organisation_id, country, work_order_no, rfr_no, source_row,
    asset_no, plate_no, asset_category, site, work_location, scope,
    status, work_type, description, notes,
    opened_at, started_at, completed_at, target_completion,
    production_out_at, production_in_at,
    breakdown_hours, standard_hours,
    waiting_parts_hours, waiting_manpower_hours, manpower_hours, custom_data)
  values (
    v_org, v_country, v_jc,
    nullif(btrim(coalesce(NEW."RFR Number", '')), ''),
    nullif(btrim(coalesce(NEW."#", '')), ''),
    nullif(upper(btrim(coalesce(NEW."Asset Code", ''))), ''),
    nullif(btrim(coalesce(NEW."Plate No", '')), ''),
    nullif(btrim(coalesce(NEW."Asset Category", '')), ''),
    nullif(btrim(coalesce(NEW."Location", '')), ''),
    nullif(btrim(coalesce(NEW."Work Location", '')), ''),
    nullif(btrim(coalesce(NEW."Scope", '')), ''),
    v_status, v_type,
    nullif(btrim(coalesce(NEW."Production Complaint", '')), ''),
    nullif(btrim(coalesce(NEW."Job Repair Description", '')), ''),
    coalesce(v_prod_out, v_ws_in), v_ws_in, v_ws_out, v_target,
    v_prod_out, v_prod_in,
    v_bd, public._to_num(NEW."STD. Hours"),
    v_wait_p, v_wait_m, v_mp_hrs, v_extra)
  on conflict (work_order_no) do update set
    country           = excluded.country,
    rfr_no            = excluded.rfr_no,
    source_row        = excluded.source_row,
    asset_no          = coalesce(excluded.asset_no, work_orders.asset_no),
    plate_no          = coalesce(excluded.plate_no, work_orders.plate_no),
    asset_category    = coalesce(excluded.asset_category, work_orders.asset_category),
    site              = coalesce(excluded.site, work_orders.site),
    work_location     = coalesce(excluded.work_location, work_orders.work_location),
    scope             = coalesce(excluded.scope, work_orders.scope),
    status            = excluded.status,
    work_type         = excluded.work_type,
    description       = coalesce(excluded.description, work_orders.description),
    notes             = coalesce(excluded.notes, work_orders.notes),
    opened_at         = coalesce(excluded.opened_at, work_orders.opened_at),
    started_at        = coalesce(excluded.started_at, work_orders.started_at),
    completed_at      = coalesce(excluded.completed_at, work_orders.completed_at),
    target_completion = coalesce(excluded.target_completion, work_orders.target_completion),
    production_out_at = coalesce(excluded.production_out_at, work_orders.production_out_at),
    production_in_at  = coalesce(excluded.production_in_at, work_orders.production_in_at),
    breakdown_hours   = excluded.breakdown_hours,
    standard_hours    = coalesce(excluded.standard_hours, work_orders.standard_hours),
    waiting_parts_hours    = excluded.waiting_parts_hours,
    waiting_manpower_hours = excluded.waiting_manpower_hours,
    manpower_hours         = excluded.manpower_hours,
    custom_data       = coalesce(work_orders.custom_data, '{}'::jsonb) || excluded.custom_data,
    updated_at        = now();

  return null;  -- pure pipe: staging never stores
end $fn$;
