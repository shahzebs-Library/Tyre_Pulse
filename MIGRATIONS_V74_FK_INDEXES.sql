-- ============================================================================
-- MIGRATIONS_V74_FK_INDEXES
-- Performance advisory remediation: "Unindexed foreign keys" + "Duplicate index"
--
-- Supabase's performance advisor flags foreign-key columns that lack a covering
-- index. Without one, every UPDATE/DELETE on the referenced (parent) row forces
-- a sequential scan of the referencing (child) table to enforce the constraint,
-- and joins that filter on the FK column cannot use an index. This migration
-- adds a btree covering index for each of the 56 flagged foreign keys, in the
-- constraint's exact column order (all 56 are single-column FKs).
--
-- It also resolves one "Duplicate index" advisory on public.report_schedules,
-- which carried two byte-identical btree indexes on (org_id):
--   * idx_report_schedules_org_id      -- KEPT  (matches idx_<table>_<col> convention)
--   * report_schedules_org_id_idx      -- DROPPED (redundant duplicate)
-- Both were non-unique, non-primary and backed no constraint, so dropping the
-- duplicate is safe; the retained index preserves identical query planner
-- coverage on org_id.
--
-- Properties of this migration:
--   * Additive & idempotent   - CREATE INDEX IF NOT EXISTS / DROP INDEX IF EXISTS;
--                               re-running is a no-op.
--   * Reversible              - see the rollback block at the foot of this file.
--   * Transaction-safe        - uses plain CREATE INDEX (NOT CONCURRENTLY), which
--                               is required because migrations run inside a single
--                               transaction and CONCURRENTLY cannot run in one.
--   * No data change          - only index metadata is affected.
--
-- Index naming is deterministic: idx_<table>_<column>. All names are unique and
-- <= 63 bytes (Postgres identifier limit).
-- ============================================================================

-- ── Covering indexes for unindexed foreign keys (56) ────────────────────────

-- accident_parts
CREATE INDEX IF NOT EXISTS idx_accident_parts_created_by ON public.accident_parts (created_by);

-- accident_remarks
CREATE INDEX IF NOT EXISTS idx_accident_remarks_author_id ON public.accident_remarks (author_id);

-- accidents
CREATE INDEX IF NOT EXISTS idx_accidents_close_requested_by ON public.accidents (close_requested_by);
CREATE INDEX IF NOT EXISTS idx_accidents_closure_approved_by ON public.accidents (closure_approved_by);

