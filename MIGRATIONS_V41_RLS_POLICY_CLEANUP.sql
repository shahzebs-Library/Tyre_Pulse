-- ============================================================
-- TYREPULSE V41 RLS POLICY CLEANUP
-- Apply after V40.
-- PostgreSQL combines RLS policies with OR, so older broad policies must be
-- dropped by name or they can bypass the stricter V40 policies.
-- Also patches V40 role-write policies so locked/unapproved users cannot write.
-- ============================================================

create or replace function public.app_is_elevated()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.app_is_active()
     and public.app_role() in ('admin', 'manager', 'director')
$$;

-- Tyre records: keep V40 active_select_/role_* policies only.
drop policy if exists "tyre_records_all" on public.tyre_records;
drop policy if exists "tyre_records_select" on public.tyre_records;
drop policy if exists "tyre_records_insert" on public.tyre_records;
drop policy if exists "tyre_records_update" on public.tyre_records;
drop policy if exists "tyre_records_delete" on public.tyre_records;
drop policy if exists "auth_read_tyre_records" on public.tyre_records;
drop policy if exists "auth_write_tyre_records" on public.tyre_records;
drop policy if exists tyre_records_insert on public.tyre_records;
drop policy if exists tyre_records_update on public.tyre_records;
drop policy if exists tyre_records_delete on public.tyre_records;
drop policy if exists "role_insert_tyre_records" on public.tyre_records;
drop policy if exists "role_update_tyre_records" on public.tyre_records;
drop policy if exists "role_delete_tyre_records" on public.tyre_records;

create policy "role_insert_tyre_records" on public.tyre_records
  for insert to authenticated
  with check (public.app_is_active() and public.app_role() in ('admin', 'manager', 'inspector', 'tyre_man'));
create policy "role_update_tyre_records" on public.tyre_records
  for update to authenticated
  using (public.app_is_active() and public.app_role() in ('admin', 'manager'))
  with check (public.app_is_active() and public.app_role() in ('admin', 'manager'));
create policy "role_delete_tyre_records" on public.tyre_records
  for delete to authenticated
  using (public.app_is_active() and public.app_role() = 'admin');

-- Inspections: keep V40 active_select_/role_* policies only.
drop policy if exists "inspections_all" on public.inspections;
drop policy if exists "inspections_select" on public.inspections;
drop policy if exists "inspections_insert" on public.inspections;
drop policy if exists "inspections_update" on public.inspections;
drop policy if exists "inspections_delete" on public.inspections;
drop policy if exists "inspections_authenticated" on public.inspections;
drop policy if exists "auth_read_inspections" on public.inspections;
drop policy if exists "auth_write_inspections" on public.inspections;
drop policy if exists "inspections_update_admin" on public.inspections;
drop policy if exists "inspections_update_own" on public.inspections;
drop policy if exists "role_insert_inspections" on public.inspections;
drop policy if exists "role_update_inspections" on public.inspections;
drop policy if exists "role_delete_inspections" on public.inspections;

create policy "role_insert_inspections" on public.inspections
  for insert to authenticated
  with check (public.app_is_active() and public.app_role() in ('admin', 'manager', 'inspector', 'tyre_man'));
create policy "role_update_inspections" on public.inspections
  for update to authenticated
  using (public.app_is_active() and public.app_role() in ('admin', 'manager', 'inspector'))
  with check (public.app_is_active() and public.app_role() in ('admin', 'manager', 'inspector'));
create policy "role_delete_inspections" on public.inspections
  for delete to authenticated
  using (public.app_is_active() and public.app_role() = 'admin');

-- Accidents: keep V40 active_select_/role_* policies only.
drop policy if exists "accidents_all" on public.accidents;
drop policy if exists "accidents_select" on public.accidents;
drop policy if exists "accidents_insert" on public.accidents;
drop policy if exists "accidents_update" on public.accidents;
drop policy if exists "accidents_delete" on public.accidents;
drop policy if exists "role_insert_accidents" on public.accidents;
drop policy if exists "role_update_accidents" on public.accidents;
drop policy if exists "role_delete_accidents" on public.accidents;

create policy "role_insert_accidents" on public.accidents
  for insert to authenticated
  with check (public.app_is_active() and public.app_role() in ('admin', 'manager', 'director', 'inspector', 'tyre_man'));
create policy "role_update_accidents" on public.accidents
  for update to authenticated
  using (public.app_is_elevated())
  with check (public.app_is_elevated());
