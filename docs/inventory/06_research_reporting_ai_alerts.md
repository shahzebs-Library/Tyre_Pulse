# 06 - Research: counting practice, reuse map, KPI and alert catalogue

Phase 1 research (Agents 5+7). Read-only. No code or schema was changed.
Scope: inventory upgrade on branch `claude/inventory-upgrade-7rxp2t`.

Status of evidence: Part 1 is from vendor documentation (sources at the end).
Part 2 names were checked against the repo on 2026-11-19 (file paths, exports,
migration file names). Live DB was NOT queried (Supabase MCP unreachable this
session), so row counts are not stated and any table/RPC must be re-checked with
`list_tables` before a migration is written.

---

## Part 1 - How the big ERPs count stock, and what to take

### 1.1 Practice by vendor

| Topic | SAP EWM / MM | Oracle Inventory | Dynamics 365 SCM | IBM Maximo |
|---|---|---|---|---|
| Blind count | PI document hides book qty from counter; count entered against bin | Count listing can hide system qty | Counting journal / warehouse cycle count work on mobile, qty hidden | Count book; mobile count hides balance by config |
| Freeze vs live | Bin can be blocked during count (posting block) OR count live and rely on doc date | Snapshot qty at count time; adjustment computed vs snapshot | Optional blocking of the location; journal holds on-hand at creation | Live count. "Reconcile balances" folds in every transaction between count save and reconcile time (cutoff reconciliation) |
| Recount | Recount tolerance group (qty % and value). Over limit -> new PI doc, old items "counted, recounted", cannot be posted | Auto recount when out of tolerance; "Maximum recounts" then routes to approval | Manual new journal | Manual |
| Posting tolerance | Posting-difference tolerance group per USER (qty % + value). Over the user's limit -> that user cannot post | Approval "always" or "if out of tolerance"; positive/negative % and cost tolerances per class/item | Approval workflow per journal name; Post disabled until approved | Reconcile is a privileged action; preview of balance change |
| Difference review | Difference Analyzer (separate tolerance group) | Count Adjustment Approvals: approve / recount / reject / hold | Workflow approve / reject / recall | Preview, then RECBALADJ transaction |
| ABC frequency | Cycle-count indicator A/B/C/D with counts per year | ABC compile -> classes with "counts per year"; scheduler picks eligible items daily/weekly/period | Cycle count plans by threshold or item | Count books built by ABC / frequency |
| Consignment | Special stock "K" (vendor-owned); ownership transfers on issue/withdrawal, liability posted then | Consigned inventory, ownership transfer transaction creates the payable | Consignment replenishment orders; ownership change journal | Consignment flag + consignment vendor on the inventory row; invoice on issue |
| Valuation | Standard (S) or moving average (V) per material | Standard / average / FIFO / LIFO cost groups | Standard, moving average, FIFO, weighted average, per item model group | Standard / average / LIFO / FIFO; AVGCSTADJ for revaluation; receipt-blended average |

### 1.2 Adapt for a tyre / fleet operator (worth doing)

1. **Blind count by default.** The counter never sees the book quantity on web,
   Expo or Flutter. Book qty is revealed only after submit, on the review step.
   Cheapest single control against "count to match the screen".
2. **Live count with cutoff reconciliation (the Maximo model), NOT a freeze.**
   Stores issue tyres all day to workshops; a freeze stops the fleet. Store the
   count timestamp on each line; at review compute
   `expected = book_at_count_time` = current balance minus movements posted after
   `counted_at` for that item/location. Variance = counted - expected. Uses the
   existing `stock_movements` ledger, so no snapshot table is required.
