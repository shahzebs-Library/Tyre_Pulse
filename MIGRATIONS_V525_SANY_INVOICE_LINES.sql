-- V525 - a SANY invoice is a table of machines, not a single number
-- STATUS: APPLIED LIVE 2026-08-11
--
-- Owner: "sany is not correct cost i want to make those correct to extract
-- table from pdf and add not just number".
--
-- sany_invoices held ONE lump amount per document. Nobody could see which
-- machines were charged, at what rate, or check the total against the lines -
-- so an error in the total was undetectable, and there were two of them.
--
-- NEW TABLE public.sany_invoice_lines: one row per machine line exactly as the
-- proforma prints it (machinery, model, charge_standard, contract_year,
-- activation_date, service_period, units, usage_detail, amount_usd), keyed
-- (invoice_id, line_no), cascade delete, org-isolated RESTRICTIVE + app_is_active
-- read + app_is_elevated write.
--
-- LOADED FROM THE TWO REAL PDFs (read with pdfjs, clustered by y, then
-- reconciled by hand):
--   SANY Automobile, Jan-Apr 2026: 27 lines summing to USD 512,864.19 TO THE
--     CENT and 324 machines, which independently matches the invoice's own
--     header row (Mixer 232 / Concrete pump 56 / Trailer Pump 10 / Line Pump 2 /
--     Batching Plant 10 / Wheel loader 14 = 324). Both checks agreeing is what
--     establishes the extraction is COMPLETE rather than merely plausible - a
--     dropped machine line would understate cost while looking finished.
--   Sany International (generators), Jan-Apr 2026: 4 lines, USD 51,000, 34
--     generators (12% of 50,000 USD annual); Dump Truck and both Excavator
--     lines are on the document at quantity 0 and are kept, because a line
--     charged nothing is a fact, not an absence.
--
-- TWO REAL ERRORS THE LINE TABLE EXPOSED
--
-- 1. THE GENERATOR INVOICE WAS OVERSTATED. It carries a spare-parts discount of
--    USD 245.38 that was never applied, AND it states its own riyal total on
--    the document - Total Amount (SAR) 190,329.82 - so no conversion was needed
--    at all. We had been computing 51,000 x 3.75 = 191,250. Corrected to
--    190,329.82 with the discount recorded as a deduction. The document's 15%
--    VAT (28,549.47 SAR, total net 218,879.29) is DELIBERATELY EXCLUDED: VAT is
--    recoverable and is not an operating cost.
--
-- 2. THE AUTOMOBILE INVOICE WAS COUNTED AT GROSS, AND GROSS DOUBLE COUNTS.
--    Its four deductions are: penalty 51,286.41, GREEN CONCRETE PURCHASED ITEMS
--    66,412.26, SANY labour food and accommodation 13,200.00, and
--    non-operational machines 21,450.00. Two of those are costs Green Concrete
--    has ALREADY recorded in the expense grid, and none of them is money that
--    leaves the company towards this invoice. Net USD 360,515.52 is what is
--    paid, so net is the cost. Applied to both Automobile invoices.
--
-- EFFECT: KSA SANY 4,333,144.54 -> 3,188,312.96 SAR (down 1,144,831.58), which
-- lowers cost per m3. This settles the standing "gross or net" question on
-- evidence rather than preference.
--
-- HONEST GAP: the Apr-Jul GENERATOR invoice is still gross x 3.75 = 213,750 and
-- carries NO machine lines, because that PDF has not been supplied. The Jan-Apr
-- generator invoice had a discount and stated its own SAR total, so this one may
-- be overstated the same way. Its note says so on the row rather than leaving a
-- clean-looking figure nobody questions. The Apr-Jul Automobile invoice is on
-- the correct net basis but likewise has no line detail.
--
-- Rollback: _bak.sany_amount_v525 holds (id, amount, net_amount, deductions,
-- notes) for all four rows as they were.

create table if not exists public.sany_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default public.app_current_org(),
  invoice_id uuid not null references public.sany_invoices(id) on delete cascade,
  line_no int not null,
  machinery text,
  model text,
  charge_standard text,
  contract_year text,
  activation_date text,
  service_period text,
  units numeric,
  usage_detail text,
  amount_usd numeric not null,
  created_at timestamptz not null default now(),
  unique (invoice_id, line_no)
);

create index if not exists sany_invoice_lines_invoice_idx
  on public.sany_invoice_lines (invoice_id, line_no);

alter table public.sany_invoice_lines enable row level security;

create policy sany_invoice_lines_org_isolation on public.sany_invoice_lines
  as restrictive for all to authenticated
  using (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()))
  with check (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()));

create policy sany_invoice_lines_read on public.sany_invoice_lines
  for select to authenticated using (public.app_is_active());

create policy sany_invoice_lines_write on public.sany_invoice_lines
  for all to authenticated
  using (public.app_is_elevated()) with check (public.app_is_elevated());

-- The 27 + 4 machine lines and the two amount corrections were applied as data
-- statements against the live database; see _bak.sany_amount_v525 for the
-- pre-change amounts.
