# Module restore list

Date: 2026-11-12. Branch audited: claude/tyrepulse-inspector-build-7rxp2t (working tree). Read only: no database
write, no code change. Machine readable copy: `module_restore_list.json` in this folder.

## 1. Result in one paragraph

75 rows of `public.modules` are disabled today. After reading each page, its service, its table constraints and
its RLS policies: **48 RESTORE** (31 core, tier R1; 17 optional registers, tier R2), **6 REPAIR THEN RESTORE**,
**21 KEEP HIDDEN**. No disabled module failed on the "save is silently refused" class: for every create payload
checked, the columns exist, the option lists match the CHECK constraints, NOT NULL columns are guarded in the
client and `organisation_id` defaults to `app_current_org()`. The operational workflows the owner named are
live and were not touched: **Vehicle Handover (`handovers`) is live, Checklist Schedules
(`checklist_schedules`) is live, Checklists, My Checklists, Checklist Insights, Inspections, Inspection
Planner, Gate Pass, Vehicle Washing, Work Orders, Workshop Live, Daily Operations and Odometer Logs are all
live.**

## 2. How this was checked, and its limits

VERIFIED by SQL (catalog only, SELECT): status of all 197 rows; existence of every column each service selects
or inserts (73 tables, 0 missing); every CHECK constraint on those tables; every RLS policy; NOT NULL columns
without default; organisation default; function existence and EXECUTE grants.
VERIFIED by code reading: route and guard for each module (src/App.jsx), service payloads and option lists
(src/lib/api), page headers and the specific lines cited in the table.
VERIFIED by a source scan, not by rendering: presence of empty states, error and Retry states, export and delete
handlers on each page.
NOT VERIFIED: no page was rendered in a browser and no record was inserted (inserts are forbidden by the audit
brief, even rolled back). "RESTORE" therefore means the contract between page, service and database is sound and
the page has first-use affordances in code. A browser pass with a non-admin test account on an empty
organisation is the acceptance test before selling.

## 3. Preserved configuration

Before today (before state): 194 rows, all `live`. The rows `driver_management`, `fleet_health` and
`fuel_efficiency` did not exist.
Now (preserved configuration, 197 rows): 122 live, 75 disabled.

Three batches today: 08:41:46 UTC (66 rows, note "no records ever entered"), 08:51:12 UTC (9 rows incl. the 3
inserts, note "inputs not recorded"; `compliance` was switched off earlier today, batch not recorded), 09:03:08 UTC (`compliance` back to
live with a note).

Disabled (75): batteries, bay_scheduling, breakdowns, carbon_tracker, certifications, charging_sessions, cold_chain, combinations, customer_portal, customers, dispatch, driver_coaching, driver_documents, driver_expenses, driver_management, driver_safety, driver_training, dtc, dvir, emissions, equipment, fleet_groups, fleet_health, fleet_optimizer, fleet_risk_score, fuel_cards, fuel_delivery, fuel_efficiency, fuel_theft, geofencing, goods_receipt, gps_tracking, hours_of_service, ifta_reporting, insurance_claims, journeys, live_fleet, load_planning, marketplace, materials, ocr_scanner, parts_catalog, parts_requests, pm_programs, policies, proof_of_delivery, recall_tracker, repair_requests, requisitions, reservations, retread, retread_claims, rotation, rotation_optimizer, route_optimization, service_requests, shifts, sla_dashboard, stock_replenishment, taas, tachograph, telematics_devices, toll_transactions, tpms, trip_replay, trips, tyre_pool, tyre_service_events, upload_approvals, vehicle_checkinout, vendor_intelligence, video_telematics, warranty, weighbridge, workshop_absence.

Live (122): accident_cases, accident_workflow_settings, accidents, action_center, advanced_search, ai_analytics, ai_command_center, ai_cost_monitor, alerts, analytics, approval_delegations, approval_matrix, approvals, asset_breakdowns, asset_disposals, audit_trail, automation_rules, billing, board_overview, brand_assets, brand_performance, broadcast, budgets, checklist_insights, checklist_schedules, checklists, claims_summary, compliance, contracts, corrective_actions, cost_per_m3, cost_scenario_planner, country_comparison, cpk_intelligence, custom_data, daily_ops, dashboard, dashboard_builder, data_cleaning, data_intake, data_reconciliation, developer_portal, digital_twin, display, driver_workspace, engine_hours, erp_import, erp_intake, erp_sync, events, executive_analytics, executive_report, expense_import, expense_report, expense_trends, fitment_validation, fleet_analytics, fleet_intelligence, fleet_master, fleet_renewal, fleet_utilization, forecasting, gate_pass, handovers, heat_intelligence, help, incidents, inspection_planner, inspections, insurance_policies, integrations, knowledge_base, kpi_scorecard, maintenance_calendar, maintenance_cost_board, my_checklists, odometer_logs, onboarding_wizard, ops_intelligence, position_intelligence, predictive_maintenance, pressure_intelligence, production_m3, qr_labels, rca, report_sharing, reports, request_access, rfid, roi_calculator, root_cause_engine, safety_compliance, sany_delay_penalty, sany_invoices, scheduled_reports, sco_costs, scrap, serial_tracker, settings, site_comparison, sites, speed_limiter, stock, store_material_issue, system_health, tco_calculator, technician_scorecard, tenant_health, tyre_age_compliance, tyre_exchange, tyre_failure_cpk, tyre_passport, tyre_records, tyre_specs, upload_data, user_management, vehicle_washing, work_orders, workflow_settings, workshop_analytics, workshop_live, workshop_settings.

Rollback of today's change in full (text only, not run): set the 72 pre-existing disabled rows to live and
delete the 3 inserted rows. This report does NOT recommend that.

## 4. Cross-cutting findings (each with two statuses and the fix risk)

**MOD-1. Module Control is one global switch board, not per company. P0 for sale. VERIFIED.**
`public.modules` has no `organisation_id` (columns: module_id, name, category, status, visible_to, roles,
depends_on, note, last_updated, updated_by, maintenance_until, maintenance_note, kind, created_at, review_after).
Policy `modules_write` allows `is_super_admin() OR get_my_role() = 'Admin'`. So the 75 switches set today apply
to every future customer, and a customer's own Admin could switch a module off (or on) for all companies.
Internal: ready (one tenant). Commercial: class 3. Fix: add a per-organisation override table read by
`AuthContext.moduleStatus` and restrict writes on the global table to super admin. Risk to current company: low
if additive (global rows stay the default; the current company's Admins lose the ability to edit the global
table, which only the owner uses). Acceptance: an Admin of org B cannot change what org A sees.

**MOD-2. The switch hides the menu for everyone but only blocks the page for non-admins. P2. VERIFIED.**
`ModuleStatusGate` lets Admin and super admin through (src/components/ProtectedRoute.jsx:213); the sidebar and
command palette hide the item for everyone (Layout.jsx:954, 1330). 54 of the 75 disabled routes are
`RoleRoute allowed={['Admin']}`, so for them the switch changes only the Admin's menu. The two exceptions that
mattered to ordinary users: `/warranty` and `/tyre-pool` have no route guard at all and were open to every
role until today. Internal: ready. Commercial: class 2. Fix: none needed for restore; decide audience per page.
Risk: none.

**MOD-3. Detail routes escape the switch. P3. VERIFIED.** `pathModuleStatus` slugifies the full path
(src/lib/navAccess.js:158), so `/recalls/:recallId` and `/driver-management/:driverId` resolve to keys with no
row and stay open while their parent is off. Internal: ready. Commercial: class 3. Fix: match on the first path
segment. Risk: low.

