-- MIGRATIONS_V419_STG_JOBCARD_OPENED_AT_FALLBACK.sql
--
-- Standing open item: a job card with NO Production Out AND NO Workshop In
-- aborts the whole CSV batch.
--
-- `work_orders.opened_at` is `timestamptz NOT NULL DEFAULT now()`. The staging
-- pipe `process_stg_job_cards` derives it as `coalesce(v_prod_out, v_ws_in)` and
-- puts it in the EXPLICIT column list. When a card carries neither timestamp that
-- expression is NULL, and an explicit NULL into a NOT NULL column raises inside
-- the per-row BEFORE INSERT trigger, aborting the entire `stg_job_cards` import
-- transaction at zero rows. This is the server-side twin of the JS bug already
-- fixed in src/lib/erpIntake.js (mapCombined / mapComplaints OMIT the key when
-- blank so the column default applies).
--
-- FIX: one token - add a `now()` fallback so the derived opened_at is never NULL,
-- exactly what the column default and the already-fixed JS mapper both produce
-- for a genuinely undated card:
--     coalesce(v_prod_out, v_ws_in)        ->  coalesce(v_prod_out, v_ws_in, now())
--
-- The ON CONFLICT branch already coalesces (`opened_at = coalesce(excluded.opened_at,
-- work_orders.opened_at)`) so only the fresh INSERT needed the guard. The typed
-- production_out_at / production_in_at columns are nullable and correctly stay NULL.
--
-- The body below reproduces the LIVE V386 definition verbatim (the last version
-- applied, which reads every field through _stg_pick) with only that single token
-- changed. This migration also closes the repo-vs-DB drift for this function
-- (V386's body was applied via execute_sql and this is its committed copy).
--
-- ===========================================================================
-- STATUS: AUTHORED, NOT YET APPLIED.
-- Apply + a rolled-back live test are REQUIRED before this is considered done;
-- they need a Supabase-MCP-authorized session against project jhssdmeruxtrlqnwfksc.
-- A blind CREATE OR REPLACE of an ~11k-char function must be proven live, not
-- assumed (see the V402 lesson: guard a subtle behaviour change with a real test).
--
-- MIGRATION NUMBER: V417 and V418 are RESERVED by the accident-module design
-- (docs/accident-module/02_DATA_MODEL.sql / 08_ENGINE_SQL_MIRROR.sql). This fix
-- takes V419. Re-confirm the next free number against supabase_migrations at apply
-- time; renumber if the accident migrations landed first.
--
-- VERIFY (rolled back), once DB access is restored:
--   1. Insert one stg_job_cards row with a valid Job Card No + country but BLANK
--      Production Out AND Workshop In. Pre-fix: fails with
--      `null value in column "opened_at" ... violates not-null constraint`.
--   2. Apply this migration.
--   3. Re-insert step 1's row: succeeds, routes to work_orders with
--      opened_at = now(), production_out_at IS NULL, production_in_at IS NULL,
--      custom_data->>'still_open' = 'true'; stg_job_cards left empty (returns NULL).
--   4. Regression: a card WITH a Production Out keeps opened_at = that timestamp
--      (fallback not triggered); a card with only Workshop In gets opened_at =
--      Workshop In; a mixed batch with one both-null card imports ALL rows.
--
-- ROLLBACK: re-apply the V386 body (this file minus the `, now()` token).
-- ===========================================================================

create or replace function public.process_stg_job_cards()
returns trigger language plpgsql security definer set search_path to 'public' as $fn$
declare
  j jsonb := to_jsonb(NEW);
  v_org uuid := coalesce(public.app_current_org(), '00000000-0000-0000-0000-000000000001'::uuid);
  v_country text := public._stg_pick(j, 'country');
  v_jc      text := public._stg_pick(j, 'Job Card No');
  v_prod_out timestamptz; v_ws_in timestamptz; v_ws_out timestamptz;
  v_prod_in timestamptz; v_target timestamptz;
  v_status text; v_type text; v_bd numeric; v_closed boolean;
  v_wait_p numeric; v_wait_m numeric; v_mp_hrs numeric; v_extra jsonb;
begin
  if v_jc is null then return null; end if;
  if public.erp_is_footer(coalesce(public._stg_pick(j,'RFR Number'),'') || ' ' || v_jc) then return null; end if;

  v_prod_out := public.erp_parse_ts(public._stg_pick(j,'Production Out'));
  v_ws_in    := public.erp_parse_ts(public._stg_pick(j,'Workshop In'));
  v_ws_out   := public.erp_parse_ts(public._stg_pick(j,'Workshop Out'));
  v_prod_in  := public.erp_parse_ts(public._stg_pick(j,'Production In'));
  v_target   := public.erp_parse_ts(public._stg_pick(j,'Excepted Job Date/Time'));

  v_status := initcap(coalesce(public._stg_pick(j,'Status'),''));
  if v_status not in ('Open','In Progress','Awaiting Parts','Completed','Closed','Cancelled') then
    v_status := case when v_prod_in is not null or v_ws_out is not null then 'Completed' else 'Open' end;
  end if;

  v_type := lower(coalesce(public._stg_pick(j,'Type'),''));
  v_type := case
    when v_type like '%break%'   then 'Emergency'
    when v_type like '%schedul%' then 'Preventive Maintenance'
    when v_type like '%general%' or v_type like '%repair%' then 'Repair'
    when v_type like '%servic%'  then 'Service'
    when v_type like '%tyre%' or v_type like '%tire%' then 'Tyre Change'
    when v_type like '%inspect%' then 'Inspection'
    else 'Other' end;

  -- open cards report hours that run to today; only a closed card's are final
  v_closed := (v_prod_in is not null or v_ws_out is not null);
  v_bd     := case when v_closed then public._to_num(public._stg_pick(j,'Total Breakdown hours')) end;
  v_wait_p := case when v_closed then coalesce(
                 public._to_num(public._stg_pick(j,'Waiting Part Hrs')),
                 public._to_num(public._stg_pick(j,'Waiting Parts Hrs'))) end;
  v_wait_m := case when v_closed then coalesce(
                 public._to_num(public._stg_pick(j,'Waiting Manpower Hrs')),
                 public._to_num(public._stg_pick(j,'Waiting Manpower Hours'))) end;
  v_mp_hrs := case when v_closed then coalesce(
                 public._to_num(public._stg_pick(j,'Manpower H')),
                 public._to_num(public._stg_pick(j,'Manpower Hrs'))) end;

  v_extra := jsonb_strip_nulls(jsonb_build_object(
    'erp_reported_cost', jsonb_strip_nulls(jsonb_build_object(
        'spare_parts',  public._to_num(public._stg_pick(j,'Spare Parts')),
        'tyre',         public._to_num(public._stg_pick(j,'Tyre')),
        'oil',          public._to_num(public._stg_pick(j,'Oil')),
        'others',       public._to_num(public._stg_pick(j,'Others')),
        'manpower',     public._to_num(public._stg_pick(j,'Manpower Cost')),
        'total_parts',  public._to_num(public._stg_pick(j,'Total Parts Consumption')),
        'total_repair', public._to_num(public._stg_pick(j,'Total Repair Cost')))),
    'erp_hours', jsonb_strip_nulls(jsonb_build_object(
        'breakdown',        public._to_num(public._stg_pick(j,'Total Breakdown hours')),
        'waiting_parts',    coalesce(public._to_num(public._stg_pick(j,'Waiting Part Hrs')),
                                     public._to_num(public._stg_pick(j,'Waiting Parts Hrs'))),
        'waiting_manpower', coalesce(public._to_num(public._stg_pick(j,'Waiting Manpower Hrs')),
                                     public._to_num(public._stg_pick(j,'Waiting Manpower Hours'))),
        'manpower',         coalesce(public._to_num(public._stg_pick(j,'Manpower H')),
                                     public._to_num(public._stg_pick(j,'Manpower Hrs'))))),
    'raised_by', public._stg_pick(j,'RFR Created By'),
    'raised_at', public._stg_pick(j,'RFR Created Date'),
    'card_by',   public._stg_pick(j,'Job Card Created By'),
    'card_at',   public._stg_pick(j,'Job Card Created Date'),
    'erp_type',            public._stg_pick(j,'Type'),
    'erp_breakdown_hours', public._to_num(public._stg_pick(j,'Total Breakdown hours')),
    'still_open',          not v_closed,
    'mr_no',               public._stg_pick(j,'MR NO'),
    'sco_no',              public._stg_pick(j,'SCO NO'),
    'asset_description',   public._stg_pick(j,'Asset Description'),
    'truck_category',      public._stg_pick(j,'Truck Category'),
    'head_tail',           public._stg_pick(j,'Head/Tail')));

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
    public._stg_pick(j,'RFR Number'),
    public._stg_pick(j,'#'),
    upper(public._stg_pick(j,'Asset Code')),
    public._stg_pick(j,'Plate No'),
    public._stg_pick(j,'Asset Category'),
    public._stg_pick(j,'Location'),
    public._stg_pick(j,'Work Location'),
    public._stg_pick(j,'Scope'),
    v_status, v_type,
    public._stg_pick(j,'Production Complaint'),
    public._stg_pick(j,'Job Repair Description'),
    coalesce(v_prod_out, v_ws_in, now()), v_ws_in, v_ws_out, v_target,
    v_prod_out, v_prod_in,
    v_bd, public._to_num(public._stg_pick(j,'STD. Hours')),
    v_wait_p, v_wait_m, v_mp_hrs, v_extra)
  on conflict (work_order_no) do update set
    country = excluded.country, rfr_no = excluded.rfr_no, source_row = excluded.source_row,
    asset_no = coalesce(excluded.asset_no, work_orders.asset_no),
    plate_no = coalesce(excluded.plate_no, work_orders.plate_no),
    asset_category = coalesce(excluded.asset_category, work_orders.asset_category),
    site = coalesce(excluded.site, work_orders.site),
    work_location = coalesce(excluded.work_location, work_orders.work_location),
    scope = coalesce(excluded.scope, work_orders.scope),
    status = excluded.status, work_type = excluded.work_type,
    description = coalesce(excluded.description, work_orders.description),
    notes = coalesce(excluded.notes, work_orders.notes),
    opened_at = coalesce(excluded.opened_at, work_orders.opened_at),
    started_at = coalesce(excluded.started_at, work_orders.started_at),
    completed_at = coalesce(excluded.completed_at, work_orders.completed_at),
    target_completion = coalesce(excluded.target_completion, work_orders.target_completion),
    production_out_at = coalesce(excluded.production_out_at, work_orders.production_out_at),
    production_in_at = coalesce(excluded.production_in_at, work_orders.production_in_at),
    breakdown_hours = excluded.breakdown_hours,
    standard_hours = coalesce(excluded.standard_hours, work_orders.standard_hours),
    waiting_parts_hours = excluded.waiting_parts_hours,
    waiting_manpower_hours = excluded.waiting_manpower_hours,
    manpower_hours = excluded.manpower_hours,
    custom_data = coalesce(work_orders.custom_data,'{}'::jsonb) || excluded.custom_data,
    updated_at = now();

  return null;  -- pure pipe: staging never stores
end $fn$;
