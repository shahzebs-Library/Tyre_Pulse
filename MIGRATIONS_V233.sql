-- V233: covering indexes for 7 unindexed foreign keys + drop 1 duplicate index. Applied live 2026-07-14.
CREATE INDEX IF NOT EXISTS idx_checklist_assignments_submission_id ON public.checklist_assignments (submission_id);
CREATE INDEX IF NOT EXISTS idx_country_addresses_created_by       ON public.country_addresses (created_by);
CREATE INDEX IF NOT EXISTS idx_country_addresses_updated_by       ON public.country_addresses (updated_by);
CREATE INDEX IF NOT EXISTS idx_invoices_subscription_id           ON public.invoices (subscription_id);
CREATE INDEX IF NOT EXISTS idx_org_subscriptions_plan_code        ON public.org_subscriptions (plan_code);
CREATE INDEX IF NOT EXISTS idx_user_access_grants_granted_by      ON public.user_access_grants (granted_by);
CREATE INDEX IF NOT EXISTS idx_workflow_instances_definition_id   ON public.workflow_instances (definition_id);
DROP INDEX IF EXISTS public.report_schedules_next_run_idx;