**MOD-4. Manager and Director deletes are silently refused, platform wide. P2. VERIFIED (policy), PLAUSIBLE
(UI effect, not rendered).** Every table carries the RESTRICTIVE policy `admin_only_delete_guard`
(`app_can_admin_delete()` = Admin or super admin). Services call `.delete().eq('id', id)` and do not check the
affected row count (example src/lib/api/certifications.js:88), and the pages show Delete to every role the route
admits. On the Admin, Manager, Director routes a Manager sees the row vanish and return on reload. This also
affects modules that are live today. Internal: at risk. Commercial: class 3. Fix: hide Delete unless Admin, or
return the deleted row and raise when none. Risk: none (UI only).

**MOD-5. `pending_uploads` has no tenant wall. P1 for sale. VERIFIED.** Policies: country restrictive, insert
`uploaded_by = auth.uid()`, select `uploaded_by = auth.uid() OR role in (Admin, Manager)`; no organisation
policy and no `organisation_id` default. Any Admin or Manager of any company would read every company's
pending upload rows. 0 rows today. Internal: ready. Commercial: class 3. Fix: add the standard restrictive
organisation policy and default. Risk: low (table is empty; the only writer is the retired Expo app).
Keep `upload_approvals` hidden until done.

**MOD-6. Three analytic families read tyre fields that no workflow writes. P2. VERIFIED.** Of 11,260 tyre rows,
`tread_depth`, `pressure_reading`, `risk_level`, `supplier` and `driver_name` are populated on 0. Inspections
store readings in `inspections.tyre_conditions`, not on the tyre row, and tread is not captured at all. Fleet
Health, Live Fleet, Fleet Risk Score, Rotation Optimizer, TPMS, Vendor Intelligence, Driver Intelligence and the
tyre side of Fuel Efficiency therefore stay empty for the current company and for any new company that works
through the app rather than through imports. Internal: at risk (pages are honest but empty). Commercial:
class 3. Fix: repoint to inspection readings and add tread capture. Risk: low (read side only).

**MOD-7. Most operational registers are Admin only on the web. P2. VERIFIED.** DVIR, vehicle check in and out,
reservations, driver expenses, breakdown callouts and service requests are filed by ordinary staff, but their
routes admit Admin only, while their RLS policies admit every active user. A new company's drivers and
supervisors cannot use them without custom-role grants. Internal: ready (not in use). Commercial: class 2.
Fix: widen route guards per module with the owner. Risk: low.

**MOD-8. Live pages link into switched off modules. P3. VERIFIED.** OpsIntelligence.jsx:423, FleetMaster.jsx:1048
and AssetDetail.jsx:1095 navigate to `/pm-programs`; DriverDetail.jsx:208 to `/driver-management`. A Manager
lands on "Module unavailable". Restoring `pm_programs` removes the first three.

## 5. Decision table

Decision legend. RESTORE R1: core fleet, tyre, workshop, procurement and compliance register; restore now.
RESTORE R2: working optional register outside the core product; safe to restore, but until Module Control is per
company (MOD-1) the owner may prefer to leave these off and switch them on for a customer who asks.
Internal = Internal Production Readiness for the current company (ready, at risk, broken). Commercial class =
the six classes in the audit brief. Policy A and B are explained under the table.

