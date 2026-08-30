-- Cover every foreign key reported by the Supabase performance advisor.
-- IF NOT EXISTS keeps this migration safe across environments with partial
-- index backfills.
create index if not exists accident_case_tasks_sla_instance_id_idx on public.accident_case_tasks (sla_instance_id);
create index if not exists accident_insurance_decisions_claim_id_idx on public.accident_insurance_decisions (claim_id);
create index if not exists accident_insurance_settlements_claim_id_idx on public.accident_insurance_settlements (claim_id);
create index if not exists accident_parts_requests_repair_order_id_idx on public.accident_parts_requests (repair_order_id);
create index if not exists accident_repair_quality_checks_repair_order_id_idx on public.accident_repair_quality_checks (repair_order_id);
create index if not exists accidents_cancelled_duplicate_of_idx on public.accidents (cancelled_duplicate_of);
create index if not exists account_deletion_requests_processed_by_idx on public.account_deletion_requests (processed_by);
create index if not exists approval_matrix_approver_user_id_idx on public.approval_matrix (approver_user_id);
create index if not exists asset_disposals_decided_by_idx on public.asset_disposals (decided_by);
create index if not exists checklist_submissions_supervisor_by_idx on public.checklist_submissions (supervisor_by);
create index if not exists insurance_claim_register_accident_id_idx on public.insurance_claim_register (accident_id);
create index if not exists insurance_claim_register_policy_id_idx on public.insurance_claim_register (policy_id);
create index if not exists insurance_loss_runs_policy_id_idx on public.insurance_loss_runs (policy_id);
create index if not exists insurance_policy_assets_policy_id_idx on public.insurance_policy_assets (policy_id);
create index if not exists insurance_property_risks_policy_id_idx on public.insurance_property_risks (policy_id);
create index if not exists parts_requests_part_id_idx on public.parts_requests (part_id);
create index if not exists release_impacts_release_id_idx on public.release_impacts (release_id);
create index if not exists tech_activity_events_task_id_idx on public.tech_activity_events (task_id);
create index if not exists wo_assignments_task_id_idx on public.wo_assignments (task_id);
create index if not exists work_orders_assigned_owner_id_idx on public.work_orders (assigned_owner_id);
create index if not exists workshop_attendance_shift_id_idx on public.workshop_attendance (shift_id);
