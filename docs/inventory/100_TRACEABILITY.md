# 100 - Inventory requirement traceability

Measured 2026-11-21 (production `jhssdmeruxtrlqnwfksc`, read-only queries) against branch
`claude/inventory-closure-7rxp2t`. A status is only "Fully operational" when the code path exists,
an automated test passes, AND production has been checked. A page or table existing is not enough.

Status vocabulary:

- **Fully operational** - built, tested, verified on production, usable today.
- **Released, awaiting configuration** - code is live; it cannot be used until people, permissions
  or master data are set (named in the row).
- **Awaiting physical testing** - code is live and tested in CI; no real-device test has been done.
- **Not implemented** - the screen or behaviour does not exist yet.

## Summary

| Status | Count |
|---|---|
| Fully operational | 4 |
| Released, awaiting configuration | 9 |
| Awaiting physical testing | 1 |
| Not implemented | 1 (row 15 awaits the database) |
| **Total** | **15** |

## Production state at measurement

| Fact | Value |
|---|---|
| Inventory migrations in ledger | 20261120100000..115000, 20261121100000 (multi-balance), 20261121110000 (tyre sync perf, PR #574 lane) |
| `stock_records` / `stock_movements` | 43 / 78 (all 43 records still have `item_id` null; 18 NHC lines are the mapping work in doc 101 s2) |
| `inventory_audits` | 1 (`AUD-20261121-76190188`, NHC, created by an Admin, 0 count lines, state `investigation`) |
| `tyre_items` / `tyre_custody_conflicts` | 8,619 / 7 (all `scrapped_but_active`, investigation `open`) |
| `oem_part_references` / `equipment_fitments` | 0 / 0 |
| `supplier_agreements` / `purchase_order_lines` / `stock_transfers` | 0 / 0 / 0 |
| `inventory_cost_reconciliations` | 33 (unvalued opening lines awaiting a Finance Manager) |
| `user_access_grants` on module `stock` | 1 (a `view` grant; 0 Store Keeper capability grants) |
| `inventory_approval_limits` | 0 |
| `approval_policies` | 3, all `draft` |
| Inventory report schedules | 0 |
| Holders of `Inventory Controller` / `Finance Manager` | 0 / 0 |

## Test results (this branch)

| Suite | Result |
|---|---|
| `npx vitest run src/test/inventory src/test/scheduledReportInventory src/test/webI18nKeyCoverage src/test/rowCapGuard src/test/designSystem` | 18 files, **265 / 265 pass** |
| `node --test --test-concurrency=1 supabase/tests/inventory_*.test.mjs` (PGlite, 12 files) | **109 tests: 108 pass, 0 fail, 1 skipped** (the staging-race case, by design) |
| `npx eslint src/components/inventory src/lib/inventory` | 0 errors (2 pre-existing warnings) |
| `npx vite build` | clean |
| New: `src/test/inventoryTyreInvestigation.test.js` | 10 / 10 pass |
| New: `src/test/inventoryStrategyScenario.test.jsx` | 3 / 3 pass (reproduces the doc 22 worked example: SAR 18,232,480.00 vs 15,450,000.00, difference 2,782,480.00) |

## Requirements

| # | Requirement | Database (migration / RPC / table) | Web | Flutter | Test evidence | Production check | Status |
|---|---|---|---|---|---|---|---|
| 1 | Stock ledger integrity (append-only movements, balance = sum of movements, no direct balance writes, concurrency) | 20261120100000 `inv_post_movement`, `stock_movements` append-only trigger, `inv_can`; 20261121100000 multi-balance reconcile | `src/components/inventory/MovementsSection.jsx`, `StockFlows.jsx` | `data/inventory_backend.dart` | `supabase/tests/inventory_ledger.test.mjs`, `inventory_concurrency.test.mjs`, `inventory_reconcile_multi_balance.test.mjs` | doc 96 s6 smoke; 78 movements reconcile to 43 balances | **Fully operational** |
| 2 | Physical inventory and blind counting | 20261120102000 `inventory_audits`, `inventory_count_lines`, `inv_audit_*`; counter assignment per person | `AuditsSection.jsx`, `AuditCounterView.jsx`, `AuditReconciliation.jsx` | `presentation/blind_count_screen.dart`, `my_audits_screen.dart`, `count_line_sheet.dart` | `inventory_audits.test.mjs`; web acceptance crit 7 (doc 95) | 1 audit exists (Admin, 0 lines). No Store Keeper holds `count`, no Inventory Controller holds `audit_create` | **Released, awaiting configuration** - grant Store Keeper `count` and name an Inventory Controller (doc 101 s1, s4) |
| 3 | Independent recount and separation of duties | 20261120108000 `_inv_approval_block_reason` (requester, creator, preparer, counter, recounter, proposed recounter refused by user id); 20261120113000 `_inv_approval_extra_block` (Store Keeper refused as approver; limits); 20261120102000/107000 `inv_recount_assign` ("A recount must be done by a different person who has not counted this audit") | `ApprovalsPanel.jsx`, `ControlsSection.jsx` | (approvals are web-only by design) | `inventory_controls.test.mjs` (requester refused, self-decide CHECK), `inventory_audits.test.mjs` (counter cannot approve or be recounter), `inventory_controls_completion.test.mjs` (preparer promoted to Admin still refused; Store Keeper refused; tyre investigator refused) | Functions present in prod with the reviewed md5 (113000 guard); refusal is in the database, not the UI | **Fully operational** (enforcement). The recount workflow itself needs the approver roles in row 2 |
| 4 | Procurement and valuation | 20261120103000 `purchase_order_lines`, `goods_receipt_lines`, `supplier_invoices`; 20261120104000 weighted-average valuation, `inventory_cost_reconciliations` | `SupplySections.jsx`, `ValuationPanels.jsx`, `OpeningBalancePanel.jsx` | - | `inventory_flows.test.mjs`, `src/test/inventoryValuation.test.js` | 0 PO lines, 0 suppliers; 33 cost reconciliations waiting; 0 Finance Manager | **Released, awaiting configuration** - name a Finance Manager, enter suppliers |
| 5 | Supplier-managed inventory and consignment | 20261120103000 `supplier_agreements`, `consignment_consumptions`, movement type `consignment_receipt` | `SupplySections.jsx` (agreements, consignment) | - | `inventory_flows.test.mjs` (consignment receipt/consume) | 0 agreements | **Released, awaiting configuration** - needs a supplier agreement |
| 6 | Brand-change simulation | `src/lib/inventory/simulation.js` `brandChangeExposure` (pure, doc 22); compatibility from 20261120106000 | `InsightSections.jsx` (honesty note) + `StrategyScenarioPanel.jsx` (this PR) | - | `src/test/inventorySimulation.test.js`, `inventoryStrategyScenario.test.jsx` | 0 validated `equipment_fitments`, so exposure cannot be computed from data | **Released, awaiting configuration** - needs OEM fitments (row 8) and item prices |
| 7 | Investment-risk analysis (stocking strategy cost, working capital, exit exposure, service-level risk) | `simulation.js` `runScenarioSet`, `compareStrategies`, `serviceLevelRisk` | **NEW** `src/components/inventory/StrategyScenarioPanel.jsx` in Planning (this PR); previously engine only, no screen | - | `inventoryStrategyScenario.test.jsx` 3/3; `inventorySimulation.test.js` | Inputs are entered by the user, so it works with today's data; output is labelled "modelled, not an actual saving" | **Fully operational** once this PR is merged |
| 8 | OEM catalogue compatibility | 20261120106000 `oem_part_references`, `equipment_fitments`, `inv_*fitment*` | `IdentificationSection.jsx` (compatibility counts) | - | `inventory_api.test.mjs` (fitment contract) | 0 references, 0 fitments | **Released, awaiting configuration** - load the OEM catalogue / validate fitments |
| 9 | Tyre serial, fitment and lifecycle integration (custody, conflicts, investigation) | 20261120105000 `tyre_items`, `inv_tyre_item_sync`; 20261121110000 sync perf (other lane); 20261120114000 investigation (`inv_tyre_conflict_assign/investigate/propose/close`, `v_inv_tyre_conflict_cases`) | `TyreInventorySection.jsx` + **NEW** `TyreInvestigationPanel.jsx` (this PR; the drawer previously only described the rule) | - | `inventory_tyres.test.mjs`, `inventory_controls_completion.test.mjs` (investigation flow); `src/test/inventoryTyreInvestigation.test.js` 10/10 (incl. SQL role-list mirror) | 8,619 tyre items synced; 7 open `scrapped_but_active` conflicts; 0 PMV Manager in KSA to approve corrections | **Released, awaiting configuration** - PMV Manager / investigator for KSA, then decide the 7 cases (doc 99) |
| 10 | Mobile offline inventory sync | Flutter `core/sync` command `INVENTORY_COUNT_LINE`, `inventory_count_command_pusher.dart`, `count_line_queue.dart`, `count_draft_store.dart` | - | as listed | `inventory_count_background_sync_test.dart`, `inventory_count_line_sync_test.dart`, `count_data_test.dart`, `count_session_test.dart` (Flutter CI) | Not exercised on a real phone (doc 92 plan not run) | **Awaiting physical testing** |
| 11 | Inventory KPIs shown on screen (stock value, discrepancies, counts) | 20261120110000 metric catalogue (25 metrics, draft) | `OverviewSection.jsx`, `InvUi.jsx` `ExplainedKpi` | - | `src/test/inventoryKpi.test.js` | Value tile reads N/A for 33 unvalued lines; discrepancies 0 (no counts yet) | **Released, awaiting configuration** - needs counts and valuation (rows 2, 4) |
| 12 | Remaining KPI catalogue (turnover, DIO, stock-out, supplier OTIF, lead-time variance, consignment utilisation...) and ABC / FSN / VED classification | `src/lib/inventory/kpi.js` (25 functions), `classification.js` - pure engines, tested; adapter `src/lib/inventory/kpiPanel.js` (reshapes rows, computes nothing); reads `src/lib/api/inventoryKpi.js` | `KpiCatalogueSection.jsx` (Insight > Inventory KPIs: the 23 KPIs not on Overview, 4 groups, definition/unit/period/reason per tile, per-currency money, Excel/PDF) and `ClassificationSection.jsx` (Insight > Stock classification: ABC/FSN/VED tabs, class summary, search, class filter, sortable table, Excel/PDF) | ABC and money KPIs need `view_value`; export needs `export` | `inventoryKpiPanel.test.js`, `inventoryKpiScreens.render.test.jsx` (populated + empty + no view_value + failed source) | 2026-11-21: stock_movements 86, stock_records 50, reservations 0, stock exceptions 0, PO lines 0, supplier agreements 0, count lines 0, items with criticality 0 - most tiles show their empty-source sentence; VED is all Unassessed | **Released, awaiting data/configuration** - fills as counts, POs, agreements, reservations and item criticality are recorded. Purchase avoidance stays unmeasurable until requests record how they were fulfilled |
| 13 | Reports and the inventory email | 20261120111000 report types; edge fn `send-scheduled-reports` v29 (deployed) | `ReportsSection.jsx`, `src/lib/inventory/reportCatalog.js` | - | `src/test/scheduledReportInventory.test.js` | 0 inventory schedules | **Released, awaiting configuration** - create a schedule and recipients |
| 14 | Role-based security (capabilities, country/site scope, anon closed) | `inv_can`/`app_user_can('stock', cap)`, `_inv_scope_ok`, 20261120115000 hardening | `InventoryHub.jsx` capability-gated sections | Flutter module gate `stock_count` | `inventory_security_acceptance.test.mjs`, `inventory_rollback.test.mjs` | doc 96 s6: 0 anon-executable inventory functions; advisors 0 ERROR | **Fully operational** (Store Keeper grants are configuration, row 2) |
| 15 | Physical inventory registration and identification (company-wide material master, OEM / aftermarket / company SKU references, variants, unidentified review, photos, corrections, global search with availability and transfer request, opening-balance hand-off, dashboard) | APPLIED 2026-11-21 `supabase/migrations/20261122100000_inv_physical_inventory_master.sql` (+ rollbacks/), with 20261122110000 transfer return fix and 20261122120000 location bulk setup: `material_canonical`, `material_variants`, `material_canonical_items`, extended `material_aliases`, `physical_inventory_*`, `material_correction_*`, `inventory_transfer_requests`, `inv_pi_*` / `inv_material_*` / `inv_correction_*` / `inv_transfer_request*` | `PhysicalInventorySection.jsx`, `PhysicalInventoryReview.jsx` (section `physical`) | `presentation/physical_inventory_screen.dart`, `data/physical_capture_outbox.dart` (offline, photos) | `supabase/tests/inventory_physical_master.test.mjs` 15 / 15 subtests; `src/test/physicalInventory.test.js`; Flutter `physical_capture_outbox_test.dart` (CI) | Applied 21:25 UTC; pre-apply baseline 2026-11-21: `material_master` 22,162 (KSA 9,443 / UAE 9,321 / Egypt 3,398), `material_aliases` 0, `inventory_locations` 0 | **Live in production** 2026-11-21 (doc 96 s12); device acceptance + store bins outstanding |

## Gaps closed in this branch

1. **Tyre conflict investigation had no screen.** The four investigation RPCs (114000) were live but
   the web drawer only showed a sentence. `TyreInvestigationPanel.jsx` now offers exactly the step the
   database will accept for the signed-in person: assign (elevated or PMV Manager), record a finding
   and propose a correction (assigned investigator only, proposal needs a finding), wait for the
   independent PMV Manager approval (links to Approvals), close. Rules mirror the SQL and a test pins
   the investigator role list against the migration text.
2. **Investment-risk analysis had no screen.** `StrategyScenarioPanel.jsx` runs the doc 22 engine on
   entered inputs and reports total cost per strategy, the modelled difference, working capital,
   exit exposure and service-level risk, labelled as a scenario, never a saving. Missing inputs are
   listed instead of being treated as zero.

## New database migrations

None. Both gaps were closed with client code over RPCs already applied in production.

## 2026-11-21 addition: physical inventory (row 15)

Merged in #585; database applied 2026-11-21 (doc 96 section 12). Operational guide and owner steps: `102_PHYSICAL_INVENTORY_GUIDE.md`.
