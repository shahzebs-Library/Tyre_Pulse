-- ============================================================================
-- 20260930120002_storage_photo_write_scope
-- STATUS: APPLIED LIVE 2026-09-30 + verified (Driver overwrite-others 13,084 -> 0; reads unchanged 14,605).
--
-- FINDING (audit 2026-09-30, AUD-03, HIGH): photo EVIDENCE in private buckets
-- can be overwritten or deleted by any active account in the organisation.
--
-- 1. storage.objects policy "Authenticated own photo updates" (UPDATE, role
--    authenticated): USING/CHECK = bucket_id in ('tyre-photos','inspection-
--    photos','accident-photos') AND app_is_active(). Despite its name it has no
--    owner check and no org check. UPDATE is what the Storage API uses for an
--    upsert/overwrite, so any active user can REPLACE any photo it can name.
--    Evidence (rolled back, KSA Driver 69ed2a92):
--      update storage.objects set metadata=metadata where bucket_id='tyre-photos'
--        and owner is distinct from <driver> and name like 'photos/%'   -> 13,084 rows
--    (Demo-org Manager c2f9a806: 0 rows - the SELECT policy's
--    storage_object_in_my_org(owner) limits it to the caller's own org.)
-- 2. storage.objects policy accident_photos_auth_delete (DELETE, authenticated):
--    USING bucket_id='accident-photos' AND foldername(name)[1]='accidents' -
--    no owner, role or org check. All 13 accident photos sit under 'accidents/'
--    (1 owner) and all 13 are visible to the Driver (read policy = same org), so
--    any of the 726 same-org accounts can delete accident evidence through the
--    Storage API. (Direct SQL DELETE is blocked by storage.protect_delete, so
--    this was proven from the policy expression + visibility, not by deleting.)
--    The sibling policy auth_delete_accident_photos (owner = auth.uid()) already
--    covers the legitimate "delete my own upload" case.
--
-- FIX: keep uploader self-service (owner = auth.uid()); allow elevated users
-- (admin/manager/director) only inside their own organisation; drop the
-- unscoped delete.
--
-- PRE-FLIGHT: policy DDL only on storage.objects (14,6xx rows). No data change.
-- Client impact: an offline retry re-uploads with upsert to the SAME path as the
-- SAME user -> still allowed (owner). A non-owner, non-elevated overwrite will
-- now fail with 403, which is the intent.
-- ============================================================================

begin;

drop policy if exists "Authenticated own photo updates" on storage.objects;

create policy "Photo updates owner or elevated same org" on storage.objects
  for update to authenticated
  using (
    bucket_id = any (array['tyre-photos','inspection-photos','accident-photos'])
    and public.app_is_active()
    and (owner = (select auth.uid())
         or ((select public.app_is_elevated()) and public.storage_object_in_my_org(owner)))
  )
  with check (
    bucket_id = any (array['tyre-photos','inspection-photos','accident-photos'])
    and public.app_is_active()
    and (owner = (select auth.uid())
         or ((select public.app_is_elevated()) and public.storage_object_in_my_org(owner)))
  );

drop policy if exists accident_photos_auth_delete on storage.objects;

create policy accident_photos_elevated_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'accident-photos'
    and (select public.app_is_elevated())
    and public.storage_object_in_my_org(owner)
  );

commit;

-- ----------------------------------------------------------------------------
-- VERIFY (after apply; rolled back):
-- do $$ declare r jsonb := '{}'; n int; begin
--   perform set_config('request.jwt.claims', json_build_object('sub','69ed2a92-0e66-4d5a-a118-9354eb1fb1f4','role','authenticated')::text, true);
--   set local role authenticated;
--   with u as (update storage.objects set metadata=metadata where bucket_id='tyre-photos'
--     and owner is distinct from '69ed2a92-0e66-4d5a-a118-9354eb1fb1f4'::uuid returning 1) select count(*) into n from u;
--   r := r || jsonb_build_object('driver_overwrite_others', n);   -- expect 0 (was 13,084)
--   reset role; raise exception 'RESULT %', r; end $$;
-- Policy check for delete (cannot DELETE via SQL - protect_delete):
-- select polname, pg_get_expr(polqual, polrelid) from pg_policy
--  where polrelid='storage.objects'::regclass and polcmd='d';   -- no unscoped accident delete
-- Functional: as an Inspector, upload a tyre photo and re-upload it with upsert -> succeeds.
--
-- ROLLBACK:
-- begin;
-- drop policy if exists "Photo updates owner or elevated same org" on storage.objects;
-- drop policy if exists accident_photos_elevated_delete on storage.objects;
-- create policy "Authenticated own photo updates" on storage.objects for update to authenticated
--   using ((bucket_id = any (array['tyre-photos','inspection-photos','accident-photos'])) and public.app_is_active())
--   with check ((bucket_id = any (array['tyre-photos','inspection-photos','accident-photos'])) and public.app_is_active());
-- create policy accident_photos_auth_delete on storage.objects for delete to authenticated
--   using ((bucket_id = 'accident-photos') and ((storage.foldername(name))[1] = 'accidents'));
-- commit;
-- ----------------------------------------------------------------------------
