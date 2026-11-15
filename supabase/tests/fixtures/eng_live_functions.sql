-- LIVE function bodies used by the engineering calculation tests (PGlite only).
--
-- Transcribed on 2026-11-12 from pg_get_functiondef() on project jhssdmeruxtrlqnwfksc
-- (SELECT only). These are the definitions the eng_* drafts in
-- supabase/pending_migrations/ patch by anchored replacement, so the tests run
-- the drafts against the same text production holds. If a draft's guard fails
-- here after a later production change, re-read the live definition and update
-- this file; do not loosen the guard.
--
-- Only line endings were normalised (the live bodies of calc_cpk and
-- _tyre_close_replaced carry CRLF).

create or replace function public.tyre_life_km_cap(p_vehicle_type text)
 returns numeric language sql immutable set search_path to 'public'
as $function$
  select case
    when upper(coalesce(p_vehicle_type,'')) like '%MIXER%'  then 80000
    when upper(coalesce(p_vehicle_type,'')) like '%PUMP%'   then 56000
    when upper(coalesce(p_vehicle_type,'')) like '%LOADER%' then 15000
    else 100000
  end::numeric
$function$;

create or replace function public.tyre_km_life(p_fit numeric, p_rem numeric, p_total numeric, p_vehicle_type text)
 returns numeric language sql immutable set search_path to 'public'
as $function$
  select case when v.km is not null and v.km <= public.tyre_life_km_cap(p_vehicle_type) then v.km end
  from (select case
    when p_fit > 1 and p_rem > p_fit then p_rem - p_fit
    when p_fit > 1 and p_total > 0 then p_total
    when p_fit = 1 then null
    when p_fit = 0 and p_total > 0 then p_total
    when p_fit = 0 and p_rem > 0 then p_rem
    when p_fit is null and p_total > 0 then p_total
  end as km) v
$function$;

create or replace function public.calc_cpk(cost numeric, km_fit numeric, km_rem numeric)
 returns numeric language sql immutable set search_path to 'public', 'extensions'
as $function$
  select case
    when km_fit  is not null
     and km_rem  is not null
     and km_rem  >  km_fit
     and cost    is not null
     and cost    >  0
    then round(cost::numeric / (km_rem - km_fit), 4)
    else null
  end
$function$;

create or replace function public.cpk_unit_for_asset_type(p_type text)
 returns text language sql immutable parallel safe
as $function$
  select case
    when lower(coalesce(p_type,'')) similar to
      '%(pump|water|treatment|concrete|batching|plaster|grout|slurry|generator|genset|gen set|compressor|excavator|loader|crane|forklift|dozer|grader|roller)%'
      then 'engine_hours'
    else 'km'
  end;
$function$;

create or replace function public.tyre_price_is_repair(p_text text)
 returns boolean language sql immutable parallel safe set search_path to 'public'
as $function$
  -- Whole-word, because substring matching is what once made "Shell RIMula"
  -- match "rim". Plurals are listed, never implied.
  select coalesce(p_text, '') ~*
    '\y(repair|repairs|repairing|puncture|punctures|patch|patches|patching|vulcaniz\w*|vulcanis\w*|retread|retreads|remould|remold)\y';
$function$;

create or replace function public.tyre_price_is_warranty(p_text text)
 returns boolean language sql immutable parallel safe set search_path to 'public'
as $function$
  select coalesce(p_text, '') ~*
    '\y(warranty|warrantee|guarantee|free of charge|no charge|zero charge|f\.o\.c|foc|replacement claim|under claim)\y';
$function$;

create or replace function public.tyre_cost_line_kind(p_text text)
 returns text language sql immutable parallel safe set search_path to 'public'
