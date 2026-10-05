-- ============================================================================
-- Tyre disposal governance (Scrap Management page, 2026-10-05)
-- STATUS: APPLIED LIVE 2026-10-05 (as tyre_disposal_governance).
--
-- Why: the owner's Scrap Management mockup has a "Disposal governance" card
-- (pending, sent for retread, recycled, destroyed, vendor collection due). The
-- live tyre_disposals table (V62) only allows Pending / Disposed / Retreaded and
-- stores no vendor or collection date, so recycled, destroyed and collection
-- due could only ever read N/A.
--
-- What: ADDITIVE ONLY.
--   * widen the status CHECK to also allow 'Recycled' and 'Destroyed'
--     (widening cannot invalidate a stored row);
--   * add nullable collection_due (vendor = existing disposal_vendor; recovery_value,
--     currency and notes already exist and are left as they are);
--   * add a country-free index for the collection-due query.
-- No row is written, no existing value changes. The page reads the new columns
-- with a fallback (isMissingColumn), so it works before and after this applies.
--
-- Verify (expect t,t,t):
--   select exists(select 1 from information_schema.columns
--                  where table_schema='public' and table_name='tyre_disposals' and column_name='collection_due');
--   select pg_get_constraintdef(oid) like '%Recycled%' from pg_constraint
--    where conrelid='public.tyre_disposals'::regclass and contype='c' and pg_get_constraintdef(oid) ilike '%status%';
--   select count(*) = (select count(*) from public.tyre_disposals) from public.tyre_disposals; -- row count unchanged
--
-- Rollback:
--   alter table public.tyre_disposals drop constraint tyre_disposals_status_check;
--   alter table public.tyre_disposals add constraint tyre_disposals_status_check
--     check (status in ('Pending','Disposed','Retreaded'));   -- only if no Recycled/Destroyed rows exist
--   alter table public.tyre_disposals drop column vendor_name, drop column collection_due,
--     drop column recovery_value, drop column currency, drop column notes;
--   drop index if exists public.tyre_disposals_collection_due_idx;
-- ============================================================================

begin;

do $$
declare c record;
begin
  -- drop whichever CHECK currently constrains status (its name was generated in V62)
  for c in
    select conname from pg_constraint
     where conrelid = 'public.tyre_disposals'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.tyre_disposals drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.tyre_disposals
  add constraint tyre_disposals_status_check
  check (status in ('Pending', 'Disposed', 'Retreaded', 'Recycled', 'Destroyed'));

alter table public.tyre_disposals
  add column if not exists collection_due date;

create index if not exists tyre_disposals_collection_due_idx
  on public.tyre_disposals (organisation_id, collection_due)
  where collection_due is not null;

comment on column public.tyre_disposals.collection_due is
  'Date the disposal or retread vendor is due to collect the casing. Drives "Vendor collection due" on Scrap Management.';
comment on column public.tyre_disposals.recovery_value is
  'Money recovered for the casing (resale, recycling credit). Stored in its own currency, never summed across currencies.';

commit;
