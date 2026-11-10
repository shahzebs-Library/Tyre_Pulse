# 19 - Data Governance Plan

| Field | Value |
|---|---|
| Deliverable | 19 of 29 (spec section 18 "Data Governance and Master Data", with the data parts of section 19 "Backup, Disaster Recovery and Compliance") |
| Date | 2026-11-10 |
| Status | Partly built. The data trust program (metric registry, quality rules, reconciliation, correction cases, lineage, trust alerts, releases) is built end to end in the console but runs on demand only and has not been used since August. Duplicate control, material master, learning layers, audit retention, data cleanup and nightly row snapshots are live. Not built: master-data change approval, effective dating and version history for masters, a data steward role, scheduled quality scans, tenant-level restore, and a recorded restore test. |
| Evidence | Verified in code (2026-11-10): console pages and service files listed below; migrations V257, V288, V362-V368, V400, V416, V471-V475 exist in the repo. V289 (data cleanup RPCs) has NO repo file; its functions were applied live (per project memory). Verified live (read-only SQL, 2026-11-10): `metric_registry` 12, `quality_rules` 10, `quality_results` 20 (last check 2026-08-08), `reconciliation_runs` 9, `correction_cases` 0, `trust_alerts` 1 (0 open), `data_assets` 34, `lineage_edges` 36, `releases` 0, `material_master` 22,162 all flagged reviewed, `tyre_learned_facts` 27, `classification_feedback` 22,163, `dup_resolve_archive` 9,863, `backups.snapshots` 30 (2026-10-12 to 2026-11-10), `backups.restore_tests` 0, `audit_retention_days` 365, `data_retention_months` 24 (stored, not enforced), cron jobs `nightly-backup`, `audit-log-retention`, `cron-run-history-retention`, `tenant-export-retention` active; no cron job for quality or trust scans. |
| Related docs | `docs/DATA_DICTIONARY.md`, `docs/DATA_MODEL_CONSOLIDATION_PLAN.md`, `docs/tyre/BUSINESS_RULES.md`, `docs/tyre/FINANCIAL_SOURCE_OF_TRUTH.md`, `docs/tyre/EXCEPTIONS.md`, doc 11, doc 12, doc 13 |

## 1. Data trust program (V473-V475) - what exists

| Capability | Objects | Console surface | Live state (2026-11-10) |
|---|---|---|---|
| Metric registry and versions | `metric_registry`, `metric_versions`, `explain_metric`, `get_record_provenance` (V473) | `/console/metric-catalogue` (`ConsoleMetricCatalogue.jsx`); `ExplainThisNumber.jsx` on Engineering KPI and Cost per m3 | 12 metrics, v1 each |
| Quality rules | `quality_rules` (global), `quality_results`, `run_quality_checks(country)` (V474) | `/console/data-quality` (`ConsoleDataQuality.jsx`) | 10 rules; last run 2026-08-08; not scheduled |
| Reconciliation | `reconciliation_runs`, `run_reconciliation(country)` (3 checks: WO total vs parts+labour, tyre-asset in fleet, supplied vs approved m3) | `/console/reconciliation` | 9 runs |
| Correction cases | `correction_cases`, `correction_case_events`, `correction_case_open/_transition/_update`; status reported, investigating, proposed, approved, applied, reconciled, closed, rejected | `/console/correction-center` | 0 cases. A case records decisions and keeps the original value; the fix itself goes through the undoable tools |
| Pipeline and integration monitors | `get_pipeline_runs`, `get_integration_events` (read existing `import_batches`, `report_send_log`, `ai_token_logs`) | `/console/pipeline-monitor` | live reads |
| Lineage and impact | `data_assets`, `lineage_edges`, `dashboard_registry`, `widget_bindings`, `get_lineage_graph`, `get_downstream_impact` (V475) | `/console/lineage` (`ConsoleLineageExplorer.jsx`) | 34 assets, 36 edges, seeded from the registry |
| Trust alerts | `trust_alerts`, `scan_data_trust(country)`, `ack_trust_alert`, `decide_trust_alert` | `/console/trust-alerts` | 1 alert, 0 open |
| Releases and impact | `releases`, `release_impacts`, `record_release`, `add_release_impact` | `/console/releases` | 0 releases recorded |
| Trust scores per KPI domain | `get_data_trust_overview` + `src/lib/dataTrust.js` (17 checks, 5 dimensions) (V375) | `/data-reconciliation` Trust tab, `TrustBadge` | live |
| Control center | `get_figure_lineage`, `get_control_center_summary`, `get_diagnostics_feed` (V458-V460, super admin only) | `/console/control-center` | live |
| Evidence classification (tyres from 2025-01-01) | `v_tyre_fitment_evidence`, `get_tyre_evidence_audit` (20261111090000) | `/data-reconciliation` Integrity | read only |
| Exceptions register (tyres) | `get_tyre_exceptions`, reviews (20261110113000) | Data Reconciliation | live |