as $function$
  select (case
  when public.tyre_price_is_warranty(p_text) then 'warranty'
  when public.tyre_price_is_repair(p_text) then 'repair'
  when p_text ~* '(^|[^a-z])(tyres?|tires?)([^a-z]|$)' and p_text ~* '(^|[^a-z])((inner\s*)?tubes?|flaps?)([^a-z]|$)'
       and p_text ~* '((^|[^a-z])(with|and|incl\w*)([^a-z]|$)|[+&])' then 'mixed'
  when p_text ~* '(^|[^a-z])(inner\s*)?tubes?([^a-z]|$)' then 'tube'
  when p_text ~* '(^|[^a-z])flaps?([^a-z]|$)' then 'flap'
  when p_text ~* '(^|[^a-z])valves?([^a-z]|$)' then 'valve'
  when p_text ~* '(fitting|mounting|dismount|labou?r|service charge|alignment|balanc|installation)'
       and not (p_text ~* '\y\d{3}/\d{2,3}\s*[rz]?\s*\d{2}(\.\d)?\y|\y\d{2}\.\d{1,2}\s*[-r]\s*\d{2}\y|\y1[12]\.?0?0\s*[-r]\s*\d{2}(\.\d)?\y|\y\d{2}\s*[-r]\s*1[68]\.5\y|\y\d{1,2}\.\d{2}\s*r\s*\d{2}\y|\y\d{3}\s*r\s*\d{2}c?\y') then 'service'
  when p_text ~* '(^|[^a-z])(tyres?|tires?)([^a-z]|$)'
       or p_text ~* '\y\d{3}/\d{2,3}\s*[rz]?\s*\d{2}(\.\d)?\y|\y\d{2}\.\d{1,2}\s*[-r]\s*\d{2}\y|\y1[12]\.?0?0\s*[-r]\s*\d{2}(\.\d)?\y|\y\d{2}\s*[-r]\s*1[68]\.5\y|\y\d{1,2}\.\d{2}\s*r\s*\d{2}\y|\y\d{3}\s*r\s*\d{2}c?\y' then 'tyre'
  else 'other' end)
$function$;

create or replace function public.tyre_serial_is_strong(p_serial text)
 returns boolean language sql immutable set search_path to 'public'
as $function$
  select coalesce(
    length(btrim(p_serial)) >= 6
    and upper(btrim(p_serial)) ~ '[0-9]'
    and upper(btrim(p_serial)) !~ '^(DOT|NULL|N/?A|-)'
    and upper(btrim(p_serial)) !~ '^[0-9]{3}/'
    and upper(btrim(p_serial)) !~ '[0-9]{2,3}/[0-9]{2}\s*R'
    and upper(btrim(p_serial)) !~ 'E\+[0-9]+$'
    and upper(btrim(p_serial)) !~ '^(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[- /]?[0-9]{2,4}$'
    and upper(btrim(p_serial)) !~ '^[0-9]{2,3}(\.[0-9]+)?\s*R\s*[0-9]{2}(\.[0-9])?($|[^0-9])'
    and upper(btrim(p_serial)) !~ '[,;&]'
    and upper(btrim(p_serial)) !~ '^([0-9])\1+$'
    and upper(btrim(p_serial)) not in ('123456', '1234567', '12345678', '123456789', '1234567890'),
    false)
$function$;

create or replace function public.tyre_size_key(p text)
 returns text language sql immutable parallel safe
as $function$ select nullif(upper(regexp_replace(coalesce(p,''),'\s+','','g')),'') $function$;

create or replace function public.tyre_status_is_active(p_status text)
 returns boolean language sql immutable set search_path to 'public'
as $function$
  select p_status is not null and btrim(p_status) <> ''
     and lower(p_status) not like '%remov%'
     and lower(p_status) not like '%scrap%'
     and lower(p_status) not like '%written%'
     and lower(p_status) not like '%dispos%';
$function$;

