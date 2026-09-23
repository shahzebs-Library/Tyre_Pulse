-- Retain existing tenant/site/country restrictions and permissive policies.
-- Capability checks must be restrictive so older broad policies cannot bypass them.
create policy vehicle_fleet_create_capability_guard on public.vehicle_fleet
  as restrictive for insert to authenticated
  with check (public.app_user_can('fleet_master', 'create'));
create policy vehicle_fleet_edit_capability_guard on public.vehicle_fleet
  as restrictive for update to authenticated
  using (public.app_user_can('fleet_master', 'edit'))
  with check (public.app_user_can('fleet_master', 'edit'));

-- The invoker's SELECT policy on the parent document provides the authoritative
-- scope. Missing/orphan parents are denied; no definer function bypasses RLS.
create policy document_chunks_parent_scope_guard on public.document_chunks
  as restrictive for select to authenticated
  using (exists (select 1 from public.knowledge_documents d
    where d.id = document_chunks.document_id));
