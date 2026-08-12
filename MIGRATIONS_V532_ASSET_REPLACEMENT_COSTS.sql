-- =====================================================================
-- V532  ASSET REPLACEMENT COST BENCHMARKS
-- STATUS: APPLIED LIVE 2026-08-12 (project jhssdmeruxtrlqnwfksc)
--         migration name: v532_asset_replacement_costs
-- =====================================================================
--
-- WHY THIS EXISTS
-- ---------------
-- Every valuation slot in the Asset Disposal module printed "Not valued".
-- That was correct: no scrap value, resale price or replacement cost existed
-- anywhere in the data, and inventing one would have produced the worst kind
-- of number - confident and wrong. The committee could say what a machine had
-- COST them; it could not say what a new one costs, which is the other half of
-- every keep-or-replace decision.
--
-- The owner supplied the first hard price: a SANY quotation for a new 47m
-- truck-mounted concrete pump. This table is the general home for that class
-- of evidence, not a one-off column for pumps.
--
-- THE SOURCE DOCUMENT, AND A NOTE ON READING IT
-- ---------------------------------------------
-- SANY_quotation_for_pump_47m0724.pdf carries ZERO extractable text and ZERO
-- embedded fonts - the whole quotation is drawn as vector outlines, so a text
-- extractor returns an empty string and the only image in the file is the SANY
-- logo. It reads as an empty document and is not. It has to be RENDERED and
-- read visually. Anyone re-checking this figure should render page 1 rather
-- than concluding the file is blank.
--
--   Supplier   SANY Automobile Manufacturing Co., Ltd. (Changsha, Hunan)
--   Model      SYG5360THB 470C-10, truck-mounted concrete pump
--   Spec       vertical reach 47m; output 200/137 m3/h; pressure 8.3/12 MPa
--   Unit price SAR 1,120,000  (ex-VAT)
--   VAT 15%    SAR   168,000
--   Total      SAR 1,288,000
--   Quoted     2026-07-24, valid until 2026-08-10, KSA only
--   Warranty   24 months or 4000 hours, whichever comes first
--
-- FOUR DECISIONS BAKED INTO THE SHAPE
-- -----------------------------------
-- 1. THE COST BASIS IS THE EX-VAT PRICE. The 15% VAT is recoverable, so it is
--    not a cost to the business - the same rule the SANY invoice reading
--    already follows (V525). `unit_price` is what every ratio divides by;
--    `total_price` keeps the printed VAT-inclusive figure because that is what
--    the cheque is written for. Both are stored so neither has to be derived.
--
-- 2. A BENCHMARK PRICES ITS OWN ASSET CLASS AND NOTHING ELSE. The client
--    matches `asset_type` exactly. A pump quotation does not price a
--    generator, and it does not price a SPIDER PUMP or a STATIONARY PUMP just
--    because the word "pump" appears - those are different machines and the
--    KSA fleet holds all three classes separately. A class with no row has NO
--    replacement cost; the module lists it as uncovered rather than reaching
--    for the nearest thing.
--
-- 3. NO SERVICE LIFE IS STORED, AND NONE IS DERIVED. The obvious next step is
--    to annualise the price over an assumed life and compare it with annual
--    repair cost. That assumed life would be the largest number in the
--    calculation and nobody could check it. The engine therefore expresses the
--    comparison only in figures that exist: spend as a share of a new machine,
--    and how many years of the last COMPLETE year's repair bill add up to one.
--
-- 4. A LAPSED QUOTATION IS LABELLED, NOT DELETED AND NOT SHOWN AS CURRENT.
--    `valid_until` drives a status the client renders on every figure. The
--    SANY quote lapsed on 2026-08-10, so it already reads as the last known
--    price rather than today's - which is the honest state, not a defect.
--
-- WHAT IT SAYS ABOUT THE TWO PUMPS ON THE DISPOSAL LIST (measured, KSA)
-- --------------------------------------------------------------------
--   MP042  Putzmeister 2015, dismantled, proposed scrap
--          lifetime maintenance SAR 399,402 over 131 job cards, 90 failures
--          = 35.7% of a new machine. Last complete year 2024: SAR 55,174.
--   MP049  BT-STAR 2018, running, proposed sale
--          lifetime maintenance SAR 406,470 over 303 job cards, 277 failures
--          = 36.3% of a new machine. Last complete year 2025: SAR 92,359,
--          so roughly 12 years at that rate buys a new pump.
--   Replacement exposure for the two priced machines: SAR 2,240,000 ex-VAT.
--
-- NOTE THAT THIS DOES NOT ARGUE FOR REPLACEMENT ON COST ALONE, and the module
-- does not pretend otherwise. Neither pump has cost more than a new one. The
-- case for disposing of them rests on their condition and their failure rate,
-- which the reliability engine already carries. Publishing a ratio that fails
-- to make the argument is the point: a number that only ever agreed with the
-- committee would not be worth computing.
--
-- ROLLBACK
--   drop table if exists public.asset_replacement_costs;
-- =====================================================================

