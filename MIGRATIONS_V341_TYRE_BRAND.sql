-- =============================================================================
-- MIGRATIONS_V341_TYRE_BRAND.sql  (as applied)
-- Carry the tyre BRAND through the tyre-load pipeline, and backfill the already
-- loaded UAE/Egypt tyres (whose brand column was NULL) from their source files.
--
-- Part A (applied): add `brand` to stg_monthly_tyres and map it into
-- tyre_records.brand on insert. The process_stg_monthly_tyres() body is the
-- current version verbatim (reversed fit/remove correction + fingerprint dedup
-- preserved); only the brand column was added to the INSERT.
--
-- Part B (applied via a tiny staging table, NOT a giant VALUES block): a
-- stg_tyre_brand(country, serial, brand) staging table whose BEFORE INSERT
-- trigger UPDATEs tyre_records.brand where blank (matched per country +
-- lower(serial)) then RETURN NULL. A generated tyre_brand_backfill.csv
-- (country, serial, brand from UAE.xlsx/EGY.xlsx) is imported into it. This
-- avoids committing thousands of data rows into the repo.
-- =============================================================================

-- Part A -----------------------------------------------------------------------
ALTER TABLE public.stg_monthly_tyres ADD COLUMN IF NOT EXISTS brand text;

CREATE OR REPLACE FUNCTION public.process_stg_monthly_tyres()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  rd date; fd date; tmp_d date;
  fkm numeric; rkm numeric; fhr numeric; rhr numeric; tmp_n numeric;
begin
  if public.erp_is_footer(NEW.job_card_no) or public.erp_is_footer(NEW.veh_no) then return null; end if;
  if coalesce(btrim(NEW.tyre_no),'')='' and coalesce(btrim(NEW.veh_no),'')='' then return null; end if;
  fd  := public.erp_parse_date(NEW.tyre_fix_date);
  rd  := public.erp_parse_date(NEW.tyre_removed_date);
  fkm := public._to_num(NEW.fixed_km);   rkm := public._to_num(NEW.removed_km);
  fhr := public._to_num(NEW.fixed_hrs);  rhr := public._to_num(NEW.removed_hrs);
  if fd is not null and rd is not null and rd < fd then tmp_d:=fd; fd:=rd; rd:=tmp_d; end if;
  if fkm is not null and rkm is not null and rkm < fkm then tmp_n:=fkm; fkm:=rkm; rkm:=tmp_n; end if;
  if fhr is not null and rhr is not null and rhr < fhr then tmp_n:=fhr; fhr:=rhr; rhr:=tmp_n; end if;
  if NEW.tyre_no is not null and exists (
     select 1 from public.tyre_records t
     where lower(btrim(t.serial_no)) = lower(btrim(NEW.tyre_no))
       and t.country is not distinct from NEW.country
       and t.issue_date is not distinct from fd
       and coalesce(lower(btrim(t.job_card)),'') = coalesce(lower(btrim(NEW.job_card_no)),'')
       and coalesce(lower(btrim(t.position)),'') = coalesce(lower(btrim(NEW.tyre_position)),'')
  ) then return null; end if;
  insert into public.tyre_records
    (country, serial_no, asset_no, job_card, vehicle_type, size, position, tyre_position,
     issue_date, km_at_fitment, hrs_at_fitment, removal_date, km_at_removal, hrs_at_removal,
     total_km, total_hrs, removal_reason, status, brand, extra_fields)
  values (NEW.country, NEW.tyre_no, NEW.veh_no, NEW.job_card_no, NEW.veh_type, NEW.item_tyre,
     NEW.tyre_position, NEW.tyre_position, fd, fkm, fhr, rd, rkm, rhr,
     public._to_num(NEW.total_km), public._to_num(NEW.total_hrs),
     NEW.reason, case when rd is not null then 'Removed' else 'Active' end,
     nullif(btrim(NEW.brand),''),
     jsonb_strip_nulls(jsonb_build_object('job_card',NEW.job_card_no,'fixed_km',NEW.fixed_km,'removed_km',NEW.removed_km,'reason',NEW.reason)));
  return null;
end; $function$;

-- Part B: staging table for the brand backfill CSV -----------------------------
CREATE TABLE IF NOT EXISTS public.stg_tyre_brand (
  id bigserial PRIMARY KEY, country text, serial text, brand text
);
ALTER TABLE public.stg_tyre_brand ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stg_tyre_brand_rw ON public.stg_tyre_brand;
CREATE POLICY stg_tyre_brand_rw ON public.stg_tyre_brand AS RESTRICTIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.process_stg_tyre_brand()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  if coalesce(btrim(NEW.serial),'')='' or coalesce(btrim(NEW.brand),'')='' then return null; end if;
  update public.tyre_records t
     set brand = btrim(NEW.brand)
   where t.country is not distinct from NEW.country
     and lower(btrim(t.serial_no)) = lower(btrim(NEW.serial))
     and (t.brand is null or t.brand = '');
  return null;
end; $function$;

DROP TRIGGER IF EXISTS trg_process_stg_tyre_brand ON public.stg_tyre_brand;
CREATE TRIGGER trg_process_stg_tyre_brand BEFORE INSERT ON public.stg_tyre_brand
  FOR EACH ROW EXECUTE FUNCTION public.process_stg_tyre_brand();
