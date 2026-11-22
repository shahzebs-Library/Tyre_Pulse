# 95 - Authenticated web inventory acceptance test (real PostgREST + real Postgres RLS)

Date 2026-11-20. Branch `claude/inventory-upgrade-7rxp2t`, base commit `7ef83b77`.
**Nothing was applied to production, merged, deployed or activated.** Production
(`jhssdmeruxtrlqnwfksc`) was read with three SELECT-only queries through the Supabase MCP
(tooling: `95_web_acceptance_tooling/extract_q1..q3*.sql`); everything else ran on a local copy.
This closes rehearsal gate 13 (`93_REHEARSAL_EVIDENCE.md`: "Browser test: NOT TESTED").

## Environment

| Part | Version / setting |
|---|---|
| Database | PostgreSQL **17.6** (x86_64, embedded-postgres 17.6.0-beta.15; production 17.6 aarch64), port 54417, roles/GUCs from `93_rehearsal_tooling/roles.sql` + `guc.sql` (postgres NOT superuser, BYPASSRLS, as production) |
| Snapshot | Rebuilt from production today with `93_rehearsal_tooling/build_snapshot.py`: **161/161 closure functions byte-identical to production** (`fpcheck.py`; the 156 of gate 2 plus the 5 the web shell calls: `get_user_module_permissions`, `get_my_capabilities`, `get_my_access_grants`, `get_public_config`, `stock_item_suggestions`), 73 relations, sanitized data (profiles 772, stock_records 43, stock_movements 78, tyre_status_marks 907, tyre_records 1,025, material_master 400, ...). Guarded writers unchanged since the rehearsal (`post_stock_movement 12d9a6a0`, `set_stock_count 28e9e4d6`, `save_stock_entry 964c2e8c`, `transfer_stock_entry 34faec25`, `validate_policy b76c1c97`). |
| Migrations | 16 pending files applied as role `postgres`, one run each: **16/16 OK**, sha256 identical to doc 93 gate 3 |
| Prepared SQL | `94_prepared/nhc_stock_country_correction.sql` (sha256 2f928d2d...) then the 16, then `94_prepared/store_keeper_capabilities.sql` (sha256 c2ea5649..., 28 grants inserted) |
| API | **PostgREST 12.2.3**, `db-schemas public`, anon role `anon`, local HS256 secret (not production), max rows 1000 |
| Auth | Local proxy (`95_web_acceptance_tooling/proxy.mjs`): `/rest/v1` -> PostgREST, `/auth/v1` -> GoTrue stub (`/user`, `/token` refresh, `/logout`). Minted HS256 JWTs (`sub`, `role authenticated`, `aud authenticated`, `aal1`). The session is injected into localStorage `tp_auth` (`src/lib/supabase.js` AUTH_STORAGE_KEY) before the app loads. Password sign-in itself is NOT exercised. |
| App | Vite 8.3.6 dev server on the branch (`VITE_SUPABASE_URL=http://localhost:54321`), node 22.22, Playwright 1.63 headless Chromium, 1440x900 |
| Not available locally | Realtime websocket, edge functions, and tables outside the 73-relation snapshot (shell calls such as `get_organisation_configuration`, `get_subscription_overview`, `corrective_actions` return 404; no inventory screen depends on them) |

### Test users (created in the snapshot copy only: `95_web_acceptance_tooling/testusers.sql`)

| User | Role | Company | Country / sites | Stock capabilities |
|---|---|---|---|---|
| qa.admin | Admin | Default (A) | KSA / ALL | all (Admin) |
| qa.manager | Manager | A | KSA / ALL | view (production default) + test grants view_value, adjustment_approve, discrepancy_review, financial_post, audit_create, audit_history, recount |
| qa.storekeeper | Store Keeper | A | KSA / **{NHC}** | view, create (production) + receive, issue, transfer, count (the 4 grants of `store_keeper_capabilities.sql`) |
| qa.invctl | Inventory Controller | A | KSA / ALL | production: **none**; test grants per `approver_roles_template.sql` (view, view_value, audit_create, audit_history, recount, discrepancy_review, adjustment_approve) |
| qa.finance | Finance Manager | A | KSA / ALL | production: none; test grants view, view_value, financial_post, adjustment_approve |
| qa.pmv | PMV Manager | A | KSA / ALL | view (production) |
| qa.otherco | Manager | Egypt (second company) | Egypt / ALL | view |

