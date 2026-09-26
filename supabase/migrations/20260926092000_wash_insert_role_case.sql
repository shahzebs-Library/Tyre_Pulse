-- Every driver's wash save was refused by RLS.
--
-- wash_records_insert checked get_my_role() against 'driver' in LOWER case,
-- but profiles.role is stored Title Case ('Driver', 674 approved users), so the
-- comparison never matched and every insert from a driver failed with
-- "new row violates row-level security policy for table wash_records"
-- (7 refusals in the Postgres log on 2026-09-26 07:07 alone).
-- The policy also omitted Inspector and Tyre Man, both of whom the mobile app
-- offers the Washing module to (mobile/lib/permissions.ts `washing`), so they
-- saw the screen and could never save from it.
--
-- Fix: compare case-insensitively and list exactly the roles the app offers
-- washing to, plus Fleet Supervisor (kept from the previous policy).
-- UPDATE/DELETE are unchanged (elevated only); org/country/site restrictive
-- policies still bound every write.
drop policy if exists wash_records_insert on public.wash_records;
create policy wash_records_insert on public.wash_records
  for insert to authenticated
  with check (
    lower(coalesce(public.get_my_role(), '')) = any (array[
      'admin','manager','director','driver','inspector','tyre man','fleet supervisor'
    ])
  );
