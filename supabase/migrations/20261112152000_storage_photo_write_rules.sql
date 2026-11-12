-- Storage: inspection-photos upload needs an active account; vehicle-photos
-- objects can only be overwritten by their owner or an authorised same-org user.
--
-- FINDINGS: FILE-2 (P2), FILE-3 (P3), RLS-12 (P3)  - audit 2026-11-12.
-- STATUS: APPLIED LIVE on jhssdmeruxtrlqnwfksc 2026-11-12, EXCEPT the
--   "OWNER TO PASTE IN SQL EDITOR" block at the foot (RLS-12 dead admin arm),
--   which is NOT applied. Verified by rolled-back impersonation.
--
-- WHAT WAS WRONG (reproduced live, rolled back; storage.objects metadata rows
-- only - no real object was uploaded or removed):
--   FILE-2  the locked + unapproved account (app_is_active() = false) inserted
--           into inspection-photos -> accepted. Policy inspection_photos_upload
--           checked the bucket only.
--   FILE-3  a Driver ran UPDATE on vehicle-photos objects -> 1 row. Policy
--           vehicle_photos_update had no owner / organisation term.
--   RLS-12  inspection_photos (removal policy) compares get_my_role() = 'admin';
--           roles are Title Case, so the admin arm never matches.
--
-- WHAT THIS DOES
--   inspection_photos_upload  WITH CHECK adds app_is_active().
--   vehicle_photos_update     USING + WITH CHECK: approved-and-unlocked AND
--       (owner is the caller OR super admin OR ((Admin/Manager/Director or a
--        holder of fleet_master:edit) AND the owner is in the caller's org)).
--     fleet_master:edit is the capability that already governs who may edit the
--     asset register, so the person who can change a vehicle can still replace
--     its photo (vehicle360.js uploads with upsert).
--
-- -------------------------------------------------------------------- PRE-FLIGHT
-- Data loss: none (two ALTER POLICY statements; no object touched).
-- Buckets at apply time: inspection-photos 0 objects; vehicle-photos 2 objects
--   (one has no owner - the report logo - and stays updatable by nobody but the
--   service role / dashboard, as before for non-owners).
-- Clients: Expo / Flutter / web photo uploads go to tyre-photos and
--   accident-photos through "Authenticated photo uploads" (already requires an
--   active account) - unchanged. vehicle-photos: web vehicle360.js only.
-- Client behaviour that changes: a non-elevated user without fleet_master:edit
--   can no longer overwrite another user's vehicle photo. A locked or pending
--   account can no longer store files in inspection-photos.
-- Rollback: at the foot.

alter policy inspection_photos_upload on storage.objects
  with check (bucket_id = 'inspection-photos' and (select public.app_is_active()) is true);

alter policy vehicle_photos_update on storage.objects
  using (
    bucket_id = 'vehicle-photos'
    and (select public.is_approved_and_unlocked())
    and (
      owner = (select auth.uid())
      or (select public.is_super_admin())
      or (((select public.app_is_elevated()) or (select public.app_user_can('fleet_master', 'edit')))
          and public.storage_object_in_my_org(owner))
    )
  )
  with check (
    bucket_id = 'vehicle-photos'
    and (select public.is_approved_and_unlocked())
    and (
      owner = (select auth.uid())
      or (select public.is_super_admin())
      or (((select public.app_is_elevated()) or (select public.app_user_can('fleet_master', 'edit')))
          and public.storage_object_in_my_org(owner))
    )
  );

-- ------------------------------------------------------------------------ VERIFY
-- (run 2026-11-12, rolled back)
--   locked + unapproved account: insert inspection-photos   -> 42501 (was accepted)
--   Driver (active):             insert inspection-photos   -> accepted (control)
--   Tyre Man (active):           insert inspection-photos   -> accepted (control)
--   Driver / Tyre Man / Fleet Supervisor: update vehicle-photos -> 0 rows (was 1)
--   Manager, super admin:        update vehicle-photos       -> 1 row  (control)
--
-- ------------------------------------------- OWNER TO PASTE IN SQL EDITOR (RLS-12)
-- NOT APPLIED by the agent: the statement names a removal policy, which the
-- deployment tool holds for confirmation. Safe to run as is. It replaces the
-- never-matching lowercase role test with the org-admin helper and adds the
-- same-organisation term; the "own folder" arm is unchanged.
--
--   alter policy inspection_photos_delete on storage.objects
--     using (
--       bucket_id = 'inspection-photos'
--       and (
--         (storage.foldername(name))[1] = (select auth.uid())::text
--         or ((select public.app_is_org_admin()) and public.storage_object_in_my_org(owner))
--       )
--     );
--
-- ---------------------------------------------------------------------- ROLLBACK
--   alter policy inspection_photos_upload on storage.objects
--     with check (bucket_id = 'inspection-photos');
--   alter policy vehicle_photos_update on storage.objects
--     using (bucket_id = 'vehicle-photos' and is_approved_and_unlocked());
--   (the previous policy had no WITH CHECK; recreate it to remove the check.)