Site restriction of the Store Keeper is `profiles.sites = {NHC}` (the grants are per person; the site
scope comes from the profile, as `store_keeper_capabilities.sql` block 3 describes). Approval limits
(no web screen exists for them) were set through `inv_approval_limit_upsert` as qa.admin:
stock_adjustment Manager max SAR 50 (KSA), Admin no limit.

## Results

Screenshots (58 PNG + 1 generated PDF) are in the session scratchpad, not committed; the file
names are listed in the last column. Every case was run in the real browser unless it says "API".

| # | Case | Result | Evidence |
|---|---|---|---|
| 1 | Stock hub `/stock` loads with real data | **PASS** - 36 company-A lines, "12 of 12 inventory parts installed", N/A owned value before any priced receipt | smoke_admin__stock |
| 2 | Locations: Admin adds WH-A, WH-B (NHC), WH-D (DIRIYAH) | **PASS** - listed, rows in `inventory_locations` with KSA country | t01_locations_admin |
| 3 | Receive with cost (10 received, 1 rejected, SAR 50) | **PASS** - +9 at SAR 50, rejected unit never enters stock | t02_receive_admin_GRN-QA-1 |
| 4 | Receive without cost | **PASS** - 6 units `unvalued`, cost NULL (never 0) | t02_..._GRN-QA-2 |
| 5 | Issue (Store Keeper, NHC) | **PASS** - posted, "Moved at known cost: 2" | t03_storekeeper_0_issue |
| 6 | Reservation then issue against it | **PASS** - reservation id shown, issue of 3 at unknown cost; balance reserved 0 after | t03_..._1_reserve, _2_issue |
| 7 | Serial tyre (140142-O, serial_tracked) receive + issue | **PASS** for the balance flow (2 in @ SAR 420, 1 out at known cost). The web receive / issue form has no serial field, so no individual serial was recorded (serial custody comes from tyre records, case 22) | t02_..._GRN-QA-3, t03_..._3_issue |
| 8 | Batch item (040105-O; `lot_tracked` set in the snapshot for the test) | **PASS** - single-cost balance issues without naming a receipt; after an unvalued receipt (mixed balance) the issue without a receipt is refused with the plain sentence; API: a receipt that does not fit is refused (22023), a fitting one posts 2 at SAR 30 | t03_..._4_issue, call.mjs |
| 9 | Over-issue (50 of 7) | **PASS** - "Not posted: not enough stock", shortage recorded, balance unchanged | t03_..._5_issue |
| 10 | Transfer WH-A -> WH-B (Store Keeper): dispatch + receive | **PASS** - TRF reference, in transit, received; WH-A 7->5, WH-B +2, transit 0; Store Keeper's location list holds only NHC (no WH-D) | t04_storekeeper_* |
| 11 | Reversal (Admin) | **PASS** - reversal row +2 pointing at the original, original kept; Store Keeper gets no reverse action | t05_admin_reversed, t05_storekeeper_ledger |
| 12 | Ledger immutability: UI | **PASS** - no edit control on any ledger row for any role | t05_* |
| 13 | Ledger immutability: direct PATCH / DELETE / INSERT through PostgREST (API) | **PASS** - Admin, Store Keeper, Manager: 403 42501 "permission denied for table stock_movements"; direct PATCH of stock_records by Store Keeper 403; row unchanged | call.mjs |
| 14 | Blind count: counter cannot see expected quantity | **PASS** - counter screen shows item + location only, no expected / book quantity (RPC payload has none either) | t07_storekeeper_counter_view |
| 15 | Count submit, finish, reconcile (Inventory Controller) | **PASS** after fix D1 (see below) - variance -2, value impact SAR -100 (net and absolute shown) | t07_*, t09_invctl_reconciled |
| 16 | Recount: request approval -> independent approval -> assign -> recount -> re-reconcile | **PASS** after fixes D2 and D3 - requester (IC) blocked "segregation_of_duties: requester", Store Keeper blocked, Finance Manager blocked (not a recount role), Manager approved; PMV Manager recounted round 2 blind; round 1 discrepancy superseded | t11_invctl_reqrecount, t12_*_queue, t07_pmv_*, t08_pmv_Finish_counting |
| 17 | Adjustment approval: preparer cannot approve own | **PASS** - IC (requester) "segregation_of_duties: requester" | t12_invctl_queue |
| 18 | Store Keeper cannot approve | **PASS** - "segregation_of_duties: creator, preparer, counter or recounter"; API: an approval limit for Store Keeper refused ("Role Store Keeper cannot approve stock_adjustment stages") | t12_storekeeper_queue |
| 19 | Threshold: Manager above limit escalates; Admin approves | **PASS** - Manager sees "above_threshold: value 100.00 exceeds your limit 50; escalate" and no Decide button; Admin approves; Manager (audit approver, not counter/creator) posts the adjustment: `adjustment_down -2 @ SAR 50`, WH-A 7 -> 5. Non-admin cannot set limits (API 42501) | t12_manager_queue, t12_admin_approve, t11_manager_approve |
| 20 | Manager / Controller approve **within** threshold | **PARTIAL** - Manager approved the recount request (no limit configured for that type). An Inventory Controller / Finance Manager approval is **NOT TESTED**: on the default route the server answers `default_route_needs_elevated_approver`; they can approve only when an approval policy stage names their role (owner configuration, not built here) | t12_finance_queue |
| 21 | Valuation: valued / unvalued / split-undecided separate; no money for Store Keeper | **PASS** - Admin: SAR 860.00 valued part (= 5x50 + 2x50 + 3x30 + 1x420), 11 valued, 305 unvalued, 0 undecided, "Valuation incomplete", per currency never summed. Store Keeper: every amount N/A, quantities only, NHC lines only (189 vs 305 unvalued) | t13_admin_valuation, t13_storekeeper_valuation |
| 22 | Tyre conflicts visible, no direct decide | **PASS** - "Refresh custody from tyre records" (KSA scope): 907 tyres, 6 open `scrapped_but_active` (KSA L520*, YMU4*, YMM6*, YMY4*, YMM2*, YMM1*); drawer shows evidence and the investigation route, no decide control; API decide refused "decided through its investigation", direct PATCH 403. The 7th (UAE YMA4*) needs a UAE-scoped user: **NOT TESTED** here | t14_admin_tyres, t14_admin_conflict |
| 23 | ERP reconciliation view | **PASS** - read-only per month/site/item/currency, status filter, Excel button, no posting control | t13_admin_valuation_ERPreconciliation |
| 24 | Reports + scheduled `inventory` type | **PASS** after fix D4 - 6 inventory reports with Excel/PDF; Scheduled Reports offers "Inventory Control", saves (`report_schedules.report_type = 'inventory'`), "Generate now" produces the digest PDF | t13_admin_reports, t15_admin_schedule_inventory |
| 25 | Inventory email digest logic (vitest) | **PASS** - `src/test/scheduledReportInventory.test.js` 11/11 (the edge function itself is not deployed or run) | vitest |
| 26 | Second-company user sees nothing | **PASS** - overview 0 lines / 0 audits / 0 conflicts, valuation empty, tyres 0; API with company-A stock id refused | t13_otherco_* |
| 27 | Store Keeper restricted to its site | **PASS** - register / valuation / pickers NHC only; API issue from a DIRIYAH line "outside your country or site scope", receive at DIRIYAH "Choose a permitted country and site" | t13_storekeeper_*, call.mjs |
| 28 | Anonymous caller | **PASS** - `inv_issue` 401 permission denied; stock_records read 401 | call.mjs |
| 29 | Audit close | **BLOCKED by finding S1** - refused "Every discrepancy must be posted, written off, rejected or closed first" | t08_invctl_Close_audit |
| 30 | Opening balance batches, cost reconciliation decide/post, supplier screens, mobile | **NOT TESTED** in the browser this run (covered at DB level by doc 93 gates 6, 9, 12) | - |

