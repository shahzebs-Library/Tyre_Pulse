-- ============================================================================
-- MIGRATIONS_V421_UNINDEXED_FK_INDEXES
--
-- STATUS: AUTHORED, NOT YET APPLIED.
--   Needs a Supabase-MCP-authorized session (project jhssdmeruxtrlqnwfksc) to
--   apply and to record in supabase_migrations.schema_migrations. This file is a
--   ready-to-apply ARTIFACT written from repo evidence only; the live DB was NOT
--   reachable when it was authored, so re-confirm the free migration number and
--   the current advisor output at apply time.
--
--   MIGRATION NUMBER: V417 and V418 are RESERVED by the accident-module design
--   (02_DATA_MODEL.sql / 08_ENGINE_SQL_MIRROR.sql). This file claims V421. If any
--   of V417..V420 have shipped by apply time, renumber this to the next free slot.
-- ============================================================================
--
-- PURPOSE
--   The Supabase performance advisor reported 6 unindexed_foreign_keys on the
--   workshop / account-deletion tables. A foreign key with no covering index
--   forces a sequential scan of the child table on every parent UPDATE/DELETE
--   (cascade enforcement) and prevents index use on FK-join lookups. This adds a
--   btree covering index for each identified uncovered FK column, in the
--   constraint's column order (all identified FKs are single-column).
--
-- PROPERTIES
--   * Additive and idempotent  - CREATE INDEX IF NOT EXISTS; re-running is a no-op.
--   * Reversible               - see the ROLLBACK block at the foot of this file.
--   * Transaction-safe         - plain CREATE INDEX (NOT CONCURRENTLY), so it can
--                                run inside the single migration transaction.
--                                NOTE: CREATE INDEX CONCURRENTLY cannot run inside
--                                a transaction block. If a lock-free build on a hot
--                                table is required, run the CONCURRENTLY variant of
--                                each statement OUTSIDE any transaction instead.
--   * No data change           - only index metadata is affected.
--
--   Index naming follows the repo convention idx_<table>_<column> (see
--   MIGRATIONS_V74_FK_INDEXES.sql). IF NOT EXISTS guards the index NAME; if the
--   applied V291/V296 migrations already created a same-column index under a
--   DIFFERENT name, run \d <table> first and skip that column here to avoid a
--   duplicate_index advisory.
--
-- REPO EVIDENCE (FK column sources)
--   work_orders.assigned_owner_id -> profiles(id)
--       MIGRATIONS_V291_WORKSHOP_LIVE_CONTROL.sql:76
--       (work_orders.created_by is already indexed by MIGRATIONS_V74_FK_INDEXES.sql:173)
--   tech_activity_events.user_id  -> profiles(id)      V291:48
--   tech_activity_events.job_id   -> work_orders(id)   V291:49
--   tech_activity_events.task_id  -> wo_tasks(id)      V291:50
--   wo_assignments.job_id         -> work_orders(id)   V291:34
--   wo_assignments.task_id        -> wo_tasks(id)       V291:35
--   wo_assignments.user_id        -> profiles(id)       V291:36
--   workshop_attendance.user_id   -> profiles(id)       V291:67
--   workshop_attendance.shift_id  -> shifts(id)         V291:68
--   parts_requests.part_id        -> parts_catalog      MIGRATIONS_V296_PARTS_REQUESTS.sql:2
--       (parts_requests.job_id is already indexed - V296:5 "Indexes (job_id),(status),(organisation_id)")
--   account_deletion_requests.processed_by -> auth.users(id)
--       MIGRATIONS_V317_ACCOUNT_DELETION_REQUESTS.sql:34
--       (account_deletion_requests.user_id is already indexed - V317:42 account_deletion_requests_user_idx)
--
-- NEEDS LIVE CONFIRMATION (\d at apply time)
--   * parts_requests.requested_by / parts_requests.approved_by: the V296 file is a
--     SUMMARY and does not show REFERENCES clauses, so it is not certain these
--     columns are declared FOREIGN KEYs (vs plain uuid audit columns). If \d shows
--     either is an FK lacking a covering index, add its index (statements are
--     provided commented-out below).
--   * Because the applied V291/V296 index DDL is not fully mirrored in the repo,
--     the advisor's exact 6 columns could not be pinned per multi-FK table
--     (tech_activity_events / wo_assignments / workshop_attendance each declare
--     more than one FK). Every FK column identified from the CREATE TABLE text is
--     covered below; IF NOT EXISTS makes any already-indexed one a no-op. Verify
--     with \d and drop any that duplicate an existing differently-named index.
-- ============================================================================