-- admin_audit
CREATE INDEX IF NOT EXISTS idx_admin_audit_actor_id ON public.admin_audit (actor_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_target_id ON public.admin_audit (target_id);

-- announcements
CREATE INDEX IF NOT EXISTS idx_announcements_created_by ON public.announcements (created_by);
CREATE INDEX IF NOT EXISTS idx_announcements_target_org_id ON public.announcements (target_org_id);

-- audit_log
CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON public.audit_log (user_id);

-- budgets
CREATE INDEX IF NOT EXISTS idx_budgets_created_by ON public.budgets (created_by);

-- cleaning_log
CREATE INDEX IF NOT EXISTS idx_cleaning_log_tyre_record_id ON public.cleaning_log (tyre_record_id);

-- column_mappings
CREATE INDEX IF NOT EXISTS idx_column_mappings_confirmed_by ON public.column_mappings (confirmed_by);

-- corrective_actions
CREATE INDEX IF NOT EXISTS idx_corrective_actions_closed_by ON public.corrective_actions (closed_by);
CREATE INDEX IF NOT EXISTS idx_corrective_actions_created_by ON public.corrective_actions (created_by);

-- drivers
CREATE INDEX IF NOT EXISTS idx_drivers_created_by ON public.drivers (created_by);
CREATE INDEX IF NOT EXISTS idx_drivers_updated_by ON public.drivers (updated_by);

-- field_synonyms
CREATE INDEX IF NOT EXISTS idx_field_synonyms_created_by ON public.field_synonyms (created_by);

-- gate_passes
CREATE INDEX IF NOT EXISTS idx_gate_passes_cleared_by ON public.gate_passes (cleared_by);
CREATE INDEX IF NOT EXISTS idx_gate_passes_inspection_id ON public.gate_passes (inspection_id);

-- import_attachment_matches
CREATE INDEX IF NOT EXISTS idx_import_attachment_matches_file_id ON public.import_attachment_matches (file_id);
CREATE INDEX IF NOT EXISTS idx_import_attachment_matches_organisation_id ON public.import_attachment_matches (organisation_id);

-- import_audit_events
CREATE INDEX IF NOT EXISTS idx_import_audit_events_organisation_id ON public.import_audit_events (organisation_id);

-- import_batch_sheets
CREATE INDEX IF NOT EXISTS idx_import_batch_sheets_organisation_id ON public.import_batch_sheets (organisation_id);

-- import_batches
CREATE INDEX IF NOT EXISTS idx_import_batches_created_by ON public.import_batches (created_by);
CREATE INDEX IF NOT EXISTS idx_import_batches_file_id ON public.import_batches (file_id);
CREATE INDEX IF NOT EXISTS idx_import_batches_uploader ON public.import_batches (uploader);

-- import_files
CREATE INDEX IF NOT EXISTS idx_import_files_created_by ON public.import_files (created_by);

-- import_mapping_profiles
CREATE INDEX IF NOT EXISTS idx_import_mapping_profiles_created_by ON public.import_mapping_profiles (created_by);
CREATE INDEX IF NOT EXISTS idx_import_mapping_profiles_organisation_id ON public.import_mapping_profiles (organisation_id);

-- import_mapping_rules
CREATE INDEX IF NOT EXISTS idx_import_mapping_rules_organisation_id ON public.import_mapping_rules (organisation_id);

-- import_master_aliases
CREATE INDEX IF NOT EXISTS idx_import_master_aliases_created_by ON public.import_master_aliases (created_by);

-- import_row_issues
CREATE INDEX IF NOT EXISTS idx_import_row_issues_organisation_id ON public.import_row_issues (organisation_id);

-- import_rows
CREATE INDEX IF NOT EXISTS idx_import_rows_organisation_id ON public.import_rows (organisation_id);

-- inspection_audit_log
CREATE INDEX IF NOT EXISTS idx_inspection_audit_log_changed_by ON public.inspection_audit_log (changed_by);

-- inspections
CREATE INDEX IF NOT EXISTS idx_inspections_approved_by ON public.inspections (approved_by);
CREATE INDEX IF NOT EXISTS idx_inspections_linked_action_id ON public.inspections (linked_action_id);

-- kpi_targets
CREATE INDEX IF NOT EXISTS idx_kpi_targets_created_by ON public.kpi_targets (created_by);

-- module_permissions
CREATE INDEX IF NOT EXISTS idx_module_permissions_updated_by ON public.module_permissions (updated_by);

-- pending_uploads
CREATE INDEX IF NOT EXISTS idx_pending_uploads_reviewed_by ON public.pending_uploads (reviewed_by);
CREATE INDEX IF NOT EXISTS idx_pending_uploads_uploaded_by ON public.pending_uploads (uploaded_by);

-- profiles
CREATE INDEX IF NOT EXISTS idx_profiles_organisation_id ON public.profiles (organisation_id);

-- rca_records
CREATE INDEX IF NOT EXISTS idx_rca_records_corrective_action_id ON public.rca_records (corrective_action_id);
CREATE INDEX IF NOT EXISTS idx_rca_records_created_by ON public.rca_records (created_by);

-- recalls
CREATE INDEX IF NOT EXISTS idx_recalls_created_by ON public.recalls (created_by);

-- settings
CREATE INDEX IF NOT EXISTS idx_settings_updated_by ON public.settings (updated_by);

-- sites
CREATE INDEX IF NOT EXISTS idx_sites_created_by ON public.sites (created_by);

-- stock_movements
CREATE INDEX IF NOT EXISTS idx_stock_movements_created_by ON public.stock_movements (created_by);

-- stock_records
CREATE INDEX IF NOT EXISTS idx_stock_records_updated_by ON public.stock_records (updated_by);

-- suppliers
CREATE INDEX IF NOT EXISTS idx_suppliers_created_by ON public.suppliers (created_by);
CREATE INDEX IF NOT EXISTS idx_suppliers_updated_by ON public.suppliers (updated_by);

-- system_config
CREATE INDEX IF NOT EXISTS idx_system_config_updated_by ON public.system_config (updated_by);

-- tyre_records
CREATE INDEX IF NOT EXISTS idx_tyre_records_uploaded_by ON public.tyre_records (uploaded_by);

-- upload_history
CREATE INDEX IF NOT EXISTS idx_upload_history_uploaded_by ON public.upload_history (uploaded_by);

-- vehicle_fleet
CREATE INDEX IF NOT EXISTS idx_vehicle_fleet_created_by ON public.vehicle_fleet (created_by);

-- warranty_claims
CREATE INDEX IF NOT EXISTS idx_warranty_claims_created_by ON public.warranty_claims (created_by);

-- work_orders
CREATE INDEX IF NOT EXISTS idx_work_orders_created_by ON public.work_orders (created_by);

-- ── Duplicate index cleanup: public.report_schedules (org_id) ───────────────
-- Keep idx_report_schedules_org_id; drop the byte-identical duplicate.
DROP INDEX IF EXISTS public.report_schedules_org_id_idx;

-- ============================================================================
-- ROLLBACK (manual, if ever required)
-- ----------------------------------------------------------------------------
-- Reverses every change in this migration. The duplicate index is recreated
-- with its original definition; all FK covering indexes are dropped.
--
--   DROP INDEX IF EXISTS public.idx_accident_parts_created_by;
--   DROP INDEX IF EXISTS public.idx_accident_remarks_author_id;
--   DROP INDEX IF EXISTS public.idx_accidents_close_requested_by;
--   DROP INDEX IF EXISTS public.idx_accidents_closure_approved_by;
--   DROP INDEX IF EXISTS public.idx_admin_audit_actor_id;
--   DROP INDEX IF EXISTS public.idx_admin_audit_target_id;
--   DROP INDEX IF EXISTS public.idx_announcements_created_by;
--   DROP INDEX IF EXISTS public.idx_announcements_target_org_id;
--   DROP INDEX IF EXISTS public.idx_audit_log_user_id;
--   DROP INDEX IF EXISTS public.idx_budgets_created_by;
--   DROP INDEX IF EXISTS public.idx_cleaning_log_tyre_record_id;
--   DROP INDEX IF EXISTS public.idx_column_mappings_confirmed_by;
--   DROP INDEX IF EXISTS public.idx_corrective_actions_closed_by;
--   DROP INDEX IF EXISTS public.idx_corrective_actions_created_by;
--   DROP INDEX IF EXISTS public.idx_drivers_created_by;
--   DROP INDEX IF EXISTS public.idx_drivers_updated_by;
--   DROP INDEX IF EXISTS public.idx_field_synonyms_created_by;
--   DROP INDEX IF EXISTS public.idx_gate_passes_cleared_by;
--   DROP INDEX IF EXISTS public.idx_gate_passes_inspection_id;
--   DROP INDEX IF EXISTS public.idx_import_attachment_matches_file_id;
--   DROP INDEX IF EXISTS public.idx_import_attachment_matches_organisation_id;
--   DROP INDEX IF EXISTS public.idx_import_audit_events_organisation_id;
--   DROP INDEX IF EXISTS public.idx_import_batch_sheets_organisation_id;
--   DROP INDEX IF EXISTS public.idx_import_batches_created_by;
--   DROP INDEX IF EXISTS public.idx_import_batches_file_id;
--   DROP INDEX IF EXISTS public.idx_import_batches_uploader;
--   DROP INDEX IF EXISTS public.idx_import_files_created_by;
--   DROP INDEX IF EXISTS public.idx_import_mapping_profiles_created_by;
--   DROP INDEX IF EXISTS public.idx_import_mapping_profiles_organisation_id;
--   DROP INDEX IF EXISTS public.idx_import_mapping_rules_organisation_id;
--   DROP INDEX IF EXISTS public.idx_import_master_aliases_created_by;
--   DROP INDEX IF EXISTS public.idx_import_row_issues_organisation_id;
--   DROP INDEX IF EXISTS public.idx_import_rows_organisation_id;
--   DROP INDEX IF EXISTS public.idx_inspection_audit_log_changed_by;
--   DROP INDEX IF EXISTS public.idx_inspections_approved_by;
--   DROP INDEX IF EXISTS public.idx_inspections_linked_action_id;
--   DROP INDEX IF EXISTS public.idx_kpi_targets_created_by;
--   DROP INDEX IF EXISTS public.idx_module_permissions_updated_by;
--   DROP INDEX IF EXISTS public.idx_pending_uploads_reviewed_by;
--   DROP INDEX IF EXISTS public.idx_pending_uploads_uploaded_by;
--   DROP INDEX IF EXISTS public.idx_profiles_organisation_id;
--   DROP INDEX IF EXISTS public.idx_rca_records_corrective_action_id;
--   DROP INDEX IF EXISTS public.idx_rca_records_created_by;
--   DROP INDEX IF EXISTS public.idx_recalls_created_by;
--   DROP INDEX IF EXISTS public.idx_settings_updated_by;
--   DROP INDEX IF EXISTS public.idx_sites_created_by;
--   DROP INDEX IF EXISTS public.idx_stock_movements_created_by;
--   DROP INDEX IF EXISTS public.idx_stock_records_updated_by;
--   DROP INDEX IF EXISTS public.idx_suppliers_created_by;
--   DROP INDEX IF EXISTS public.idx_suppliers_updated_by;
--   DROP INDEX IF EXISTS public.idx_system_config_updated_by;
--   DROP INDEX IF EXISTS public.idx_tyre_records_uploaded_by;
--   DROP INDEX IF EXISTS public.idx_upload_history_uploaded_by;
--   DROP INDEX IF EXISTS public.idx_vehicle_fleet_created_by;
--   DROP INDEX IF EXISTS public.idx_warranty_claims_created_by;
--   DROP INDEX IF EXISTS public.idx_work_orders_created_by;
--   CREATE INDEX IF NOT EXISTS report_schedules_org_id_idx ON public.report_schedules USING btree (org_id);
-- ============================================================================