| Module id | Name | Routes governed (guard) | Decision | Internal | Commercial class | Evidence | New empty customer sees | Defects to repair |
|---|---|---|---|---|---|---|---|---|
| batteries | Battery Lifecycle | /batteries (App.jsx:811; RoleRoute Admin) | RESTORE R1 | ready | 2 | Batteries.jsx; batteries.js; tables batteries. Policy A. Status CHECK matches BATTERY_STATUS_VALUES. | Register with empty state; first action is Add battery (asset or serial required). | Route is Admin only, so ordinary roles cannot use it without a custom role or a per-user grant. Planning life is an assumed 36 months, stated on the page. |
| bay_scheduling | Bay Scheduling | /bay-scheduling (App.jsx:853; RoleRoute Admin) | RESTORE R1 | ready | 2 | BayScheduling.jsx; bayScheduling.js; tables bay_schedules. Policy A. Three CHECKs match. | Bay board with empty state; first action is Schedule job (bay name required). | Route is Admin only, so ordinary roles cannot use it without a custom role or a per-user grant. |
| breakdowns | Breakdown Callouts | /breakdowns (App.jsx:845; RoleRoute Admin) | RESTORE R1 | ready | 2 | BreakdownCallouts.jsx; breakdownCallouts.js; tables breakdown_callouts. Policy A. Three CHECKs match. | Register with empty state; first action is Log callout. | Route is Admin only, so ordinary roles cannot use it without a custom role or a per-user grant. Overlaps the live Breakdown Register (asset_breakdowns). Class 5 duplicate for consolidation later. |
| certifications | Certifications | /certifications (App.jsx:799; RoleRoute Admin, Manager, Director) | RESTORE R1 | ready | 2 | Certifications.jsx; certifications.js; tables certifications. Policy A. status and subject_type CHECKs match. | Register with expiry KPIs and empty state; first action is Add certification. | Manager or Director pressing Delete gets no error and the row returns on reload (restrictive admin_only_delete_guard policy, service does not check the deleted row count). |
| combinations | Combinations | /combinations (App.jsx:806; RoleRoute Admin) | RESTORE R1 | ready | 2 | Combinations.jsx; combinations.js; tables asset_combinations, vehicle_fleet, tyre_records. Insert policy is_approved_and_unlocked. Status CHECK matches COMBINATION_STATUSES. | Register with empty state; first action is New combination (prime mover required). | Route is Admin only, so ordinary roles cannot use it without a custom role or a per-user grant. |
| driver_documents | Driver Documents | /driver-documents (App.jsx:820; RoleRoute Admin) | RESTORE R1 | ready | 2 | DriverDocuments.jsx; driverDocuments.js; tables driver_documents. Policy A. Status CHECK matches DOC_STATUS_VALUES. | Register with empty state; first action is Add document. | Route is Admin only, so ordinary roles cannot use it without a custom role or a per-user grant. |
| driver_training | Driver Training | /driver-training (App.jsx:851; RoleRoute Admin) | RESTORE R1 | ready | 2 | DriverTraining.jsx; driverTraining.js; tables driver_training. Policy A. category and result CHECKs match. | Register with empty state; first action is Add training record. | Route is Admin only, so ordinary roles cannot use it without a custom role or a per-user grant. Currency falls back to SAR when no country is active. |
| dvir | DVIR Reports | /dvir (App.jsx:821; RoleRoute Admin) | RESTORE R1 | ready | 2 | Dvir.jsx; dvir.js; tables dvir_reports. Policy A. inspection_type and status CHECKs match. | Register with empty state; first action is New DVIR. | Route is Admin only, so ordinary roles cannot use it without a custom role or a per-user grant. Drivers, who file DVIRs, cannot reach the page on web; there is no mobile DVIR screen. |
| equipment | Tool and Equipment | /equipment (App.jsx:816; RoleRoute Admin) | RESTORE R1 | ready | 2 | Equipment.jsx; equipment.js; tables equipment. Policy B. Status CHECK matches EQUIPMENT_STATUSES. | Register with empty state; first action is Add equipment. | Route is Admin only, so ordinary roles cannot use it without a custom role or a per-user grant. |
| fleet_groups | Fleet Groups | /fleet-groups (App.jsx:858; RoleRoute Admin) | RESTORE R1 | ready | 2 | FleetGroups.jsx; fleetGroups.js, fleetGroupSignals.js, sites.js; tables fleet_groups, vehicle_fleet, asset_utilization, tyre_records, corrective_actions, pm_programs, sites. Policy A. group_type CHECK matches GROUP_TYPES. | Group list with empty state; first action is New group. | Route is Admin only, so ordinary roles cannot use it without a custom role or a per-user grant. |
| goods_receipt | Goods Receipt | /goods-receipt (App.jsx:823; RoleRoute Admin, Manager, Director) | RESTORE R1 | ready | 2 | GoodsReceipt.jsx; goodsReceipts.js; tables goods_receipts. Policy A plus site restrictive. Status CHECK matches. | Register with a not-in-use notice and empty state; first action is New GRN. | Manager or Director pressing Delete gets no error and the row returns on reload (restrictive admin_only_delete_guard policy, service does not check the deleted row count). |
| insurance_claims | Insurance Claims | /insurance-claims (App.jsx:797; RoleRoute Admin, Manager, Director) | RESTORE R1 | ready | 2 | InsuranceClaims.jsx; insuranceClaims.js; tables insurance_claims. Policy B. Status CHECK matches CLAIM_STATUSES. | Ledger with empty state; first action is New claim. | Manager or Director pressing Delete gets no error and the row returns on reload (restrictive admin_only_delete_guard policy, service does not check the deleted row count). Separate from Claims Summary (accident claims). Two claim surfaces will confuse a new customer; label this one as the manual ledger. |
| materials | Materials | /materials (App.jsx:859; RoleRoute Admin) | RESTORE R1 | ready | 2 | Materials.jsx; materials.js; tables materials. Policy A. category and status CHECKs match. | Register with empty state; first action is Add material. | Route is Admin only, so ordinary roles cannot use it without a custom role or a per-user grant. |
| parts_catalog | Parts Catalog | /parts-catalog (App.jsx:805; RoleRoute Admin, Manager, Director) | RESTORE R1 | ready | 2 | PartsCatalog.jsx; partsCatalog.js; tables parts_catalog. Policy B. Status CHECK matches PART_STATUSES. | Catalogue with empty state; first action is Add part (part number required). | Manager or Director pressing Delete gets no error and the row returns on reload (restrictive admin_only_delete_guard policy, service does not check the deleted row count). |
| parts_requests | Parts Requests | /parts-requests (App.jsx:685; RoleRoute Admin,Manager,Director) | RESTORE R1 | ready | 2 | PartsRequests.jsx; partsRequests.js; tables parts_requests, work_orders, parts_catalog. Insert policy requested_by = auth.uid() or elevated. Status CHECK matches PARTS_REQUEST_STATUSES. | KPI strip and register with empty state; first action is New request (part from catalogue or free text). | Part picker is empty until Parts Catalog has rows, so restore parts_catalog with it. Manager or Director pressing Delete gets no error and the row returns on reload (restrictive admin_only_delete_guard policy, service does not check the deleted row count). |
| pm_programs | Preventive Maintenance | /pm-programs (App.jsx:831; RoleRoute Admin,Manager,Director ModuleRoute moduleKey="pm_programs") | RESTORE R1 | ready | 2 | PmPrograms.jsx; pmPrograms.js, governedCost.js, workOrders.js, partsCatalog.js; tables pm_programs, odometer_logs, engine_hours_logs, pm_service_records, vehicle_fleet, work_orders, parts_catalog. Policy B on pm_programs and pm_service_records. RPC record_pm_service exists, SECURITY DEFINER, executable by authenticated. Five CHECKs match PM_* lists in pmPrograms.js. Disabling also switches off the Flutter module pm in the unreleased working tree. | Dashboard, Plans and Service History tabs with empty states; first action is New plan (template picker). | Live pages still link to it while it is off (OpsIntelligence.jsx:423, FleetMaster.jsx:1048, AssetDetail.jsx:1095). Manager or Director pressing Delete gets no error and the row returns on reload (restrictive admin_only_delete_guard policy, service does not check the deleted row count). |
| policies | Policy Management | /policies (App.jsx:800; RoleRoute Admin) | RESTORE R1 | ready | 2 | PolicyManagement.jsx; policies.js; tables policies. Policy B. Status CHECK matches POLICY_STATUSES. | Document register with empty state; first action is New policy. | Route is Admin only, so ordinary roles cannot use it without a custom role or a per-user grant. No Retry or error state found in the page source. |
| recall_tracker | Recall Tracker | /recall-tracker (App.jsx:701; RoleRoute Admin) | RESTORE R1 | ready | 2 | RecallTracker.jsx; recalls.js; tables recalls, tyre_records. Insert policy is_approved_and_unlocked. | Recall board with empty state; first action is New recall (recall number and brand required). | Route is Admin only, so ordinary roles cannot use it without a custom role or a per-user grant. recalls.status and severity have no CHECK. Detail route /recalls/:recallId is not covered by the module switch (slug mismatch). |
| repair_requests | Repair Requests (RFR) | /repair-requests (App.jsx:690; RoleRoute Admin, Manager, Director moduleKey="repair_requests") | RESTORE R1 | ready | 2 | RepairRequests.jsx; repairRequests.js; tables repair_requests, work_orders. Insert policy admits elevated roles plus Driver, Inspector, Tyre Man, Mechanic, Electrician, supervisors. Status and priority CHECKs match. convert_repair_request_to_job_card exists. Flutter module repairRequest writes the same table. | Register with empty state; first action is New request (asset code and fault description required, RepairRequests.jsx:514). | RFR number preview never fills: next_rfr_no is not executable by authenticated, the page swallows the refusal (RepairRequests.jsx:506). The insert trigger trg_repair_requests_mint_rfr still mints the number. Manager or Director pressing Delete gets no error and the row returns on reload (restrictive admin_only_delete_guard policy, service does not check the deleted row count). |
| requisitions | Requisitions | /requisitions (App.jsx:822; RoleRoute Admin, Manager, Director) | RESTORE R1 | ready | 2 | Requisitions.jsx; requisitions.js; tables requisitions. Policy A plus site restrictive. Status CHECK matches. Decision stamp trigger present. | Register with empty state; first action is New requisition (item required). | Manager or Director pressing Delete gets no error and the row returns on reload (restrictive admin_only_delete_guard policy, service does not check the deleted row count). |
| reservations | Vehicle Reservations | /reservations (App.jsx:844; RoleRoute Admin) | RESTORE R1 | ready | 2 | VehicleReservations.jsx; vehicleReservations.js, assets.js; tables vehicle_reservations, vehicle_reservation_events, gate_passes, handover_reports, drivers, vehicle_fleet. Policy A. Guard trigger limits approve and reject to elevated roles. Status CHECK matches. | Calendar and list with empty state; first action is New reservation. | Route is Admin only, so ordinary roles cannot use it without a custom role or a per-user grant. Requesters are ordinary staff, but the page is Admin only. |
| retread | Retread Management | /retread (App.jsx:700; RoleRoute Admin) | RESTORE R1 | ready | 2 | RetreadManagement.jsx; direct supabase calls; tables tyre_records. retread_jobs insert policy app_is_elevated. Payload builder retreadJobPayload matches all 16 CHECKs (status, outcome, grade, cycle 1 to 6, currency ISO). | Retread jobs register with a not-in-use notice and empty state; first action is New retread job (casing serial required). | Route is Admin only, so ordinary roles cannot use it without a custom role or a per-user grant. ROI calculator opens with example defaults (retread cost 480, life 80,000 km) with no currency; label them as examples. |
| retread_claims | Retread Claims | /retread-claims (App.jsx:810; RoleRoute Admin) | RESTORE R1 | ready | 2 | RetreadClaims.jsx; retreadClaims.js; tables retread_claims. Policy B. Status CHECK matches RETREAD_CLAIM_STATUSES. | Register with empty state; first action is New claim. | Route is Admin only, so ordinary roles cannot use it without a custom role or a per-user grant. |
| rotation | Rotation Schedule | /rotation (App.jsx:703; RoleRoute Admin) | RESTORE R1 | ready | 2 | RotationSchedule.jsx; rotations.js, assets.js, workshopLive.js; tables tyre_rotations, tyre_records, vehicle_fleet, profiles, technician_skills, work_orders, wo_tasks, wo_assignments, tech_activity_events, workshop_attendance, shifts. Insert policy is_approved_and_unlocked. rotation_type CHECK matches the page patterns (rearward_cross added 20260929100000). | Schedule and history tabs with empty state; first action is Schedule rotation. | Route is Admin only, so ordinary roles cannot use it without a custom role or a per-user grant. tyre_rotations.status and priority have no CHECK, so the page vocabulary is not enforced by the database. |
| service_requests | Service Requests | /service-requests (App.jsx:843; RoleRoute Admin) | RESTORE R1 | ready | 2 | ServiceRequests.jsx; serviceRequests.js; tables service_requests. Policy A. Three CHECKs match. | Register with empty state; first action is New request (subject required). | Route is Admin only, so ordinary roles cannot use it without a custom role or a per-user grant. Overlaps Repair Requests. Class 5 duplicate for consolidation later. |
| shifts | Shift Scheduling | /shifts (App.jsx:814; RoleRoute Admin ModuleRoute moduleKey="shifts") | RESTORE R1 | ready | 2 | ShiftScheduling.jsx; shifts.js; tables shifts. Policy A. shifts_status_check matches SHIFT_STATUS_VALUES. Route line 814 carries both RoleRoute Admin and ModuleRoute shifts. | Roster table with empty state; first action is Add shift. | Route is Admin only, so ordinary roles cannot use it without a custom role or a per-user grant. |
| tyre_pool | Tyre Pool | /tyre-pool (App.jsx:787; NO GUARD) | RESTORE R1 | ready | 2 | TyrePool.jsx; tyrePool.js; tables tyre_records, tyre_pool, vehicle_fleet. Policy B. reason CHECK matches POOL_REASONS including the misspelt token retreat_return on both sides. | Pool manager and analytics tabs with not-provisioned and empty states; first action is Add to pool. | Route has NO guard (App.jsx:787). Policy B means a Tyre Man or Inspector sees the page but every add is refused by RLS. Add a guard or hide the write buttons by role. |
| tyre_service_events | Tyre Service Events | /tyre-service-events (App.jsx:817; RoleRoute Admin, Manager, Director) | RESTORE R1 | ready | 2 | TyreServiceEvents.jsx; tyreServiceEvents.js; tables tyre_service_events. Policy A plus site restrictive. event_type CHECK matches EVENT_TYPES. | Register with empty state; first action is Log event. | Manager or Director pressing Delete gets no error and the row returns on reload (restrictive admin_only_delete_guard policy, service does not check the deleted row count). Live pages (Tyre Exchange, Tyre Bay, Flutter rotate) already write rows here while the register is hidden. |
| vehicle_checkinout | Vehicle Check In/Out | /vehicle-checkinout (App.jsx:809; RoleRoute Admin) | RESTORE R1 | ready | 2 | VehicleCheckInOut.jsx; vehicleCheckInOut.js, assets.js; tables vehicle_checkinout, vehicle_fleet. Policy A. direction and status CHECKs match. | Register with empty state; first action is Check out a vehicle. | Route is Admin only, so ordinary roles cannot use it without a custom role or a per-user grant. Gate staff cannot reach an Admin only page. |
| warranty | Warranty Tracker | /warranty (App.jsx:694; NO GUARD) | RESTORE R1 | ready | 2 | WarrantyTracker.jsx; warranty.js; tables warranty_claims, tyre_records, warranty_claim_events. Insert policy is_approved_and_unlocked. Guard trigger trg_warranty_claim_guard and event trigger present. No NOT NULL column without default. | Claims register and candidates tab with empty states; first action is New claim. | Route has NO guard at all (App.jsx:694), so every signed-in role reaches it. Decide the intended audience. Hard-coded AED appears in the page (2 places) as a fallback label. |
| workshop_absence | Absence and Attendance | /workshop-absence (App.jsx:682; RoleRoute Admin,Manager,Director) | RESTORE R1 | ready | 2 | WorkshopAbsence.jsx; workshopAbsence.js; tables shifts, workshop_attendance, profiles. Reads shifts, workshop_attendance, profiles. All selected columns exist. | Read-only report. Empty until shifts are rostered and technicians check in; says so. | No way to create anything on this page: it depends on Shift Scheduling (shifts) and on mobile check-in (workshop_attendance). Restore together with shifts. |
| charging_sessions | EV Charging | /charging-sessions (App.jsx:835; RoleRoute Admin) | RESTORE R2 | ready | 2 | ChargingSessions.jsx; chargingSessions.js; tables charging_sessions. No permissive DELETE policy beyond the admin guard. Status CHECK matches. | Register with empty state; first action is Add session. | Route is Admin only, so ordinary roles cannot use it without a custom role or a per-user grant. Only relevant to a fleet with electric assets. |
| cold_chain | Cold-Chain Monitor | /cold-chain (App.jsx:808; RoleRoute Admin) | RESTORE R2 | ready | 2 | ColdChain.jsx; coldChain.js; tables cold_chain_logs. Policy A. Status is derived by the service and matches the CHECK. | Readings log with empty state; first action is Log reading. Manual entry, stated. | Route is Admin only, so ordinary roles cannot use it without a custom role or a per-user grant. Not relevant to ready-mix or construction fleets. |
| customers | Customers | /customers (App.jsx:825; RoleRoute Admin) | RESTORE R2 | ready | 2 | Customers.jsx; customers.js, customerPortal.js, contracts.js; tables customers, customer_accounts, contracts. Policy B. Status CHECK matches. | Register with empty state; first action is Add customer. | Route is Admin only, so ordinary roles cannot use it without a custom role or a per-user grant. Revenue, satisfaction and SLA tiles read N/A by design. |
| dispatch | Dispatch Planning | /dispatch (App.jsx:807; RoleRoute Admin) | RESTORE R2 | ready | 2 | Dispatch.jsx; dispatch.js; tables dispatch_loads. Policy A. Status CHECK matches. | Load board with empty state; first action is New load. | Route is Admin only, so ordinary roles cannot use it without a custom role or a per-user grant. Overlaps Load Planning. Class 5 duplicate. |
| driver_expenses | Driver Expenses | /driver-expenses (App.jsx:818; RoleRoute Admin) | RESTORE R2 | ready | 2 | DriverExpenses.jsx; driverExpenses.js; tables driver_expenses. Policy A. Status CHECK matches. | Register with empty state; first action is Add expense. | Route is Admin only, so ordinary roles cannot use it without a custom role or a per-user grant. Drivers cannot submit their own expenses on web or mobile. |
| dtc | DTC Diagnostics | /dtc (App.jsx:827; RoleRoute Admin) | RESTORE R2 | ready | 2 | DtcDiagnostics.jsx; dtcCodes.js; tables dtc_codes. Policy A. severity and status CHECKs match. | Fault code register with empty state; first action is Log code. Manual entry. | Route is Admin only, so ordinary roles cannot use it without a custom role or a per-user grant. |
| emissions | Emissions Tests | /emissions (App.jsx:847; RoleRoute Admin) | RESTORE R2 | ready | 2 | Emissions.jsx; emissionsTests.js; tables emissions_tests. Policy A. result CHECK matches. | Register with empty state; first action is Add test. | Route is Admin only, so ordinary roles cannot use it without a custom role or a per-user grant. Currency falls back to SAR. |
| fuel_cards | Fuel Cards | /fuel-cards (App.jsx:798; RoleRoute Admin) | RESTORE R2 | ready | 2 | FuelCards.jsx; fuelCards.js; tables fuel_cards. Policy B. Status CHECK matches. | Register with empty state; first action is Add card. | Route is Admin only, so ordinary roles cannot use it without a custom role or a per-user grant. |
| fuel_delivery | Fuel Delivery | /fuel-delivery (App.jsx:813; RoleRoute Admin) | RESTORE R2 | ready | 2 | FuelDelivery.jsx; fuelDeliveries.js; tables fuel_deliveries. Policy A. Status CHECK matches. | Register with empty state; first action is Log delivery. | Route is Admin only, so ordinary roles cannot use it without a custom role or a per-user grant. |
| hours_of_service | Hours of Service | /hours-of-service (App.jsx:841; RoleRoute Admin) | RESTORE R2 | ready | 2 | HoursOfService.jsx; hosLogs.js; tables hos_logs. Policy A. duty_status CHECK matches. | Duty log register with empty state; first action is Add log. | Route is Admin only, so ordinary roles cannot use it without a custom role or a per-user grant. Limits follow a US style HOS model; confirm relevance per customer. |
| journeys | Journey Log | /journeys (App.jsx:802; RoleRoute Admin) | RESTORE R2 | ready | 2 | JourneyLog.jsx; journeys.js; tables journeys. Policy A. Status CHECK matches. | Register and analytics tabs with empty state; first action is New journey. | Route is Admin only, so ordinary roles cannot use it without a custom role or a per-user grant. |
| load_planning | Load Planning | /load-planning (App.jsx:836; RoleRoute Admin) | RESTORE R2 | ready | 2 | LoadPlanning.jsx; loadPlans.js, assets.js; tables load_plans, vehicle_fleet. Policy A. Status CHECK matches. | Planner with empty state; first action is New load plan (reference required). | Route is Admin only, so ordinary roles cannot use it without a custom role or a per-user grant. |
| proof_of_delivery | Proof of Delivery | /proof-of-delivery (App.jsx:848; RoleRoute Admin) | RESTORE R2 | ready | 2 | ProofOfDelivery.jsx; podRecords.js; tables pod_records. Policy A. Status CHECK matches. | Register with empty state; first action is New POD. | Route is Admin only, so ordinary roles cannot use it without a custom role or a per-user grant. Signature and photo are URL text fields, not captured evidence. |
| sla_dashboard | SLA Dashboard | /sla-dashboard (App.jsx:854; RoleRoute Admin) | RESTORE R2 | ready | 2 | SlaDashboard.jsx; slaRecords.js; tables sla_records. Policy A. Three CHECKs match. | Manual SLA register with empty state; first action is Add SLA record. | Route is Admin only, so ordinary roles cannot use it without a custom role or a per-user grant. SLA records are typed by hand, not derived from work orders or breakdowns, so the dashboard does not measure the real work. |
| toll_transactions | Toll Transactions | /toll-transactions (App.jsx:838; RoleRoute Admin) | RESTORE R2 | ready | 2 | TollTransactions.jsx; tollTransactions.js; tables toll_transactions. Policy A. payment_method and status CHECKs match. | Ledger with empty state; first action is Add transaction. | Route is Admin only, so ordinary roles cannot use it without a custom role or a per-user grant. |
| trips | Trip History | /trips (App.jsx:833; RoleRoute Admin) | RESTORE R2 | ready | 2 | Trips.jsx; trips.js; tables trips. Policy A. Status CHECK matches. | Register with empty state; first action is Add trip. Manual entry only. | Route is Admin only, so ordinary roles cannot use it without a custom role or a per-user grant. Overlaps Journey Log. Class 5 duplicate. |
| weighbridge | Weighbridge | /weighbridge (App.jsx:846; RoleRoute Admin) | RESTORE R2 | ready | 2 | Weighbridge.jsx; weighbridgeTickets.js; tables weighbridge_tickets. Policy A. Status CHECK matches. | Register with empty state; first action is New ticket. | Route is Admin only, so ordinary roles cannot use it without a custom role or a per-user grant. |
| carbon_tracker | Carbon Tracker | /carbon-tracker (App.jsx:792; RoleRoute Admin, Manager, Director) | REPAIR THEN RESTORE | ready | 3 | CarbonTracker.jsx; carbon.js; tables tyre_records, vehicle_fleet, carbon_offsets, carbon_initiatives. Policy B on carbon_offsets and carbon_initiatives. | Embedded CO2 charts compute from tyre fitments; offsets and initiatives ledgers are empty with add forms. | Offset cost is hard-coded to AED (column aed_cost, CarbonTracker.jsx:545 to 596); wrong for KSA, Egypt or any other customer. Fuel emissions view is titled as real fuel usage but uses a fleet-average consumption assumption (CarbonTracker.jsx:862, 901). Relabel as an estimate. Manager or Director pressing Delete gets no error and the row returns on reload (restrictive admin_only_delete_guard policy, service does not check the deleted row count). |
| driver_management | Driver Intelligence | /driver-management (App.jsx:715; ModuleRoute moduleKey="fleet_master"; also key fleet_master) | REPAIR THEN RESTORE | ready | 3 | DriverManagement.jsx; direct supabase calls; tables tyre_records. DriverManagement.jsx:187 select, :564 empty message. | Table says No tyre records carry a driver yet (honest). | Built on tyre_records.driver_name (0 rows populated) while 674 drivers exist in the drivers table. Join through asset or driver assignment instead. Row was inserted today only to switch the page off; before today the page answered to fleet_master alone. Detail page /driver-management/:driverId stays reachable and its Back button leads to the switched off page (DriverDetail.jsx:208). |
| fleet_health | Fleet Health Board | /fleet-health (App.jsx:718; ModuleRoute moduleKey="fleet_intelligence"; also key fleet_intelligence) | REPAIR THEN RESTORE | ready | 3 | FleetHealthBoard.jsx; direct supabase calls; tables tyre_records. FleetHealthBoard.jsx:229 select; HealthCircle renders N/A for a null score (line 173). Shares the fleet_intelligence curated key but is switched on its own slug. | Every vehicle reads Not assessed and every score N/A (honest), so the board is a grid of blanks. | Scores are built from tyre_records.risk_level, tread_depth and pressure_reading. No daily workflow writes them (inspection readings live in inspections.tyre_conditions). 0 of 11,260 tyre rows carry any of the three. Repoint to inspection readings. No error or Retry state found in the page source. |
| live_fleet | Live Fleet Status | /live-fleet (App.jsx:698; RoleRoute Admin) | REPAIR THEN RESTORE | ready | 3 | LiveFleetStatus.jsx; direct supabase calls; tables vehicle_fleet, tyre_records, inspections, alerts. Reads vehicle_fleet, tyre_records, inspections, alerts. | Fleet grid loads from the asset register, but tyre condition and health are blank. | Same input gap as Fleet Health Board (LiveFleetStatus.jsx:443). No error or Retry state found in the page source. Name promises live status; there is no live feed. Rename or state the source. Route is Admin only, so ordinary roles cannot use it without a custom role or a per-user grant. |
| stock_replenishment | Stock Replenishment | /stock-replenishment (App.jsx:697; RoleRoute Admin, Manager, Director) | REPAIR THEN RESTORE | ready | 3 | StockReplenishment.jsx; purchaseOrders.js; tables purchase_orders, stock, tyre_records. purchase_orders insert policy auth.uid() = created_by. | Replenishment matrix is empty for every customer. | Reads the legacy table stock (0 rows; nothing in the app writes it) instead of stock_records, which the live Stock module uses (purchaseOrders.js:50). Create PO works (payload matches purchase_orders CHECKs Draft and Normal) but there is no purchase order register page to see it afterwards. Manager or Director pressing Delete gets no error and the row returns on reload (restrictive admin_only_delete_guard policy, service does not check the deleted row count). |
| vendor_intelligence | Vendor Intelligence | /vendor-intelligence (App.jsx:714; ModuleRoute moduleKey="vendor_intelligence") | REPAIR THEN RESTORE | ready | 3 | VendorIntelligence.jsx; governedCost.js; tables tyre_records, corrective_actions. Curated permission key vendor_intelligence governs only /vendor-intelligence. | Vendor tables are empty because no tyre row carries a supplier. | Groups by tyre_records.supplier, populated on 0 of 11,260 rows. The Data Intake tyre template can map a supplier column, so a new customer could fill it; the current company has not. Null failure and close rates are sorted and plotted as 0 (VendorIntelligence.jsx:349 to 427), which reads as a perfect vendor. No error or Retry state found in the page source. |
| customer_portal | Customer Portal | /customer-portal (App.jsx:862; RoleRoute Admin) | KEEP HIDDEN | ready | 4 | CustomerPortal.jsx; customerPortal.js; tables customer_accounts. No portal route exists in App.jsx. | Account register with add form. | There is no customer-facing portal. The Portal enabled switch on an account does nothing. Route is Admin only, so ordinary roles cannot use it without a custom role or a per-user grant. |
| driver_coaching | Driver Coaching | /driver-coaching (App.jsx:856; RoleRoute Admin) | KEEP HIDDEN | ready | 4 | DriverCoaching.jsx; driverCoaching.js; tables driver_coaching. DriverCoaching.jsx header lists the missing fields. | Empty coaching queue. | Safety and fuel scores per driver are typed by hand; nothing computes them. Route is Admin only, so ordinary roles cannot use it without a custom role or a per-user grant. |
| driver_safety | Driver Safety | /driver-safety (App.jsx:839; RoleRoute Admin) | KEEP HIDDEN | ready | 4 | DriverSafety.jsx; driverSafety.js; tables driver_safety_events, tyre_records, trips. driver_safety_events policy A. | Empty event register and scores. | Scores drivers from harsh braking, speeding and similar events that only a telematics feed can supply. Route is Admin only, so ordinary roles cannot use it without a custom role or a per-user grant. |
| fleet_optimizer | Fleet Optimizer | /fleet-optimizer (App.jsx:861; RoleRoute Admin) | KEEP HIDDEN | ready | 4 | FleetOptimizer.jsx; fleetOptimizer.js; tables fleet_optimizer_scenarios. fleet_optimizer_scenarios policy A. | Scenario register with add form. | Utilisation, cost and the keep or replace decision are typed by hand per asset; currency defaults to SAR (FleetOptimizer.jsx:48). Duplicates Fleet Renewal, which reads recorded data. Route is Admin only, so ordinary roles cannot use it without a custom role or a per-user grant. |
| fleet_risk_score | Fleet Risk Score | /fleet-risk-score (App.jsx:789; RoleRoute Admin, Manager, Director) | KEEP HIDDEN | at risk | 3 | FleetRiskScore.jsx; fleetRisk.js; tables tyre_records. Page shows an evidence count per row, but the headline score and bands still render. | Would show a 0 to 100 safety score for every tyre built mostly from defaults. | With no tread, pressure or inspection date the engine substitutes fixed defaults (50, 60, 40: fleetRisk.js:142, 152, 174), which carry 65 of the 100 weight points. The score looks measured and is not. |
| fuel_efficiency | Fuel Efficiency | /fuel-efficiency (App.jsx:748; ModuleRoute moduleKey="fleet_analytics"; also key fleet_analytics) | KEEP HIDDEN | ready | 4 | FuelEfficiency.jsx; direct supabase calls; tables tyre_records. FuelEfficiency.jsx header lines 5 to 13; fuel_transactions referenced only by this page. | Measured figures read Not recorded; remaining figures are a labelled model plus a user-input calculator. | No fuel volume source exists: fuel_transactions has 0 rows and no page, import or mobile screen writes it. Until fuel can be captured the module cannot measure what its name says. Row was inserted today only to switch the page off. |
| fuel_theft | Fuel Theft Alerts | /fuel-theft (App.jsx:849; RoleRoute Admin) | KEEP HIDDEN | ready | 4 | FuelTheftAlerts.jsx; fuelTheftAlerts.js; tables fuel_theft_alerts. FuelTheftAlerts.jsx header. | Empty alert feed. | Alerts need tank level or fuel card data that is not collected; rows are typed by hand. Route is Admin only, so ordinary roles cannot use it without a custom role or a per-user grant. |
| geofencing | Geofencing | /geofencing (App.jsx:796; RoleRoute Admin) | KEEP HIDDEN | ready | 4 | Geofencing.jsx; geofences.js; tables geofences. Geofencing.jsx header: list and coordinate based. | Zone list with add form. | Zones can be saved but nothing evaluates them: no positions, no alerts, no map. Route is Admin only, so ordinary roles cannot use it without a custom role or a per-user grant. |
| gps_tracking | GPS Tracking | /gps-tracking (App.jsx:840; RoleRoute Admin) | KEEP HIDDEN | ready | 4 | GpsTracking.jsx; gpsPositions.js; tables gps_positions. GpsTracking.jsx header; gps_positions policy A. | Empty register; positions would have to be typed in by hand. | No GPS or telematics ingest exists (no API key, no feed, no map). A page named GPS Tracking that takes hand-typed coordinates misleads. Route is Admin only, so ordinary roles cannot use it without a custom role or a per-user grant. |
| ifta_reporting | IFTA Fuel Tax | /ifta-reporting (App.jsx:842; RoleRoute Admin) | KEEP HIDDEN | ready | 4 | IftaReporting.jsx; iftaRecords.js; tables ifta_records. IftaReporting.jsx header. | Empty register. | IFTA is a US and Canada fuel tax scheme; not applicable in KSA, UAE or Egypt. Route is Admin only, so ordinary roles cannot use it without a custom role or a per-user grant. |
| marketplace | Supplier Marketplace | /marketplace (App.jsx:865; RoleRoute Admin) | KEEP HIDDEN | ready | 4 | SupplierMarketplace.jsx; marketplace.js; tables marketplace_listings, marketplace_rfqs. marketplace tables policy B. | Listings and RFQ registers with add forms. | No supplier side exists; listings, ratings and quotes are typed by the customer. Forms default the currency to SAR (SupplierMarketplace.jsx:53, 58). Route is Admin only, so ordinary roles cannot use it without a custom role or a per-user grant. |
| ocr_scanner | OCR Scanner | /ocr-scanner (App.jsx:866; RoleRoute Admin) | KEEP HIDDEN | ready | 4 | OcrScanner.jsx; ocrScanner.js; tables ocr_scans. ocr_scans insert restricted to Admin by restrictive policy. | Scan record register; rows stay pending. | No OCR or vision provider is connected (stated in OcrScanner.jsx lines 7 to 11). Nothing is extracted. Route is Admin only, so ordinary roles cannot use it without a custom role or a per-user grant. |
| rotation_optimizer | Rotation Optimizer | /rotation-optimizer (App.jsx:790; RoleRoute Admin, Manager, Director) | KEEP HIDDEN | ready | 4 | RotationOptimizer.jsx; rotationOptimizer.js; tables tyre_records. RotationOptimizer.jsx:80 to 95. | All tread cells N/A, no recommendations. | Recommendations need tread depth per tyre. Tread is not captured by any inspection form (web or mobile), so the page cannot produce output for any customer. |
| route_optimization | Route Optimization | /route-optimization (App.jsx:834; RoleRoute Admin) | KEEP HIDDEN | ready | 4 | RouteOptimization.jsx; routePlans.js; tables route_plans. RouteOptimization.jsx header. | Plan register with add form. | There is no optimiser. The user types both the baseline and the optimised distance and the page reports the difference as savings. Route is Admin only, so ordinary roles cannot use it without a custom role or a per-user grant. |
| taas | Tyre-as-a-Service | /taas (App.jsx:864; RoleRoute Admin) | KEEP HIDDEN | ready | 4 | Taas.jsx; taas.js; tables taas_subscriptions. taas_subscriptions policy B. | Subscription register with add form. | Presents recurring revenue and billed to date with no billing behind it; all figures typed by hand. Only relevant to a tyre contractor. Route is Admin only, so ordinary roles cannot use it without a custom role or a per-user grant. |
| tachograph | Tachograph | /tachograph (App.jsx:852; RoleRoute Admin) | KEEP HIDDEN | ready | 4 | Tachograph.jsx; tachographRecords.js; tables tachograph_records. Tachograph.jsx header. | Empty register. | EU tachograph regulation (EC 561/2006) does not apply to the target markets and no card download exists. Route is Admin only, so ordinary roles cannot use it without a custom role or a per-user grant. |
| telematics_devices | Telematics Devices | /telematics-devices (App.jsx:812; RoleRoute Admin) | KEEP HIDDEN | ready | 4 | TelematicsDevices.jsx; telematicsDevices.js; tables telematics_devices, vehicle_fleet. telematics_devices policy B. | Device register with add form. | Registers devices that feed nothing; last seen never updates, so connectivity KPIs are meaningless. Route is Admin only, so ordinary roles cannot use it without a custom role or a per-user grant. |
| tpms | TPMS | /tpms (App.jsx:793; RoleRoute Admin) | KEEP HIDDEN | ready | 4 | Tpms.jsx; direct supabase calls; tables . tpms.js:73; Tpms.jsx has no insert call. | Empty charts; there is no button to add a reading. | No sensor feed exists and the page has no create form (insertTpmsReading is never called from Tpms.jsx). The fallback source tyre_records.pressure_reading is empty. Route is Admin only, so ordinary roles cannot use it without a custom role or a per-user grant. |
| trip_replay | Trip Replay | /trip-replay (App.jsx:860; RoleRoute Admin) | KEEP HIDDEN | ready | 4 | TripReplay.jsx; tripReplay.js; tables trip_segments. Source trip_segments only. | Empty; needs GPS breadcrumbs. | Depends on GPS breadcrumbs that no feed supplies. Route is Admin only, so ordinary roles cannot use it without a custom role or a per-user grant. |
| upload_approvals | Upload Approvals | /upload-approvals (App.jsx:774; FlagRoute flag="data_intake") | KEEP HIDDEN | at risk | 6 | UploadApprovals.jsx; imports.js, pendingUploadDecisions.js; tables pending_uploads, profiles, import_files, import_batches, import_attachment_matches, import_batch_sheets, import_rows, import_row_issues, alerts, corrective_actions, import_mapping_profiles, import_mapping_rules, import_master_aliases, currency_rates, custom_field_catalog. pg_policies for pending_uploads: country restrictive only; select = uploader or role Admin or Manager. | Empty queue. | pending_uploads has NO organisation isolation policy and no organisation_id default: its SELECT policy lets any Admin or Manager of any company read every pending upload, including the rows payload. Unsafe for a second tenant. Only the retired Expo app writes pending uploads. |
| video_telematics | Video Telematics | /video-telematics (App.jsx:837; RoleRoute Admin) | KEEP HIDDEN | ready | 4 | VideoTelematics.jsx; dashcamEvents.js; tables dashcam_events. dashcam_events policy A. | Empty event register. | No dashcam integration; events and a video URL are typed by hand. Route is Admin only, so ordinary roles cannot use it without a custom role or a per-user grant. |

