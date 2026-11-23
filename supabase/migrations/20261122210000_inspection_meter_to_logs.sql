-- Inspection meter readings reach the vehicle.
--
-- An inspection records odometer_km and hour_meter, but nothing carried them
-- to odometer_logs / engine_hours_logs, so the vehicle's current km (synced by
-- trg_sync_asset_current_km from odometer_logs, country-aware and monotonic)
-- never moved when an inspector read the meter. Found in the 2026-11-22 live
-- function test: a demo inspection at 125,400 km left the vehicle unchanged.
--
-- One log row per inspection and meter, keyed by client_uuid
-- 'inspection:<id>:km' / 'inspection:<id>:hours'. Editing the reading updates
-- that row; it never creates a second one. A lower reading is still written:
-- the existing flag_meter_regression trigger flags it for review, and the sync
-- trigger refuses to lower current_km.
--
-- Fails safe: any error here is swallowed so an inspection save is never
-- blocked by meter logging. No backfill of past inspections (that would move
-- current_km on live vehicles from old readings).
--
-- Rollback:
--   drop trigger if exists trg_inspection_meter_to_logs on public.inspections;
--   drop function if exists public.inspection_meter_to_logs();

create or replace function public.inspection_meter_to_logs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date := coalesce(new.completed_date::date, new.inspection_date::date, current_date);
  v_asset text := nullif(btrim(coalesce(new.asset_no, '')), '');
  v_km_key text := 'inspection:' || new.id::text || ':km';
  v_hr_key text := 'inspection:' || new.id::text || ':hours';
begin
  if v_asset is null then
    return null;
  end if;

  begin
    if new.odometer_km is not null and new.odometer_km > 0
       and (tg_op = 'INSERT' or new.odometer_km is distinct from old.odometer_km) then
      update public.odometer_logs
         set odometer_km = new.odometer_km, reading_date = v_day, updated_at = now()
       where client_uuid = v_km_key;
      if not found then
        insert into public.odometer_logs
          (organisation_id, country, asset_no, odometer_km, reading_date, source, site, notes, created_by, client_uuid)
        values
          (new.organisation_id, new.country, v_asset, new.odometer_km, v_day, 'inspection', new.site,
           'From inspection ' || coalesce(new.title, new.id::text), new.created_by, v_km_key);
      end if;
    end if;

    if new.hour_meter is not null and new.hour_meter > 0
       and (tg_op = 'INSERT' or new.hour_meter is distinct from old.hour_meter) then
      update public.engine_hours_logs
         set engine_hours = new.hour_meter, reading_date = v_day, updated_at = now()
       where client_uuid = v_hr_key;
      if not found then
        insert into public.engine_hours_logs
          (organisation_id, country, asset_no, engine_hours, reading_date, source, site, notes, created_by, client_uuid)
        values
          (new.organisation_id, new.country, v_asset, new.hour_meter, v_day, 'inspection', new.site,
           'From inspection ' || coalesce(new.title, new.id::text), new.created_by, v_hr_key);
      end if;
    end if;
  exception when others then
    raise warning 'inspection_meter_to_logs skipped for inspection %: %', new.id, sqlerrm;
  end;

  return null;
end;
$$;

revoke all on function public.inspection_meter_to_logs() from public;
revoke all on function public.inspection_meter_to_logs() from anon, authenticated;

drop trigger if exists trg_inspection_meter_to_logs on public.inspections;
create trigger trg_inspection_meter_to_logs
  after insert or update of odometer_km, hour_meter on public.inspections
  for each row execute function public.inspection_meter_to_logs();

create index if not exists odometer_logs_client_uuid_idx on public.odometer_logs (client_uuid) where client_uuid is not null;
create index if not exists engine_hours_logs_client_uuid_idx on public.engine_hours_logs (client_uuid) where client_uuid is not null;