create policy "role_delete_accidents" on public.accidents
  for delete to authenticated
  using (public.app_is_active() and public.app_role() = 'admin');

-- Accident child tables from V19 had FOR ALL policies. Replace with role-aware
-- policies that mirror accident visibility and management.
drop policy if exists "accident_remarks_all" on public.accident_remarks;
drop policy if exists "accident_parts_all" on public.accident_parts;

drop policy if exists "active_select_accident_remarks" on public.accident_remarks;
drop policy if exists "role_insert_accident_remarks" on public.accident_remarks;
drop policy if exists "role_update_accident_remarks" on public.accident_remarks;
drop policy if exists "role_delete_accident_remarks" on public.accident_remarks;

create policy "active_select_accident_remarks" on public.accident_remarks
  for select to authenticated
  using (public.app_is_active() and public.app_role() in ('admin', 'manager', 'director', 'inspector'));
create policy "role_insert_accident_remarks" on public.accident_remarks
  for insert to authenticated
  with check (public.app_is_active() and public.app_role() in ('admin', 'manager', 'director', 'inspector'));
create policy "role_update_accident_remarks" on public.accident_remarks
  for update to authenticated
  using (public.app_is_elevated())
  with check (public.app_is_elevated());
create policy "role_delete_accident_remarks" on public.accident_remarks
  for delete to authenticated
  using (public.app_is_active() and public.app_role() = 'admin');

drop policy if exists "active_select_accident_parts" on public.accident_parts;
drop policy if exists "role_insert_accident_parts" on public.accident_parts;
drop policy if exists "role_update_accident_parts" on public.accident_parts;
drop policy if exists "role_delete_accident_parts" on public.accident_parts;

create policy "active_select_accident_parts" on public.accident_parts
  for select to authenticated
  using (public.app_is_active() and public.app_role() in ('admin', 'manager', 'director', 'inspector'));
create policy "role_insert_accident_parts" on public.accident_parts
  for insert to authenticated
  with check (public.app_is_elevated());
create policy "role_update_accident_parts" on public.accident_parts
  for update to authenticated
  using (public.app_is_elevated())
  with check (public.app_is_elevated());
create policy "role_delete_accident_parts" on public.accident_parts
  for delete to authenticated
  using (public.app_is_active() and public.app_role() = 'admin');

-- Settings: keep V40 settings_elevated_select/settings_admin_write only.
drop policy if exists "settings_all" on public.settings;
drop policy if exists "settings_select" on public.settings;
drop policy if exists "settings_admin_write" on public.settings;

create policy "settings_admin_write" on public.settings
  for all to authenticated
  using (public.app_is_active() and public.app_role() = 'admin')
  with check (public.app_is_active() and public.app_role() = 'admin');

-- Storage objects: remove legacy public/authenticated policies so private
-- buckets require signed URLs.
drop policy if exists "tyre_photos_upload" on storage.objects;
drop policy if exists "tyre_photos_read" on storage.objects;
drop policy if exists "Public read" on storage.objects;
drop policy if exists "Public read photos" on storage.objects;
drop policy if exists "Auth upload" on storage.objects;
drop policy if exists "Auth users can upload" on storage.objects;
drop policy if exists "Public read tyre photos" on storage.objects;
drop policy if exists "Public read inspection photos" on storage.objects;
drop policy if exists "Public read accident photos" on storage.objects;
drop policy if exists "Authenticated photo reads" on storage.objects;
drop policy if exists "Authenticated own photo updates" on storage.objects;

create policy "Authenticated photo reads"
  on storage.objects for select to authenticated
  using (
    bucket_id in ('tyre-photos', 'inspection-photos', 'accident-photos')
    and public.app_is_active()
  );

create policy "Authenticated own photo updates"
  on storage.objects for update to authenticated
  using (
    bucket_id in ('tyre-photos', 'inspection-photos', 'accident-photos')
    and public.app_is_active()
    and (owner = auth.uid() or public.app_is_elevated())
  )
  with check (
    bucket_id in ('tyre-photos', 'inspection-photos', 'accident-photos')
    and public.app_is_active()
    and (owner = auth.uid() or public.app_is_elevated())
  );

-- Verify remaining policies for hardened tables:
-- select schemaname, tablename, policyname, cmd, qual, with_check
-- from pg_policies
-- where (schemaname = 'public' and tablename in ('tyre_records','inspections','accidents','accident_remarks','accident_parts','settings'))
--    or (schemaname = 'storage' and tablename = 'objects')
-- order by schemaname, tablename, policyname;
