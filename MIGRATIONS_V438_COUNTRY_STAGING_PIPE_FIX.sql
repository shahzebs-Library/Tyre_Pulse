-- =====================================================================
-- V438 - FIX COUNTRY-NAMED STAGING ROUTES
-- =====================================================================
-- Country staging tables intentionally omit `country`. A later organisation
-- scoping change tried to assign NEW.country before returning, which raises
-- `record "new" has no field "country"` and rolls back the forwarded insert.
-- Stamp country/org only on the JSON sent to the shared staging table, then
-- return NULL so the country table remains an insert-only routing surface.

create or replace function public._stg_country_pipe()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_country text := tg_argv[0];
  v_target  text := tg_argv[1];
  v_row     jsonb;
  v_org     uuid;
begin
  v_org := public.app_current_org();

  if v_org is null then
    select o.id
      into v_org
    from public.organisations o
    where o.country = v_country
    order by o.created_at asc
    limit 1;
  end if;

  if v_org is null then
    raise exception 'No organisation_id resolved for country %', v_country;
  end if;

  v_row := (to_jsonb(new) - 'id' - 'created_at' - 'organisation_id')
           || jsonb_build_object('country', v_country, 'organisation_id', v_org);

  -- Monthly-tyre country tables accept either canonical API columns or the
  -- ERP's original quoted headers. Read through JSON so this generic trigger
  -- remains valid for every other country staging table as well.
  if v_target = 'stg_monthly_tyres' then
    v_row := v_row || jsonb_build_object(
      'job_card_no', coalesce(v_row ->> 'job_card_no', v_row ->> 'Job Card No.'),
      'job_card_date', coalesce(v_row ->> 'job_card_date', v_row ->> 'Job Card Date'),
      'veh_no', coalesce(v_row ->> 'veh_no', v_row ->> 'VEH.NO'),
      'veh_type', coalesce(v_row ->> 'veh_type', v_row ->> 'VEH TYPE/CATEGORY'),
      'item_tyre', coalesce(v_row ->> 'item_tyre', v_row ->> 'ITEM/TYRE'),
      'tyre_position', coalesce(v_row ->> 'tyre_position', v_row ->> 'TYRE POSITION'),
      'tyre_no', coalesce(v_row ->> 'tyre_no', v_row ->> 'TYRE No.'),
      'tyre_fix_date', coalesce(v_row ->> 'tyre_fix_date', v_row ->> 'TYRE FIX DATE'),
      'fixed_km', coalesce(v_row ->> 'fixed_km', v_row ->> 'FIXED KM'),
      'fixed_hrs', coalesce(v_row ->> 'fixed_hrs', v_row ->> 'FIXED HRS'),
      'tyre_removed_date', coalesce(v_row ->> 'tyre_removed_date', v_row ->> 'TYRE REMOVED DATE'),
      'removed_km', coalesce(v_row ->> 'removed_km', v_row ->> 'REMOVED KM'),
      'removed_hrs', coalesce(v_row ->> 'removed_hrs', v_row ->> 'REMOVED HRS'),
      'reason', coalesce(v_row ->> 'reason', v_row ->> 'REASON'),
      'total_km', coalesce(v_row ->> 'total_km', v_row ->> 'TOTAL KM '),
      'total_hrs', coalesce(v_row ->> 'total_hrs', v_row ->> 'TOTAL HRS')
    );
  end if;

  execute format(
    'insert into public.%I select * from jsonb_populate_record(null::public.%I, $1)',
    v_target, v_target
  ) using v_row;

  return null;
end
$function$;

comment on function public._stg_country_pipe() is
  'V438: stamps country and organisation into the forwarded base-staging row, then returns NULL. Never assigns fields omitted from the country table.';
