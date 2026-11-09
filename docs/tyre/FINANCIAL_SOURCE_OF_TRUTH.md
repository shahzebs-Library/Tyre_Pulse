# Financial source of truth (Phase 2, 2026-11-09)

Every money figure in Tyre Pulse, where it comes from, and the rule that keeps one purchase
from being counted twice. Measured on live data (project jhssdmeruxtrlqnwfksc) on 2026-11-09.
Rules referenced: docs/tyre/BUSINESS_RULES.md (T1-T19).

## 1. The one rule
**Money comes from ONE place: the expense grid (`parts_consumption`), each country in its own
currency.** Tyre records, inventory, work orders and lifecycle events never add money on top of it.

| Source | What it holds | Used for money totals? |
|---|---|---|
| `parts_consumption` (expense grid) | every issued part / tyre / oil line, ERP amount, classified tyre / spare / oil by the item | **Yes - the only one** (T9) |
| `tyre_records.cost_per_tyre` | the purchase price of one physical tyre (once, T1) | No. Only for per-tyre and lifetime CPK, and for site / brand splits that are labelled "tyre-record price" |
| `stock_records.unit_cost` (36 rows) / `stock_movements` (78 rows, no money) | inventory on hand | No. Shown only as "stock value" on Materials; never added to spend |
| `purchase_orders`, `goods_receipts`, `material_issues` | 0 rows | No |
| `work_orders.tyre_cost` | 0 non-null rows | Excluded from maintenance on purpose (no double count against tyre spend) |
| `tyre_service_events`, `retread_jobs`, `warranty_claims` | 0 rows | Lifetime CPK extras only (Phase 1), never spend |
| `sco_costs`, `sany_invoices` | contractor / OEM invoices | Cost per m3 and report cost only, as their own lines |

A tyre bought in the ERP therefore appears twice in the DATA (an expense line AND a tyre record
carrying the same price), but only once in any MONEY TOTAL, because totals read the grid and CPK
reads the tyre. No screen adds the two together (checked: `costIntelligence.assetCpk` adds grid
tyre + grid maintenance; Cost Center, Board Overview, Executive, Dashboard, Analytics read the grid).

## 2. Every money figure and its single source

| Figure | Screen(s) | Single source |
|---|---|---|
| Tyre / maintenance spend split, monthly | Dashboard, Analytics, Board Overview, Executive, Cost Center, PM, Engineering KPI, Brand Performance, Vehicle History, KPI Scorecard | `loadGovernedCostSplit` -> `get_cost_cpk_overview` / `get_parts_expense_snapshot` (grid) |
| Expense totals, categories, stores, assets, items, trend | Expense Report | `get_parts_expense_snapshot`, `get_expense_by_country`, `get_expense_period_trend` (grid) |
| **Expense cost status split (new)** | Expense Report "Cost Status", Data Reconciliation | `get_expense_cost_status_summary` / `expense_cost_status_lines` (grid, migration 20261110090000) |
| Per-asset tyre cost | Asset Detail, Fleet Analytics, Vendor / Position / Size intelligence | `loadGridTyreByAsset` -> `get_tyre_cost_by_asset` (grid) |
| Per-site operating cost | Expense Report "By Site" | `get_site_operating_cost` (grid through the asset, T15) |
| Cost variance (why it changed) | Expense Report | `get_cost_variance` (grid) |
| **Budget Planner actual spend (changed this phase)** | Budget Planner | `loadCostSplit` grid path (tyre bucket), one country only |
| Budget Planner site / brand split | Budget Planner | `tyre_records` price, one price per tyre (labelled) |
| Report snapshot cost (TV board, Flutter management, mobile exec report) | ReportShare, mobile, Flutter | `get_report_snapshot(_authed)` `cost` block = grid since V522 |
| Fleet expense per vehicle-km / per engine hour | CPK Intelligence "Fleet CPK", report snapshot `cost.tyre_cpk` | `get_fleet_cpk` (grid tyre expense / fleet km) |
| Physical tyre lifetime CPK (purchase-only and full) | CPK Intelligence "Tyre lifetime", Passport, Serial Tracker, Tyre Bay, Tyre Records | `v_tyre_lifetime` / `get_tyre_lifetime_cpk`; JS `toLifetimeTyres` (Phase 1) |
| Fleet aggregate tyre CPK (weighted) | kpiEngine, every group CPK | JS `weightedCpk` / `lifetimeSummary` |
| Per-fitment tyre CPK | Tyre Bay stints, Tyre Records row, Driver Detail | JS `recordCpk` with `withOnePricePerTyre` |
| TCO | TCO Calculator | `tco.js` over tyre-record prices (purchase cost, not spend) |
| Cost per m3 | Cost per M3 | `get_cost_per_m3` (grid + SCO + SANY / approved m3) |
| Stock value | Materials | `stock_records` (inventory, not spend) |
| Mobile (Expo) overview / AI context | mobile | `mobile/lib/tyrePurchase.ts` (purchase once per tyre) |
| Flutter asset financials | Flutter | `asset_insights_repository.dart` (expense lines per asset) |