create or replace function public._tyre_close_replaced(p_org uuid, p_country text, p_asset text, p_position text, p_serial text, p_fit_date date, p_fit_km numeric, p_fit_hrs numeric, p_source text, p_batch uuid, p_dry_run boolean default false, p_force boolean default false)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
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
    -- 20261109150000: same day is only "latest wins" when nothing says the
    -- incoming row is older than the tyre already on the wheel.
    if v_prev_date = p_fit_date then
      if v_serial is not null and exists (
        select 1 from public.tyre_records t
        where t.organisation_id is not distinct from p_org and coalesce(t.country, '') = coalesce(p_country, '')
          and upper(regexp_replace(coalesce(t.asset_no, t.asset_number, ''), '\s+', '', 'g')) = v_asset
          and upper(btrim(coalesce(t.tyre_position, t.position, ''))) = v_pos
          and upper(btrim(coalesce(t.serial_no, ''))) = v_serial
          and not public.tyre_status_is_active(t.status)) then
        return jsonb_build_object('status', 'ambiguous_same_day_stale', 'reason', 'serial_already_removed_from_wheel', 'tyre_id', v_prev.id);
      end if;
      if v_serial is not null and exists (
        select 1 from public.tyre_replacement_log l
        where l.organisation_id is not distinct from p_org and coalesce(l.country, '') = coalesce(p_country, '')
          and upper(regexp_replace(coalesce(l.asset_no, ''), '\s+', '', 'g')) = v_asset
          and l.position = v_pos and l.undone_at is null
          and upper(btrim(coalesce(l.old_serial, ''))) = v_serial
          and upper(btrim(coalesce(l.new_serial, ''))) = upper(btrim(coalesce(v_prev.serial_no, '')))) then
        return jsonb_build_object('status', 'ambiguous_same_day_stale', 'reason', 'logged_as_replaced_by_current', 'tyre_id', v_prev.id);
      end if;
      if (p_fit_km > 1 and v_prev.km_at_fitment > 1 and p_fit_km < v_prev.km_at_fitment)
         or (p_fit_hrs > 0 and v_prev.hrs_at_fitment > 0 and p_fit_hrs < v_prev.hrs_at_fitment) then
        return jsonb_build_object('status', 'ambiguous_same_day_stale', 'reason', 'meter_below_current_fitment', 'tyre_id', v_prev.id);
      end if;
    end if;
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

create or replace function public.get_tyre_running_life(p_country text default null::text, p_limit integer default null::integer, p_offset integer default 0, p_asset text default null::text, p_due_only boolean default false)
 returns jsonb language sql stable set search_path to 'public' set plan_cache_mode to 'force_custom_plan'
