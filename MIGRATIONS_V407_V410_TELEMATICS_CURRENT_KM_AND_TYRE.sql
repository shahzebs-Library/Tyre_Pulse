-- V407-V410 (applied live via Supabase MCP). Bundled here for repo completeness.
-- =====================================================================
-- V407: telematics latest odometer -> odometer_logs (advances vehicle_fleet.current_km
--       through trg_sync_asset_current_km). Snapshot _current_km_snapshot_v407 for undo.
-- Undo: delete from odometer_logs where source='telematics';
--       update vehicle_fleet f set current_km = s.prior_current_km
--         from public._current_km_snapshot_v407 s where f.id = s.id;
create table if not exists public._current_km_snapshot_v407 as
select f.id, f.asset_no, f.country, f.organisation_id, f.current_km prior_current_km
from vehicle_fleet f
where f.country in ('KSA','UAE')
  and exists (select 1 from public.asset_utilization au
    where au.linked_to_fleet and au.odo_end is not null and au.odo_end between 1 and 3000000
      and btrim(au.asset_no)=btrim(f.asset_no) and au.country=f.country
      and au.organisation_id = f.organisation_id);

insert into public.odometer_logs (organisation_id, country, asset_no, odometer_km, reading_date, source, site)
select f.organisation_id, f.country, f.asset_no, au.odo_end, coalesce(au.captured_at, current_date), 'telematics', f.site
from public.asset_utilization au
join vehicle_fleet f
  on btrim(f.asset_no)=btrim(au.asset_no) and f.country=au.country and f.organisation_id=au.organisation_id
where au.linked_to_fleet and au.odo_end is not null and au.odo_end between 1 and 3000000;

-- =====================================================================
-- V408: make the odometer->current_km sync + regression flag COUNTRY-AWARE.
-- The same asset code is a DIFFERENT machine per country (V376); the old trigger
-- matched on asset_no + org only, so a KSA reading cross-wrote UAE fleet rows and
-- vice versa. Also resets the 56 rows that had been cross-contaminated by V407.
create or replace function public.sync_asset_current_km()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if NEW.odometer_km is null or btrim(coalesce(NEW.asset_no,'')) = '' then return NEW; end if;
  update public.vehicle_fleet vf
     set current_km = NEW.odometer_km, updated_at = now()
   where btrim(vf.asset_no) = btrim(NEW.asset_no)
     and vf.organisation_id is not distinct from NEW.organisation_id
     and (NEW.country is null or vf.country is null or lower(btrim(vf.country)) = lower(btrim(NEW.country)))
     and (vf.current_km is null or NEW.odometer_km >= vf.current_km);
  return NEW;
end;
$function$;

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

update public.vehicle_fleet f set current_km = null, updated_at = now()
 where f.country in ('KSA','UAE') and coalesce(f.current_km,0) > 0
   and not exists (select 1 from public.asset_utilization au
                   where btrim(au.asset_no)=btrim(f.asset_no) and au.country=f.country and au.odo_end is not null)
   and exists (select 1 from public.asset_utilization au2
               where btrim(au2.asset_no)=btrim(f.asset_no) and au2.country<>f.country and au2.odo_end is not null);

-- =====================================================================
-- V409: the three raw import landing tables are admin-only. RLS already ON;
-- add elevated-only SELECT and remove the open write grants from authenticated.
do $$
declare t text;
begin
  foreach t in array array['ksa_country_upload_template_staging','ksa_kms','uae_kms'] loop
    execute format('drop policy if exists %I on public.%I', t||'_admin_read', t);
    execute format($f$create policy %I on public.%I for select
      using ((select public.is_super_admin()) or (select public.app_is_org_admin()))$f$, t||'_admin_read', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
  end loop;
end $$;

-- =====================================================================
-- V410: bring the KSA staging tyre-change data fully into tyre_records.
-- 97 genuinely-new active fitments (asset+pos+serial not already present) + fill
-- blank brand/size on existing rows. Non-destructive. Snapshot _bak.tyre_enrich_v410.
-- A row's remove_date describes the REPLACED (old) tyre, not this new one, so all
-- new fitments load Active. Inserts tagged extra_fields->>'import' = 'ksa_staging_v410'.
-- (Full statement body is in the applied migration; DB is the source of truth.)
