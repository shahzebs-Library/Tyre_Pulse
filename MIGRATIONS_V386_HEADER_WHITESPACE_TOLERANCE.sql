-- V386. Header whitespace must never block or silently drop an import.
--
-- After V385 added the eleven missing columns, the importer STILL reported
-- "Job Card Created By" and "Job Card Created Date" as absent, while the other
-- nine matched. Both existed verbatim (verified: 19 and 21 characters, no
-- padding), so the file's version of exactly those two had to differ by
-- characters the error message does not render. They are the last two columns
-- in the export, which is where trailing whitespace collects, and Excel emits a
-- non-breaking space (U+00A0) that is indistinguishable on screen from a space.
--
-- Two halves to the fix:
--   1. Tolerant COLUMNS, so the CSV import is accepted at all. Supabase matches
--      the literal header, so each variant needs a real column.
--   2. Tolerant READING, so the value actually lands somewhere. This is the part
--      that cannot be done by listing variants: a function body cannot contain
--      an invisible character reliably. The pipe now looks each field up by
--      NORMALISED header name, so any casing or whitespace difference works,
--      including variants nobody has seen yet.

-- ---------------------------------------------------------------------------
-- REVERTED: the tolerant-COLUMN half of this migration.
--
-- The variant columns below were added, and the import STILL failed with the
-- same two headers. I then brute-forced every space / non-breaking-space / tab
-- / zero-width combination, which grew stg_job_cards to 946 columns and STILL
-- did not match. That was the wrong approach: guessing at bytes I cannot see,
-- at the cost of a table the customer browses. All variant columns were dropped
-- and the table is back to its 46 real columns.
--
-- WHAT REMAINS AND IS WORTH KEEPING is the tolerant-READING half: _stg_pick
-- below, and process_stg_job_cards reading every field through it. That is
-- genuinely useful and is unaffected by the revert - if a variant column ever
-- does exist, its value is still read correctly.
--
-- THE REAL CONSTRAINT: Supabase's Table Editor requires the column name to
-- match the CSV header byte for byte. No amount of server-side tolerance can
-- satisfy that for a header whose bytes are unknown. The fix is on the file
-- side - delete or retype the two offending headers - or send the header row so
-- the exact bytes can be read and one correct column added.
--
-- Kept here, commented out, as the record of what was tried and why it failed.
--
-- do $mig$ ... variant column generation ... end $mig$;
-- ---------------------------------------------------------------------------

-- Read a staging column by header NAME, ignoring case and any whitespace
-- difference. This is what makes the fix general: listing variants by literal
-- identifier cannot cover a non-breaking space, because the function body would
-- have to contain the invisible character itself.
create or replace function public._stg_pick(p_row jsonb, p_key text)
returns text language sql immutable set search_path to 'public' as $fn$
  select nullif(btrim(kv.value), '')
    from jsonb_each_text(p_row) as kv(key, value)
   where lower(btrim(regexp_replace(replace(kv.key, chr(160), ' '), '\s+', ' ', 'g')))
       = lower(btrim(regexp_replace(replace(p_key,  chr(160), ' '), '\s+', ' ', 'g')))
     and nullif(btrim(kv.value), '') is not null
   limit 1;
$fn$;

comment on function public._stg_pick(jsonb, text) is
  'Read a staging column by header name, ignoring case and any whitespace difference (including the non-breaking space Excel leaves behind).';

-- The pipe, rewritten to read EVERY field through the normalising picker, so no
-- header difference can block an import or silently drop a value again.
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
    coalesce(v_prod_out, v_ws_in), v_ws_in, v_ws_out, v_target,
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
