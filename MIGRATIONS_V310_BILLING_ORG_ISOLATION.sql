-- V310 (Phase-1 SaaS security, follow-up to V306/B2) — applied live 2026-07-20
-- The billing tables invoices / org_subscriptions had PERMISSIVE policies whose
-- scope allowed "organisation_id IS NULL OR = app_current_org()". A null-org
-- billing row would be visible/writable to an elevated user in ANY org. A billing
-- record always belongs to a specific org (Stripe checkout stamps org_id), so the
-- null branch is a latent cross-tenant leak with no legitimate use. Both tables
-- have 0 rows and 0 null-org rows today, so dropping the branch hides nothing.
-- NOTE (deliberately NOT changed): the workflow-engine tables (workflow_definitions/
-- instances/notifications/step_events, domain_events, rule_executions) and
-- report_send_log legitimately hold null-org / system rows today and would be
-- emptied for elevated users if scoped; they need an org backfill first.

drop policy if exists invoices_read on public.invoices;
create policy invoices_read on public.invoices
  as permissive for select to authenticated
  using (organisation_id = (select public.app_current_org()));

drop policy if exists invoices_admin_write on public.invoices;
create policy invoices_admin_write on public.invoices
  as permissive for all to authenticated
  using (
    organisation_id = (select public.app_current_org())
    and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'Admin')
  )
  with check (
    organisation_id = (select public.app_current_org())
    and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'Admin')
  );

drop policy if exists org_subscriptions_read on public.org_subscriptions;
create policy org_subscriptions_read on public.org_subscriptions
  as permissive for select to authenticated
  using (organisation_id = (select public.app_current_org()));

drop policy if exists org_subscriptions_admin_write on public.org_subscriptions;
create policy org_subscriptions_admin_write on public.org_subscriptions
  as permissive for all to authenticated
  using (
    organisation_id = (select public.app_current_org())
    and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'Admin')
  )
  with check (
    organisation_id = (select public.app_current_org())
    and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'Admin')
  );
