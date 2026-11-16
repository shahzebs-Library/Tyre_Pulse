# At-risk modules review (58 at risk + 1 broken)

Date: 2026-11-15. Read-only review. Nothing was changed in the repository or in production.

## How this was checked

- Register: `docs/commercial-readiness/audit/modules_A.json`, `modules_B.json`, `modules_C.json` (227 entries). 58 entries have a status that starts with "at risk", 1 is "broken". All 59 are covered below.
- Code: the checkout at `/home/user/Tyre_Pulse` (branch `claude/tyrepulse-inspector-build-7rxp2t`). Where a fix exists on this branch but not on `origin/main`, it is stated.
- Production database (project jhssdmeruxtrlqnwfksc): SELECT only. Row counts, column lists, policies, indexes, constraints and function definitions. No rows were copied.
- Routes: all 59 routes exist in `src/App.jsx`. The guard on each is listed in the tables.
- Module switch: `public.modules.status` read for every key. A switch set to disabled now blocks every non-Admin on any route (`ModuleStatusGate`, `src/components/ProtectedRoute.jsx:213-222`, which looks up the route slug as well as the shared key). Admin and super admin still pass a disabled module (`ProtectedRoute.jsx:199` and `:218`).
- Column check: a script compared every literal `.select()`, `.eq()`, `.order()` and similar column name in 75 service and page files against `information_schema`. It found one real missing column (Heat Intelligence). Reads that use `select('*')` or a computed column list were not checked this way, and insert or update payload keys were not checked by script.
- Browser test: `MODULE_WORKFLOW_TESTS.md` on `origin/claude/module-workflow-tests-7rxp2t`. 13 of these 59 are among the 29 modules that passed that test and were switched live on 2026-11-15 (the `last_updated` date in `public.modules` confirms it). That test ran on a staging copy with synthetic companies, not on production.

## Counts

| Class | Meaning | Modules |
|---|---|---|
| (a) | Works, risk cleared | 12 |
| (b) | Works but unproven | 13 |
| (c) | Defect found | 18 |
| (d) | Should stay hidden or off | 12 |
| (e) | Duplicate of another module | 4 |
| Total | | 59 |

## Findings that apply to many modules

| Finding | Evidence | Effect |
|---|---|---|
| Saved table views have no table in production | `to_regclass('public.user_view_prefs')` is null; no row for it in `supabase_migrations.schema_migrations`; the file `supabase/migrations/20260921090000_user_view_prefs.sql` exists | Pages still load (`src/lib/api/registerViews.js:44,91` degrade to "not provisioned"), but nobody can save a view. Applying the migration needs the owner's approval. |
| Admin passes a disabled module | `ProtectedRoute.jsx:199`, `:218` | Every company Admin can open the 12 modules in class (d). The switch is also global, not per company (`public.modules` has no organisation column). |
| All 13 restored and tested modules still hold 0 rows in production | counts below | Tested on staging only. First real use in production has not happened. |
| Tyre condition columns are empty | `tyre_records`: risk_level 0, tread_depth 0, pressure_reading 0, driver_name 0, supplier 0 of 11,267; removal_reason 3,851; position 11,267 | Any view built on these is empty or N/A. Readings exist only in `inspections.tyre_conditions`. |

## (a) Works, risk cleared

All but Position Intelligence passed the seven browser checks on staging (open, role access, empty state, create, update, error handling, tenant isolation) and are live since 2026-11-15.

