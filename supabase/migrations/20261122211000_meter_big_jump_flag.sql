-- Flag big meter jumps in the logs (owner request, 2026-11-22).
--
-- flag_meter_regression already flagged:
--   * odometer: an "implausible" reading (3x current and +20,000 km) - held,
--     not applied to the vehicle;
--   * both meters: a reading below the previous one (regression) - accepted,
--     flagged for review.
-- It did not flag a reading that rose faster than the vehicle can travel or
-- run. This adds that check against the asset's previous reading and its date:
--   * odometer: more than the daily limit per day on average AND more than the
--     daily limit in total. The limit is system_config 'meter_max_km_per_day'
--     (default 500 km, owner 2026-11-22: 1,000+ a day is not realistic);
--   * hour meter: more hours than calendar time allows (24 h per day, plus 2 h
--     for readings taken at different times of day), when more than 24 h.
-- These are accepted and flagged ("Big jump: ..."), so a real long gap does not
-- stall the vehicle's km, and a reviewer sees it in the meter log review.
-- Existing rules and their wording are unchanged.
--
-- Rollback: re-create the previous body (in git history of this function).

create or replace function public.flag_meter_regression()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_prev numeric; v_new numeric; v_unit text;
  v_last numeric; v_last_day date; v_day date; v_days numeric; v_rate numeric;
  v_max_km numeric;
begin
  begin
    if btrim(coalesce(NEW.asset_no,'')) = '' then return NEW; end if;
    v_day := coalesce(NEW.reading_date, current_date);

    if TG_TABLE_NAME = 'odometer_logs' then
      v_new := NEW.odometer_km; v_unit := 'km';
      if v_new is null then return NEW; end if;
      select vf.current_km into v_prev from public.vehicle_fleet vf
        where btrim(vf.asset_no) = btrim(NEW.asset_no)
          and vf.organisation_id is not distinct from NEW.organisation_id
          and (NEW.country is null or vf.country is null or lower(btrim(vf.country)) = lower(btrim(NEW.country)))
        limit 1;
      if (v_prev is not null and v_prev > 0 and v_new > v_prev * 3 and v_new > v_prev + 20000)
         or (v_prev is null and v_new > 2000000) then
        NEW.flagged := true; NEW.flagged_prev_reading := v_prev;
        NEW.flag_reason := format('Implausible reading (likely an extra digit): %s km against current %s km for asset %s. Saved, not used for the fleet odometer, pending admin review.',
          v_new, coalesce(v_prev::text, 'none'), btrim(NEW.asset_no));
        NEW.reviewed := false; NEW.reviewed_by := null; NEW.reviewed_at := null;
        return NEW;
      end if;
      -- Previous accepted reading for the time-based check.
      select o.odometer_km, o.reading_date into v_last, v_last_day
        from public.odometer_logs o
       where btrim(o.asset_no) = btrim(NEW.asset_no)
         and o.organisation_id is not distinct from NEW.organisation_id
         and (NEW.country is null or o.country is null or lower(btrim(o.country)) = lower(btrim(NEW.country)))
         and o.odometer_km is not null
         and o.id is distinct from NEW.id
         and not (coalesce(o.flagged, false) and coalesce(o.flag_reason, '') like 'Implausible reading%')
         and coalesce(o.reading_date, current_date) <= v_day
       order by o.reading_date desc nulls last, o.created_at desc
       limit 1;
      if v_last is not null and v_new > v_last then
        v_days := greatest(1, v_day - coalesce(v_last_day, v_day));
        v_rate := (v_new - v_last) / v_days;
        begin
          select nullif(btrim(value::text, '" '), '')::numeric into v_max_km
            from public.system_config where key = 'meter_max_km_per_day';
        exception when others then v_max_km := null;
        end;
        v_max_km := coalesce(v_max_km, 500);
        if v_new - v_last > v_max_km and v_rate > v_max_km then
          NEW.flagged := true; NEW.flagged_prev_reading := v_last;
          NEW.flag_reason := format('Big jump: +%s km in %s day(s) (about %s km a day) for asset %s, previous reading %s km. Accepted, pending admin review.',
            round(v_new - v_last), v_days, round(v_rate), btrim(NEW.asset_no), v_last);
          NEW.reviewed := false; NEW.reviewed_by := null; NEW.reviewed_at := null;
          return NEW;
        end if;
      end if;

    elsif TG_TABLE_NAME = 'engine_hours_logs' then
      v_new := NEW.engine_hours; v_unit := 'hrs';
      if v_new is null then return NEW; end if;
      select e.engine_hours, e.reading_date into v_prev, v_last_day from public.engine_hours_logs e
        where btrim(e.asset_no) = btrim(NEW.asset_no)
          and e.organisation_id is not distinct from NEW.organisation_id
          and e.engine_hours is not null
          and e.id is distinct from NEW.id
          and coalesce(e.reading_date, current_date) <= v_day
        order by e.reading_date desc nulls last, e.created_at desc limit 1;
      if v_prev is not null and v_new > v_prev then
        v_days := greatest(1, v_day - coalesce(v_last_day, v_day));
        if v_new - v_prev > 24 and v_new - v_prev > v_days * 24 + 2 then
          NEW.flagged := true; NEW.flagged_prev_reading := v_prev;
          NEW.flag_reason := format('Big jump: +%s hrs in %s day(s), more than the hours in that time, for asset %s, previous reading %s hrs. Accepted, pending admin review.',
            round(v_new - v_prev, 1), v_days, btrim(NEW.asset_no), v_prev);
          NEW.reviewed := false; NEW.reviewed_by := null; NEW.reviewed_at := null;
          return NEW;
        end if;
      end if;
    else
      return NEW;
    end if;

    if v_prev is not null and v_new < v_prev then
      NEW.flagged := true; NEW.flagged_prev_reading := v_prev;
      NEW.flag_reason := format('Meter regression: reading %s %s is below current %s %s for asset %s. Accepted, pending admin review.',
        v_new, v_unit, v_prev, v_unit, btrim(NEW.asset_no));
      NEW.reviewed := false; NEW.reviewed_by := null; NEW.reviewed_at := null;
    end if;
    return NEW;
  exception when others then return NEW;
  end;
end;
$function$;
