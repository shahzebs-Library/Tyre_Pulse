-- Locked or unapproved accounts can no longer read business / configuration tables.
--
-- FINDING: AUTH-2 (P1)  - audit 2026-11-12.
-- STATUS: APPLIED LIVE on jhssdmeruxtrlqnwfksc 2026-11-12. Verified by
--   rolled-back impersonation (VERIFY block at the foot).
--
-- WHAT WAS WRONG (reproduced live as the one locked + unapproved account,
-- app_is_active() = false, 484-table sweep, rolled back). Rows readable:
--   action_item_history 169, action_items 161, ai_models 5, brand_aliases 36,
--   budgets 12, checklist_templates 12, column_mappings 16, corrective_actions 161,
--   country_currency 3, custom_roles 33, due_alert_rules 8,
--   import_mapping_profiles 9, import_mapping_rules 193, incident_reports 3,
--   module_permissions 1346, modules 194, organisations 1, rca_records 1,
--   sco_costs 672, site_aliases 54, sites 45, stock_movements 78, stock_records 36,
--   subscription_plans 4, workflow_definitions 25, system_config 62
--   (+ its own profiles row, which is intended).
--   Their read policies test only auth.role()='authenticated' / auth.uid() is not
--   null / a site helper - none checks approval or lock.
--
-- WHAT THIS DOES. One RESTRICTIVE SELECT policy per table, for role authenticated:
--     <table>_active_user_read  USING ((select app_is_active()) is true)
--   on the 25 tables listed in the loop below. Same name and shape as the existing
--   kpi_targets_active_user_read. A restrictive policy can only remove rows, and
--   only for a caller whose account is not approved-and-unlocked; an active
--   user's result is unchanged (proved by before/after counts).
--
-- NOT CHANGED HERE, ON PURPOSE
--   system_config - its read scope is owned by a separate change (RLS-11). It
--     still returns its 62 rows to a locked/unapproved account until that lands.
--   profiles - a pending user must read their own row (profiles_active_or_self_read
--     already limits them to it).
--   Registration being open and a lock not ending the GoTrue session are auth
--     settings / edge behaviour, outside a database-only change.
--
-- -------------------------------------------------------------------- PRE-FLIGHT
-- Data loss: none (policies only). No table rewrite, no data touched.
-- Locks: CREATE POLICY takes a brief ACCESS EXCLUSIVE on each table; all 25 are
--   small (largest module_permissions 1346 rows).
-- Who else reads these tables:
--   anon          - no table grants; policies are TO authenticated only.
--   service role / cron / SECURITY DEFINER RPCs (public token boards, login
--     lookup, get_user_module_permissions, normalize_site, workflow engine,
--     due-alert scan) - run as the owner, RLS not applied: unaffected.
--   INVOKER helpers called by signed-in users (currency_for_country inside the
--     expense classifier) - the caller is an active user wherever the write
--     itself is allowed, so the helper reads the same rows as before.
-- Performance: (select app_is_active()) is an InitPlan - evaluated once per query.
-- Client behaviour that changes: none for approved, unlocked users. A locked or
--   pending account now gets empty lists from these tables (the apps already sign
--   such an account out).
-- Rollback: at the foot.

do $mig$
declare
  t text;
begin
  foreach t in array array[
    'action_item_history','action_items','ai_models','brand_aliases','budgets',
    'checklist_templates','column_mappings','corrective_actions','country_currency',
    'custom_roles','due_alert_rules','import_mapping_profiles','import_mapping_rules',
    'incident_reports','module_permissions','modules','organisations','rca_records',
    'sco_costs','site_aliases','sites','stock_movements','stock_records',
    'subscription_plans','workflow_definitions'
  ] loop
    if to_regclass('public.' || quote_ident(t)) is null then
      raise exception 'table % not found', t;
    end if;
    if not exists (select 1 from pg_policies
                    where schemaname = 'public' and tablename = t
                      and policyname = t || '_active_user_read') then
      execute format(
        'create policy %I on public.%I as restrictive for select to authenticated '
        || 'using ((select public.app_is_active()) is true)',
        t || '_active_user_read', t);
    end if;
  end loop;
end
$mig$;

-- ============================================================================
-- VERIFY (rolled-back impersonation; counts in the table order of the loop above)
--   locked + unapproved 6627f7f6-...  BEFORE 169,161,5,36,12,12,16,161,3,33,8,9,193,3,1346,194,1,1,672,54,45,78,36,4,25
--                                     AFTER  0 on all 25; own profiles row still 1
--   active users - identical before and after:
--     KSA Manager 34793423-...   169,161,5,36,12,12,16,161,3,33,8,9,193,3,1346,194,1,1,672,54,45,78,36,4,25
--     KSA Driver  ebd60db1-...   same as the Manager
--     KSA Tyre Man 5d9edcb1-...  same as the Manager
--     Egypt Tyre Data Collector 0bdeeb0d-...  169,2,5,36,0,7,16,2,3,33,8,6,193,3,1346,194,1,0,0,54,4,78,1,4,25
--   anon token RPC still answers (get_public_config, get_email_by_identifier).
--
-- ROLLBACK (owner, SQL editor - statements the MCP gate will not run):
--   for each table in the list above:
--     drop policy <table>_active_user_read on public.<table>;