| # | Module | Route | Guard | Switch | Table rows (prod) | Why the register flagged it | What I verified |
|---|---|---|---|---|---|---|---|
| 2 | Fleet Groups | /fleet-groups | Admin | live | fleet_groups 0 | Disabled, never used; asset count typed by hand | Browser test passed. Still true that a group does not own vehicles (design note, not a fault). |
| 3 | Combinations | /combinations | Admin | live | asset_combinations 0 | Disabled, 0 rows | Browser test passed. Columns match. |
| 5 | Battery Lifecycle | /batteries | Admin | live | batteries 0 | Disabled, 0 rows | Browser test passed. Life is an assumed 36 months, stated on the page. |
| 8 | Vehicle Check In/Out | /vehicle-checkinout | Admin | live | vehicle_checkinout 0 | Disabled, 0 rows; overlaps Handover | Browser test passed. Overlap with Handover and Gate Pass remains a product decision. |
| 10 | Vehicle Reservations | /reservations | Admin | live | vehicle_reservations 0 | Disabled, 0 rows | Browser test passed. Column script flag on `pass_date` was a false alarm (it belongs to the gate pass query on the same lines). |
| 12 | Rotation Schedule | /rotation | Admin | live | tyre_rotations 0 | Disabled, 0 rows | Browser test passed. |
| 16 | Position Intelligence | /position-intelligence | ModuleRoute position_intelligence | live | tyre_records 11,267 (position filled on all) | Risk views rest on risk_level, which is empty | The page no longer reads risk_level (no reference in `src/pages/PositionIntelligence.jsx`; the engine header records the removal). Position data is complete. Not browser tested by me. |
| 18 | Tyre Service Events | /tyre-service-events | Admin, Manager, Director | live | tyre_service_events 0 | Disabled, 0 rows | Browser test passed. |
| 20 | Retread Management | /retread | Admin | live | retread_jobs 0 | Disabled; eligibility uses empty columns | Browser test passed (create and update a retread job). Eligibility suggestions stay empty until tread or risk data exists. |
| 21 | Retread Claims | /retread-claims | Admin | live | retread_claims 0 | Disabled, 0 rows; currency fallback | Browser test passed. |
| 41 | Goods Receipt | /goods-receipt | Admin, Manager, Director | live | goods_receipts 0 | Any signed-in user may write through the API; receipt does not move stock | Browser test passed. Both register points are still true (policies `goods_receipts_insert/update` are `auth.uid() IS NOT NULL`; no stock posting). They are design gaps, not faults in what the page does. |
| 42 | Requisitions | /requisitions | Admin, Manager, Director | live | requisitions 0 | Same open write policy; no conversion to a purchase order | Browser test passed. Same two design gaps remain. |

## (b) Works but unproven: needs first real use or a browser test

