-- =====================================================================
-- V533  A QUOTATION CAN NAME ONE MACHINE
-- STATUS: APPLIED LIVE 2026-08-12 (project jhssdmeruxtrlqnwfksc)
--         migration name: v533_replacement_cost_per_asset
-- =====================================================================
--
-- WHAT WAS WRONG
-- --------------
-- V532 loaded the SANY 47m pump quotation against the asset CLASS `PUMPS`,
-- because the document names no asset: it is addressed to Green Concrete
-- Company and carries a model and a price, nothing more. That was the
-- defensible reading of the document, and it was still wrong - the owner
-- obtained that quotation as the replacement for MP049 specifically.
--
-- The consequence was that MP042 was shown at SAR 1,120,000 as well. MP042 is
-- a 2015 Putzmeister; MP049 is a 2018 BT-STAR. A SANY 47m is not automatically
-- the equivalent machine for the Putzmeister, so that figure was a price nobody
-- had quoted, attached to a machine nobody had quoted it for. It was invented
-- by inference rather than by arithmetic, which makes it harder to spot, not
-- easier.
--
-- THE RULE THIS ENCODES
-- ---------------------
-- A class price and a machine price are DIFFERENT CLAIMS and the table now
-- holds both:
--   asset_no NULL -> the quotation prices any machine of that asset_type
--   asset_no set  -> it prices THAT machine and no other
--
-- The machine price outranks the class price for its own machine. It is NEVER
-- widened to the class: a quotation obtained for one machine is not evidence
-- about another, even a similar one. Where neither exists there is no price,
-- and the machine is listed as uncovered so the gap is visible - which is what
-- MP042 now correctly shows.
--
-- The client also publishes WHICH of the two a figure rests on (`basis`:
-- 'asset' or 'class'). A reader deciding about one machine should know whether
-- the price has that machine's name on it, because a class price carried onto a
-- specific decision is the weaker claim.
--
-- WHAT CHANGED IN THE DATA
--   The single seeded row moves from PUMPS (class) to MP049 (machine).
--   MP049 keeps its price; MP042 goes from SAR 1,120,000 to no price at all.
--
-- ROLLBACK
--   update public.asset_replacement_costs set asset_no = null
--    where source_file = 'SANY_quotation_for_pump_47m0724.pdf';
--   alter table public.asset_replacement_costs drop column if exists asset_no;
-- =====================================================================

alter table public.asset_replacement_costs
  add column if not exists asset_no text;

create index if not exists asset_replacement_costs_org_country_asset_idx
  on public.asset_replacement_costs (organisation_id, country, asset_no)
  where asset_no is not null;

comment on column public.asset_replacement_costs.asset_no is
  'NULL = the quotation prices any machine of this asset_type. Set = it prices THIS machine only and outranks the class price. Never widen a machine-specific quotation to its class - a quotation obtained for one machine is not evidence about another.';

update public.asset_replacement_costs
   set asset_no = 'MP049'
 where organisation_id = '00000000-0000-0000-0000-000000000001'
   and source_file = 'SANY_quotation_for_pump_47m0724.pdf'
   and asset_no is null;

-- ---------------------------------------------------------------------
-- 2026-08-12, owner instruction: the same quotation also replaces MP043.
--
-- MP043 is a KSA pump (vehicle_fleet, Inactive, RIY-SAL) that the owner says
-- the SANY 47m also replaces. Recorded as its OWN row rather than by widening
-- the MP049 row back to the PUMPS class - two named machines is two facts the
-- owner stated; a class price would silently re-cover MP042, which is exactly
-- what this migration exists to stop.
--
-- NOTE: MP043 is NOT on the disposal list, so it carries a price with no row in
-- the register. That is correct and visible - the Quotations sheet and table
-- show it - and the price applies the moment the committee adds the machine.
-- ---------------------------------------------------------------------
insert into public.asset_replacement_costs
 (organisation_id, country, asset_no, asset_type, label, supplier, model, spec,
  unit_price, vat_pct, vat_amount, total_price, currency,
  quote_ref, quote_date, valid_until, warranty_note, source_file, source_page, notes)
select organisation_id, country, 'MP043', asset_type, label, supplier, model, spec,
       unit_price, vat_pct, vat_amount, total_price, currency,
       quote_ref, quote_date, valid_until, warranty_note, source_file, source_page,
       notes || ' Applied to MP043 as well as MP049 on the owner''s instruction: the same quoted model replaces both machines.'
  from public.asset_replacement_costs
 where source_file = 'SANY_quotation_for_pump_47m0724.pdf' and asset_no = 'MP049'
   and not exists (select 1 from public.asset_replacement_costs
                    where source_file = 'SANY_quotation_for_pump_47m0724.pdf' and asset_no = 'MP043');