Policy A: any authenticated active user of the organisation may insert and update; organisation and country
are restrictive. Policy B: insert, update and delete limited to Admin, Manager, Director by policy. In both,
delete is further restricted to Admin (MOD-4).

Risk to the current company of the restore itself: none. Restoring a row only returns a menu item and page that
existed until this morning; every table involved is empty for the current company, and no data, policy or code
changes. Risk of the listed repairs: none to low, each is confined to one page or one empty table.

## 6. Shared module keys and hazards

How a route is switched: `pathModuleStatus` checks two keys, the route slug and the curated key from
`NAV_MODULE_KEY`; the worst status wins. `ModuleRoute` additionally checks its own `moduleKey`.

| Module id | Routes it governs | Other key on the same route | Hazard |
|---|---|---|---|
| driver_management | /driver-management | fleet_master (live; also governs /fleet-master, /asset-management, /vehicle-history, detail pages) | Safe both ways: the slug row switches only this page. Do NOT switch fleet_master to reach it. Detail /driver-management/:driverId is not covered. |
| fleet_health | /fleet-health | fleet_intelligence (live; also /fleet-intelligence) | Safe both ways for the same reason. |
| fuel_efficiency | /fuel-efficiency | fleet_analytics (live; also /fleet, /downtime) | Safe both ways. |
| vendor_intelligence | /vendor-intelligence | none | Curated permission key as well as a status key; role grants for it are unaffected by the status. |
| pm_programs | /pm-programs | none | Also the Flutter module pm and the Expo mirror key pm (section 8). Live pages link to it (MOD-8). PM data also shows on Dashboard, Maintenance Calendar and Asset Detail, which stay visible while the module is off. |
| repair_requests | /repair-requests | none | Also the Flutter field screen repairRequest (section 8). Leaving it off will remove a field workflow from phones once the pending Flutter build ships. |
| shifts and workshop_absence | /shifts, /workshop-absence | none | Absence report has no input of its own; it reads the roster. Restore both or neither. Workshop Live (live) also reads shifts. |
| parts_requests and parts_catalog | /parts-requests, /parts-catalog | none | Parts request picker reads the catalogue; PM service recording also reads it. Restore together. |
| tyre_service_events | /tyre-service-events | none | Live pages write to this table today (Tyre Exchange, Tyre Bay). |
| recall_tracker | /recall-tracker | none | /recalls/:recallId carries moduleKey recall_tracker for permissions but is not status gated. |
| customers | /customers | none | Page also reads customer_accounts (Customer Portal table) and contracts (live). Restoring customers while customer_portal stays hidden is fine. |
| insurance_claims | /insurance-claims | none | Different from Claims Summary (live). No shared key. |
| breakdowns | /breakdowns | none | Different from asset_breakdowns (live). No shared key. |

