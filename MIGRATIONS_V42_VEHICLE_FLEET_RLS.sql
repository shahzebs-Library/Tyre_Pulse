-- ============================================================
-- TYREPULSE V42 VEHICLE FLEET RLS FIX
-- Ensures vehicle_fleet can be read by the app and written by
-- signed-in users without tripping RLS on insert/update/delete.
-- ============================================================

alter table public.vehicle_fleet enable row level security;

-- Drop any older vehicle_fleet policies so they cannot conflict.
drop policy if exists "vehicle_fleet_select" on public.vehicle_fleet;
drop policy if exists "vehicle_fleet_write" on public.vehicle_fleet;
drop policy if exists "vehicle_fleet_insert" on public.vehicle_fleet;
drop policy if exists "vehicle_fleet_update" on public.vehicle_fleet;
drop policy if exists "vehicle_fleet_delete" on public.vehicle_fleet;
drop policy if exists "vf_select" on public.vehicle_fleet;
drop policy if exists "vf_insert" on public.vehicle_fleet;
drop policy if exists "vf_update" on public.vehicle_fleet;
drop policy if exists "vf_delete" on public.vehicle_fleet;

-- Allow the app to read fleet records even before a full authenticated session is
-- established, which is needed by the registration/site lookup flows.
create policy "vehicle_fleet_select"
  on public.vehicle_fleet for select
  to anon, authenticated
  using (true);

-- Allow signed-in users to create and maintain fleet records.
create policy "vehicle_fleet_insert"
  on public.vehicle_fleet for insert
  to authenticated
  with check (auth.uid() is not null and auth.role() = 'authenticated');

create policy "vehicle_fleet_update"
  on public.vehicle_fleet for update
  to authenticated
  using (auth.uid() is not null and auth.role() = 'authenticated')
  with check (auth.uid() is not null and auth.role() = 'authenticated');

create policy "vehicle_fleet_delete"
  on public.vehicle_fleet for delete
  to authenticated
  using (auth.uid() is not null and auth.role() = 'authenticated');