Route note (verified in `src/App.jsx`, 2026-11-10): the console was regrouped in October 2026. The routes in
the table are legacy entry points that now redirect: data-quality, reconciliation, correction-center, lineage
and control-center to `/console/database/trust/*`; metric-catalogue to `/console/analytics?tab=metrics`;
trust-alerts to `/console/alerts?tab=trust`; pipeline-monitor to `/console/developer?tab=pipeline`;
data-cleanup, duplicates, material-master, classification-learning and data-learning to
`/console/operations?tab=*`. `/console/releases` is still a direct page.

Assessment: the machinery is complete but dormant. No scheduled scan, no correction case ever opened, no release
ever recorded. Governance that nobody operates is documentation, not control.

## 2. Master data

| Master | Table(s) | Governance today | Gaps against spec section 18 |
|---|---|---|---|
| Vehicle | `vehicle_fleet` (unique per org + country + asset_no, V348); `ops_status`, capacity, engine no (V539); asset ownership view `get_asset_ownership` (V376) | Admin-only writes (asset register + job cards writable by Admin only, owner decision 2026-09-30); asset_no normalised UPPER, no whitespace (V337, V490); country-aware odometer sync (V408) | No change approval, no version history beyond `audit_log_v2`; 497 rows with blank vehicle_type (per project memory) |
| Tyre | `tyre_records`, `tyre_spec_catalog` (approval status + events, V20260929090000), `tyre_specifications` (fitment rules) | Catalogue approval by Admin / Manager / Director with immutable events | No tyre master (identity is the serial on fitment rows); serial strength rule T6 |
| Location | `sites`, `site_aliases` (V247, V395), `normalize_site` + `normalize_site_name` triggers | Retired `-ST` suffix with a blanket strip; aliases self-correct imports | Region empty for many KSA sites (cost per m3 by region depends on it) |
| Material / cost item | `material_master` keyed (org, country, item_code) (V367); review flags; `reclassify_from_master` dry run + undo (V368); bulk confirm (V416) | Reviewed row outranks every classifier token | See section 3 |
| Vendor | `suppliers` (empty per project memory) | Admin writes | Not in use |
| User | `profiles`, `custom_roles`, `user_access_grants`, `access_audit` (V228) | Super admin console, immutable access audit | Covered in docs 7 and 17 |
| Cost centre | `parts_consumption.cost_center` (text) | none | No master table |
| Inspection / checklist templates | `checklist_templates` with ISO document control (form_ref, revision, approver, review interval) and immutable published revisions (20261108140000) | Strongest governed master in the system | Model to copy for other masters |
| Failure codes, status values | `removal_reason` (free text, normalised V590), `workOrderStatus.js`, accident vocab (`accidentVocab.js`) | Normalising triggers | 858 UAE rows still carry a brand in `removal_reason` (per project memory) |
| Currencies, country settings | `country_currency` (V366), `currency_rates` with enter vs approve (V380), `system_config` | Approval enforced server-side | No approved rate yet |

## 3. Material master review coverage - a finding

