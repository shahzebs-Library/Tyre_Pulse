-- 20261111107000_odometer_typo_guard
-- Found checking the 2026-11-10 phone meter readings. A reading typed with an extra digit
-- (TM611 990,726,629 km; MP095 7,805,419,205 km; TM393 22,014,121,747 km ...) was synced to
-- vehicle_fleet.current_km. The sync only ever moves FORWARD, so every correct reading after
-- it was refused and flagged as a "regression": 12 KSA vehicles were stuck on an impossible
-- odometer, and tyre running life (km run = current_km - fitment km) was wrong for them.
--
-- 1. Data: for vehicles with >= 10 readings whose current_km is above both 1.5x and
--    median+50,000 of their own readings AND above 1,000,000 km, current_km is reset to the
--    latest plausible reading; the outlier log rows are flagged for admin review (never deleted).
--    Snapshot: _bak.odometer_typo_20261111 (fleet id, old current_km) + _bak.odometer_typo_logs_20261111.
-- 2. Guard: flag_meter_regression now also flags an IMPLAUSIBLE JUMP (> 3x the current km and
--    > +20,000 km, or a first reading above 2,000,000 km), and sync_asset_current_km does not
--    move the fleet odometer on such a reading. It is still saved, flagged, pending review.
-- Rollback: restore current_km from the snapshot; re-apply the previous function bodies.

create table if not exists _bak.odometer_typo_20261111 as
with s as (
  select asset_no, country, percentile_cont(0.5) within group (order by odometer_km::numeric) med, count(*) n
    from public.odometer_logs group by 1, 2)
select v.id, v.asset_no, v.country, v.current_km as old_km, s.med,
       (select o.odometer_km from public.odometer_logs o
         where o.asset_no = v.asset_no and o.country = v.country and o.odometer_km <= s.med * 1.5
         order by o.reading_date desc, o.created_at desc limit 1) as new_km
  from public.vehicle_fleet v join s on s.asset_no = v.asset_no and s.country = v.country
 where s.n >= 10 and v.current_km > 1000000 and v.current_km > greatest(s.med * 1.5, s.med + 50000);

create table if not exists _bak.odometer_typo_logs_20261111 as
select o.id, o.flagged, o.flag_reason, o.reviewed
  from public.odometer_logs o join _bak.odometer_typo_20261111 b on b.asset_no = o.asset_no and b.country = o.country
 where o.odometer_km > greatest(b.med * 1.5, b.med + 50000);

update public.vehicle_fleet v set current_km = b.new_km, updated_at = now()
  from _bak.odometer_typo_20261111 b where b.id = v.id and b.new_km is not null;

update public.odometer_logs o
   set flagged = true, reviewed = false,
       flag_reason = 'Implausible reading (likely an extra digit): ' || o.odometer_km || ' km against a usual ' || round(b.med) || ' km. Not used for the fleet odometer.'
  from _bak.odometer_typo_20261111 b
 where b.asset_no = o.asset_no and b.country = o.country
   and o.odometer_km > greatest(b.med * 1.5, b.med + 50000);

create or replace function public.flag_meter_regression()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare v_prev numeric; v_new numeric; v_unit text;
begin
  begin
    if btrim(coalesce(NEW.asset_no,'')) = '' then return NEW; end if;
    if TG_TABLE_NAME = 'odometer_logs' then
      v_new := NEW.odometer_km; v_unit := 'km';
      if v_new is null then return NEW; end if;
      select vf.current_km into v_prev from public.vehicle_fleet vf
        where btrim(vf.asset_no) = btrim(NEW.asset_no)
          and vf.organisation_id is not distinct from NEW.organisation_id
          and (NEW.country is null or vf.country is null or lower(btrim(vf.country)) = lower(btrim(NEW.country)))
        limit 1;
      -- An extra digit is not a journey: never let it become the fleet odometer.
      if (v_prev is not null and v_prev > 0 and v_new > v_prev * 3 and v_new > v_prev + 20000)
         or (v_prev is null and v_new > 2000000) then
        NEW.flagged := true; NEW.flagged_prev_reading := v_prev;
        NEW.flag_reason := format('Implausible reading (likely an extra digit): %s km against current %s km for asset %s. Saved, not used for the fleet odometer, pending admin review.',
          v_new, coalesce(v_prev::text, 'none'), btrim(NEW.asset_no));
        NEW.reviewed := false; NEW.reviewed_by := null; NEW.reviewed_at := null;
        return NEW;
      end if;
    elsif TG_TABLE_NAME = 'engine_hours_logs' then
      v_new := NEW.engine_hours; v_unit := 'hrs';
      if v_new is null then return NEW; end if;
      select e.engine_hours into v_prev from public.engine_hours_logs e
        where btrim(e.asset_no) = btrim(NEW.asset_no)
          and e.organisation_id is not distinct from NEW.organisation_id
          and e.engine_hours is not null
        order by e.reading_date desc nulls last, e.created_at desc limit 1;
    else return NEW; end if;
    if v_prev is not null and v_new < v_prev then
      NEW.flagged := true; NEW.flagged_prev_reading := v_prev;
      NEW.flag_reason := format('Meter regression: reading %s %s is below current %s %s for asset %s. Accepted, pending admin review.',
        v_new, v_unit, v_prev, v_unit, btrim(NEW.asset_no));
      NEW.reviewed := false; NEW.reviewed_by := null; NEW.reviewed_at := null;
    end if;
    return NEW;
  exception when others then return NEW;
  end;
end; $function$;

create or replace function public.sync_asset_current_km()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if NEW.odometer_km is null or btrim(coalesce(NEW.asset_no,'')) = '' then
    return NEW;
  end if;
  if coalesce(NEW.flagged, false) and coalesce(NEW.flag_reason, '') like 'Implausible reading%' then
    return NEW;
  end if;
  update public.vehicle_fleet vf
     set current_km = NEW.odometer_km, updated_at = now()
   where btrim(vf.asset_no) = btrim(NEW.asset_no)
     and vf.organisation_id is not distinct from NEW.organisation_id
     and (NEW.country is null or vf.country is null
          or lower(btrim(vf.country)) = lower(btrim(NEW.country)))
     and (vf.current_km is null or NEW.odometer_km >= vf.current_km);
  return NEW;
end;
$function$;

-- 3. Correct readings that were flagged "Meter regression" ONLY because the previous value was
--    the typo are unflagged (applied as odometer_typo_false_regressions).
--    Snapshot: _bak.odometer_false_regression_20261111.
create table if not exists _bak.odometer_false_regression_20261111 as
select o.id, o.flagged, o.flag_reason, o.flagged_prev_reading, o.reviewed
  from public.odometer_logs o join _bak.odometer_typo_20261111 b on b.asset_no = o.asset_no and b.country = o.country
 where o.flagged and o.flag_reason like 'Meter regression%'
   and o.flagged_prev_reading > greatest(b.med * 1.5, b.med + 50000)
   and o.odometer_km <= b.med * 1.5;
update public.odometer_logs o
   set flagged = false, flag_reason = null, flagged_prev_reading = null
  from _bak.odometer_false_regression_20261111 f where f.id = o.id;