| # | Module | Route | Guard | Switch | Table rows (prod) | Why flagged | What I verified | What would prove it |
|---|---|---|---|---|---|---|---|---|
| 6 | RFID Registry | /rfid | Admin | live | rfid_tags 1, rfid_tag_events 1 | Effectively unused, no reader hardware | Status values written (`active`, `unassigned`, `retired`, `src/lib/api/rfid.js:55,153-171`) match the CHECK. Columns match. | One assign, unassign and retire in a browser. |
| 9 | Vehicle Handover | /handovers | Admin, Manager, Director, Fleet Supervisor, Fleet Incharge | live | handover_reports 0 | Full flow with two-stage sign-off never used | Form defaults (`checkout`, `good`, `clean`) match the three CHECKs; `decide_handover_approval` exists and is callable. Insert and update policies allow any signed-in user. | One real handover through both sign-offs on web and phone, with photos. |
| 11 | Gate Pass | /gate-pass | ModuleRoute gate_pass | live | gate_passes 2 (both Denied) | Barely used; update result not checked | The cleared path has never run in production. Insert and update return no row (`src/lib/api/gatePassPage.js:59,98`), but the write policies admit any signed-in user, so a silent refusal is unlikely. | One cleared pass and one check out. |
| 14 | Fitment Validation | /fitment-validation | Admin, Manager, Director | live | fitment_rules 0, fitment_validations 0 | No rules, no validations | Write policy roles equal the route roles. Columns match. | Write one rule and run one validation. |
| 27 | Maintenance Calendar | /maintenance-calendar | Admin | live | pm_programs 3, pm_service_records 2, work_orders 97,242 | Estimated tyre dates read empty columns | PM data now exists (register said 0). Tyre estimates stay empty and are labelled as estimates. | Open as Admin and confirm the three PM plans appear on their due dates. |
| 28 | Downtime Tracker | /downtime | ModuleRoute fleet_analytics | live | work_orders 97,242 | Severity based estimate uses risk_level | Confirmed: `src/lib/downtimeTrackerAnalytics.js:20` gives 2 hours to every unrated tyre change. The page and PDF label these as estimated and prefer job card times. | Compare one month against job card open to complete times. |
| 31 | Root Cause Engine | /root-cause | ModuleRoute root_cause_engine | live | tyre_records with a removal reason: 3,851 | Removal reason quality | Not re-measured. Project memory records brand names stored as reasons on UAE rows. | Review the top reasons per country before showing a customer. |
| 32 | Compliance Dashboard | /compliance | Admin | live | inspections 2,672 | Tread and pressure scores N/A | Confirmed the tread and pressure columns are empty; the inspection part has data. | Feed the board from inspection readings, then test. |
| 33 | Alerts | /alerts | ModuleRoute alerts | live | alerts 0 (table unused; alerts are computed in the browser) | Tyre condition alerts cannot fire | Confirmed. Stock, budget, inspection and action alerts can fire. Dismissals are kept in the browser only. | Browser check with real stock and budget rows. |
| 53 | Smart Analytics (AI) | /ai-command-center | flag ai_tools + ModuleRoute | live | ai_token_logs 105 | AI budget and switches are platform wide | The module is in use (105 logged calls). Success rate was not checked. The budget is still global (`system_config.ai_enabled` is one row). | Check failed calls in `ai_token_logs` and decide per company budgets. |
| 54 | Automation Rules | /automation-rules | flag automation_platform only | live | business_rules 1, rule_executions 0 | No rule has ever run | Confirmed 0 executions. The `process-domain-events` job is active. Route has no role guard. | Trigger the one rule and confirm an execution row. |
| 56 | Onboarding Wizard | /onboarding-wizard | Admin | live | onboarding_tasks 0 | Open write policy; self-serve workspace creation unavailable | The open policy is now backed by a restrictive Admin-only policy (`administration_active_admin_insert/update`), so that risk is closed. `create_workspace_owner` is not executable by signed-in users, but no page calls it (`createWorkspaceOwner` has no caller in `src/pages` or `src/components`). | Create one task and complete it as Admin. |
| 58 | Request Access | /request-access | none (any signed-in user) | live | (RPC based) | Only a super admin can decide | Confirmed in `src/pages/RequestAccess.jsx:5,126,176-191`. The RPCs exist and are callable. | One request, one decision, confirm the grant expires. |

## (c) Defect found

