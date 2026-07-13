-- MIGRATIONS_V219_ACCIDENT_CASE_FIELDS.sql
-- GCC accident case-management fields for the accidents table.
-- Additive + idempotent (ADD COLUMN IF NOT EXISTS). No RLS change — the
-- accidents table already carries org-isolation + role RLS from earlier
-- migrations; new columns inherit it automatically.
--
-- Domain notes (GCC fleet accident handling):
--   Najm     = Saudi accident-assessment company (issues the official report).
--   Taqdeer  = damage appraisal / cost-estimate report (تقدير).
--   GCC liability ratio = insurer-assigned fault share: 0% / 50% / 100%.
--   Repair   = Internal (own workshop) or External (outside workshop + quote).

alter table public.accidents add column if not exists damage_class        text;    -- 'Major' | 'Minor'
alter table public.accidents add column if not exists fault_status        text;    -- 'Faulty' | 'Non-faulty' | 'Under review'
alter table public.accidents add column if not exists najm_status         text;    -- 'Najm report' | 'No Najm'
alter table public.accidents add column if not exists najm_fault          text;    -- 'Faulty' | 'Non-faulty' | 'N/A'
alter table public.accidents add column if not exists taqdeer_status      text;    -- 'Taqdeer report' | 'No Taqdeer'
alter table public.accidents add column if not exists gcc_liability_ratio integer; -- 0 | 50 | 100
alter table public.accidents add column if not exists repair_type         text;    -- 'Internal' | 'External'
alter table public.accidents add column if not exists next_step           text;
alter table public.accidents add column if not exists workshop_name       text;
alter table public.accidents add column if not exists workshop_quotation  numeric;
alter table public.accidents add column if not exists discount_pct        numeric;
alter table public.accidents add column if not exists final_amount        numeric;
alter table public.accidents add column if not exists release_date        date;    -- ACTUAL release (expected_release_date already exists)

comment on column public.accidents.damage_class        is 'Damage classification: Major | Minor';
comment on column public.accidents.fault_status        is 'Fleet fault: Faulty | Non-faulty | Under review';
comment on column public.accidents.najm_status         is 'Najm official report presence: Najm report | No Najm';
comment on column public.accidents.najm_fault          is 'Fault per Najm report: Faulty | Non-faulty | N/A';
comment on column public.accidents.taqdeer_status      is 'Taqdeer appraisal report presence: Taqdeer report | No Taqdeer';
comment on column public.accidents.gcc_liability_ratio is 'GCC insurer liability ratio: 0 | 50 | 100 (percent)';
comment on column public.accidents.repair_type         is 'Repair route: Internal (own workshop) | External (outside workshop)';
comment on column public.accidents.next_step           is 'Next workflow step in the case lifecycle';
comment on column public.accidents.workshop_name       is 'Workshop performing the repair';
comment on column public.accidents.workshop_quotation  is 'Workshop quotation amount (pre-discount)';
comment on column public.accidents.discount_pct        is 'Discount percent applied to the workshop quotation';
comment on column public.accidents.final_amount        is 'Final agreed repair amount (quotation - discount%)';
comment on column public.accidents.release_date        is 'Actual vehicle release date from the workshop';

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (manual, destructive — drops the columns and their data):
-- alter table public.accidents drop column if exists damage_class;
-- alter table public.accidents drop column if exists fault_status;
-- alter table public.accidents drop column if exists najm_status;
-- alter table public.accidents drop column if exists najm_fault;
-- alter table public.accidents drop column if exists taqdeer_status;
-- alter table public.accidents drop column if exists gcc_liability_ratio;
-- alter table public.accidents drop column if exists repair_type;
-- alter table public.accidents drop column if exists next_step;
-- alter table public.accidents drop column if exists workshop_name;
-- alter table public.accidents drop column if exists workshop_quotation;
-- alter table public.accidents drop column if exists discount_pct;
-- alter table public.accidents drop column if exists final_amount;
-- alter table public.accidents drop column if exists release_date;
-- ─────────────────────────────────────────────────────────────────────────────