Live 2026-11-10: all 22,162 `material_master` rows are flagged reviewed; 14,983 were stamped on 2026-07-29 and
6,473 on 2026-07-30 (bulk confirm, V416, which accepts the item's CURRENT category), and 536 carry no
reviewer. Project memory recorded review coverage of 1-6% of spend in late July. The flag therefore moved from
"a human decided" to "a human accepted the machine proposal in bulk". Meanwhile 120,609 of 220,425 expense lines
still carry `classified_by = 'default'` (spare at 0.30 confidence), because confirming a master row does not
re-bucket historical lines until `reclassify_from_master` runs.

Recommendation: record HOW an item was reviewed (`review_method`: individual / bulk / learned rule), report
"individually reviewed share of money" separately, run `reclassify_from_master` as a dry run and put the money
movement in front of the owner before applying. Phase 3, M.

## 4. Learning layers

| Layer | Objects | What it does | State |
|---|---|---|---|
| Classifier learning | `classification_feedback` (trigger-captured), `classification_weak_spots`, `propose_classification_rules` (lift >= 1.5, veto via `oil_part`, rejected tokens remembered), `apply_learned_rule` (V400) | Learns cost-bucket rules from human corrections; applies them as reviewed master rows, never inside `brain_classify` | Built; console `/console/classification-learning` |
| Tyre data learning | `tyre_learned_facts`, `tyre_learn_apply_log`, trigger `apply_tyre_learned_facts`, `tyre_learn_confirm/_undo/_suggestions` (V471, V472) | Confirm once, fixes current rows and future imports for brand, size, removal reason; never cost | 27 facts live; console `/console/data-learning` |
| Classification brain cache | `brain_cache` keyed by `brain_rules_version()` (V373) | Speed; must be bumped with any brain change | Built |

## 5. Duplicate control and correction tools

- Duplicate Control (`/console/duplicates`, V362, V365): scan by business key with the `source_row`
  discriminator, preview, resolve with full-row archive (`dup_resolve_archive`, 9,863 rows live), one-click
  restore. Excluded tables by evidence: `production_logs` (per trip), `inspections`, `accidents`.
- Data Reconciliation (`/data-reconciliation`): orphan assets, strict duplicates, serial on multiple assets
  (read only), brand gaps, job-card date mismatches, duplicate-key tyres (byte-identical only), tyre price
  backfill with undo, learning suggestions.
- Row editing in the Data Browser with before/after records in `admin_row_changes` and revert (V364).
- Standing rule T16: nothing in business data is deleted or rewritten without a `_bak.*` backup and a tested
  undo.

## 6. Retention, cleanup, backup

| Item | State | Decision / note |
|---|---|---|
| Audit log retention | Enforced: `cron_purge_audit_logs()` daily 01:15 UTC, `audit_retention_days = 365` (V288); logs only (`audit_log_v2`, `system_logs`, `access_audit`) | Shortening to 90 days is an open owner decision (deletes 0 rows today) |
| Business data retention | `data_retention_months = 24` is STORED but deliberately NOT enforced | Owner decision (2026-07-19): business records are never auto-deleted. Badge reads "Protected" |
| Manual cleanup | `/console/data-cleanup` (`ConsoleDataCleanup.jsx`, `src/lib/api/dataCleanup.js`): safelisted targets, preview count, snapshot first, typed CLEAN confirmation, audit | Functions applied live (V289) with no repo migration file: backfill the file |
| Tenant export | `tenant-export` edge function, private bucket `tenant-exports`, retention cron | Built |
| Nightly snapshots | `backups` schema (V257, chunked rewrite V495), cron `nightly-backup` 00:30 UTC, 30 snapshots live, 30-day retention, recover-missing-rows restore only | Row recovery, not disaster recovery. Core tables only; `work_orders` and the financial ledger deliberately excluded |
| Restore test | A rolled-back restore was performed during V495 work (per project memory, 2026-08-10); `backups.restore_tests` holds 0 rows | Spec section 19: "Do not claim backup readiness until a restore test has been completed". Record one |
| Point-in-time recovery | Platform (Supabase) feature; plan and setting not verified here | Verify plan tier and PITR window |

## 7. Proposed governance model

Roles (add as custom roles plus capabilities, not new code paths):

| Role | Responsibility | Grants |
|---|---|---|
| Data Owner (per domain: fleet, tyres, cost, workshop, accidents) | Accountable for a KPI domain's definitions and targets | approve metric versions and master changes in the domain |
| Data Steward (per country) | Operates quality scans, correction cases, duplicate control, learning confirmations | `data_reconciliation` edit, correction case transitions, material master review |
| Platform Administrator (super admin) | Schema, retention, backups, cleanup | console |
| Reviewer | Second person for dual control on destructive actions | existing four-eyes (`/console/approvals`, dual control flag off by default) |

Process:
1. Schedule `scan_data_trust` per country daily (pg_cron, same pattern as `upload-gap-check`) and notify the
   steward on new fails only (dedupe like `upload_gap_notices`). Phase 3, S.
2. Master-data change approval: a `master_change_requests` table (entity, key, field, old, new, requested_by,
   decided_by, effective_from) for vehicle, site, material and tyre catalogue edits, reusing the checklist
   template revision pattern for history. Phase 3, L.
3. Effective dating for masters that change meaning over time (asset site, asset status): build on
   `v_asset_site_history` (20261110101000). Phase 3, M.
4. Every release that changes a calculation records a `releases` row with `release_impacts`, linked to the
   metric versions it changed. Phase 3, S (process) + S (CI reminder).
5. Data quality score per master shown on the master pages, using `dataTrust.js`. Phase 4, M.
6. Mandatory field rules per country stored as data (`quality_rules` already supports per-rule config).
   Phase 4, M.

## Open decisions for the owner

1. Name a Data Owner per domain and a Data Steward per country.
2. Run `reclassify_from_master` (dry run first) to move historical spend into the reviewed buckets?
3. Shorten `audit_retention_days` from 365 to 90?
4. Keep `data_retention_months` saved-only (current decision) or define an archive (not delete) policy?
5. Enable dual control for destructive console actions (currently off by default)?

## Next actions

| Action | Phase | Effort |
|---|---|---|
| Record a restore test in `backups.restore_tests`; verify PITR plan | 1 | S |
| Backfill the V289 data cleanup migration file from live definitions | 1 | S |
| Schedule daily trust scans with steward notification | 3 | S |
| Review-method column and money-weighted individual review share | 3 | M |
| Master change approval with effective dates and history | 3 | L |
| Steward and owner roles via custom roles + capabilities | 3 | M |