-- ---- work_orders ----------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_work_orders_assigned_owner_id
  ON public.work_orders (assigned_owner_id);

-- ---- tech_activity_events -------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_tech_activity_events_user_id
  ON public.tech_activity_events (user_id);
CREATE INDEX IF NOT EXISTS idx_tech_activity_events_job_id
  ON public.tech_activity_events (job_id);
CREATE INDEX IF NOT EXISTS idx_tech_activity_events_task_id
  ON public.tech_activity_events (task_id);

-- ---- wo_assignments -------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_wo_assignments_job_id
  ON public.wo_assignments (job_id);
CREATE INDEX IF NOT EXISTS idx_wo_assignments_task_id
  ON public.wo_assignments (task_id);
CREATE INDEX IF NOT EXISTS idx_wo_assignments_user_id
  ON public.wo_assignments (user_id);

-- ---- workshop_attendance --------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_workshop_attendance_user_id
  ON public.workshop_attendance (user_id);
CREATE INDEX IF NOT EXISTS idx_workshop_attendance_shift_id
  ON public.workshop_attendance (shift_id);

-- ---- parts_requests -------------------------------------------------------
-- job_id already indexed (V296). part_id is the uncovered FK.
CREATE INDEX IF NOT EXISTS idx_parts_requests_part_id
  ON public.parts_requests (part_id);
-- Uncomment ONLY if \d confirms these are declared FKs lacking a covering index:
-- CREATE INDEX IF NOT EXISTS idx_parts_requests_requested_by
--   ON public.parts_requests (requested_by);
-- CREATE INDEX IF NOT EXISTS idx_parts_requests_approved_by
--   ON public.parts_requests (approved_by);

-- ---- account_deletion_requests --------------------------------------------
-- user_id already indexed (V317). processed_by is the uncovered FK.
CREATE INDEX IF NOT EXISTS idx_account_deletion_requests_processed_by
  ON public.account_deletion_requests (processed_by);

-- ============================================================================
-- ROLLBACK (manual, if ever required)
-- ----------------------------------------------------------------------------
--   DROP INDEX IF EXISTS public.idx_work_orders_assigned_owner_id;
--   DROP INDEX IF EXISTS public.idx_tech_activity_events_user_id;
--   DROP INDEX IF EXISTS public.idx_tech_activity_events_job_id;
--   DROP INDEX IF EXISTS public.idx_tech_activity_events_task_id;
--   DROP INDEX IF EXISTS public.idx_wo_assignments_job_id;
--   DROP INDEX IF EXISTS public.idx_wo_assignments_task_id;
--   DROP INDEX IF EXISTS public.idx_wo_assignments_user_id;
--   DROP INDEX IF EXISTS public.idx_workshop_attendance_user_id;
--   DROP INDEX IF EXISTS public.idx_workshop_attendance_shift_id;
--   DROP INDEX IF EXISTS public.idx_parts_requests_part_id;
--   DROP INDEX IF EXISTS public.idx_parts_requests_requested_by;
--   DROP INDEX IF EXISTS public.idx_parts_requests_approved_by;
--   DROP INDEX IF EXISTS public.idx_account_deletion_requests_processed_by;
-- ============================================================================