## Defects found and fixed (app code only; no migration changed)

| # | Defect (real browser, real server) | Fix |
|---|---|---|
| D1 | The blind-count screen listed the same item three times with **no location** (WH-A, WH-B, IN-TRANSIT): `inv_audit_counter_view` returns `location_id` per line and the locations separately, the client read a non-existent `location_code`. A counter could not tell which shelf each line was. | `src/lib/api/inventory.js` `getCounterView` joins each line to the payload's `locations` (code, name). Test added (`inventoryApi.test.js`). Re-verified in the browser: lines read "... \| WH-A". |
| D2 | An **approved recounter** without the `count` capability (PMV Manager) got no Count button, so an approved recount could never be done. The server (`inv_count_submit`) accepts exactly the assigned counter / recounter, by assignment, not capability. | `src/lib/inventory/auditView.js` `availableActions`: count is offered by assignment. Tests updated (`inventoryHubEngines.test.js`). Re-verified: PMV Manager counted round 2. |
| D3 | The recount pickers offered the audit's **approver**, whom `inv_recount_assign` refuses ("A recount must be done by a different person..."). | `AuditReconciliation.jsx` and `DiscrepanciesSection.jsx` exclude counter, earlier recounter, approver and self (mirror of the server rule). Re-verified: QA Manager (approver) no longer offered. |
| D4 | The scheduled inventory digest PDF printed **"SAR 11"** for a quantity: the generic summary picked `owned_valued_qty` as money (it matches /value/) and would also have added amounts across currencies. | `exportToPdf` takes `opts.summaryMoney === false`; the `inventory` dataset sets it; ScheduledReports passes it. Re-verified: the PDF shows record and site cards only. |
| D5 | Every refused write in the inventory hub was titled **"This could not be loaded"** (e.g. a refused issue, a refused audit close). | `ErrorNote` titles an action refusal "This was not done" (en + ar key `inventory.state.actionErrorTitle`); load errors (with Retry or `load`) keep the old title. |

