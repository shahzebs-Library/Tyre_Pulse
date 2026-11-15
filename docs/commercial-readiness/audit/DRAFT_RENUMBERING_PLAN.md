# Draft renumbering plan (pending migrations across open PR branches)

Date 2026-11-15. PROPOSAL ONLY. No branch other than `claude/commercial-fixes-7rxp2t` was edited and nothing
was applied anywhere. Source: `git ls-tree -r --name-only origin/<branch> supabase/pending_migrations` on the
14 open draft PR branches (#504 to #521) and `origin/main`.

## 1. Findings

- 46 distinct draft files. 44 already have a unique timestamp.
- 2 timestamp clashes, both between #518 (`claude/commercial-blockers-7rxp2t`) and #519
  (`claude/work-order-permissions-7rxp2t`): `20261115160000` and `20261115161000`.
- Where the same file name sits on two branches (TEN on #506 and #518, COM on #510 and #518, CUR on #511 and
  #519) the copies are byte identical (same blob id), so they are one draft, not a clash.
- No draft depends on a draft with a later timestamp. Later numbers named in headers are "followed by" notes.
- `20261115120000_observation_erp_reconciliation.sql` exists on `main` under `supabase/migrations/` (from #514,
  never applied) and as the rework under `supabase/pending_migrations/` on #521. #521 removes the `migrations/`
  copy, so after #521 merges there is one file. Until then do not apply the copy on main.

## 2. Proposed change: move the three work order drafts, keep everything else

The work order drafts depend only on `20261113130000_cur_work_orders_manager_director_default.sql`, not on any
tenant draft, so they can sit before the TEN b/c series. Moving them keeps `ten9c_HOLD` as the last file of
that day and leaves the multi-company sequence file on #518 untouched.

| Branch (PR) | Current name | Proposed name |
|---|---|---|
| work-order-permissions (#519) | `20261115160000_wo_permission_resolver.sql` | `20261115140000_wo_permission_resolver.sql` |
| work-order-permissions (#519) | `20261115160500_wo_policies_and_guards.sql` | `20261115140500_wo_policies_and_guards.sql` |
| work-order-permissions (#519) | `20261115161000_wo_supervisor_module_visibility.sql` | `20261115141000_wo_supervisor_module_visibility.sql` |
| commercial-blockers (#518) | `20261115160000_ten6b_entitlement_switch_preflight.sql` | unchanged |
| commercial-blockers (#518) | `20261115161000_ten7c_role_matrix_own_company_read.sql` | unchanged |

Files on #519 that name the old numbers and must change in the same commit: the three drafts' own headers
(DEPENDS ON / FOLLOWED BY lines), `supabase/tests/staging_work_order_permissions.sh`,
`src/lib/workOrderAccess.js`, `src/test/workOrderAccessMirror.test.js`,
`docs/commercial-readiness/audit/WORKORDER_ROUND2.md`, and the pending_migrations README entry.
The backup table name `_bak.wo3_module_permissions_20261115` carries only the date and stays.

## 3. Full order after the change (every timestamp unique, dependency order)

| # | Timestamp | Draft | Branch (PR) | Needs first |
|---|---|---|---|---|
| 1 | 20261110147000 | profiles_pii_read | main, tyrepulse-inspector-build, console-fixes, tenant-security-drafts, flutter-fixes, staging-environment, current-prod-fixes-b, commercial-fixes, current-prod-fixes-a, engineering-accuracy, module-workflow-tests, commercial-blockers, work-order-permissions, closure-workflow, tyre-position-service |  |
| 2 | 20261112111000 | replace_open_work_orders_rpc | main, tyrepulse-inspector-build, console-fixes, tenant-security-drafts, flutter-fixes, staging-environment, current-prod-fixes-b, commercial-fixes, current-prod-fixes-a, engineering-accuracy, module-workflow-tests, commercial-blockers, work-order-permissions, closure-workflow, tyre-position-service |  |
| 3 | 20261112171000 | profiles_secret_columns_not_selectable | main, tyrepulse-inspector-build, console-fixes, tenant-security-drafts, flutter-fixes, staging-environment, current-prod-fixes-b, commercial-fixes, current-prod-fixes-a, engineering-accuracy, module-workflow-tests, commercial-blockers, work-order-permissions, closure-workflow, tyre-position-service |  |
| 4 | 20261113100000 | ten1_job_card_conflict_org_guard | tenant-security-drafts, commercial-blockers |  |
| 5 | 20261113100500 | ten1b_work_orders_per_org_key | tenant-security-drafts, commercial-blockers | 20261113100000 |
| 6 | 20261113101000 | ten2_raw_upload_tables_org_wall | tenant-security-drafts, commercial-blockers |  |
| 7 | 20261113102000 | ten3_platform_tables_super_admin_write | tenant-security-drafts, commercial-blockers |  |
| 8 | 20261113103000 | ten4_admin_rpcs_same_org | tenant-security-drafts, commercial-blockers |  |
| 9 | 20261113104000 | ten5_subscription_and_plan_write_guard | tenant-security-drafts, commercial-blockers |  |
| 10 | 20261113110000 | ten6_entitlement_enforcement | tenant-security-drafts, commercial-blockers |  |
| 11 | 20261113111000 | ten7_per_tenant_configuration | tenant-security-drafts, commercial-blockers |  |
| 12 | 20261113112000 | ten8_company_a_fallback_resolver | tenant-security-drafts, commercial-blockers | 20261113111000 |
| 13 | 20261113113000 | ten9_tenant_lifecycle | tenant-security-drafts, commercial-blockers | 20261113112000 |
| 14 | 20261113114000 | ten4b_module_permissions_same_org | tenant-security-drafts, commercial-blockers | 20261113103000 |
| 15 | 20261113114500 | ten5b_organisation_plan_columns_trigger | tenant-security-drafts, commercial-blockers | 20261113104000 |
| 16 | 20261113115000 | ten7b_accident_mailbox_keys_legacy_org_only | tenant-security-drafts, commercial-blockers | 20261113111000 |
| 17 | 20261113120000 | eng1_cost_per_km_named_metrics | engineering-accuracy |  |
| 18 | 20261113121000 | eng2_running_life_baseline_km_rule | engineering-accuracy |  |
| 19 | 20261113122000 | eng3_calc_cpk_km_rule | engineering-accuracy |  |
| 20 | 20261113123000 | eng4_unit_rule_road_vehicles | engineering-accuracy |  |
| 21 | 20261113124000 | eng5_warranty_spelling_and_tyre_spend_kinds | engineering-accuracy |  |
| 22 | 20261113130000 | cur_work_orders_manager_director_default | current-prod-fixes-a, work-order-permissions |  |
| 23 | 20261113130500 | cur_kpi_targets_org_scoped_key | current-prod-fixes-a, work-order-permissions |  |
| 24 | 20261113140000 | ops_report_exec_money_by_country | current-prod-fixes-b |  |
| 25 | 20261113141000 | ops_webhook_reliable_delivery | current-prod-fixes-b |  |
| 26 | 20261113142000 | ops_backup_coverage_restore_test_health | current-prod-fixes-b |  |
| 27 | 20261113150000 | com_organisation_settings_foundation | commercial-fixes, commercial-blockers |  |
| 28 | 20261113151000 | com_accident_mail_per_organisation | commercial-fixes, commercial-blockers | 20261113150000 |
| 29 | 20261113152000 | com_notify_elevated_users_org_scope | commercial-fixes, commercial-blockers |  |
| 30 | 20261113153000 | com_alert_thresholds_org_scope | commercial-fixes, commercial-blockers |  |
| 31 | 20261113154000 | com_scrap_mark_org_guard | commercial-fixes, commercial-blockers |  |
| 32 | 20261113154500 | com_tyre_status_marks_per_org_key | commercial-fixes, commercial-blockers | 20261113154000; ships with client line src/lib/api/tyreExchange.js |
| 33 | 20261113155000 | com_warranty_claim_no_per_org | commercial-fixes, commercial-blockers |  |
| 34 | 20261113156000 | com_tenant_settings_resolvers | commercial-fixes, commercial-blockers | 20261113150000 |
| 35 | 20261115110000 | tyre_position_service | tyre-position-service |  |
| 36 | 20261115120000 | observation_erp_reconciliation | tyre-position-service | 20261115110000 |
| 37 | 20261115140000 | wo_permission_resolver | work-order-permissions | 20261113130000 |
| 38 | 20261115140500 | wo_policies_and_guards | work-order-permissions | 20261115140000 |
| 39 | 20261115141000 | wo_supervisor_module_visibility | work-order-permissions | 20261115140500 |
| 40 | 20261115160000 | ten6b_entitlement_switch_preflight | commercial-blockers | 20261113110000, 20261113111000 |
| 41 | 20261115161000 | ten7c_role_matrix_own_company_read | commercial-blockers | 20261113111000 |
| 42 | 20261115162000 | ten8b_invitation_company_code_signup | commercial-blockers | 20261113113000 |
| 43 | 20261115163000 | ten9b_sign_in_company_code | commercial-blockers | 20261115162000 |
| 44 | 20261115169000 | ten9c_HOLD_per_company_usernames | commercial-blockers | 20261115163000; ON HOLD |
| 45 | 20261116100000 | clo_corrective_action_review | closure-workflow |  |
| 46 | 20261116101000 | clo_checklist_acknowledge_exception | closure-workflow | 20261116100000 |

Rows 1 to 3 are the older drafts carried by every branch and by main.

## 4. How to carry it out (not done)

1. On #519 only: `git mv` the three files, update the references listed in section 2, rerun
   `supabase/tests/staging_work_order_permissions.sh` and `src/test/workOrderAccessMirror.test.js`.
2. No change on #518, #506, #510, #511, #513, #509, #520, #521.
3. Merge order that keeps the folder consistent: #506 and #510 before #518; #511 before #519; #521 before any
   decision on `20261115120000`.

Status: Not Tested (a plan; nothing was renamed).