| # | Module | Route | Switch | Defect (precise) | Where | Fix |
|---|---|---|---|---|---|---|
| 1 | Site Management | /sites | live | (1) Editing a site sent `updated_by`, a column `sites` does not have. Fixed on this branch (commit 78b9954f) but the fix is not on `origin/main`. (2) Director is shown the add and edit controls, the write policy `sites_write` admits Admin and Manager only, so a Director's save is refused. | `src/lib/api/sites.js` (fixed); `src/pages/SiteManagement.jsx:362` | Merge 78b9954f. Remove Director from line 362. |
| 17 | Heat Intelligence | /heat-intelligence | live | The fleet blowout risk read asks for `current_status`, which `tyre_records` does not have. PostgREST rejects the whole request. The service then treats "does not exist" as a missing table and returns an empty list, so the section shows no tyres for every user while 11,267 exist. No error is shown. | `src/lib/api/heatIntelligence.js:96` (column list), `:117-121` (swallow via `isMissingRelation`, `src/lib/api/_client.js:77`) | Remove `current_status` from `TYRE_RISK_COLS`. The engine already falls back to `status` (`src/lib/heatIntelligence.js:454`). |
| 19 | Tyre Pool | /tyre-pool | live | Route has no role guard. A Tyre Man opens the page and sees Add; the insert policy admits Admin, Manager, Director only. | `src/App.jsx:787` | Wrap in `RoleRoute allowed={['Admin','Manager','Director']}`. Browser test otherwise passed. |
| 22 | Warranty Tracker | /warranty | live | (1) Route has no role guard. (2) Claim number is unique on (claim_no, country) with no organisation, so a second company in the same country fails on its first claim. (3) Country on the claim form is free text and a wrong value reads as a permission error. (4) "Unclaimed recovery" is 30 percent of tyres times 40 percent of cost, shown as money. | `src/App.jsx:694`; index `warranty_claim_no_country_uniq`; `src/pages/WarrantyTracker.jsx` country field; `src/lib/warrantyTrackerAnalytics.js:181-182` | Guard the route; add organisation to the index; make country a picker; label or remove the assumed figure. Browser test otherwise passed. |
| 25 | Work Orders | /work-orders | live | Create and edit are allowed only by capability (`work_orders_cap_insert`, `work_orders_cap_update`). Managers and Directors see New Work Order and are refused. The page gates only delete. Job card numbers are unique across all companies (`work_orders_work_order_no_key`). | policies on `work_orders`; `src/pages/WorkOrders.jsx:164` | Hide write controls without the capability and seed the capability for Manager; per company numbering. Which roles hold the capability today was not read. |
| 26 | Live Control | /workshop-live | live | Route admits Admin, Manager, Director (`src/App.jsx:681`) but New Job, assign and status changes write `work_orders`, so the same refusal applies to Managers and Directors. Delay cost uses a default labour rate of 120 when `workshop_config` is empty (it is, 0 rows). | `src/pages/WorkshopLive.jsx:489-506`; `src/lib/workshopLive.js:444,607` | Same capability fix; show "default rate" beside the cost. |
| 29 | Workshop Analytics | /workshop-analytics | live | Delay cost is hours times the hard-coded 120 per hour, labelled with the active currency, with no note that the rate is a default. | `src/lib/workshopLive.js:444,607` | Show the cost only when a rate is configured, or label the default. |
| 30 | Corrective Actions | /actions | live | Update returns no row, so an update refused by row security (policy admits Manager and Admin only) changes nothing and reports success. A Director or Inspector who moves a card sees no error and no change. 177 of 180 actions are still Open. | `src/lib/api/correctiveActions.js:49-51`; callers `src/pages/CorrectiveActions.jsx:367,378` | Add `.select('id')` and raise when no row comes back; hide controls from roles the policy refuses. |
| 34 | Alert Thresholds | /alert-thresholds | not listed (shares alerts, live) | (1) The hourly job reads `inspections.tread_depth`, which does not exist. The first active "Tread Depth" rule (a one-click preset on the page) raises an error that stops the whole run for every rule and every user. (2) The "Cost Per KM" metric is offered but the job ignores it, so that rule never fires. (3) The tread, pressure, tyre age and inspection overdue queries have no organisation filter. Latent today: 0 rules. | DB function `evaluate_alert_thresholds`; `src/pages/AlertThresholds.jsx:17,20,33` | Remove or repoint the tread metric, remove the CPK option, add the organisation filter to the four branches. |
| 40 | Stock Replenishment (broken) | /stock-replenishment | disabled | The planner reads table `stock` (0 rows, nothing writes it) while the Stock module writes `stock_records` (43 rows). Column names also differ (`size`, `quantity` against `tyre_size`, `stock_qty`). Stock on hand is always empty. | `src/lib/api/purchaseOrders.js:50`; `src/lib/stockReplenishmentAnalytics.js:59,98` | Read `stock_records` and map the three columns. Keep off until done. |
| 43 | Supplier Management | /suppliers | not listed (shares stock, live) | The page treats the tyre brand as the supplier. The `suppliers` table (0 rows) is never read or written here, so a company cannot add a supplier. Brand ratings are unique on (brand, country) across all companies. | `src/lib/api/supplierManagementApi.js:74`; index `supplier_ratings_brand_country_key` | Read and write `suppliers`; keep the brand view as a tab; add organisation to the rating key. |
| 46 | Budgets and Cost | /budgets | live | Unique key (site, region, year, month) has no organisation, so two companies with the same site name collide. Manager and Director see the editor and the save is refused (policy is Admin or capability); the refusal is shown. | index `budgets_site_region_year_month_key`; `src/lib/api/budgets.js:54,64`; `src/pages/Budgets.jsx:164-177` | Add organisation to the key; hide the editor from roles that cannot save. |
| 47 | Budget Planner | /budget-planner | not listed (shares budgets, live) | Same key and same refusal. It writes its own region, so one site can hold two budget rows. | `src/pages/BudgetPlanner.jsx:423-426` | Same fix; consider one page. |
| 48 | TCO Calculator | /tco-calculator | live | Savings and benchmark tabs show money built from constants: tyre cost 850 AED, fuel 2.89 AED, and whole vehicle AED per km benchmarks compared with tyre-only cost in the company currency. | `src/lib/tco.js:189-201` | Remove the benchmark comparison or make the references company entered; show savings only from measured inputs. |
| 50 | KPI Center | /kpi | live | Targets cannot be saved a second time. The save sends no month and no site, the upsert target (metric, year, month, site) never matches a NULL, so it inserts and hits `kpi_targets_scope_uidx`. Production holds 7 rows for 2026, all with month and site NULL, so every save this year fails. Region is hard-coded to KSA. Director is refused by policy. Not executed, read from code and catalog. | `src/pages/KpiScorecard.jsx:259-268`; `src/lib/api/kpiTargets.js:44`; `src/lib/api/settings.js:61` | Update by id when a row exists (or save through an RPC); drop the fixed region. |
| 51 | Carbon Tracker | /carbon-tracker | disabled | A blank cost is stored as tonnes times 90, a blank tree count as tonnes times 45, a blank provider as "Verra Registry" and a blank project as "UAE Mangrove Restoration". Values the user never entered are saved as fact. | `src/lib/api/carbon.js:183-187` | Store null when blank. Keep off; factors and currency are fixed to the UAE. |
| 52 | Scheduled Reports | /scheduled-reports | live | The executive email adds SAR, AED and EGP into one figure and labels it with one global currency; spend comes from `cost_per_tyre`, not the expense grid used on screen. Delivery itself works: 200 sent, 61 failed. All 7 schedules now carry an organisation. | `supabase/functions/send-scheduled-reports/index.ts:253,1197-1199,1289`; DB function `report_exec_digest` | Per country sections with their own currency. Changes numbers in the email, so it needs sign-off. |
| 55 | API and Webhooks | /integrations | live | Outbound webhooks have never delivered: 9 pending since 2026-07-14, 3 failed, 0 delivered, both subscriptions inactive, no API key issued. The `deliver-webhooks` job is active. Cause not found in this review. Route has a flag guard only. | counts on `webhook_deliveries`, `webhook_subscriptions`, `api_keys` | Find why delivery fails, prove one delivery end to end, add a role guard. |

