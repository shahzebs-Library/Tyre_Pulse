-- F-F-07 - the cross-country expense guard labels its rejects 'country_mismatch'.
--
-- STATUS: APPLIED 2026-11-11. Verified live, rolled back: 69 historical country-mismatch
--   rejects backfilled (0 left unlabelled); a cross-country line (RM* uploaded as KSA) is
--   skipped and labelled reject_reason='country_mismatch' detected_country='UAE', and a
--   matching line (GCKR* uploaded as KSA) still lands. The live guard was the V491 body
--   (no reject_reason), trigger trg_aa_expense_country_guard kept via CREATE OR REPLACE.
--
-- WHY. expense_country_guard() (V491) skips an expense line whose job-card prefix names a
--   different country than it is uploaded under (RM -> UAE, EG -> Egypt, AFKR/GCKR -> KSA),
--   and logs it to expense_import_rejects. The reject_reason column did not exist at V491
--   (it was added by V603), so every country-mismatch reject has reject_reason NULL and is
--   indistinguishable, in the audit table, from a reject that was never labelled. The
--   building guard already writes 'uae_building_non_workshop' and the re-upload guard writes
--   'already_stored'; the country guard should write 'country_mismatch' for the same reason.
--
-- FIX. CREATE OR REPLACE expense_country_guard() with reject_reason = 'country_mismatch' on
--   its INSERT. The body is byte-for-byte the V491 body apart from adding that one column +
--   value. The trigger trg_aa_expense_country_guard already binds to this function name, so
--   CREATE OR REPLACE keeps the binding - the trigger is NOT dropped or recreated (DROP-free)
--   and its load-bearing name (fires first, before the classifier) is preserved. EXECUTE is
--   also revoked from PUBLIC/anon/authenticated (this is a SECURITY DEFINER trigger function
--   that needs no caller EXECUTE grant; V491 left the default PUBLIC grant).

create or replace function public.expense_country_guard() returns trigger
language plpgsql security definer set search_path = public as $$
DECLARE v_detected text;
BEGIN
  IF NEW.work_order_no IS NULL OR NEW.country IS NULL THEN RETURN NEW; END IF;
  v_detected := CASE
    WHEN NEW.work_order_no ~* '^\s*RM' THEN 'UAE'
    WHEN NEW.work_order_no ~* '^\s*EG' THEN 'Egypt'
    WHEN NEW.work_order_no ~* '^\s*(AFKR|GCKR)' THEN 'KSA'
  END;
  IF v_detected IS NULL OR v_detected = NEW.country THEN RETURN NEW; END IF;
  INSERT INTO public.expense_import_rejects
    (organisation_id, uploaded_country, detected_country, reject_reason,
     work_order_no, item_code, item_description, value_amount, source_row)
  VALUES (NEW.organisation_id, NEW.country, v_detected, 'country_mismatch',
          NEW.work_order_no, NEW.item_code, NEW.item_description, NEW.line_cost, NEW.source_row);
  RETURN NULL;  -- skip the row: it belongs to another country's sheet
END; $$;

revoke all on function public.expense_country_guard() from public, anon, authenticated;

-- BACKFILL (~69 rows): stamp the historical country-mismatch rejects. A country-mismatch
--   reject is exactly a row carrying a detected_country that differs from uploaded_country;
--   the building guard writes detected_country NULL and the re-upload guard writes
--   detected_country = uploaded_country, so neither is touched. Safe + idempotent.
update public.expense_import_rejects
   set reject_reason = 'country_mismatch'
 where reject_reason is null
   and detected_country is not null
   and detected_country is distinct from uploaded_country;

-- VERIFY (one rolled-back call):
--   begin;
--     -- 1. a cross-country line is skipped and labelled:
--     insert into public.parts_consumption (country, work_order_no, item_code, value_amount, organisation_id)
--     values ('KSA', 'RM99999', 'ZZ', 1, '00000000-0000-0000-0000-000000000001');  -- 0 rows into parts_consumption
--     select reject_reason, detected_country from public.expense_import_rejects
--      where work_order_no='RM99999' order by created_at desc limit 1;              -- 'country_mismatch', 'UAE'
--     -- 2. a matching line still lands:
--     insert into public.parts_consumption (country, work_order_no, item_code, value_amount, organisation_id)
--     values ('KSA', 'GCKR99999', 'ZZ', 1, '00000000-0000-0000-0000-000000000001'); -- inserted
--   rollback;
--   -- 3. no country-mismatch reject is left unlabelled:
--   select count(*) as unlabelled from public.expense_import_rejects
--    where reject_reason is null and detected_country is not null
--      and detected_country is distinct from uploaded_country;                       -- 0
--
-- ROLLBACK (manual lead action):
--   -- restore the V491 body (reject_reason removed from the INSERT):
--   create or replace function public.expense_country_guard() returns trigger
--   language plpgsql security definer set search_path = public as $b$
--   DECLARE v_detected text;
--   BEGIN
--     IF NEW.work_order_no IS NULL OR NEW.country IS NULL THEN RETURN NEW; END IF;
--     v_detected := CASE
--       WHEN NEW.work_order_no ~* '^\s*RM' THEN 'UAE'
--       WHEN NEW.work_order_no ~* '^\s*EG' THEN 'Egypt'
--       WHEN NEW.work_order_no ~* '^\s*(AFKR|GCKR)' THEN 'KSA' END;
--     IF v_detected IS NULL OR v_detected = NEW.country THEN RETURN NEW; END IF;
--     INSERT INTO public.expense_import_rejects
--       (organisation_id, uploaded_country, detected_country, work_order_no, item_code, item_description, value_amount, source_row)
--     VALUES (NEW.organisation_id, NEW.country, v_detected, NEW.work_order_no, NEW.item_code, NEW.item_description, NEW.line_cost, NEW.source_row);
--     RETURN NULL;
--   END; $b$;
--   -- (the backfilled reject_reason values can be left; they are correct.)