3. **Two tolerances, kept separate (the SAP idea, simplified):**
   - Recount tolerance: |variance| > max(1 unit, X %) OR value > V -> one
     automatic recount by a DIFFERENT person. Max recounts = 1 (Oracle's limit);
     after that it goes to approval, never loops.
   - Posting / approval tolerance: by value band in SAR/AED/EGP (per country,
     never blended), routed through the existing approval policy engine.
   Serialized tyres: tolerance is always 0 - any serial missing or extra is an
   exception, not a percentage.
4. **Segregation of duties.** Counter != recounter != approver (SAP posts by
   user tolerance group; Oracle routes by approval). Enforce in the RPC, not UI.
5. **ABC cycle counting by value + criticality.** A = top ~70-80% of stock value
   (new tyres, retreads, high-value OTR) counted monthly; B quarterly; C twice a
   year. Plus event triggers: on negative balance, on a variance last cycle, on a
   store-keeper change. Serialized tyres: count every serial at least quarterly.
6. **Approval actions = approve / recount / reject / hold** (Oracle's four).
   Reject means the count is wrong, not the book; hold means investigate.
7. **Consignment ownership** (only if a supplier holds stock in GCC stores):
   a flag + owner supplier on the stock row; the cost is recognised on ISSUE,
   not receipt. Consigned qty is counted but excluded from owned stock value.
8. **Valuation = weighted average cost (WAC) per item per country,** blended on
   receipt with the Maximo formula
   `(old_qty*old_avg + recv_qty*recv_cost) / (old_qty + recv_qty)`.
   Serialized tyres keep their own actual cost (the "one price per tyre" rule
   already enforced on `tyre_records`), so a tyre's issue cost is its own price.
   Revaluation is an audited adjustment row, never an in-place edit.

### 1.3 Avoid (overkill for this operator)

- SAP warehouse-task / handling-unit / storage-bin-type physical inventory
  procedures (annual, ad-hoc, low-stock, putaway-count variants).
- FIFO / LIFO layer costing for consumables - WAC is enough; serialized tyres
  already carry actual cost.
- Standard costing with purchase-price-variance accounts (needs a GL; the app
  has none and treats the ERP as the ledger).
- Multiple Difference Analyzer tolerance groups per user. One value band per
  country routed through approval_policies is enough.
- Full location blocking during counts (blocks workshops; use cutoff instead).
- Dynamics-style per-journal-name workflow configuration. One governed policy
  per module is already the pattern here.

---

## Part 2 - Existing infrastructure to reuse

Rule from CLAUDE.md / PROJECT_MEMORY: one module, one calculation service, one
surface per domain. Anything marked DUPLICATE RISK must be extended, not rebuilt.

### 2.1 Stock domain that already exists (extend, do not fork)

| What | Where | Note |
|---|---|---|
| Stock master | `stock_records` (+ legacy `stock`) | `stock_status` derived by trigger `trg_stock_status_derive` / `stock_status_derive()` (2026-11-12). Low/Critical from `min_level` / `critical_level`. |
| Movement ledger | `stock_movements` | Append history. RPC `post_stock_movement` (V52, DEFINER, recomputes status). |
| Count RPC | `set_stock_count` (V214) | Today a direct overwrite. DUPLICATE RISK: the new count workflow must REPLACE this path (count session -> review -> approved adjustment via `post_stock_movement`), not run beside it. |
| Quick entry / transfer | `save_stock_entry`, `transfer_stock_entry` (PT409, not 40001 - see 2026-11-11 rule) | `src/lib/stockQuickEntry.js`, `src/lib/api/stockQuickEntry.js` |
| Service | `src/lib/api/stock.js` (listStockRecords, postStockMovement, listMovementsInRange, listTyreIssuesInRange) | Paged via `fetchAllPages`. |
| Ledger engine | `src/lib/stockLedger.js` (MOVEMENT_GROUPS, classifyMovement, summarizeLedger, dailyLedger, tyresFitted, utilisationGap) | KPI base for turnover / issue rate. |
| Analytics | `src/lib/stockManagementAnalytics.js`, `src/lib/stockReplenishmentAnalytics.js` | Reorder logic lives here - DUPLICATE RISK for any new reorder engine. |
| Pages | `src/pages/StockManagement.jsx`, `StockReplenishment.jsx`, `GoodsReceipt.jsx`, `Requisitions.jsx`, `Procurement.jsx` | Plus material issue/return (V609: `material_issues`, `material_issue_lines`, `get_material_issue_summary`) and WO reservations (`work_order_stock_reservations`, `reserve_work_order_stock`, `release_work_order_stock`). |
| Parts requests | `parts_requests` (V296), `src/lib/partsRequests.js` | |
| Workforce readiness | `src/lib/workforceStockReadiness.js` (sizeKeyFromText) | Reuse its tyre-size parsing for stock descriptions. |
| Tyre cost truth | `parts_consumption` grid + `classify_parts_consumption`; `loadCostSplit`, `loadGridTyreByAsset` | Issue VALUE for KPIs comes from here, never `sum(cost_per_tyre)`. |
| Demand forecast | `src/lib/tyreDemandForecast.js` (`forecastTyreDemand`, `buildSizeCanonicalizer`), `src/components/tyre/TyreForecastSection.jsx`, `src/lib/forecastPeriod.js` | DUPLICATE RISK: reorder forecasting must call this, with `forecastWindow` captions. |

### 2.2 Dashboards and KPIs

- Kit: `src/components/commandCenter/kit.jsx` (PageHero, Kpi, Card, CardState,
  Tabs, Trend, KitTable, Pager, fmtInt/fmtPct = N/A on null). New pages build on
  this; KitTable wraps EnterpriseTable (no raw `<table>` - design ratchet).
- Palette: `src/lib/reportColors.js` (colorAt, categorical, withAlpha, stylize;
  super-admin theme). Semantic status colours stay fixed.
- Governed KPIs: `metric_registry` + `metric_versions` (V473),
  `src/lib/api/metricRegistry.js` (listMetrics, explainMetric, upsertMetric,
  saveMetricVersion), `src/lib/metricExplain.js`, `src/lib/metricGovernance.js`,
  `src/components/trust/ExplainThisNumber.jsx` (mount by `metricId`). Lineage
  `data_assets`/`lineage_edges`/`dashboard_registry`/`widget_bindings` (V475).
  New inventory KPIs MUST be registered here (Part 3), not computed ad hoc.
- Quality checks: `run_quality_checks(country)` / `quality_rules` (V474) - add
  inventory checks (negative balance, movement with no stock row) there.
- Existing KPI engine: `src/lib/kpiEngine.js` (tyre KPIs only; do not put stock
  maths in it - make `src/lib/inventoryKpis.js` and register each output).

### 2.3 Reports (PDF / Excel, signatures, references, versioning)

- `src/lib/exportUtils.js`: `exportToExcel`, `exportSheetsToExcel`, `exportToPdf`,
  `exportDocumentPdf`, `pdfHeader`/`pdfFooter`, `resolvePdfBrand`,
  `pdfTableTheme`, `reportFileName`, `applyExportPolicy` (export audit +
  `max_export_rows` + export capability via `src/lib/exportCapability.js`).
  PDF tables MUST go through `loadAutoTable()` in `src/lib/pdfEngine.js`
  (jspdf 4 + autotable peer break).
- Table exports: `src/lib/report/tableReport.js`; server print engine optional:
  `src/lib/report/serverReport.js` -> `services/report-engine`.
- Signature + document number pattern to copy: checklist `document_no`
  minted server-side per (org, prefix, asset, year) by
  `next_checklist_document_no` (V594, DEFINER, revoked from authenticated - V596);
  PDF prints "version vN"; saved signatures `user_signatures` (V601, own-row only)
  pre-fill the pad. Count sheet / adjustment voucher should mint e.g.
  `CNT-<STORE>-2026-0001` the same way and print approver signature + version.
- Audit pack precedent: `src/lib/checklistAuditPack.js` + `checklistAuditPackPdf.js`.
- Scheduled delivery: `report_schedules` + `send-scheduled-reports` edge fn
  (`DATASET_DIGEST`); a new `inventory` report_type needs the CHECK widened AND
  a digest branch, and the fn must be deployed via CLI (never hand-inlined).
- Public TV: `get_report_snapshot` / `report_shares` (add a channel only if a
  board is needed; no second share surface).

### 2.4 Approvals and segregation of duties

- Governed engine: `approval_policies` (versioned, audited, schema
  `approval_private`): `execution_decide`, `permits`, `can_execute`,
  `guard_document`, `notify_stage`, `assert_scope`, `caller_module_access`
  (migrations `20260910182201_governed_approval_policies.sql`,
  `20260910185625_approval_pre_execution_gates.sql`, region routing
  `20260919100000/110000`). Owner ruling 2026-11-10: KEEP this engine;
  `approval_matrix` is RETIRED (read-only). DUPLICATE RISK: no new approval table
  for adjustments - add a policy context for `stock_adjustment` / `stock_count`.
- Capability gate: `app_user_can(module, cap)` + `app_cap_granted` /
  `app_cap_revoked(<module>,'approve')` (20261025153000). Stock already has
  `organisations.settings` override "Store Keeper": stock.create=true; min/critical
  levels Admin-only.
- Inbox + delegation: `src/lib/approvalInbox.js`, `src/lib/api/approvalsQueue.js`,
  `src/lib/api/approvalDecisions.js`, `approvalDelegations` (V203);
  `src/pages/Approvals.jsx` (bulk only on rows the caller can decide).
- SoD rule to encode in the decide RPC: `approver_id <> counted_by` and
  `recount_by <> counted_by`, checked server-side (same pattern as the ERP
  exception "different approver" check).

### 2.5 Notifications (in-app, email, push, dedupe)

- Due-alert engine: `due_alert_rules` + `due_alert_notices` (dedupe key
  rule_key, entity_key, stage, user_id) + `_due_items()` + hourly
  `scan_due_alerts()` cron `due-alerts-scan` (`20261025090000_due_alerts_engine.sql`
  and follow-ups). `stock_low` already exists (critical, repeats weekly while
  low). Links/severity `src/lib/dueAlertLinks.js` (a test pins every rule key).
  Add a rule = row + `_due_items` branch + link entry.
- Push: `workflow_notifications` with pre-rendered `push` payload ->
  `workflow-notify` edge fn (Expo + FCM v1); `domain_events` minted for event_id
  BIGINT (20261108110000). Receipts `push_delivery_receipts`.
- In-app: `notifications` table (server-inserted; mobile inbox
  `mobile/lib/notificationsInbox.ts`, web NotificationCenter);
  `notify_elevated_users` is NOT org-scoped - insert org-scoped rows directly
  (V486b lesson).
- Email: `send-email` (verify_jwt=false, self-validating), Resend.
- Preferences: `notification_preferences` (V204), `src/lib/api/notificationPreferences.js`.
- Domain events bus: `trg_emit_domain_event`, `event_consumers`
  (`src/lib/api/domainEvents.js`). DUPLICATE RISK: no new notification table.

### 2.6 AI (advisory only)

- Agent registry: `supabase/functions/_shared/aiAgents.ts` (AGENT_TYPES:
  analyst, tyre_engineer, qa_data, planner, safety, procurement, cost_audit;
  ROLE_AGENTS; GLOBAL_RULES) mirrored by `src/lib/aiRouter.js`. Inventory fits
  `procurement` (reorder, supplier) and `qa_data` (duplicates) - extend their
  tools, do not add an 8th agent unless a clear gap.
- Orchestrator tools run on the CALLER's JWT: `supabase/functions/ai-orchestrator/tools.ts`
  (+ `budget.ts`, `policy.ts`, `knowledge.ts`). Atomic budget reservation
  `ai_budget_reservations` (20261112100000); cost ledger `ai_token_logs`
  (cost_usd, status, latency_ms; server-write-only 20261112151000);
  `ai_budgets`, `ai_models` pricing, `src/lib/api/aiOps.js` single reader.
- Proposals (advisory -> human decides): `ai_proposals` + events,
  `src/lib/api/aiProposals.js` (scanProposals, decideAiProposal). Inventory AI
  suggestions (reorder, suspicious variance, duplicate item) land here.
- OCR / photo: `ai-tyre-inspection` worker pattern (queued jobs, hash reuse,
  quality gate, budget fail-closed). For delivery-note / serial OCR copy the
  queue+budget pattern; never let OCR write stock directly.
- Duplicate detection: material master per (org, country, item_code)
  `material_master` + `material_master_set_bulk`, classification learning
  `tyre_learned_facts`/V400 lift rules, `admin_dup_*` + `_dup_scan_spec`
  (Duplicate Control). Item-code dedupe must reuse these.
- Edge-fn deploy rule: never write `\uXXXX` in source; deploy from repo, never
  hand-inline a large file.

### 2.7 Audit logs

- `audit_log_v2` via `trg_audit_row_change` (records actor_type, site, IP/UA;
  immutable; `app.actor_label` for imports); client `src/lib/auditLogger.js`
  (`logAuditEvent`, `audit`). Hash seals `src/lib/auditSeals.js` /
  `src/lib/api/auditSeals.js`. Access changes `access_audit`.
- Any new inventory table: attach the audit trigger, RESTRICTIVE org isolation,
  country/site policy copied from `tyre_records` (V542 FOR ALL form), and end
  the migration with `select anum_integration.apply_reader_policies();`.

### 2.8 Duplicate-risk summary

Rebuilding any of these would violate the single-source rule: a second stock
ledger, a second count overwrite beside `set_stock_count`, a second approval
table, a second notification/alert table, a second reorder engine beside
`stockReplenishmentAnalytics.js`, a second forecast beside `tyreDemandForecast.js`,
a second cost source beside the `parts_consumption` grid, a second chart palette,
a second KPI registry, a second export helper.

---

## Part 3 - Proposed catalogues

Conventions: money per country in its own currency, never blended (All view =
per-country rows, total N/A). Null rule = what the metric returns when it cannot
be measured; never 0 in its place. Every metric: `metric_registry` row +
`metric_versions` v1, `lineage_domain` set, mounted via `ExplainThisNumber`.

### 3.1 KPI catalogue (`metric_registry`)

| metric_id | Formula | Source | Null rule |
|---|---|---|---|
| inv_stock_value | sum(qty_on_hand * wac) of OWNED stock (consigned excluded) | stock_records + valuation | null if any line in scope lacks a cost; report `priced_pct` beside it |
| inv_record_accuracy | items with |counted - expected| <= tolerance / items counted, approved counts in period | count lines | null if no approved count in period |
| inv_variance_value_net | sum((counted - expected) * wac) | count lines (approved) | null if no approved count |
| inv_variance_value_abs | sum(abs(...)) | same | same; always shown beside net (net hides offsetting losses) |
| inv_cycle_count_compliance | items counted in period / items due by ABC schedule | count schedule + lines | null if nothing scheduled |
| inv_recount_rate | lines recounted / lines counted | count lines | null if 0 counted |
| inv_adjustment_approval_time | median(approved_at - submitted_at) | approval decisions | null if no decisions |
| inv_turnover | issued value 12m / avg stock value 12m | stock_movements + parts_consumption issue value | null if avg value 0 or unpriced |
| inv_days_of_cover | qty_on_hand / avg daily issue qty (90d) per item | stock_movements | null if no issues in 90d (show "no recent use") |
| inv_stockout_rate | item-days with qty <= 0 and demand / item-days | ledger daily | null if no demand |
| inv_below_min_count | items where qty <= min_level | stock_records | null if min_level unset on all items in scope |
| inv_dead_stock_value | value of items with no issue in 180d | ledger + valuation | null if unpriced |
| inv_negative_balance_count | items with qty < 0 | stock_records | 0 is a real value; never null |
| inv_serial_exceptions | serials expected but not found + found but not expected | serial count lines vs tyre_records | null if no serialized count |
| inv_issue_to_fitment_gap | tyres issued from store vs tyres fitted (`utilisationGap`) | stockLedger.tyresFitted + tyre_records | null if no fitments loaded for window (KSA Aug-Nov 2025 baseline caveat) |
| inv_reorder_forecast | projected demand next 3 months per size | tyreDemandForecast | null when < MIN_TREND_MONTHS; caption via forecastWindow |
| inv_consignment_value | sum(qty * agreed price) where consigned | stock + consignment owner | null if no consignment stock |

### 3.2 Alert catalogue (`due_alert_rules` + `_due_items` branch + dueAlertLinks)

| rule_key | Trigger / stage | Severity | Recipient roles | Dedupe |
|---|---|---|---|---|
| stock_low (exists) | qty <= min_level; low/critical | critical | Admin, Manager, Director, Store Keeper, Tire Planning Engineer, Fleet Supervisor | weekly repeat while low (existing) |
| stock_negative | qty < 0 | critical | Admin, Store Keeper, Manager | once per item per day |
| cycle_count_due | ABC schedule date within lead_days / overdue | warning | Store Keeper, Manager | once per item per stage |
| count_awaiting_approval | submitted count older than N hours | warning | approvers resolved by approval_policies | once per count per stage (overdue after SLA) |
| count_variance_high | approved/submitted variance value over band | critical | Admin, Manager, Director | once per count |
| recount_assigned | recount created | info | the assigned recounter only (user, not role) | once per recount |
| stock_dead | no issue in 180d and value > 0 | info | Manager, Tire Planning Engineer | monthly |
| reorder_suggested | forecast demand > on hand + open PO within lead time | warning | Tire Planning Engineer, Store Keeper | once per item per month (also an ai_proposals row) |
| consignment_aged | consigned stock older than agreed days | warning | Admin, Manager | once per item per stage |
| grn_unreconciled | goods receipt with no matching PO/price after N days | warning | Store Keeper, Manager | once per GRN |

Rules: recipients must pass role + org + country + site (engine already does);
recipient roles only roles whose web route opens the target page; push goes via
`workflow_notifications` pre-rendered payload; each new key needs a
`dueAlertLinks.js` entry (pinned by test).

---

## Sources

- SAP: [tolerance groups in embedded EWM](https://groups.community.sap.com/t5/supply-chain-management-blogs-by-members/how-to-define-physical-inventory-tolerance-group-in-embedded-ewm-in-s-4/ba-p/13433320), [compare PI in IM/WM/EWM](https://community.sap.com/t5/supply-chain-management-blog-posts-by-members/compare-physical-inventory-im-wm-ewm/ba-p/13541080), [automatic posting after count](https://community.sap.com/t5/supply-chain-management-blog-posts-by-members/ewm-automatic-posting-of-physical-inventory-document-after-entering-the/ba-p/13190271), [SAP Help: PI differences](https://help.sap.com/saphelp_46C/helpdata/EN/12/0863e7470311d1894a0000e8323352/content.htm), [SAP Learning: conducting physical inventory](https://learning.sap.com/courses/inventory-management-and-physical-inventory-in-sap-s-4hana/conducting-physical-inventory)
- Oracle: [cycle counting (EBS 12.2)](https://docs.oracle.com/cd/E26401_01/doc.122/e48820/T291651T292438.htm), [count adjustments and approvals](https://docs.oracle.com/cd/A60725_05/html/comnls/us/inv/ccadj.htm), [approving adjustments](https://docs.oracle.com/cd/A60725_05/html/comnls/us/inv/ccadj01.htm), [Fusion cycle count creation](https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/24d/famml/cycle-count-creation.html)
- Microsoft: [inventory journal approval workflows](https://learn.microsoft.com/en-us/dynamics365/supply-chain/inventory/inventory-journal-workflow), [cycle counting in D365 WMS](https://www.westerncomputer.com/resources/blog/cycle-counting-in-d365-for-finance-and-operations-warehouse-management-part-3)
- IBM: [Reconcile balances action](https://www.ibm.com/support/knowledgecenter/SSLKT6_7.6.1.2/com.ibm.mam.doc/gp_finmgr/c_rec_bal_action.html), [reconciling inventory balances](https://www.ibm.com/support/knowledgecenter/SSLKT6_7.6.1.2/com.ibm.mam.doc/wc_inventory/t_reconcile_inv.html), [managing inventory counting](https://www.ibm.com/docs/SSLL9Z_7.6.2/com.ibm.trn.doc/plustcount/t_ctr_manage_inv_count.html), [APAR IJ46287 avg cost after reconcile](https://www.ibm.com/support/pages/apar/IJ46287)

Gaps: no source found for Dynamics 365 blocking a location during a count, or
for Maximo consignment reconciliation. Consignment/valuation lines above for SAP
and Oracle are from general product knowledge, not a fetched page this session.