Known places that can still show a tyre-record sum as spend (fallback only, not changed here):
`boardOverview.js` `kpis.tyreSpend` is used by Board Overview only when the grid returns 0 for the
scope; `loadCostSplit`'s last-resort legacy path sums `tyre_records` when neither the grid nor
`get_maint_tyre_split` answers.

## 3. Expense cost status (T17 for expense lines)
Migration `20261110090000_expense_cost_status.sql` (additive, read only, SECURITY INVOKER, RLS of
`parts_consumption` applies). JS mirror: `src/lib/expenseCostStatus.js` `classifyExpenseLines`.

| Status | Meaning | Precedence |
|---|---|---|
| DISPUTED | a person must decide (`cross_load_copy` or `conflicting_revision`) | 1 |
| CONFIRMED_ZERO | zero on a warranty / free-of-charge line | 2 |
| ESTIMATED | ERP sent nothing; `filled_cost` from `parts_cost_fill` (item-code median) | 3 |
| MISSING | zero, no estimate, not warranty | 4 |
| ACTUAL | the ERP sent an amount (negative = credit, flagged `is_credit`) | 5 |

An "upload" is the hour a row arrived. A content copy is DISPUTED only when an EARLIER upload
already holds that content at least as many times, so genuine identical lines inside one export
stay ACTUAL. Both duplicate keys include the transaction date, so a date-filtered check is exact.

### Live result, all dates (dry run 2026-11-09)
| Country | Lines | Total | ACTUAL | ESTIMATED | CONFIRMED_ZERO | MISSING | DISPUTED |
|---|---|---|---|---|---|---|---|
| KSA (SAR) | 119,725 | 43,279,081.37 | 116,463 / 42,878,377.32 | 1,066 / 31,972.98 | 2 / 0 | 106 / 0 | 2,088 / 368,731.07 |
| UAE (AED) | 60,020 | 15,054,215.58 | 60,019 / 15,053,615.58 | 1 / 600.00 | 0 | 0 | 0 |
| Egypt (EGP) | 40,680 | 81,747,668.44 | 40,550 / 81,162,280.73 | 1 / 12.00 | 0 | 0 | 129 / 585,375.71 |

Status totals reconcile to the grid totals to the cent in every country. KSA 2026 to date (as the
KSA-only Manager, 1.4 s): 29,800 lines, SAR 5,830,469.82, of which DISPUTED SAR 368,731.07 (6.3%).

## 4. Entry paths audited (what is protected, what is not)

