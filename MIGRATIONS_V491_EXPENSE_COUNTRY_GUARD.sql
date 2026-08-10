-- V491 - EXPENSE COUNTRY GUARD: a mixed expense file can never cross countries again
-- STATUS: APPLIED LIVE 2026-08-10 (project jhssdmeruxtrlqnwfksc) via apply_migration
-- (v491_expense_country_guard) + a follow-up rename of the trigger so it fires FIRST.
--
-- WHY: the KSA August expense file uploaded 2026-08-08 07:50 UTC ("ERP grid import",
-- one 32-second window) contained 886 UAE lines (RM job cards). They landed under
-- country='KSA' with SAR currency - the exact contamination corrected in
-- _bak.expense_fix_20260810 (211 deleted duplicates + 675 moved to UAE/AED).
-- The data loaded before 1 Aug was never mixed; the mix arrived with that one file.
--
-- CONTRACT (measured 2026-08-10, 201,861 rows with a job card, ZERO conflicts):
--   work_order_no prefix AFKR/GCKR = KSA, RM = UAE, EG = Egypt.
--
-- WHAT: BEFORE INSERT trigger on parts_consumption. A row whose job-card prefix
-- contradicts the country it is being uploaded under is SKIPPED (never inserted)
-- and logged to public.expense_import_rejects (org RLS + elevated read; writes only
-- via the DEFINER trigger). Unknown prefixes pass through untouched (fail-open).
-- Covers EVERY path - the staging pipes AND the in-app ERP grid import - because
-- everything lands in parts_consumption.
--
-- TRIGGER NAME IS LOAD-BEARING: trg_aa_expense_country_guard - BEFORE triggers fire
-- alphabetically and this must run BEFORE trg_classify_parts_consumption, or the
-- classifier does its work (and writes brain_cache rows) for a row that is then
-- skipped. Never rename it to sort after trg_classify_*.
--
-- VERIFIED LIVE (rolled back): insert of ('KSA', 'RM99999') -> 0 rows inserted +
-- 1 reject logged with detected_country='UAE'; ('KSA', 'GCKR99999') inserted fine.
--
-- ROLLBACK: drop trigger trg_aa_expense_country_guard on parts_consumption;
--           drop function expense_country_guard(); drop table expense_import_rejects;

create table if not exists public.expense_import_rejects (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid,
  uploaded_country text,
  detected_country text,
  work_order_no text,
  item_code text,
  item_description text,
  value_amount numeric,
  source_row text,
  created_at timestamptz not null default now()
);
alter table public.expense_import_rejects enable row level security;
drop policy if exists expense_import_rejects_org_isolation on public.expense_import_rejects;
create policy expense_import_rejects_org_isolation on public.expense_import_rejects
  as restrictive for all to authenticated
  using ((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()));
drop policy if exists expense_import_rejects_read on public.expense_import_rejects;
create policy expense_import_rejects_read on public.expense_import_rejects
  for select to authenticated using (public.app_is_elevated());
revoke insert, update, delete, truncate on public.expense_import_rejects from authenticated, anon;

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
    (organisation_id, uploaded_country, detected_country, work_order_no, item_code, item_description, value_amount, source_row)
  VALUES (NEW.organisation_id, NEW.country, v_detected, NEW.work_order_no, NEW.item_code, NEW.item_description, NEW.line_cost, NEW.source_row);
  RETURN NULL;  -- skip the row: it belongs to another country's sheet
END; $$;

drop trigger if exists trg_expense_country_guard on public.parts_consumption;
drop trigger if exists trg_aa_expense_country_guard on public.parts_consumption;
create trigger trg_aa_expense_country_guard before insert
  on public.parts_consumption for each row execute function public.expense_country_guard();
