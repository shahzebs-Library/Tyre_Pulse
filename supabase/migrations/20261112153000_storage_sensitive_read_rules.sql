-- Storage reads: raw import files and accident identity documents are no longer
-- readable by every member of the organisation.
--
-- FINDING: FILE-1 (P1)  - audit 2026-11-12.
-- STATUS: APPLIED LIVE on jhssdmeruxtrlqnwfksc 2026-11-12. Verified by
--   rolled-back impersonation (VERIFY block at the foot).
--
-- WHAT WAS WRONG (reproduced live as a Driver, rolled back):
--   import-files      29 objects visible (raw ERP / expense / asset workbooks,
--                     all three countries)
--   accident-photos   13 objects visible, 8 of them identity / insurer
--                     documents (licence, resident id, registration, Najm)
--   Read policies were "active account AND owner is in my organisation" only.
--
-- MEASURED BEFORE CHANGING ANYTHING (object paths, live)
--   import-files     <org>/<country>/<module>/...   29 objects, segment 2 is
--                    always KSA / UAE / Egypt.
--   accident-photos  accidents/<uid>/<category>_<ts>_<rand>.<ext> (Expo). The
--                    category is the file-name prefix: accident_ (5 photos),
--                    license_ / resident_ / registration_ / najm_ / taqdeer_
--                    (8 documents). Distinguishable by path.
--   tyre-photos      photos/ 22,532, modules/<meter-log|wash|checklist|...>/
--                    3,276, inspections/ 1,170, checklists/ 24. NO object under
--                    accidents/ yet; the web accident evidence uploader
--                    (src/lib/api/accidentEvidence.js) writes
--                    accidents/<accidentId>/..., photos and documents mixed.
--
-- WHAT THIS DOES (three ALTER POLICY; every existing term is kept)
--   import_files_auth_read     adds: the uploader, OR (Admin/Manager/Director,
--       super admin, or a holder of upload_data:view) whose country scope covers
--       the path's country segment (super admin: all).
--   accident_photos_auth_read  adds: a document-named object
--       (license_/resident_/registration_/najm_/taqdeer_) is readable only by
--       its uploader, Admin/Manager/Director, super admin, or a holder of
--       accidents:view (the people who work accident cases: Fleet Supervisor,
--       Tyre Data Collector, PMV Manager, ...). accident_ photos are unchanged.
--   tyre_photos_read           adds: the same rule for the accidents/ prefix.
--       Everything else in the bucket (inspection, tyre, wash, meter, checklist
--       photos) is unchanged - field roles keep what they see today.
--
-- NOT SOLVED HERE - NEEDS A PATH CONVENTION CHANGE IN THE CLIENTS
--   Flutter uploads accident claim-package / case documents to accident-photos as
--   accidents/<first 8 of uid>/<free file name>
--   (tyre_pulse_flutter/.../accident_case_rows.dart, accident_case_docs_repository.dart).
--   Nothing in that path says "document", so those objects stay readable by any
--   active member of the organisation. Fix in the clients: a documents/ segment
--   (or the Expo category prefix), then extend the pattern below.
--   Storage objects also carry no record id / country, so a per-record or
--   per-country rule for photos is not possible until paths are org- and
--   record-prefixed (FILE-4).
--
-- -------------------------------------------------------------------- PRE-FLIGHT
-- Data loss: none (policies only).
-- Readers checked: web Data Intake (src/lib/api/imports.js) - route is
--   Admin/Manager/Director or upload_data module; console storage centre uses
--   super-admin RPCs; edge functions use the service role (not subject to RLS).
--   Mobile / Flutter do not read import-files.
-- Roles holding accidents:view today (measured by impersonation): Manager,
--   Fleet Supervisor, Tyre Data Collector, Data Monitor Officer, Maintenance
--   Supervisor, PMV Manager, Tire Planning Engineer, Workshop Maintenance Area
--   Manager. Driver, Tyre Man, Inspector, Reporter and the trades: no.
-- Performance: the new role terms are (select ...) init-plans, evaluated once
--   per statement; the path tests are plain string operations.
-- Client behaviour that changes: a Driver / Tyre Man / Inspector who opens an
--   accident filed by SOMEONE ELSE no longer loads its licence / id /
--   registration / Najm / Taqdeer images (their own uploads still load). Field
--   roles no longer see Data Intake source files.
-- Rollback: at the foot.

alter policy import_files_auth_read on storage.objects
  using (
    bucket_id = 'import-files'
    and public.app_is_active()
    and public.storage_object_in_my_org(owner)
    and (
      owner = (select auth.uid())
      or (
        ((select public.app_is_elevated())
          or (select public.is_super_admin())
          or (select public.app_user_can('upload_data', 'view')))
        and (
          (select public.is_super_admin())
          or (storage.foldername(name))[2] is null
          or upper((storage.foldername(name))[2]) in ('NA', 'ALL')
          or public.app_can_see_country((storage.foldername(name))[2])
        )
      )
    )
  );

alter policy accident_photos_auth_read on storage.objects
  using (
    bucket_id = 'accident-photos'
    and public.app_is_active()
    and public.storage_object_in_my_org(owner)
    and (
      name !~ '^accidents/[^/]+/(license|resident|registration|najm|taqdeer)_'
      or owner = (select auth.uid())
      or (select public.app_is_elevated())
      or (select public.is_super_admin())
      or (select public.app_user_can('accidents', 'view'))
    )
  );

alter policy tyre_photos_read on storage.objects
  using (
    bucket_id = 'tyre-photos'
    and public.app_is_active()
    and public.storage_object_in_my_org(owner)
    and (
      name not like 'accidents/%'
      or owner = (select auth.uid())
      or (select public.app_is_elevated())
      or (select public.is_super_admin())
      or (select public.app_user_can('accidents', 'view'))
    )
  );

-- ------------------------------------------------------------------------ VERIFY
-- (run 2026-11-12, rolled back; a metadata-only probe row
--  tyre-photos/accidents/probe-case/probe.jpg was inserted inside the transaction)
--                      import-files  accident docs  accident photos  tyre accidents/  tyre inspections/
--   Driver                  0 (29)        0 (8)        5 (5)             0                1,170 (same)
--   Tyre Man                0             0            5                 0                1,170 (same)
--   locked account          0             0            0                 0                0
--   Fleet Supervisor        0             8            5                 1                -
--   KSA Manager            26 (KSA only)  8            5                 1                -
--   super admin            29             8            5                 1                -
--   document uploader       -             8 (own)      5                 -                -
--   (before values in brackets)
--
-- ---------------------------------------------------------------------- ROLLBACK
--   alter policy import_files_auth_read on storage.objects
--     using (bucket_id = 'import-files' and app_is_active() and storage_object_in_my_org(owner));
--   alter policy accident_photos_auth_read on storage.objects
--     using (bucket_id = 'accident-photos' and app_is_active() and storage_object_in_my_org(owner));
--   alter policy tyre_photos_read on storage.objects
--     using (bucket_id = 'tyre-photos' and app_is_active() and storage_object_in_my_org(owner));