No disabled id governs a second working screen. The reverse risk exists on LIVE curated keys: switching off
`fleet_master`, `stock`, `analytics`, `budgets`, `tyre_records`, `inspections`, `work_orders`,
`kpi_scorecard`, `reports`, `alerts`, `fleet_analytics` or `fleet_intelligence` takes several pages with it
(see NAV_MODULE_KEY, src/lib/navAccess.js:23 to 105).

Working branch versus origin/main: `navAccess.js` and `ProtectedRoute.jsx` are identical to origin/main. The
App.jsx differences on the branch turn eight duplicate pages into redirects; none of them is a disabled module.

## 7. Routes with no row in public.modules

These cannot be switched from Module Control (public pages such as /login, /privacy, /terms, /support, /status
and the token viewers are left out on purpose):

- /report/:token (App.jsx:606, ReportShare, no guard)
- /workshop-tv/:token (App.jsx:607, WorkshopTv, no guard)
- /accident-portal/:token (App.jsx:611, AccidentPortalView, no guard)
- /accidents/:id (App.jsx:657, AccidentDetail, FlagRoute flag="accidents_module")
- /accidents/:id/timeline (App.jsx:658, AccidentCaseTimeline, FlagRoute flag="accidents_module")
- /vehicle/:assetNo (App.jsx:671, Vehicle360, FlagRoute flag="vehicle_360")
- /daily-ops/workshop (App.jsx:705, WorkshopStatus, ModuleRoute moduleKey="daily_ops:workshop")
- /executive (App.jsx:722, ExecutiveLanding, no guard)
- /upload (App.jsx:762, UploadData, FlagRoute flag="data_intake")
- /data-intake/history (App.jsx:764, DataIntakeHistory, RoleRoute allowed={['Admin', 'Manager', 'Director']} FlagRoute flag="data_intake")
- /checklists/:templateId/run (App.jsx:766, ChecklistRun, no guard)
- /checklists/submission/:id (App.jsx:767, ChecklistSubmission, no guard)
- /checklist-audit (App.jsx:769, ChecklistAuditPack, RoleRoute allowed={CHECKLIST_AUTHOR_ROLES})
- /checklist-builder (App.jsx:772, ChecklistBuilder, RoleRoute allowed={CHECKLIST_AUTHOR_ROLES})
- /checklist-builder/:id (App.jsx:773, ChecklistBuilder, RoleRoute allowed={CHECKLIST_AUTHOR_ROLES})
- /my-problems (App.jsx:779, MyProblems, no guard)
- /tyre-passport/:serial (App.jsx:783, TyrePassport, ModuleRoute moduleKey="tyre_passport")
- /digital-twin/:assetNo (App.jsx:804, DigitalTwin, RoleRoute allowed={['Admin', 'Manager', 'Director']})
- /workforce-daily (App.jsx:815, WorkforceDailyWork, no guard)
- /scan (App.jsx:873, TyreScan, no guard)
- /rfid-registry (App.jsx:875, RfidRegistry, ModuleRoute moduleKey="tyre_records")
- /report-builder (App.jsx:876, ReportBuilder, RoleRoute allowed={['Admin']})
- /design-system (App.jsx:880, DesignSystem, RoleRoute allowed={['Admin']})
- /asset-management/:assetNo (App.jsx:898, AssetDetail, ModuleRoute moduleKey="fleet_master")
- /suppliers/:supplierId (App.jsx:899, SupplierDetail, ModuleRoute moduleKey="stock")
- /driver-management/:driverId (App.jsx:900, DriverDetail, ModuleRoute moduleKey="fleet_master")
- /workshop/:jobId (App.jsx:901, WorkshopJobDetail, ModuleRoute moduleKey="work_orders")
- /recalls/:recallId (App.jsx:902, RecallDetail, RoleRoute allowed={['Admin']} moduleKey="recall_tracker")
- /workflow-settings/builder/:defId? (App.jsx:903, WorkflowBuilder, FlagRoute flag="automation_platform")
- /automation-rules/builder (App.jsx:904, RuleBuilder, FlagRoute flag="automation_platform")
- /automation-rules/builder/:ruleId (App.jsx:905, RuleBuilder, FlagRoute flag="automation_platform")

