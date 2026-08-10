-- V490 - ASSET CODES: ALL CAPS, NO WHITESPACE, EVERYWHERE
-- STATUS: APPLIED LIVE 2026-08-10 (project jhssdmeruxtrlqnwfksc) via execute_sql.
--
-- WHY: uploads write asset codes with internal spaces ("TM 685", "ALEC 1"), and
-- the V337 normalizer only did upper(btrim()) - internal whitespace survived, so
-- utilization/production rows silently failed to match the fleet register
-- (asset_utilization: 83 of 556 rows unlinked purely from spacing).
--
-- WHAT:
-- 1. normalize_asset_no() + normalize_asset_code() now strip ALL whitespace:
--      upper(regexp_replace(x, '\s+', '', 'g'))
-- 2. trg_normalize_asset_no attached to the upload tables that never had it:
--      asset_utilization, production_logs, odometer_logs, engine_hours_logs
-- 3. Backfill of every stored value containing whitespace (5,693 rows):
--      production_logs 5,586 | asset_utilization 83 | parts_consumption.asset_code 17
--      work_orders 5 | vehicle_fleet 2 ("TM 245" Egypt renamed; the spaced twin
--      whose stripped form already existed was DELETED as a derived duplicate)
--    Snapshot: _bak.asset_no_space_fix_20260810 (tbl, id, old_value).
--
-- VERIFIED: 0 whitespace asset codes remain across the 5 tables;
-- asset_utilization fleet linkage 402 -> 550 of 556; KSA parts_consumption
-- total unchanged (the 17 asset_code rows re-ran the classifier deterministically).
--
-- ROLLBACK: restore old values from _bak.asset_no_space_fix_20260810 per table
-- and re-apply the V337 function bodies (upper(btrim())).

create or replace function public.normalize_asset_no() returns trigger
language plpgsql as $$
BEGIN
  IF NEW.asset_no IS NOT NULL THEN
    NEW.asset_no := upper(regexp_replace(NEW.asset_no, '\s+', '', 'g'));
    IF NEW.asset_no = '' THEN NEW.asset_no := NULL; END IF;
  END IF;
  RETURN NEW;
END; $$;

create or replace function public.normalize_asset_code() returns trigger
language plpgsql as $$
BEGIN
  IF NEW.asset_code IS NOT NULL THEN
    NEW.asset_code := upper(regexp_replace(NEW.asset_code, '\s+', '', 'g'));
    IF NEW.asset_code = '' THEN NEW.asset_code := NULL; END IF;
  END IF;
  RETURN NEW;
END; $$;

drop trigger if exists trg_normalize_asset_no on public.asset_utilization;
create trigger trg_normalize_asset_no before insert or update of asset_no
  on public.asset_utilization for each row execute function public.normalize_asset_no();
drop trigger if exists trg_normalize_asset_no on public.production_logs;
create trigger trg_normalize_asset_no before insert or update of asset_no
  on public.production_logs for each row execute function public.normalize_asset_no();
drop trigger if exists trg_normalize_asset_no on public.odometer_logs;
create trigger trg_normalize_asset_no before insert or update of asset_no
  on public.odometer_logs for each row execute function public.normalize_asset_no();
drop trigger if exists trg_normalize_asset_no on public.engine_hours_logs;
create trigger trg_normalize_asset_no before insert or update of asset_no
  on public.engine_hours_logs for each row execute function public.normalize_asset_no();
