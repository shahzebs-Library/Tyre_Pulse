-- ============================================================
-- TYREPULSE V40 SECURITY HARDENING
-- Apply after the existing schema/migrations.
-- - Removes legacy "authenticated full access" policies.
-- - Requires approved/unlocked profiles for operational access.
-- - Restricts writes by role.
-- - Makes photo buckets private and serves them through signed URLs.
-- ============================================================

create or replace function public.app_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select lower(replace(coalesce(role, 'reporter'), ' ', '_'))
  from public.profiles
  where id = auth.uid()
$$;

create or replace function public.app_is_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(approved, false) = true
     and coalesce(locked, false) = false
  from public.profiles
  where id = auth.uid()
$$;

create or replace function public.app_is_elevated()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.app_role() in ('admin', 'manager', 'director')
$$;

grant execute on function public.app_role() to authenticated;
grant execute on function public.app_is_active() to authenticated;
grant execute on function public.app_is_elevated() to authenticated;

-- Legacy broad policies from early schema files.
drop policy if exists "Auth users full access" on public.tyre_records;
drop policy if exists "Auth users full access" on public.stock_records;
drop policy if exists "Auth users full access" on public.budgets;
drop policy if exists "Auth users full access" on public.corrective_actions;
drop policy if exists "Auth users full access" on public.rca_records;
drop policy if exists "Auth users full access" on public.upload_history;
drop policy if exists "Auth users full access" on public.column_mappings;
drop policy if exists "Auth users full access" on public.cleaning_log;
drop policy if exists "Auth users full access" on public.settings;
drop policy if exists "Auth users full access" on public.vehicle_fleet;
drop policy if exists "Auth users full access" on public.inspections;
drop policy if exists "Auth users full access" on public.accidents;
drop policy if exists "Auth users full access" on public.accident_remarks;
drop policy if exists "Auth users full access" on public.accident_parts;
drop policy if exists "Auth users full access" on public.stock_movements;
drop policy if exists "Auth users full access" on public.alerts;
drop policy if exists "Auth users full access" on public.work_orders;
drop policy if exists "Auth users full access" on public.audit_log;
drop policy if exists "Auth users full access" on public.kpi_targets;

-- Private photo buckets. Mobile stores tp-storage:// references and resolves
-- short-lived signed URLs at display/export time.
update storage.buckets
set public = false
where id in ('tyre-photos', 'inspection-photos', 'accident-photos');

drop policy if exists "Public read tyre photos" on storage.objects;
drop policy if exists "Public read inspection photos" on storage.objects;
drop policy if exists "Public read accident photos" on storage.objects;
drop policy if exists "Auth users can upload" on storage.objects;
drop policy if exists "Authenticated photo uploads" on storage.objects;

create policy "Authenticated photo uploads"
  on storage.objects for insert to authenticated
  with check (
    bucket_id in ('tyre-photos', 'inspection-photos', 'accident-photos')
    and public.app_is_active()
  );

create policy "Authenticated own photo updates"
  on storage.objects for update to authenticated
  using (
    bucket_id in ('tyre-photos', 'inspection-photos', 'accident-photos')
    and public.app_is_active()
  )
  with check (
    bucket_id in ('tyre-photos', 'inspection-photos', 'accident-photos')
    and public.app_is_active()
  );

-- Role-scoped operational writes. SELECT remains broad for active users; country
-- isolation should continue to be applied by existing country-aware policies or
-- views where present.
drop policy if exists "active_select_tyre_records" on public.tyre_records;
drop policy if exists "role_insert_tyre_records" on public.tyre_records;
drop policy if exists "role_update_tyre_records" on public.tyre_records;
drop policy if exists "role_delete_tyre_records" on public.tyre_records;

create policy "active_select_tyre_records" on public.tyre_records
  for select to authenticated using (public.app_is_active());
create policy "role_insert_tyre_records" on public.tyre_records
  for insert to authenticated with check (public.app_role() in ('admin', 'manager', 'inspector', 'tyre_man'));
create policy "role_update_tyre_records" on public.tyre_records
  for update to authenticated using (public.app_role() in ('admin', 'manager')) with check (public.app_role() in ('admin', 'manager'));
create policy "role_delete_tyre_records" on public.tyre_records
  for delete to authenticated using (public.app_role() = 'admin');

drop policy if exists "active_select_inspections" on public.inspections;
drop policy if exists "role_insert_inspections" on public.inspections;
drop policy if exists "role_update_inspections" on public.inspections;
drop policy if exists "role_delete_inspections" on public.inspections;

create policy "active_select_inspections" on public.inspections
  for select to authenticated using (public.app_is_active());
create policy "role_insert_inspections" on public.inspections
  for insert to authenticated with check (public.app_role() in ('admin', 'manager', 'inspector', 'tyre_man'));
create policy "role_update_inspections" on public.inspections
  for update to authenticated using (public.app_role() in ('admin', 'manager', 'inspector')) with check (public.app_role() in ('admin', 'manager', 'inspector'));
create policy "role_delete_inspections" on public.inspections
  for delete to authenticated using (public.app_role() = 'admin');

drop policy if exists "active_select_accidents" on public.accidents;
drop policy if exists "role_insert_accidents" on public.accidents;
drop policy if exists "role_update_accidents" on public.accidents;
drop policy if exists "role_delete_accidents" on public.accidents;

create policy "active_select_accidents" on public.accidents
  for select to authenticated using (public.app_is_active() and public.app_role() in ('admin', 'manager', 'director', 'inspector'));
create policy "role_insert_accidents" on public.accidents
  for insert to authenticated with check (public.app_role() in ('admin', 'manager', 'director', 'inspector', 'tyre_man'));
create policy "role_update_accidents" on public.accidents
  for update to authenticated using (public.app_is_elevated()) with check (public.app_is_elevated());
create policy "role_delete_accidents" on public.accidents
  for delete to authenticated using (public.app_role() = 'admin');

drop policy if exists "settings_elevated_select" on public.settings;
drop policy if exists "settings_admin_write" on public.settings;

create policy "settings_elevated_select" on public.settings
  for select to authenticated using (public.app_is_elevated());
create policy "settings_admin_write" on public.settings
  for all to authenticated using (public.app_role() = 'admin') with check (public.app_role() = 'admin');

-- Verify:
-- select schemaname, tablename, policyname, cmd, qual, with_check
-- from pg_policies
-- where schemaname in ('public', 'storage')
-- order by schemaname, tablename, policyname;