Routes governed only through a curated key (no row of their own, switched with the parent): /suppliers and
/procurement (stock), /cost-center and /budget-planner (budgets), /tyre-size, /tyre-lifecycle and /anomalies
(tyre_records), /kpi-engine and /kpi-command (kpi_scorecard), /report-center (reports), /alert-thresholds
(alerts), /inspection-intelligence and /ai-tyre-inspection (inspections), /downtime (fleet_analytics),
/vehicle-history (fleet_master), /benchmark, /continuous-improvement and /advanced-analytics (analytics).
Rows that govern no route: ai_analytics, display, upload_data, user_management (their pages moved or the slug
differs: /upload has slug upload, not upload_data).
Limit: the route list was parsed from single-line Route elements in App.jsx (267 of 342 Route tags; the rest
are console routes and multi-line elements).

## 8. Mobile and Flutter

Expo mirror (src/lib/mobileModules.js) and Flutter registry
(tyre_pulse_flutter/lib/core/permissions/module_registry.dart). Only two disabled web modules have a phone twin:

| Web module (disabled) | Expo key | Flutter key | Effect today |
|---|---|---|---|
| pm_programs | pm (Maintenance Due) | ModuleKey.pm | None on installed apps. In the uncommitted working tree Flutter reads Module Control through webModuleStatusKeys (module_registry.dart:186), so the next Flutter build would hide Maintenance Due. |
| repair_requests | repairRequest (Repair Request) | ModuleKey.repairRequest | Same: none today, hidden in the next Flutter build if the row is still disabled. |