Tests after the fixes: inventory + scheduled-report + export + i18n suites **18 files / 318 tests pass**,
`webI18nKeyCoverage` + `inventoryHub.render` pass, eslint 0 errors on the touched files.

## Findings NOT fixed (server or prepared SQL; reported, not changed)

* **S1 - legacy stock lines can never be counted (migration 20261120102000).** A full audit at a site
  with legacy, un-itemised `stock_records` snapshots those lines (`item_id` NULL; 18 at NHC), but
  `inv_audit_counter_view` returns only lines with an `item_id`. Every round therefore creates one
  "not counted" discrepancy per legacy line (18 in round 1 and again in round 2), and the audit cannot
  be closed until each is written off or closed by hand. Fix belongs in the migration (either offer
  legacy lines to the counter by description, or leave them out of the snapshot until they are mapped
  through an opening batch) - **owner decision; the migration was not changed**. Related display gap:
  those discrepancy rows show item and location as N/A (the description is in the view but not shown).
* **S2 - `94_prepared/nhc_stock_country_correction.sql` cannot run after the release.** Its header says
  "Running it after the release also works"; on the copy, after the 16 files it fails with
  `Stock quantity, cost, ownership and location change only through a posted movement.`
  (`inv_balance_guard`). It works when run **before** file 1 (as done here). The file was not edited
  (its sha256 is part of the approval package); the package must say "before only".
* **S3 - Inventory Controller and Finance Manager hold no stock capability in production** (inv_can is
  false for every capability, including `view`), and on the default route the server refuses them as
  approvers. Both need the capability grants and an approval policy naming them before they can act.
* Observations: completed transfers disappear from the default transfer filter; the source-receipt list
  shows "5 left" for a receipt after unnamed issues took units from it (the server refuses a receipt
  that no longer fits, so no wrong posting is possible); legacy lines show "No currency" (unvalued, so no
  amount is affected); the conflict drawer shows raw evidence keys (`activeRows`, `scrapMarks`).

## Reproduce

`95_web_acceptance_tooling/`: extraction queries q1-q3 (q2/q3 were described but not written in doc 93's
`extract_queries.sql`; they are here), `testusers.sql`, `testgrants.sql`, `pgrst.conf`, `jwt.mjs`,
`proxy.mjs`, `call.mjs` (direct PostgREST calls), `pw.mjs` / `ui.mjs` (Playwright session injection) and
the case scripts `t01`..`t15`. Order: roles.sql + guc.sql -> rebuild.sh -> fresh.sh rh_a snap_base ->
nhc correction -> apply.sh rh_a forward -> store_keeper_capabilities.sql -> testusers.sql ->
testgrants.sql -> postgrest -> proxy -> vite -> scripts. Every local cluster, binary and extract was
deleted after the run.