create table if not exists public.asset_replacement_costs (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default public.app_current_org(),
  country text,
  asset_type text not null,
  label text not null,
  supplier text,
  model text,
  spec text,
  unit_price numeric,          -- ex-VAT. THE COST BASIS.
  vat_pct numeric,
  vat_amount numeric,
  total_price numeric,         -- as printed on the document, VAT inclusive.
  currency text not null default 'SAR',
  quote_ref text,
  quote_date date,
  valid_until date,
  warranty_note text,
  source_file text,
  source_page integer,
  notes text,
  active boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists asset_replacement_costs_org_country_type_idx
  on public.asset_replacement_costs (organisation_id, country, asset_type);

alter table public.asset_replacement_costs enable row level security;

drop policy if exists asset_replacement_costs_org_isolation on public.asset_replacement_costs;
create policy asset_replacement_costs_org_isolation on public.asset_replacement_costs
  as restrictive for all to authenticated
  using (organisation_id = (select public.app_current_org()))
  with check (organisation_id = (select public.app_current_org()));

drop policy if exists asset_replacement_costs_country_isolation on public.asset_replacement_costs;
create policy asset_replacement_costs_country_isolation on public.asset_replacement_costs
  as restrictive for select to authenticated
  using (public.app_can_see_country(country));

drop policy if exists asset_replacement_costs_read on public.asset_replacement_costs;
create policy asset_replacement_costs_read on public.asset_replacement_costs
  for select to authenticated
  using ((select public.app_is_active()));

drop policy if exists asset_replacement_costs_write on public.asset_replacement_costs;
create policy asset_replacement_costs_write on public.asset_replacement_costs
  for all to authenticated
  using ((select public.app_is_elevated()))
  with check ((select public.app_is_elevated()));

revoke all on public.asset_replacement_costs from anon;

comment on table public.asset_replacement_costs is
  'Quotation-backed replacement cost benchmarks per asset class. unit_price is the ex-VAT figure and is the cost basis (VAT is recoverable, per the V525 SANY rule); total_price keeps the printed VAT-inclusive figure. A class with no row has NO benchmark - never derive one.';

-- --------------------------------------------------------------------
-- Seed: the SANY 47m pump quotation (applied live).
-- --------------------------------------------------------------------
insert into public.asset_replacement_costs
 (organisation_id, country, asset_type, label, supplier, model, spec,
  unit_price, vat_pct, vat_amount, total_price, currency,
  quote_ref, quote_date, valid_until, warranty_note, source_file, source_page, notes)
select
 '00000000-0000-0000-0000-000000000001', 'KSA', 'PUMPS',
 'Truck-mounted concrete pump 47m (new)',
 'SANY Automobile Manufacturing Co., Ltd.',
 'SYG5360THB 470C-10',
 'Vertical reach 47m; output 200/137 m3/h; pressure 8.3/12 MPa; SANY engine and chassis',
 1120000, 15, 168000, 1288000, 'SAR',
 null, date '2026-07-24', date '2026-08-10',
 'Main machine 24 months or 4000 hours, whichever comes first',
 'SANY_quotation_for_pump_47m0724.pdf', 1,
 'Quotation addressed to Green Concrete Company, valid for KSA only. Cost basis is the ex-VAT unit price; the 15% VAT is recoverable and excluded, consistent with the SANY invoice rule.'
where not exists (
  select 1 from public.asset_replacement_costs
  where organisation_id = '00000000-0000-0000-0000-000000000001'
    and country = 'KSA' and asset_type = 'PUMPS'
    and source_file = 'SANY_quotation_for_pump_47m0724.pdf'
);