as $function$
with targets_m as materialized (select size, vehicle_type, country, target_km, target_hours from tyre_life_targets), active as (
  select t.id, t.country, t.site, t.asset_no, t.serial_no, t.tyre_position,
         t.brand, t.size, t.issue_date, t.km_at_fitment,
         f.current_km, coalesce(f.vehicle_type, t.vehicle_type) as vehicle_type
  from tyre_records t
  left join vehicle_fleet f
    on f.country = t.country and f.asset_no = t.asset_no
   and f.organisation_id = t.organisation_id
  where t.status = 'Active'
    and (p_country is null or t.country = p_country)
    -- Pure filter. Asset codes are canonical UPPER (V490), so an exact match is
    -- the whole rule; no normalising, no fuzzy match, no judgement.
    and (p_asset is null or t.asset_no = p_asset)
),
removed as (
  select t.country, t.size, t.total_km,
         coalesce(t.vehicle_type, f.vehicle_type) as vehicle_type,
         case when t.removal_date is not null and t.issue_date is not null
               and t.removal_date > t.issue_date
              then t.removal_date - t.issue_date end as life_days
  from tyre_records t
  left join vehicle_fleet f
    on f.country = t.country and f.asset_no = t.asset_no
   and f.organisation_id = t.organisation_id
  where coalesce(t.status,'') <> 'Active'
    and t.total_km between 1000 and 400000
    and t.size is not null
    and (p_country is null or t.country = p_country)
  -- NOTE: p_asset is deliberately NOT applied here. This is the fleet baseline
  -- the expected life is measured from; narrowing it to one asset would change
  -- that asset's expected life depending on how you asked for it.
),
base_size as (
  select country, public.tyre_size_key(size) as size_key, round(avg(total_km)) as avg_km, count(*) as sample,
         round(avg(life_days)) as avg_days, count(life_days) as day_sample
  from removed group by 1,2
),
base_type as (
  select country, public.tyre_size_key(size) as size_key, vehicle_type, round(avg(total_km)) as avg_km, count(*) as sample,
         round(avg(life_days)) as avg_days, count(life_days) as day_sample
  from removed where vehicle_type is not null group by 1,2,3
),
-- MATERIALIZED IS LOAD-BEARING (V577). Every CTE below this one is referenced exactly
-- once, so Postgres INLINES them, and inlining copies an expression into each place it
-- is referenced. hours_run reads the two correlated engine_hours subqueries 3x each,
-- rem_hours/used_hours_pct read hours_run 5x, and is_due plus the final `select *` read
-- those again - about 16 re-executions of both subqueries per row over 3,518 rows.
-- Barrier here: each subquery runs once per row, everything downstream reads a
-- tuplestore column. 4,675 ms -> 1,177 ms, results byte-identical.
-- DO NOT REMOVE THIS KEYWORD.
enriched as materialized (
  select a.*,
         bs.avg_km as size_avg_km, bs.sample as size_sample,
         bs.avg_days as size_avg_days, bs.day_sample as size_day_sample,
         bt.avg_km as type_avg_km, bt.sample as type_sample,
         bt.avg_days as type_avg_days, bt.day_sample as type_day_sample,
         tg.target_km, tg.target_hours,
         public.cpk_unit_for_asset_type(a.vehicle_type) as unit,
         (select e.engine_hours from engine_hours_logs e
           where e.asset_no = a.asset_no and e.country = a.country
             and a.issue_date is not null and e.reading_date <= a.issue_date
           order by e.reading_date desc limit 1) as hours_at_fitment,
         (select e.engine_hours from engine_hours_logs e
           where e.asset_no = a.asset_no and e.country = a.country
           order by e.reading_date desc limit 1) as current_hours,
         case when a.km_at_fitment is not null and a.km_at_fitment > 1
               and a.current_km is not null and a.current_km > a.km_at_fitment
              then a.current_km - a.km_at_fitment end as km_run,
         case when a.issue_date is not null and a.issue_date <= current_date
              then current_date - a.issue_date end as days_on
  from active a
  left join base_size bs on bs.country = a.country and bs.size_key = public.tyre_size_key(a.size)
  left join base_type bt on bt.country = a.country and bt.size_key = public.tyre_size_key(a.size)
                        and bt.vehicle_type = a.vehicle_type and bt.sample >= 3
  left join lateral (
    select t.target_km, t.target_hours from targets_m t
    where (t.size is null or public.tyre_size_key(t.size) = public.tyre_size_key(a.size))
      and (t.vehicle_type is null or t.vehicle_type = a.vehicle_type)
      and (t.country is null or t.country = a.country)
    order by ((t.size is not null)::int + (t.vehicle_type is not null)::int) desc,
             (t.vehicle_type is not null) desc,
             (t.country is not null) desc
    limit 1
  ) tg on true
),
hours_calc as (
  select e.*,
         case when e.hours_at_fitment is not null and e.current_hours is not null
               and e.current_hours > e.hours_at_fitment
              then round(e.current_hours - e.hours_at_fitment) end as hours_run
  from enriched e
),
final as (
  select e.*,
         coalesce(e.target_km, e.type_avg_km, e.size_avg_km) as expected_km,
         case when e.target_km is not null then 'manual'
              when e.type_avg_km is not null then 'measured_type'
              when e.size_avg_km is not null then 'measured_size' end as life_basis,
         case when e.target_km is not null then null
              when e.type_avg_km is not null then e.type_sample
              else e.size_sample end as life_sample,
         coalesce(e.type_avg_days, e.size_avg_days) as expected_days,
         case when e.type_avg_days is not null then e.type_day_sample else e.size_day_sample end as day_sample
  from hours_calc e
),
-- MIRROR OF bandFor() IN src/lib/tyreRunningLife.js. The three figures below are
-- DUE_SOON_KM 10000 / DUE_SOON_HOURS 500 / LIFE_USED_DUE_PCT 90, exported there
-- as named constants and pinned by src/test/tyreRunningLifeBands.test.js.
-- CHANGE BOTH TOGETHER.
-- Judged on km when there is a km remaining; an hours-only tyre falls through to
-- its hours target. A row with neither is 'unknown' and is NOT due.
judged as (
  select f.*,
         case when f.km_run is not null and f.expected_km is not null
              then greatest(f.expected_km - f.km_run, 0) end as rem_km,
         case when f.km_run is not null and f.expected_km is not null and f.expected_km > 0
              then least(round(f.km_run * 100.0 / f.expected_km), 999) end as used_km_pct,
         case when f.hours_run is not null and f.target_hours is not null
              then greatest(round(f.target_hours - f.hours_run), 0) end as rem_hours,
         case when f.hours_run is not null and f.target_hours is not null and f.target_hours > 0
              then least(round(f.hours_run * 100.0 / f.target_hours), 999) end as used_hours_pct
  from final f
),
banded as (
  select j.*,
         -- WHICHEVER BUDGET RUNS OUT FIRST. Each side is judged against its
         -- own limits and the tyre is due when either is spent; reading one
         -- side first hid every tyre spent on the other. Thresholds mirror
         -- DUE_SOON_KM / DUE_SOON_HOURS / LIFE_USED_DUE_PCT in
         -- src/lib/tyreRunningLife.js - change both together.
         case
           when j.rem_km is null and j.rem_hours is null then false
           else coalesce(j.rem_km = 0 or j.rem_km < least(10000, case when j.expected_km > 0 then j.expected_km * 0.1 else 10000 end)
                         or (j.used_km_pct is not null and j.used_km_pct >= 90), false)
             or coalesce(j.rem_hours = 0 or j.rem_hours < least(500, case when j.target_hours > 0 then j.target_hours * 0.1 else 500 end)
                         or (j.used_hours_pct is not null and j.used_hours_pct >= 90), false)
         end as is_due
  from judged j
),
scoped as (
  select * from banded where (not coalesce(p_due_only, false)) or is_due
)
select jsonb_build_object(
  'ok', true,
  'generated_at', now(),
  'country', p_country,
  'asset', p_asset,
  'due_only', coalesce(p_due_only, false),
  'rows', coalesce((
    select jsonb_agg(jsonb_build_object(
      'serial_no', serial_no,
      'asset_no', asset_no,
      'position', tyre_position,
      'vehicle_type', vehicle_type,
      'unit', unit,
      'site', site,
      'country', country,
      'brand', brand,
      'size', size,
      'fitted_on', issue_date,
      'days_on', days_on,
      'expected_days', expected_days,
      'day_sample', day_sample,
      'remaining_days', case when days_on is not null and expected_days is not null
                             then greatest(expected_days - days_on, 0) end,
      'km_at_fitment', km_at_fitment,
      'current_km', current_km,
      'km_run', km_run,
      'hours_at_fitment', hours_at_fitment,
      'current_hours', current_hours,
      'hours_run', hours_run,
      'expected_life_km', expected_km,
      'expected_life_hours', target_hours,
      'remaining_hours', rem_hours,
      'hours_used_pct', used_hours_pct,
      'life_basis', life_basis,
      'life_sample', life_sample,
      'remaining_km', rem_km,
      'life_used_pct', used_km_pct
    ) order by rem_km asc nulls last, asset_no, tyre_position)
    -- The order lives INSIDE the sliced subquery: ordering only in jsonb_agg
    -- makes page 2 an arbitrary set (the V523 lesson).
    from (select * from scoped
            order by rem_km asc nulls last, asset_no, tyre_position
            limit coalesce(p_limit, 6000) offset coalesce(p_offset, 0)) e), '[]'::jsonb),
  -- total is the count of the FILTERED set, so the client's paging loop stops
  -- at the right place for a filtered read.
  'total', (select count(*) from scoped)
);
$function$;
