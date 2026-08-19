-- V603 — UAE upload rule: a non-workshop "BUILDINGS" expense row is not ours, so
-- do not add it on import. STATUS: APPLIED LIVE on jhssdmeruxtrlqnwfksc.
--
-- WHY. UAE parts_consumption carries asset_type='BUILDINGS'. Some of those rows
-- are the fleet WORKSHOPS (DP027 Jabal Ali / DP030 Baniyas / DP024 Musafah -
-- parts issued for vehicle repair, legitimately ours). The rest are real
-- buildings and department overhead (HSE, QC, Diesel, Production) that are not
-- fleet expenses. Session 2026-08-19 deleted 481 such live rows (AED 734,018.53);
-- this stops the next UAE upload re-adding them.
--
-- THE RULE. On INSERT, skip a row when country is UAE AND asset_type is
-- BUILDING(S) AND its asset_description does NOT name a WORKSHOP. The skipped row
-- is logged to expense_import_rejects (reason 'uae_building_non_workshop') so a
-- vanished line is auditable, exactly like the V491 cross-country guard.
--
-- ORDER IS LOAD-BEARING. Named trg_ab_ so it fires AFTER trg_aa_expense_country_
-- guard and BEFORE trg_classify_parts_consumption: returning NULL here stops the
-- classifier ever running for a row that is being dropped, so brain_cache is not
-- written for a skipped row (the V491 lesson).
--
-- SCOPE. UAE only, matching the owner instruction and leaving KSA/Egypt (where
-- BUILDINGS may mean something else or not exist) untouched. Matches BUILDING and
-- BUILDINGS, case/space-insensitive.
--
-- ROLLBACK: drop trigger trg_ab_uae_building_guard on public.parts_consumption;
--           drop function public.expense_building_guard();

ALTER TABLE public.expense_import_rejects ADD COLUMN IF NOT EXISTS reject_reason text;

CREATE OR REPLACE FUNCTION public.expense_building_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF upper(btrim(coalesce(NEW.country,''))) = 'UAE'
     AND upper(btrim(coalesce(NEW.asset_type,''))) IN ('BUILDINGS','BUILDING')
     AND upper(coalesce(NEW.asset_description,'')) NOT LIKE '%WORKSHOP%'
  THEN
    INSERT INTO public.expense_import_rejects
      (organisation_id, uploaded_country, detected_country, reject_reason,
       work_order_no, item_code, item_description, value_amount, source_row)
    VALUES (NEW.organisation_id, NEW.country, NULL, 'uae_building_non_workshop',
            NEW.work_order_no, NEW.item_code, NEW.item_description, NEW.line_cost, NEW.source_row);
    RETURN NULL;  -- skip: a non-workshop building is not a fleet expense
  END IF;
  RETURN NEW;
END; $function$;

DROP TRIGGER IF EXISTS trg_ab_uae_building_guard ON public.parts_consumption;
CREATE TRIGGER trg_ab_uae_building_guard
  BEFORE INSERT ON public.parts_consumption
  FOR EACH ROW EXECUTE FUNCTION public.expense_building_guard();