No other disabled web module maps to a phone module. Phone modules with a live web twin (handovers, checklists,
accidents, alerts, stock, rca, analytics, reports, vehicle_washing, odometer_logs, maintenance_calendar,
serial_tracker, fleet_master, work_orders, inspections, tyre_records) are unaffected. The Expo app does not read
`public.modules` at all. NOT VERIFIED: whether the Flutter gate exempts Admin accounts.

## 9. SQL for the lead (text only, nothing was run)

Tier R1 (31 rows):

```sql
update public.modules
   set status = 'live', note = 'Back on 2026-11-12 after module review: working register, starts empty.', last_updated = now()
 where status = 'disabled'
   and module_id in ('batteries', 'bay_scheduling', 'breakdowns', 'certifications', 'combinations', 'driver_documents', 'driver_training', 'dvir', 'equipment', 'fleet_groups', 'goods_receipt', 'insurance_claims', 'materials', 'parts_catalog', 'parts_requests', 'pm_programs', 'policies', 'recall_tracker', 'repair_requests', 'requisitions', 'reservations', 'retread', 'retread_claims', 'rotation', 'service_requests', 'shifts', 'tyre_pool', 'tyre_service_events', 'vehicle_checkinout', 'warranty', 'workshop_absence');
```

Tier R2 (17 rows), optional:

