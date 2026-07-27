-- V381. Job card intake: the customer's own "Format job card" export, importable
-- straight from the Supabase Table Editor.
--
-- This export is richer than anything the system loaded before. Beyond the job
-- card itself it carries the FULL availability cycle - Production Out, Workshop
-- In, Workshop Out, Production In - which is what turns a maintenance log into
-- real downtime measurement: time waiting for the workshop is the gap between
-- Production Out and Workshop In, and time under repair is Workshop In to
-- Workshop Out. Nothing in the app could distinguish those before.

-- ---------------------------------------------------------------------------
-- 1. The columns the cycle needs. Everything else the export carries that has
--    no analytical use lands in custom_data rather than widening the table.
-- ---------------------------------------------------------------------------
alter table public.work_orders
  add column if not exists rfr_no            text,
  add column if not exists production_out_at timestamptz,
  add column if not exists production_in_at  timestamptz,
  add column if not exists plate_no          text,
  add column if not exists asset_category    text,
  add column if not exists work_location     text,
  add column if not exists scope             text,
  add column if not exists source_row        text;

comment on column public.work_orders.production_out_at is
  'When the asset left production. Start of unavailability, not of repair.';
comment on column public.work_orders.production_in_at is
  'When the asset returned to production. NULL means it has not come back.';

create index if not exists work_orders_production_out_idx
  on public.work_orders (organisation_id, country, production_out_at desc);
create index if not exists work_orders_opened_day_idx
  on public.work_orders (organisation_id, country, opened_at desc);

-- ---------------------------------------------------------------------------
-- 2. Staging table. Headers are the export's own, VERBATIM, including the
--    spacing and the "Excepted"/"STD. Hours" spellings, so the Table Editor CSV
--    import maps every column by itself with nothing to click.
-- ---------------------------------------------------------------------------
create table if not exists public.stg_job_cards (
  id uuid primary key default gen_random_uuid(),
  country                    text,
  "#"                        text,
  "RFR Number"               text,
  "Job Card No"              text,
  "MR NO"                    text,
  "SCO NO"                   text,
  "Location"                 text,
  "Status"                   text,
  "Type"                     text,
  "Work Location"            text,
  "Production Complaint"     text,
  "Job Repair Description"   text,
  "Asset Code"               text,
  "Asset Description"        text,
  "Plate No"                 text,
  "Truck Category"           text,
  "Head/Tail"                text,
  "Scope"                    text,
  "Asset Category"           text,
  "Excepted Job Date/Time"   text,
  "Production Out"           text,
  "Workshop In"              text,
  "Workshop Out"             text,
  "Production In"            text,
  "Total Breakdown hours"    text,
  "STD. Hours"               text,
  "Spare Parts"              text,
  "Tyre"                     text,
  "Oil"                      text,
  "Others"                   text,
  created_at timestamptz not null default now()
);

alter table public.stg_job_cards enable row level security;

drop policy if exists stg_job_cards_org_isolation on public.stg_job_cards;
create policy stg_job_cards_org_isolation on public.stg_job_cards
  as restrictive for all to authenticated
  using ((select public.app_current_org()) is not null or (select public.is_super_admin()))
  with check ((select public.app_current_org()) is not null or (select public.is_super_admin()));

drop policy if exists stg_job_cards_write on public.stg_job_cards;
create policy stg_job_cards_write on public.stg_job_cards
  for all to authenticated
  using ((select public.app_is_elevated()))
  with check ((select public.app_is_elevated()));

revoke all on public.stg_job_cards from anon;
grant select, insert on public.stg_job_cards to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The pipe. Maps, guards and routes each row into work_orders, then returns
--    NULL so staging stays empty - the same pattern as every other stg_ table.
-- ---------------------------------------------------------------------------
create or replace function public.process_stg_job_cards()
returns trigger language plpgsql security definer set search_path to 'public' as $$
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
  v_extra    jsonb;
begin
  -- a row with no job card number identifies nothing
  if v_jc is null then return null; end if;
  -- the ERP export carries a footer band; erp_is_footer already knows its shapes
  if public.erp_is_footer(coalesce(NEW."RFR Number", '') || ' ' || v_jc) then return null; end if;

  v_prod_out := public.erp_parse_ts(NEW."Production Out");
  v_ws_in    := public.erp_parse_ts(NEW."Workshop In");
  v_ws_out   := public.erp_parse_ts(NEW."Workshop Out");
  v_prod_in  := public.erp_parse_ts(NEW."Production In");
  v_target   := public.erp_parse_ts(NEW."Excepted Job Date/Time");

  -- Status: the export's vocabulary already matches the CHECK for Closed and
  -- Cancelled; anything else that is not recognised is left Open rather than
  -- guessed into a terminal state.
  v_status := initcap(btrim(coalesce(NEW."Status", '')));
  if v_status not in ('Open','In Progress','Awaiting Parts','Completed','Closed','Cancelled') then
    v_status := case when v_prod_in is not null or v_ws_out is not null
                     then 'Completed' else 'Open' end;
  end if;

  -- Type: mapped into the existing vocabulary so this export does not fragment
  -- it, with the ERP's own wording preserved in custom_data. Break Down maps to
  -- Emergency because that is what an unplanned stoppage is; losing the
  -- breakdown-versus-scheduled split would remove the single most useful
  -- maintenance signal in the file.
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

  -- BREAKDOWN HOURS: the export's own figure counts to NOW when the card never
  -- closed, so an asset out since 2022 reads 40,028 hours. Verified against the
  -- data: for a closed card the figure is exactly Production Out to Workshop
  -- Out, and for an open one it is Production Out to today. Importing that
  -- verbatim would put a four year "downtime" into every average, so it is only
  -- taken when the card actually closed. The raw value is kept in custom_data.
  v_closed := (v_prod_in is not null or v_ws_out is not null);
  v_bd := case when v_closed then public._to_num(NEW."Total Breakdown hours") end;

  -- Reference-only figures. THE EXPENSE GRID IS THE COST SOURCE (see
  -- PROJECT_MEMORY): these four columns are the ERP's own view and are stored
  -- for reconciliation, deliberately NOT written to labour_cost/parts_cost,
  -- which would both change every existing workshop figure and create a second
  -- competing cost source.
  v_extra := jsonb_strip_nulls(jsonb_build_object(
    'erp_reported_cost', jsonb_strip_nulls(jsonb_build_object(
        'spare_parts', public._to_num(NEW."Spare Parts"),
        'tyre',        public._to_num(NEW."Tyre"),
        'oil',         public._to_num(NEW."Oil"),
        'others',      public._to_num(NEW."Others"))),
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
    breakdown_hours, standard_hours, custom_data)
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
    v_bd, public._to_num(NEW."STD. Hours"), v_extra)
  on conflict (work_order_no) do update set
    -- A job card is a living record: re-importing the export REFRESHES it in
    -- place rather than stacking a copy, so the file can be uploaded as often
    -- as the customer likes. This is what makes the daily view current.
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
    custom_data       = coalesce(work_orders.custom_data, '{}'::jsonb) || excluded.custom_data,
    updated_at        = now();

  return null;  -- pure pipe: staging never stores
end $$;

drop trigger if exists trg_process_stg_job_cards on public.stg_job_cards;
create trigger trg_process_stg_job_cards
  before insert on public.stg_job_cards
  for each row execute function public.process_stg_job_cards();