### Defects grouped by fix size

| Size | Defects |
|---|---|
| One line | Heat Intelligence missing column (17). Site Management Director control (1). Tyre Pool route guard (19). Warranty route guard (22, part 1). Carbon Tracker blank defaults (51). Alert Thresholds: remove the CPK option (34, part 2). |
| Small (one file or one migration, clear answer) | Merge the site edit fix to main (1). Stock Replenishment read (40). KPI Center save (50). Corrective Actions update result (30). Labour rate label (26, 29). Alert Thresholds tread metric and organisation filter (34). Budgets key and editor gate (46, 47). Warranty key and country picker (22). Hide work order write controls without the capability (25, 26). Role guards on Integrations and Automation Rules (55, 54). |
| Needs design or the owner's decision | Who may create and edit job cards, and per company job card numbers (25, 26). Supplier master instead of brand (43). TCO benchmarks and assumed savings (48). Scheduled email currency and cost source (52). Webhook delivery (55). Warranty assumed recovery figure (22). |

## (d) Should stay hidden or off

| # | Module | Route | Switch | Rows | Why it should stay off |
|---|---|---|---|---|---|
| 4 | Customers | /customers | disabled | customers 0, customer_accounts 0, contracts 1 | Not in the tested set. Accounts and contracts link by name only. The word Customers will confuse a buyer. |
| 13 | Rotation Optimizer | /rotation-optimizer | disabled | tread_depth filled on 0 of 11,267 | No input data. Benefit figure is a fixed 10,000 km per mm. |
| 15 | TPMS | /tpms | disabled | tpms_readings 0 | No sensor feed; the fallback column is empty too. |
| 23 | Fleet Risk Score | /fleet-risk-score | disabled | tread, pressure, risk all 0 | The score has nothing to measure. |
| 24 | Tyre Scan | /scan | no switch, no menu, no guard | none (history kept in the browser, `src/pages/TyreScan.jsx:24,31`) | Unfinished. Remove the route or finish it. |
| 35 | Driver Intelligence | /driver-management | disabled | tyre_records.driver_name 0 of 11,267; drivers 674 | The page reads tyre records only (`src/pages/DriverManagement.jsx:187-190`), so it is permanently empty. Rebuild on the drivers register or retire. |
| 36 | Driver detail | /driver-management/:driverId | disabled (same switch) | same | Same source, same result. |
| 37 | Live Fleet Status | /live-fleet | disabled | condition columns 0 | Nothing live about it; shows vehicles with no tyre condition. |
| 38 | Fleet Health Board | /fleet-health | disabled | condition columns 0 | Every vehicle reads "not rated". |
| 39 | Fuel Efficiency | /fuel-efficiency | disabled | fuel_transactions 0 | Fuel figures are modelled from tyre readings that do not exist. Labelled as modelled, but there is nothing to model from. |
| 44 | Vendor Intelligence | /vendor-intelligence | disabled | supplier 0 of 11,267 | It is a brand ranking under a vendor name. Overlaps Brand Performance. |
| 49 | Billing and Subscription | /billing | live (flag default on) | org_subscriptions 0, invoices 0, subscription_plans 4 | Not in use. Route has a flag guard only, so any role can open it by URL. Opening it is designed to create a trial row. Keep hidden until billing goes live and add an Admin guard. Not opened in this review. |