```sql
update public.modules
   set status = 'live', note = 'Back on 2026-11-12 after module review: optional register, starts empty.', last_updated = now()
 where status = 'disabled'
   and module_id in ('charging_sessions', 'cold_chain', 'customers', 'dispatch', 'driver_expenses', 'dtc', 'emissions', 'fuel_cards', 'fuel_delivery', 'hours_of_service', 'journeys', 'load_planning', 'proof_of_delivery', 'sla_dashboard', 'toll_transactions', 'trips', 'weighbridge');
```

Check afterwards: `select status, count(*) from public.modules group by status;` expects 153 live and 44
disabled after R1 alone, 170 live and 27 disabled after R1 and R2. The 6 REPAIR THEN RESTORE rows
(carbon_tracker, driver_management, fleet_health, live_fleet, stock_replenishment, vendor_intelligence) and the 21 KEEP HIDDEN rows stay disabled; their notes should be
rewritten to the specific reason in the table above, because "no records ever entered" is not the reason any of
them is hidden.

## 10. Not verified

- No page was rendered and no record was created; first-use behaviour is read from code and catalog.
- Whether tyre imports for a new customer populate supplier, tread and pressure in practice.
- The Flutter Module Control gate was read only at the registry; its admin exemption and offline behaviour were
  not traced.
- The UI effect of the Manager delete refusal (MOD-4) is inferred from policy and service code.
