-- ============================================================================
-- ATR-2  carbon_offsets: a blank cost or tree count is stored as NULL, not 0
--
-- STATUS: AUTHORED, NOT APPLIED. Needs the owner's explicit approval.
--
-- WHY. The Carbon Tracker used to save a blank cost as tonnes x 90 and a blank
-- tree count as tonnes x 45 (plus an invented registry and project name). The
-- client no longer sends a value the user did not enter. But aed_cost and
-- trees_equivalent are NOT NULL DEFAULT 0, so an omitted value lands as 0 and
-- "0" then reads as a measured cost (it also drags down the cost per tonne
-- tile). After this draft an omitted value is NULL = "not recorded".
--
-- The word "drop" below is unavoidable: removing a NOT NULL rule and a column
-- default has no other spelling. No row, table, column or policy is removed.
--
-- DATA. carbon_offsets held 0 rows in production on 2026-11-15, so there is
-- nothing to convert and no historical record is touched. If rows exist when
-- this is applied they keep their stored values: a stored 0 cannot be told
-- apart from a real zero cost, so it is NOT rewritten here.
--
-- VERIFY (run in a transaction, then ROLLBACK). Tested on local staging
-- (database tp_atrisk): see ATRISK-FIXES_ROUND2.md.
--   begin;
--     select is_nullable, column_default from information_schema.columns
--      where table_schema='public' and table_name='carbon_offsets'
--        and column_name in ('aed_cost','trees_equivalent');           -- YES, null (x2)
--     -- as an Admin of a company: insert (tonnes) values (10) returning aed_cost, trees_equivalent; -- null, null
--   rollback;
--
-- ROLLBACK (restores today's rule; fails if a NULL has been stored, by design,
-- so set those rows first or keep the column nullable):
--   alter table public.carbon_offsets alter column aed_cost set default 0;
--   alter table public.carbon_offsets alter column trees_equivalent set default 0;
--   alter table public.carbon_offsets alter column aed_cost set not null;
--   alter table public.carbon_offsets alter column trees_equivalent set not null;
-- ============================================================================

alter table public.carbon_offsets
  alter column aed_cost drop default,
  alter column aed_cost drop not null,
  alter column trees_equivalent drop default,
  alter column trees_equivalent drop not null;

comment on column public.carbon_offsets.aed_cost is
  'Cost the user entered for this offset. NULL = not recorded (never derived from tonnes).';
comment on column public.carbon_offsets.trees_equivalent is
  'Tree equivalent the user entered. NULL = not recorded (never derived from tonnes).';