| Path | Idempotency key | Protected against | NOT protected against (measured) |
|---|---|---|---|
| Staging tables `expenses_ksa/uae/egypt` (`process_expenses_country`) | `import_uid` = md5(country, "#", content, store, cost centre), `on conflict do nothing` | re-sending the same file (same "#") | **an overlapping date-range export: "#" is renumbered, so the same line gets a new key.** KSA 2,037 lines / SAR 346,786.07 across 7 uploads since 2026-08-27; Egypt 129 / EGP 585,375.71 (upload 2026-07-28) |
| In-app Expense Import (`commit_expense_import`) | none on the row (`import_uid` not computed, no trigger stamps it) | an identical request id (receipt) and the file fingerprint warning | any re-upload of the same lines |
| ERP Intake grid (`insertPartsConsumption`) | none on the row | file fingerprint warning only | any re-upload |
| UAE / Egypt history | no "#" in the source: UAE 51,546 / Egypt 38,451 lines carry no `import_uid` | file fingerprint | re-import of those files (standing) |
| Revised transaction (same "#", new value) | key includes the value, so both rows land | - | KSA 25 groups / 51 lines; over-count SAR 920 (issue GC/MIS/0004/1026 line 8 counted 841 + 920; the other 24 groups pair a zero row with the priced row) |
| Zero / blank amount | classify keeps 0; `parts_cost_fill` can price it (estimate, logged, undoable) | estimate never overwrites an ERP amount (0 lines where `filled_cost` and an ERP amount coexist) | 106 KSA MISSING lines (70 tyre lines, Sep-Oct 2026) not yet estimated |
| Negative amount (refund / return) | kept as is, ACTUAL, `is_credit` | - | KSA 8 lines SAR -225.43, Egypt 1 line EGP -0.01 |
| Warranty line | `parts_cost_is_warranty` keeps it out of `parts_cost_fill` | - | the tyre price backfill uses a DIFFERENT regex (`tyre_price_is_warranty`) that misses "WARRENTY": 2 KSA lines |
| Repair / retread lines | classified by item; no serial, never linked to a tyre (Phase 1) | - | KSA 237 repair lines SAR 67,173 (18 retread SAR 7,200), Egypt 1,814 / EGP 1,563,547, UAE 336 / AED 151,326 |
| Multiple-quantity lines | `line_cost` is the line value; `unit_cost` = value / qty; tyre backfill divides by qty | - | KSA 60,691 / UAE 32,259 / Egypt 18,589 lines with qty > 1 (2,856 tyre lines) - correct, listed for awareness |

### Estimates are never built on estimates
- `parts_cost_fill`: evidence excludes every line with `filled_cost` set (checked in the live definition).
- `tyre_price_backfill` 'comparable' rung: excludes every tyre in `tyre_price_backfill_log` (V401c).
- **Latent gap:** `tyre_price_backfill` 'own_jobcard' rung sums grid `tyre_cost` WITHOUT excluding
  `filled_cost` lines, so a tyre could be priced from an expense ESTIMATE and read ACTUAL. Live today:
  1 estimated tyre-bucket grid line (SAR 600), 0 tyre prices taken from it. Proposal below.

## 5. Budget Planner (changed this phase)
Before: actual spend, YTD, projection, quarters, history trend and the derived budget summed
`tyre_records.cost_per_tyre` (one price per tyre). After: the expense grid tyre bucket via
`loadCostSplit`, one country at a time; with no grid data the spend is N/A, never a record sum;
"All countries" shows no spend (currencies are not added). CPK stays the lifetime layer; the site
and brand split keep the tyre-record price and say so on the page.

| Country, 2026 | Before (tyre-record sum) | After (expense grid tyre) |
|---|---|---|
| KSA (SAR) | about 1,881,205 | 2,904,584 (includes SAR 179,794 DISPUTED tyre lines) |
| UAE (AED) | about 316,243 | 1,442,716 |
| Egypt (EGP) | about 2,793,142 | 4,438,589 |

| Derived 2026 budget | Before | After |
|---|---|---|
| KSA | about 2,100,464 (2024-2025 only; 2023 had no priced tyres) | 2,588,954 (2023-2025) |
| UAE | about 113,636 (2025 only) | 847,909 |
| Egypt | about 1,627,743 | 3,349,563 |

"Before" figures are raw yearly sums of `cost_per_tyre` by issue date (the page also dropped refit
repeat prices, so its figure was at most this). Tyre records were priced for only part of the
history, which is why the old budget was far too low.

## 6. Proposals for a person (nothing here was changed)
1. **Archive the 2,037 KSA and 129 Egypt later-upload copies** (T11: exact content = keep one,
   archive the rest). The existing Duplicate Control key includes "#", so it cannot see them; use
   `expense_cost_status_lines(country, from, to, 'DISPUTED')` as the list. KSA spend falls by SAR
   346,786.07, Egypt by EGP 585,375.71.
2. **Decide the 25 KSA revised lines** (51 rows): keep the priced row, archive the zero rows, and
   decide line GC/MIS/0004/1026 #8 (841 or 920).
3. **Make re-imports idempotent on content, not on "#"**: either a BEFORE INSERT guard that holds a
   line whose content already arrived in an earlier upload, or a content key for the in-app paths
   (`commit_expense_import`, `insertPartsConsumption` set no `import_uid` today). This changes write
   behaviour, so it needs an owner decision.
4. **Exclude `filled_cost` lines from the `own_jobcard` rung** of `tyre_price_backfill` (new
   versioned function), and use one warranty test for both expense and tyre price.
5. **Run `parts_cost_fill` (dry run first)** for the 106 KSA MISSING lines.
