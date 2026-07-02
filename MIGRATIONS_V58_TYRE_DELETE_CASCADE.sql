-- ============================================================================
-- MIGRATIONS_V58_TYRE_DELETE_CASCADE.sql
-- Fix: deleting a tyre record failed for EVERYONE (even Admins) with
--   "violates foreign key constraint cleaning_log_tyre_record_id_fkey"
-- because cleaning_log.tyre_record_id referenced tyre_records with NO ON DELETE
-- action (NO ACTION). Any tyre record that had ever been AI-text-cleaned could
-- not be deleted, and the web UI swallowed the error so the button silently
-- did nothing.
--
-- cleaning_log is an operational AI data-cleaning log about a specific tyre
-- record's text; once the record is gone the log rows are orphaned noise, so
-- ON DELETE CASCADE is the correct behaviour — deleting the record removes its
-- cleaning-log rows in the same transaction.
--
-- Verified live (rolled back): after this, an Admin can delete a tyre record
-- that has a cleaning_log reference; a non-admin remains blocked by RLS.
--
-- Two sibling FKs had the same NO ACTION trap and silently blocked deletes:
--   * corrective_actions  <- rca_records.corrective_action_id
--   * inspections         <- gate_passes.inspection_id
-- Unlike cleaning_log, RCA records and gate passes are independent entities with
-- their own value, and both child columns are nullable, so ON DELETE SET NULL is
-- correct: deleting the parent unlinks the child instead of destroying it.
--
-- Rollback:
--   ALTER TABLE public.cleaning_log DROP CONSTRAINT cleaning_log_tyre_record_id_fkey;
--   ALTER TABLE public.cleaning_log ADD CONSTRAINT cleaning_log_tyre_record_id_fkey
--     FOREIGN KEY (tyre_record_id) REFERENCES public.tyre_records(id);
--   ALTER TABLE public.rca_records DROP CONSTRAINT rca_records_corrective_action_id_fkey;
--   ALTER TABLE public.rca_records ADD CONSTRAINT rca_records_corrective_action_id_fkey
--     FOREIGN KEY (corrective_action_id) REFERENCES public.corrective_actions(id);
--   ALTER TABLE public.gate_passes DROP CONSTRAINT gate_passes_inspection_id_fkey;
--   ALTER TABLE public.gate_passes ADD CONSTRAINT gate_passes_inspection_id_fkey
--     FOREIGN KEY (inspection_id) REFERENCES public.inspections(id);
-- ============================================================================

ALTER TABLE public.cleaning_log DROP CONSTRAINT cleaning_log_tyre_record_id_fkey;
ALTER TABLE public.cleaning_log
  ADD CONSTRAINT cleaning_log_tyre_record_id_fkey
  FOREIGN KEY (tyre_record_id) REFERENCES public.tyre_records(id) ON DELETE CASCADE;

ALTER TABLE public.rca_records DROP CONSTRAINT rca_records_corrective_action_id_fkey;
ALTER TABLE public.rca_records
  ADD CONSTRAINT rca_records_corrective_action_id_fkey
  FOREIGN KEY (corrective_action_id) REFERENCES public.corrective_actions(id) ON DELETE SET NULL;

ALTER TABLE public.gate_passes DROP CONSTRAINT gate_passes_inspection_id_fkey;
ALTER TABLE public.gate_passes
  ADD CONSTRAINT gate_passes_inspection_id_fkey
  FOREIGN KEY (inspection_id) REFERENCES public.inspections(id) ON DELETE SET NULL;
