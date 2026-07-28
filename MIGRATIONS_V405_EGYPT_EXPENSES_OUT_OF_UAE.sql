-- =====================================================================
-- V405 - AN EGYPT EXPENSE FILE WAS LOADED INTO THE UAE TABLE. MOVED.
-- Applied live 2026-07-28.
-- =====================================================================
--
-- User: "I added Egypt expenses in UAE, can you fix it and move it to Egypt."
--
-- THREE INDEPENDENT SIGNALS AGREE UNANIMOUSLY on which rows those are, which is
-- what makes this a fix rather than a judgement call:
--   1. JOB CARD PREFIX - 1,524 rows begin EG (Egypt). The other 67,713 UAE rows
--      all begin RM (UAE). Not one row is ambiguous.
--   2. STORE CODE - every one of the 1,524 is SP_EG_* (SP_EG_ MID 507,
--      SP_EG_GML4 420, SP_EG_EAST 321, SP_EG_ RH 161, SP_EG_H6 115), which are
--      Egypt's own store codes.
--   3. ITEM CODE - 1,502 of 1,524 use Egypt's letter scheme (XX-XX-nnnn) and
--      ZERO use the six-digit numeric scheme UAE and KSA use.
-- Dates run 2026-06-01 to 2026-07-28, i.e. the load just performed.
--
-- =====================================================================
-- THE CURRENCY WAS THE DANGEROUS PART
-- =====================================================================
-- These rows carried currency AED. The classify trigger only fills currency when
-- it is NULL (`if NEW.currency is null then ...`), so changing the country alone
-- would have left EGP 5,392,835 of Egyptian spend labelled AED. AED is worth
-- roughly THIRTEEN TIMES EGP, so every converted or combined figure would have
-- been wrong by an order of magnitude. Currency is set explicitly.
--
-- =====================================================================
-- THE IMPORT KEY HAD TO BE RECOMPUTED OR THE NEXT UPLOAD WOULD DUPLICATE
-- =====================================================================
-- `import_uid` is md5(COUNTRY | source row | ...) - the country is its FIRST
-- component. Left as the UAE-derived hash, a correct Egypt re-import of the same
-- file would compute a different uid, match nothing, and insert all 1,524 rows a
-- second time. That is exactly the path that produced the 8,248 duplicate
-- expense rows this project has already had to clean up once.
--
-- THE RECOMPUTATION WAS PROVEN BEFORE BEING TRUSTED: feeding the CURRENT country
-- back through the same function reproduces the stored uid on 1,519 of 1,524
-- rows, which is what establishes the column mapping is right.
-- RESIDUAL, stated rather than hidden: 5 rows do not reproduce - they were loaded
-- through the app rather than the staging pipe, so their original inputs differ
-- slightly. Those 5 could still duplicate on a re-import. Writing the formula
-- value is no worse than leaving them (a NULL uid never dedupes either) and is
-- strictly correct for the other 1,519.
--
-- Verified BEFORE applying: 0 recomputed keys collide with an existing row, and
-- 0 are duplicated within the move.
--
-- =====================================================================
-- THE TRIGGER RE-CLASSIFIES ON UPDATE, AND HERE THAT IS CORRECT
-- =====================================================================
-- `trg_classify_parts_consumption` is BEFORE INSERT OR UPDATE, so touching any
-- column re-runs classification. Measured in a rolled-back run: exactly 3 rows
-- change bucket and all 3 are improvements -
--   GREASE NIPPLE 4 PIN   oil -> spare   (a nipple is a part)
--   GREASE GUN            oil -> spare   (a gun is a tool)
-- They move because the material master is keyed PER COUNTRY: Egypt has these
-- reviewed as spare_part, and a row tagged UAE could never see that decision.
-- line_cost changes on 0 rows, so no money is created or destroyed.
--
-- =====================================================================
-- RESULT, VERIFIED AFTER APPLYING
-- =====================================================================
--   Egypt  44,389 rows  EGP 85,863,351.89   (+1,524, +5,392,835.35)
--   UAE    67,713 rows  AED 18,517,204.46   (-1,524)
--   KSA   106,980 rows  SAR 40,682,097.75   (unchanged)
--   EG job cards still tagged UAE ............ 0
--   RM job cards tagged Egypt ................ 0
--   SP_EG_ stores still tagged UAE ........... 0
--   countries carrying more than one currency  0
--   duplicate import_uid created ............. 0
-- =====================================================================

create table if not exists public._egypt_expense_move_v405 (
  id uuid primary key,
  old_country text,
  old_currency text,
  old_import_uid text,
  old_cost_category text,
  old_tyre_cost numeric,
  old_spare_cost numeric,
  old_oil_cost numeric,
  moved_at timestamptz not null default now()
);

revoke all on public._egypt_expense_move_v405 from anon, authenticated;

insert into public._egypt_expense_move_v405
       (id, old_country, old_currency, old_import_uid, old_cost_category,
        old_tyre_cost, old_spare_cost, old_oil_cost)
select id, country, currency, import_uid, cost_category, tyre_cost, spare_cost, oil_cost
from public.parts_consumption
where organisation_id = '00000000-0000-0000-0000-000000000001'
  and country = 'UAE'
  and work_order_no ilike 'EG%'
on conflict (id) do nothing;

update public.parts_consumption p
   set country    = 'Egypt',
       currency   = 'EGP',
       import_uid = public.parts_import_uid('Egypt', p.source_row, p.issue_number,
                      p.work_order_no, p.item_code, p.item_description, p.qty,
                      p.value_amount::text, p.txn_date, p.asset_code,
                      p.store_code, p.cost_center)
  from public._egypt_expense_move_v405 s
 where p.id = s.id
   and p.organisation_id = '00000000-0000-0000-0000-000000000001';

-- =====================================================================
-- UNDO
--   update public.parts_consumption p
--      set country = s.old_country, currency = s.old_currency,
--          import_uid = s.old_import_uid
--     from public._egypt_expense_move_v405 s
--    where p.id = s.id;
--   The 3 re-bucketed rows revert on the same write, because the trigger
--   re-derives the bucket from the restored country.
--
-- HOW TO SPOT THIS AGAIN: a country whose expense rows carry a job card prefix
-- belonging to another country. The prefixes are AFKR and GCKR = KSA, RM = UAE,
-- EG = Egypt. Derive an expense row's country from that prefix or the SP_EG_
-- style store code - NEVER from the asset code, which is a per-country sequence
-- and collides across countries (V376).
-- =====================================================================