Note: the eleven disabled modules above are still reachable by every company Admin.

## (e) Duplicate of another module

| # | Module | Route | Duplicate of | Evidence | Action |
|---|---|---|---|---|---|
| 7 | RFID Registry (old page, no menu) | /rfid-registry | RFID Registry at /rfid | Both pages read and write `rfid_tags` through `src/lib/api/rfid.js`. This one is guarded by the tyre records key and reachable only by URL. | Redirect to /rfid. |
| 45 | Incident Reports | /incidents | Accidents | A second incident store (`incident_reports`, 4 rows) with no link to accident cases or corrective actions. It works: the type, severity and status lists in `src/lib/api/incidents.js:14-16` match the CHECKs. | Fold into Accidents as a near miss type, or state a clear split. |
| 57 | Developer Portal | /developer-portal | API and Webhooks at /integrations | It registers webhooks in `webhook_endpoints` (0 rows); Integrations uses `webhook_subscriptions`. No edge function names either table; the database delivery job was not read, so which table it serves is taken from the register. | Merge into API and Webhooks. |
| 59 | Legacy Upload Data (no menu) | /upload | Data Intake Center | Old import path, flag guard only, any role by URL. The register's concern about the missing organisation default is covered: the trigger `guard_upload_history` stamps the organisation on insert. upload_history holds 2 rows. | Retire the route or redirect to Data Intake. |

## What I could not verify

- No browser run of my own. Everything marked as passing a browser test comes from the staging test report, which did not cover delete, exports, file upload, Arabic, phone widths, or the Director and Inspector roles.
- Insert and update payloads were read by hand only for the modules where a defect was suspected. The column script covered reads and filters with literal column names only.
- Which roles hold the work order create and edit capability today (stored in organisation settings, not read).
- Why webhook deliveries fail, and whether the deployed edge functions match the repository.
- Stored feature flag values. No `feature_flags` row was returned from `settings`, so the code defaults (all on) were assumed.
- Whether `ensure_org_subscription` creates a trial row for a non-Admin who opens /billing by URL.
- The KPI Center save failure and the Alert Thresholds job failure are read from code and catalog. Neither was executed.
- The checkout is a feature branch. Apart from the site edit fix, I did not compare each finding against `origin/main`.
