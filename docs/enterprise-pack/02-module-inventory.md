# 02 - Complete Module Inventory

| Field | Value |
|---|---|
| Deliverable | 2 of 29 |
| Date | 2026-11-10 |
| Status | Built (inventory). 218 web nav items in 13 groups, 35 console nav entries in 5 areas, 32 mobile modules shared by Flutter and Expo. |
| Evidence | Generated from code: `NAV_GROUPS` in `src/components/Layout.jsx` (lines 115 to ~560), route guards in `src/App.jsx`, `NAV_GROUPS`/`CONSOLE_NAV` in `src/console/components/ConsoleLayout.jsx`, `ModuleRegistry.all` in `tyre_pulse_flutter/lib/core/permissions/module_registry.dart`, `src/lib/mobileModules.js`. Row counts are EXACT `count(*)` from the live database, read-only, 2026-11-10. "Main tables" were derived from page and service imports (`src/lib/api/*`) and checked by hand for the ambiguous ones; a few are inferred from migration names and marked as such in doc 10. |
| Related docs | [01 Architecture](01-current-system-architecture.md), [03 Duplicates](03-duplicate-module-report.md), [05 Navigation](05-navigation-redesign.md), `docs/ROUTE_OWNERSHIP_2026-08-30.md`, `docs/MODULE_ROADMAP.md`, `docs/flutter-migration/01-*` |

## 1. How to read this inventory

- **Route guard** is what `src/App.jsx` enforces: `Role:` = `RoleRoute allowed` (super-admin always admitted; per-user grants and custom roles admitted via `governingModuleKey`), `Module:` = `ModuleRoute moduleKey` (role matrix + per-user grant/revoke, Module Control status), `Flag:` = `FlagRoute` feature flag. "(nav: Admin only)" means the sidebar item is `adminOnly` even if the route is wider. Parity between sidebar and route is enforced by `src/test/navRouteAccessParity.test.js`.
- **Live data status** uses the first listed table: `EMPTY` (0 rows), `thin data` (< 50 rows), `in use`, or `n/a` (page reads aggregates or a table not counted). Counts are for all tenants together (5 organisations; only "Company A" holds operational data per project memory).
- A module over an empty table is a **complete interface with no data**. It is not broken, but it must not be demoed as a working process (project memory 2026-08-10 buyer audit; owner ruling 2026-10-05: empty-table pages are accepted as-is, do not seed or fake).

## 2. Summary

| Measure | Value |
|---|---|
| Web nav groups / items | 13 / 218 |
| Items whose main table is EMPTY | 78 |
| Items with thin data (< 50 rows) | 24 |
| Items in real use | 74 |
| Aggregate / unmeasured | 42 (dashboards and analytics over other tables) |
| Routes outside the nav (deep links, builders, public pages) | ~35 (section 4) |
| Legacy routes that redirect into the console | 12 (`/admin`, `/users`, `/master-access-control`, `/permission-matrix`, `/security-center`, `/org-hierarchy`, `/holding-company`, `/sso-configuration`, `/ai-administration`, plus `/ai` to `/ai-command-center`) |
| Console areas / nav entries / child routes | 5 / 35 / 69 (many are tab redirects into the 5 area pages) |
| Mobile modules (Flutter = Expo keys) | 32 |
| Web pages in `src/pages` / console pages | 324 / 92 files |

Largest operational datasets: `audit_log_v2` 578,281; `parts_consumption` 220,425 (expense grid, the cost source); `production_logs` 212,567; `work_orders` 96,554; `tyre_records` 11,410; `engine_hours_logs` 5,675; `odometer_logs` 2,879; `inspections` 2,554; `vehicle_fleet` 1,622; `drivers` 674.

## 3. Web application modules by nav group

### Overview

| Module | Route | Sub-group | Route guard (App.jsx) | Main tables / RPCs | Live data status |
|---|---|---|---|---|---|
| Command Center | `/` | - | authenticated only | vehicle_fleet, tyre_records, work_orders, action_items (aggregates) | in use (vehicle_fleet = 1,622) |
| Action Center | `/action-center` | - | Role: Admin (nav: Admin only) | action_items | in use (action_items = 154) |
| Approvals | `/approvals` | - | Flag: automation_platform | approval_dashboard RPC, inspections, checklist_submissions, accidents | in use (inspections = 2,554) |
| My Checklists | `/my-checklists` | - | authenticated only | checklist_templates, checklist_submissions | thin data (checklist_templates = 12) |
| Message the Team | `/broadcast` | - | Role: Admin,Manager,Director Module: broadcast (nav: Admin only) | broadcasts, broadcast_recipient_receipts | n/a (aggregate or unmeasured) |

### Fleet & Assets

| Module | Route | Sub-group | Route guard (App.jsx) | Main tables / RPCs | Live data status |
|---|---|---|---|---|---|
| Fleet Master | `/fleet-master` | Registry | Module: fleet_master | vehicle_fleet | in use (vehicle_fleet = 1,622) |
| Asset Management | `/asset-management` | Registry | Module: fleet_master | vehicle_fleet | in use (vehicle_fleet = 1,622) |
| Site Management | `/sites` | Registry | Module: fleet_master | sites | in use (sites = 70) |
| Fleet Groups | `/fleet-groups` | Registry | Role: Admin (nav: Admin only) | fleet_groups | EMPTY (fleet_groups = 0) |
| Combinations | `/combinations` | Registry | Role: Admin (nav: Admin only) | asset_combinations | EMPTY (asset_combinations = 0) |
| Customers | `/customers` | Registry | Role: Admin (nav: Admin only) | customers | EMPTY (customers = 0) |
| Vehicle History | `/vehicle-history` | Lifecycle | Module: fleet_master (nav: Admin only) | vehicle_fleet, work_orders, tyre_records (timeline) | in use (vehicle_fleet = 1,622) |
| Asset Disposal | `/asset-disposals` | Lifecycle | Role: Admin,Manager,Director Module: asset_disposals | asset_disposals | thin data (asset_disposals = 40) |
| Fleet Renewal | `/fleet-renewal` | Lifecycle | Role: Admin,Manager,Director | fleet_renewal_plans, vehicle_fleet | EMPTY (fleet_renewal_plans = 0) |
| Battery Lifecycle | `/batteries` | Lifecycle | Role: Admin (nav: Admin only) | batteries | EMPTY (batteries = 0) |
| QR Labels | `/qr-labels` | Identification | Role: Admin Module: qr_labels (nav: Admin only) | vehicle_fleet, qr_print_jobs | in use (vehicle_fleet = 1,622) |
| RFID Registry | `/rfid` | Identification | Role: Admin (nav: Admin only) | rfid_tags | thin data (rfid_tags = 1) |
| Engine Hours | `/engine-hours` | Meters | Role: Admin (nav: Admin only) | engine_hours_logs | in use (engine_hours_logs = 5,675) |
| Odometer Logs | `/odometer-logs` | Meters | Module: odometer_logs | odometer_logs | in use (odometer_logs = 2,879) |
| Fleet Utilization | `/fleet-utilization` | Meters | Role: Admin,Manager,Director | asset_utilization | in use (asset_utilization = 556) |
| Vehicle Check In/Out | `/vehicle-checkinout` | Movement | Role: Admin (nav: Admin only) | vehicle_checkinout | EMPTY (vehicle_checkinout = 0) |
| Vehicle Handover | `/handovers` | Movement | Role: Admin (nav: Admin only) | handover_reports | EMPTY (handover_reports = 0) |
| Vehicle Reservations | `/reservations` | Movement | Role: Admin (nav: Admin only) | vehicle_reservations | EMPTY (vehicle_reservations = 0) |
| Gate Pass | `/gate-pass` | Movement | Module: gate_pass | gate_passes | thin data (gate_passes = 2) |

### Tyre Management

| Module | Route | Sub-group | Route guard (App.jsx) | Main tables / RPCs | Live data status |
|---|---|---|---|---|---|
| Tyre Records | `/tyres` | Records | Module: tyre_records | tyre_records | in use (tyre_records = 11,410) |
| Serial Tracker | `/serial-tracker` | Records | Role: Admin Module: serial_tracker (nav: Admin only) | tyre_records, tyre_status_marks | in use (tyre_records = 11,410) |
| Tyre Passport | `/tyre-passport` | Records | Module: tyre_passport | tyre_records | in use (tyre_records = 11,410) |
| Tyre Specifications | `/tyre-specs` | Records | Role: Admin (nav: Admin only) | tyre_specifications, tyre_spec_catalog | thin data (tyre_specifications = 10) |
| Tyre Exchange | `/tyre-exchange` | Fitment & Rotation | Role: Admin (nav: Admin only) | tyre_records, tyre_service_events | in use (tyre_records = 11,410) |
| Rotation Schedule | `/rotation` | Fitment & Rotation | Role: Admin (nav: Admin only) | tyre_rotations | EMPTY (tyre_rotations = 0) |
| Rotation Optimizer | `/rotation-optimizer` | Fitment & Rotation | Role: Admin,Manager,Director | tyre_records | in use (tyre_records = 11,410) |
| Fitment Validation | `/fitment-validation` | Fitment & Rotation | Role: Admin,Manager,Director | fitment_rules, fitment_validations | n/a (aggregate or unmeasured) |
| Size Optimizer | `/tyre-size` | Fitment & Rotation | Module: tyre_records (nav: Admin only) | tyre_records | in use (tyre_records = 11,410) |
| Pressure Intelligence | `/pressure-intel` | Condition | Module: pressure_intelligence (nav: Admin only) | inspections.tyre_conditions | in use (inspections = 2,554) |
| TPMS | `/tpms` | Condition | Role: Admin (nav: Admin only) | tpms_readings | EMPTY (tpms_readings = 0) |
| Position Intelligence | `/position-intelligence` | Condition | Module: position_intelligence (nav: Admin only) | tyre_records | in use (tyre_records = 11,410) |
| Tyre Age Compliance | `/tyre-age-compliance` | Condition | Role: Admin,Manager,Director | tyre_records | in use (tyre_records = 11,410) |
| Heat Intelligence | `/heat-intelligence` | Condition | Role: Admin,Manager,Director | tyre_records + Open-Meteo | in use (tyre_records = 11,410) |
| Tyre Lifecycle | `/tyre-lifecycle` | Lifecycle | Module: tyre_records (nav: Admin only) | tyre_records, get_tyre_running_life | in use (tyre_records = 11,410) |
| Tyre Service Events | `/tyre-service-events` | Lifecycle | Role: Admin,Manager,Director | tyre_service_events | EMPTY (tyre_service_events = 0) |
| Tyre Pool | `/tyre-pool` | Lifecycle | authenticated only | tyre_pool | EMPTY (tyre_pool = 0) |
| Scrap Management | `/scrap` | Lifecycle | authenticated only | tyre_status_marks, list_scrapped_tyres | in use (tyre_status_marks = 720) |
| Retread Management | `/retread` | Lifecycle | Role: Admin (nav: Admin only) | retread_jobs | EMPTY (retread_jobs = 0) |
| Retread Claims | `/retread-claims` | Lifecycle | Role: Admin (nav: Admin only) | retread_claims | EMPTY (retread_claims = 0) |
| Warranty Tracker | `/warranty` | Lifecycle | authenticated only | warranty_claims | EMPTY (warranty_claims = 0) |
| Brand Performance | `/brand-perf` | Performance | Module: brand_performance | tyre_records, get_brand_size_cpk | in use (tyre_records = 11,410) |
| Tyre Failure & CPK | `/tyre-failure-cpk` | Performance | Role: Admin,Manager,Director | tyre_records, get_tyre_cost_by_asset | in use (tyre_records = 11,410) |
| CPK Intelligence | `/cpk-intelligence` | Performance | Role: Admin,Manager,Director Module: cpk_intelligence | get_fleet_cpk, get_cpk_drivers | n/a (aggregate or unmeasured) |
| Fleet Risk Score | `/fleet-risk-score` | Performance | Role: Admin,Manager,Director | tyre_records | in use (tyre_records = 11,410) |
| Digital Twin | `/digital-twin` | Performance | Role: Admin,Manager,Director | vehicle_fleet, tyre_records | in use (vehicle_fleet = 1,622) |

### Workshop & Maintenance

| Module | Route | Sub-group | Route guard (App.jsx) | Main tables / RPCs | Live data status |
|---|---|---|---|---|---|
| Work Orders | `/work-orders` | Jobs | Module: work_orders | work_orders | in use (work_orders = 96,554) |
| Workshop Management | `/workshop` | Jobs | Module: work_orders (nav: Admin only) | work_orders, get_maintenance_snapshot | in use (work_orders = 96,554) |
| Live Control | `/workshop-live` | Jobs | Role: Admin,Manager,Director Module: workshop_live | tech_activity_events, wo_assignments, work_orders | in use (work_orders = 96,554) |
| Bay Scheduling | `/bay-scheduling` | Jobs | Role: Admin (nav: Admin only) | bay_schedules | EMPTY (bay_schedules = 0) |
| Service Requests | `/service-requests` | Jobs | Role: Admin (nav: Admin only) | service_requests | EMPTY (service_requests = 0) |
| Breakdown Callouts | `/breakdowns` | Jobs | Role: Admin (nav: Admin only) | breakdown_callouts | EMPTY (breakdown_callouts = 0) |
| Repair Requests (RFR) | `/repair-requests` | Jobs | Role: Admin,Manager,Director Module: repair_requests | repair_requests | EMPTY (repair_requests = 0) |
| Breakdown Register | `/asset-breakdowns` | Jobs | Role: Admin,Manager,Director Module: asset_breakdowns | asset_breakdowns | thin data (asset_breakdowns = 30) |
| Preventive Maintenance | `/pm-programs` | Maintenance | Role: Admin,Manager,Director Module: pm_programs | pm_programs, pm_service_records | EMPTY (pm_programs = 0) |
| Maintenance Calendar | `/maintenance-calendar` | Maintenance | Role: Admin (nav: Admin only) | pm_programs, work_orders | EMPTY (pm_programs = 0) |
| Predictive Maintenance | `/predictive-maintenance` | Maintenance | Module: predictive_maintenance (nav: Admin only) | tyre_records, work_orders | in use (tyre_records = 11,410) |
| Downtime Tracker | `/downtime` | Maintenance | Module: fleet_analytics (nav: Admin only) | work_orders | in use (work_orders = 96,554) |
| DTC Diagnostics | `/dtc` | Maintenance | Role: Admin (nav: Admin only) | dtc_codes | EMPTY (dtc_codes = 0) |
| Vehicle Washing | `/vehicle-washing` | Maintenance | Module: vehicle_washing | wash_records | in use (wash_records = 249) |
| Absence & Attendance | `/workshop-absence` | People | Role: Admin,Manager,Director | workshop_attendance, shifts | EMPTY (shifts = 0) |
| Technician Scorecard | `/technician-scorecard` | People | Role: Admin (nav: Admin only) | work_orders, technician_skills | in use (work_orders = 96,554) |
| Shift Scheduling | `/shifts` | People | Role: Admin Module: shifts (nav: Admin only) | shifts | EMPTY (shifts = 0) |
| My Day & Team Reviews | `/workforce-daily` | People | authenticated only | workforce_* (V20261109*) | n/a (aggregate or unmeasured) |
| Parts Requests | `/parts-requests` | Parts & Tools | Role: Admin,Manager,Director | parts_requests | EMPTY (parts_requests = 0) |
| Tool & Equipment | `/equipment` | Parts & Tools | Role: Admin (nav: Admin only) | equipment | EMPTY (equipment = 0) |
| Workshop Analytics | `/workshop-analytics` | Analysis | Role: Admin,Manager,Director | tech_activity_events | n/a (aggregate or unmeasured) |
| Maintenance Cost & Tasks | `/maintenance-cost-board` | Analysis | Role: Admin,Manager,Director | get_maintenance_snapshot | n/a (aggregate or unmeasured) |
| Workshop Settings | `/workshop-settings` | Analysis | Role: Admin,Manager,Director | workshop_config | n/a (aggregate or unmeasured) |

### Inspections & Compliance

| Module | Route | Sub-group | Route guard (App.jsx) | Main tables / RPCs | Live data status |
|---|---|---|---|---|---|
| Inspections | `/inspections` | Inspections | Module: inspections | inspections | in use (inspections = 2,554) |
| AI Tyre Inspection | `/ai-tyre-inspection` | Inspections | Role: Admin,Manager,Director,MaintenanceSupervisor,TyreMan,TyreDataCollector Module: inspections | ai_tyre_inspection_jobs | in use (ai_tyre_inspection_jobs = 878) |
| Inspection Planner | `/inspection-planner` | Inspections | authenticated only | inspection_schedules, inspections | in use (inspections = 2,554) |
| Inspection Intelligence | `/inspection-intelligence` | Inspections | Module: inspections (nav: Admin only) | inspections | in use (inspections = 2,554) |
| DVIR Reports | `/dvir` | Inspections | Role: Admin (nav: Admin only) | dvir_reports | EMPTY (dvir_reports = 0) |
| Checklists | `/checklists` | Checklists | authenticated only | checklist_submissions, checklist_templates | in use (checklist_submissions = 133) |
| Checklist Schedules | `/checklist-schedules` | Checklists | authenticated only (nav: Admin only) | checklist_schedules | n/a (aggregate or unmeasured) |
| Checklist Insights | `/checklist-insights` | Checklists | authenticated only (nav: Admin only) | checklist_submissions | in use (checklist_submissions = 133) |
| Audit Pack | `/checklist-audit` | Checklists | authenticated only (nav: Admin only) | checklist_submissions, corrective_actions | in use (checklist_submissions = 133) |
| Corrective Actions | `/actions` | Findings | Module: corrective_actions | corrective_actions | in use (corrective_actions = 154) |
| Root Cause | `/rca` | Findings | Module: rca | rca_records | thin data (rca_records = 1) |
| Root Cause Engine | `/root-cause` | Findings | Module: root_cause_engine | tyre_records (client engine) | in use (tyre_records = 11,410) |
| Anomaly Scan | `/anomalies` | Findings | Module: tyre_records (nav: Admin only) | tyre_records | in use (tyre_records = 11,410) |
| Compliance Dashboard | `/compliance` | Compliance | Role: Admin (nav: Admin only) | fleet_master (EMPTY), inspections | EMPTY (fleet_master = 0) |
| Safety & Compliance | `/safety-compliance` | Compliance | Role: Admin (nav: Admin only) | inspections, tyre_records, accidents | in use (inspections = 2,554) |
| Certifications | `/certifications` | Compliance | Role: Admin,Manager,Director | certifications | EMPTY (certifications = 0) |
| Policy Management | `/policies` | Compliance | Role: Admin (nav: Admin only) | policies | EMPTY (policies = 0) |
| Emissions Tests | `/emissions` | Compliance | Role: Admin (nav: Admin only) | emissions_tests | EMPTY (emissions_tests = 0) |
| Hours of Service | `/hours-of-service` | Compliance | Role: Admin (nav: Admin only) | hos_logs | EMPTY (hos_logs = 0) |
| Tachograph | `/tachograph` | Compliance | Role: Admin (nav: Admin only) | tachograph_records | EMPTY (tachograph_records = 0) |
| Speed Limiter | `/speed-limiter` | Compliance | Role: Admin (nav: Admin only) | speed_limiters | thin data (speed_limiters = 1) |
| Alerts | `/alerts` | Alerts | Module: alerts (nav: Admin only) | alerts + client alertEngine | EMPTY (alerts = 0) |
| Alert Thresholds | `/alert-thresholds` | Alerts | Module: alerts (nav: Admin only) | alert_thresholds | EMPTY (alert_thresholds = 0) |

### Drivers & Safety

| Module | Route | Sub-group | Route guard (App.jsx) | Main tables / RPCs | Live data status |
|---|---|---|---|---|---|
| Driver Intelligence | `/driver-management` | - | Module: fleet_master (nav: Admin only) | drivers | in use (drivers = 674) |
| Driver workspace | `/driver-workspace` | - | authenticated only | driver_fines, driver assignments | n/a (aggregate or unmeasured) |
| Driver Safety | `/driver-safety` | - | Role: Admin (nav: Admin only) | driver_safety_events | n/a (aggregate or unmeasured) |
| Driver Training | `/driver-training` | - | Role: Admin (nav: Admin only) | driver_training | EMPTY (driver_training = 0) |
| Driver Coaching | `/driver-coaching` | - | Role: Admin (nav: Admin only) | driver_coaching | EMPTY (driver_coaching = 0) |
| Driver Documents | `/driver-documents` | - | Role: Admin (nav: Admin only) | driver_documents | EMPTY (driver_documents = 0) |
| Driver Expenses | `/driver-expenses` | - | Role: Admin (nav: Admin only) | driver_expenses | EMPTY (driver_expenses = 0) |
| Video Telematics | `/video-telematics` | - | Role: Admin (nav: Admin only) | dashcam_events | EMPTY (dashcam_events = 0) |
| Fuel Theft Alerts | `/fuel-theft` | - | Role: Admin (nav: Admin only) | fuel_theft_alerts | EMPTY (fuel_theft_alerts = 0) |

### Monitoring & Logistics

| Module | Route | Sub-group | Route guard (App.jsx) | Main tables / RPCs | Live data status |
|---|---|---|---|---|---|
| Live Fleet Status | `/live-fleet` | Live | Role: Admin (nav: Admin only) | fleet_master (EMPTY), tyre_records | EMPTY (fleet_master = 0) |
| Daily Ops | `/daily-ops` | Live | Module: daily_ops (nav: Admin only) | action_items, inspections, work_orders | in use (action_items = 154) |
| Workshop Status | `/daily-ops/workshop` | Live | Module: daily_ops:workshop | workshop_status_* (V20261007*) | n/a (aggregate or unmeasured) |
| GPS Tracking | `/gps-tracking` | Live | Role: Admin (nav: Admin only) | gps_positions | EMPTY (gps_positions = 0) |
| Fleet Health Board | `/fleet-health` | Live | Module: fleet_intelligence (nav: Admin only) | tyre_records | in use (tyre_records = 11,410) |
| Trip Replay | `/trip-replay` | Live | Role: Admin (nav: Admin only) | trip_segments | EMPTY (trip_segments = 0) |
| Trip History | `/trips` | Journeys | Role: Admin (nav: Admin only) | trips | EMPTY (trips = 0) |
| Journey Log | `/journeys` | Journeys | Role: Admin (nav: Admin only) | journeys | EMPTY (journeys = 0) |
| Route Optimization | `/route-optimization` | Journeys | Role: Admin (nav: Admin only) | route_plans | EMPTY (route_plans = 0) |
| Geofencing | `/geofencing` | Journeys | Role: Admin (nav: Admin only) | geofences | EMPTY (geofences = 0) |
| Dispatch Planning | `/dispatch` | Journeys | Role: Admin (nav: Admin only) | dispatch_loads | EMPTY (dispatch_loads = 0) |
| Load Planning | `/load-planning` | Journeys | Role: Admin (nav: Admin only) | load_plans | EMPTY (load_plans = 0) |
| Telematics Devices | `/telematics-devices` | Devices | Role: Admin (nav: Admin only) | telematics_devices | EMPTY (telematics_devices = 0) |
| Cold-Chain Monitor | `/cold-chain` | Devices | Role: Admin (nav: Admin only) | cold_chain_logs | EMPTY (cold_chain_logs = 0) |
| Weighbridge | `/weighbridge` | Logistics | Role: Admin (nav: Admin only) | weighbridge_tickets | EMPTY (weighbridge_tickets = 0) |
| Proof of Delivery | `/proof-of-delivery` | Logistics | Role: Admin (nav: Admin only) | pod_records | EMPTY (pod_records = 0) |
| Toll Transactions | `/toll-transactions` | Logistics | Role: Admin (nav: Admin only) | toll_transactions | EMPTY (toll_transactions = 0) |
| Fuel Cards | `/fuel-cards` | Fuel & Energy | Role: Admin (nav: Admin only) | fuel_cards | EMPTY (fuel_cards = 0) |
| Fuel Delivery | `/fuel-delivery` | Fuel & Energy | Role: Admin (nav: Admin only) | fuel_deliveries | EMPTY (fuel_deliveries = 0) |
| Fuel Efficiency | `/fuel-efficiency` | Fuel & Energy | Module: fleet_analytics (nav: Admin only) | fuel_transactions, odometer_logs | EMPTY (fuel_transactions = 0) |
| EV Charging | `/charging-sessions` | Fuel & Energy | Role: Admin (nav: Admin only) | charging_sessions | EMPTY (charging_sessions = 0) |
| IFTA Fuel Tax | `/ifta-reporting` | Fuel & Energy | Role: Admin (nav: Admin only) | ifta_records | EMPTY (ifta_records = 0) |

### Inventory & Procurement

| Module | Route | Sub-group | Route guard (App.jsx) | Main tables / RPCs | Live data status |
|---|---|---|---|---|---|
| Stock | `/stock` | Stock | Module: stock | stock_records, stock_movements | thin data (stock_records = 36) |
| Stock Replenishment | `/stock-replenishment` | Stock | Role: Admin,Manager,Director | stock_records | thin data (stock_records = 36) |
| Parts Catalog | `/parts-catalog` | Stock | Role: Admin,Manager,Director | parts_catalog | EMPTY (parts_catalog = 0) |
| Materials | `/materials` | Stock | Role: Admin (nav: Admin only) | materials | EMPTY (materials = 0) |
| Goods Receipt | `/goods-receipt` | Stock | Role: Admin,Manager,Director | goods_receipts | EMPTY (goods_receipts = 0) |
| Material Issue (MIS) | `/store-material-issue` | Stock | Role: Admin,Manager,Director Module: store_material_issue | material_issues | EMPTY (material_issues = 0) |
| Procurement | `/procurement` | Purchasing | Module: stock (nav: Admin only) | purchase_orders | EMPTY (purchase_orders = 0) |
| Requisitions | `/requisitions` | Purchasing | Role: Admin,Manager,Director | requisitions | EMPTY (requisitions = 0) |
| Supplier Management | `/suppliers` | Purchasing | Module: stock (nav: Admin only) | suppliers | EMPTY (suppliers = 0) |
| Vendor Intelligence | `/vendor-intelligence` | Purchasing | Module: vendor_intelligence (nav: Admin only) | tyre_records | in use (tyre_records = 11,410) |
| Supplier Marketplace | `/marketplace` | Purchasing | Role: Admin (nav: Admin only) | marketplace_listings | EMPTY (marketplace_listings = 0) |
| Contracts | `/contracts` | Purchasing | Role: Admin,Manager,Director | contracts | thin data (contracts = 1) |

### Accidents & Claims

| Module | Route | Sub-group | Route guard (App.jsx) | Main tables / RPCs | Live data status |
|---|---|---|---|---|---|
| Accidents | `/accidents` | - | Flag: accidents_module | accidents (+ accident_case_workstreams, accident_* tables) | thin data (accidents = 43) |
| Accident Cases | `/accident-cases` | - | Role: Admin,Manager,Director | accidents, accident_case_workstreams | thin data (accidents = 43) |
| Incident Reports | `/incidents` | - | Role: Admin,Manager,Director | incident_reports | thin data (incident_reports = 3) |
| Claims Summary | `/claims-summary` | - | Role: Admin,Manager,Director Flag: accidents_module | accidents (claim fields) | thin data (accidents = 43) |
| Insurance Claims | `/insurance-claims` | - | Role: Admin,Manager,Director | insurance_claims | EMPTY (insurance_claims = 0) |
| Insurance Policies | `/insurance-policies` | - | Role: Admin (nav: Admin only) | insurance_policies, insurance_policy_assets, insurance_claim_register | thin data (insurance_policies = 23) |
| Recall Tracker | `/recall-tracker` | - | Role: Admin (nav: Admin only) | recalls | EMPTY (recalls = 0) |
| Accident Workflow | `/accident-workflow-settings` | - | Role: Admin,Manager,Director | departments, accident_routing_rules, accident_email_templates | n/a (aggregate or unmeasured) |

### Finance & Commercial

| Module | Route | Sub-group | Route guard (App.jsx) | Main tables / RPCs | Live data status |
|---|---|---|---|---|---|
| Cost Center | `/cost-center` | Cost | Module: budgets | parts_consumption via get_cost_cpk_overview | in use (parts_consumption = 220,425) |
| Budgets & Cost | `/budgets` | Cost | Module: budgets | budgets | thin data (budgets = 12) |
| Budget Planner | `/budget-planner` | Cost | Module: budgets | budgets, get_parts_expense_snapshot | thin data (budgets = 12) |
| Expenses & CPK | `/expense-report` | Cost | Role: Admin,Manager,Director | parts_consumption, get_cost_cpk_overview, get_cost_variance | in use (parts_consumption = 220,425) |
| Expense Trends | `/expense-trends` | Cost | Role: Admin,Manager,Director | get_expense_period_trend | n/a (aggregate or unmeasured) |
| Cost Scenario Planner | `/cost-scenario-planner` | Cost | Role: Admin,Manager,Director | get_cost_cpk_overview | n/a (aggregate or unmeasured) |
| Cost per M3 | `/cost-per-m3` | Production & Vendor | Role: Admin,Manager,Director | get_cost_per_m3 (parts_consumption, sco_costs, sany_invoices, production_logs) | in use (sco_costs = 672) |
| Production (M3) | `/production-m3` | Production & Vendor | Role: Admin,Manager,Director | production_logs | in use (production_logs = 212,567) |
| SCO Cost | `/sco-costs` | Production & Vendor | Role: Admin,Manager,Director | sco_costs | in use (sco_costs = 672) |
| SANY Invoices | `/sany-invoices` | Production & Vendor | Role: Admin,Manager,Director | sany_invoices, sany_invoice_lines | thin data (sany_invoices = 4) |
| SANY Delay Penalty | `/sany-delay-penalty` | Production & Vendor | Role: Admin,Manager,Director | sany_delay_penalties | EMPTY (sany_delay_penalties = 0) |
| ROI Calculator | `/roi-calculator` | Modelling | Role: Admin,Manager,Director | tyre_records (CPK seed) | in use (tyre_records = 11,410) |
| TCO Calculator | `/tco-calculator` | Modelling | Role: Admin,Manager,Director | tyre_records, vehicle_fleet | in use (tyre_records = 11,410) |
| Tyre-as-a-Service | `/taas` | Modelling | Role: Admin (nav: Admin only) | taas_subscriptions | EMPTY (taas_subscriptions = 0) |
| Customer Portal | `/customer-portal` | Commercial | Role: Admin (nav: Admin only) | customer_accounts | n/a (aggregate or unmeasured) |
| Billing & Subscription | `/billing` | Commercial | Flag: billing (nav: Admin only) | org_subscriptions, invoices, subscription_plans | n/a (aggregate or unmeasured) |

### Analytics & Reports

| Module | Route | Sub-group | Route guard (App.jsx) | Main tables / RPCs | Live data status |
|---|---|---|---|---|---|
| Board Overview | `/board-overview` | Dashboards | Role: Admin,Manager,Director | multi-table aggregates | n/a (aggregate or unmeasured) |
| Executive Report | `/executive-report` | Dashboards | Module: executive_report (nav: Admin only) | tyre_records, loadCostSplit | in use (tyre_records = 11,410) |
| Executive Analytics | `/executive-analytics` | Dashboards | Role: Admin,Manager,Director | tyre_records, inspections, pm_* | in use (tyre_records = 11,410) |
| Analytics | `/analytics` | Dashboards | Module: analytics | tyre_records, report_tyre_summary | in use (tyre_records = 11,410) |
| Advanced Analytics | `/advanced-analytics` | Dashboards | Module: analytics | tyre_records | in use (tyre_records = 11,410) |
| KPI Center | `/kpi` | KPIs | Module: kpi_scorecard | kpi_targets, kpiEngine | thin data (kpi_targets = 7) |
| Engineering KPI | `/kpi-engine` | KPIs | Module: kpi_scorecard | kpiEngine + get_maint_tyre_split | n/a (aggregate or unmeasured) |
| KPI Command Center | `/kpi-command` | KPIs | Module: kpi_scorecard | tyre_records, inspections | in use (tyre_records = 11,410) |
| Performance Benchmark | `/benchmark` | KPIs | Module: analytics (nav: Admin only) | tyre_records | in use (tyre_records = 11,410) |
| SLA Dashboard | `/sla-dashboard` | KPIs | Role: Admin (nav: Admin only) | sla_records | EMPTY (sla_records = 0) |
| Site Comparison | `/site-comp` | Comparison | Module: site_comparison | report_* RPCs | n/a (aggregate or unmeasured) |
| Country Comparison | `/country-comp` | Comparison | Module: country_comparison | report_country_metrics | n/a (aggregate or unmeasured) |
| Comparison | `/comparison` | Comparison | Module: analytics | tyre_records | in use (tyre_records = 11,410) |
| Fleet Analytics | `/fleet` | Comparison | Module: fleet_analytics | tyre_records, vehicle_fleet | in use (tyre_records = 11,410) |
| Fleet Intelligence | `/fleet-intelligence` | Intelligence | Module: fleet_intelligence | tyre_records, vehicle_fleet | in use (tyre_records = 11,410) |
| Ops Intelligence | `/ops-intelligence` | Intelligence | Role: Admin (nav: Admin only) | multi-table | n/a (aggregate or unmeasured) |
| Forecasting Engine | `/forecasting` | Intelligence | Module: forecasting (nav: Admin only) | tyre_records | in use (tyre_records = 11,410) |
| Fleet Optimizer | `/fleet-optimizer` | Intelligence | Role: Admin (nav: Admin only) | fleet_optimizer_scenarios | n/a (aggregate or unmeasured) |
| Carbon Tracker | `/carbon-tracker` | Intelligence | Role: Admin,Manager,Director | carbon_offsets, carbon_initiatives | n/a (aggregate or unmeasured) |
| Continuous Improvement | `/continuous-improvement` | Intelligence | Module: analytics (nav: Admin only) | corrective_actions, rca_records | in use (corrective_actions = 154) |
| Reports | `/reports` | Reporting | Module: reports | tyre_records, inspections, pm_* (wizard) | in use (tyre_records = 11,410) |
| Report Center | `/report-center` | Reporting | Module: reports | report_schedules, accident_report_templates, report_send_log | thin data (report_schedules = 7) |
| Report Sharing | `/report-sharing` | Reporting | Role: Admin (nav: Admin only) | report_shares | thin data (report_shares = 2) |
| Scheduled Reports | `/scheduled-reports` | Reporting | Role: Admin,Manager,Director Flag: report_scheduling | report_schedules | thin data (report_schedules = 7) |
| Dashboard Builder | `/dashboard-builder` | Reporting | Role: Admin (nav: Admin only) | dashboard layouts (localStorage + saved_reports) | n/a (aggregate or unmeasured) |
| TV Display Mode | `/display` | Reporting | Flag: tv_display (own ProtectedRoute, outside the shell) (nav: Admin only) | multi-table (TV kiosk) | n/a (aggregate or unmeasured) |
| Smart Analytics (AI) | `/ai-command-center` | AI | Module: ai_command_center Flag: ai_tools (nav: Admin only) | chat-ai edge fn | n/a (aggregate or unmeasured) |
| Knowledge Base | `/knowledge-base` | AI | Flag: ai_tools (nav: Admin only) | knowledge_documents | EMPTY (knowledge_documents = 0) |
| AI Cost Monitor | `/ai-cost-monitor` | AI | Flag: ai_tools (nav: Admin only) | ai_token_logs, ai_models | in use (ai_token_logs = 104) |

### Automation

| Module | Route | Sub-group | Route guard (App.jsx) | Main tables / RPCs | Live data status |
|---|---|---|---|---|---|
| Event Stream | `/events` | - | Flag: automation_platform (nav: Admin only) | domain_events | in use (domain_events = 222,611) |
| Approval Workflows | `/workflow-settings` | - | Flag: automation_platform (nav: Admin only) | workflow_definitions | thin data (workflow_definitions = 25) |
| Approval Delegations | `/approval-delegations` | - | Flag: automation_platform | approval_delegations | EMPTY (approval_delegations = 0) |
| Approval Matrix | `/approval-matrix` | - | Role: Admin (nav: Admin only) | approval_matrix | EMPTY (approval_matrix = 0) |
| Automation Rules | `/automation-rules` | - | Flag: automation_platform (nav: Admin only) | business_rules | n/a (aggregate or unmeasured) |
| API & Webhooks | `/integrations` | - | Flag: automation_platform (nav: Admin only) | api_keys, webhook_subscriptions | EMPTY (api_keys = 0) |

### Administration

| Module | Route | Sub-group | Route guard (App.jsx) | Main tables / RPCs | Live data status |
|---|---|---|---|---|---|
| Data Intake Center | `/data-intake` | Data | Role: Admin,Manager,Director Flag: data_intake | import_batches, import_rows, import_files | n/a (aggregate or unmeasured) |
| ERP Data Import | `/erp-import` | Data | Role: Admin,Manager,Director | erp_*_import, promote_erp_* RPCs | n/a (aggregate or unmeasured) |
| Data Intake (ERP) | `/erp-intake` | Data | Role: Admin,Manager,Director | parts_consumption, tyre_records, work_orders, vehicle_fleet | in use (parts_consumption = 220,425) |
| Expense Import | `/expense-import` | Data | Role: Admin,Manager,Director | parts_consumption | in use (parts_consumption = 220,425) |
| Upload Approvals | `/upload-approvals` | Data | Flag: data_intake | pending_uploads, import_batches | n/a (aggregate or unmeasured) |
| Data Cleaning | `/cleaning` | Data | Module: data_cleaning | tyre_records (dataCleaning scans) | in use (tyre_records = 11,410) |
| Data Reconciliation | `/data-reconciliation` | Data | Role: Admin,Manager,Director (nav: Admin only) | recon_* RPCs | n/a (aggregate or unmeasured) |
| Custom Data | `/custom-data` | Data | Module: custom_data | custom_field_catalog | n/a (aggregate or unmeasured) |
| ERP Sync | `/erp-sync` | Data | Module: erp_sync Flag: erp_sync | erp_connections | n/a (aggregate or unmeasured) |
| OCR Scanner | `/ocr-scanner` | Data | Role: Admin (nav: Admin only) | ocr_scans | n/a (aggregate or unmeasured) |
| Advanced Search | `/advanced-search` | Data | Role: Admin,Manager,Director | saved_searches | n/a (aggregate or unmeasured) |
| Brand Assets | `/brand-assets` | Organisation | Role: Admin (nav: Admin only) | brand asset registry | n/a (aggregate or unmeasured) |
| Onboarding Wizard | `/onboarding-wizard` | Organisation | Role: Admin (nav: Admin only) | onboarding_tasks | n/a (aggregate or unmeasured) |
| Audit Trail | `/audit` | System | Module: audit_trail | audit_log_v2, access_audit | in use (audit_log_v2 = 578,281) |
| System Health | `/system-health` | System | Role: Admin (nav: Admin only) | system_logs (client checks) | n/a (aggregate or unmeasured) |
| Usage & Adoption | `/tenant-health` | System | Role: Admin (nav: Admin only) | multi-table usage | n/a (aggregate or unmeasured) |
| Developer Portal | `/developer-portal` | System | Role: Admin,Manager,Director,IntegrationAdmin (nav: Admin only) | api_keys | EMPTY (api_keys = 0) |
| Settings | `/settings` | System | authenticated only | profiles, settings | n/a (aggregate or unmeasured) |
| Request Access | `/request-access` | System | authenticated only | request_elevation RPC | n/a (aggregate or unmeasured) |
| Help & Support | `/help` | System | authenticated only | support_tickets | n/a (aggregate or unmeasured) |

## 4. Routes outside the sidebar

| Route | Component | Guard | Purpose |
|---|---|---|---|
| `/login`, `/reset-password` | Login, ResetPassword | public | Sign-in, recovery |
| `/data-deletion` (+ `/delete-account`), `/privacy`, `/terms`, `/support`, `/contact`, `/status` | public pages | public | Play Store / legal / status |
| `/report/:token`, `/workshop-tv/:token`, `/accident-portal/:token` | ReportShare, WorkshopTv, AccidentPortalView | anon, token RPC | Public TV and insurer boards |
| `/accidents/:id`, `/accidents/:id/timeline` | AccidentDetail, AccidentCaseTimeline | Flag: accidents_module | Case workspace (7 workstreams) |
| `/vehicle/:assetNo` | Vehicle360 | Flag: vehicle_360 | Vehicle 360 |
| `/asset-management/:assetNo` | AssetDetail | Module: fleet_master | Asset detail incl. Tyre Bay |
| `/tyre-passport/:serial` | TyrePassport | Module: tyre_passport | Per-tyre passport |
| `/digital-twin/:assetNo`, `/workshop/:jobId`, `/suppliers/:supplierId`, `/driver-management/:driverId`, `/recalls/:recallId` | detail pages | as parent | Drill-downs |
| `/checklists/:templateId/run`, `/checklists/submission/:id`, `/checklist-builder(/:id)` | checklist run/view/build | authenticated (builder self-gates) | Checklist engine |
| `/workflow-settings/builder/:defId?`, `/automation-rules/builder(/:ruleId)` | WorkflowBuilder, RuleBuilder | Flag: automation_platform | Builders |
| `/report-builder` | ReportBuilder | Role: Admin | Report builder (Admin-only rule, project memory 2026-08-16) |
| `/upload`, `/data-intake/history` | UploadData, DataIntakeHistory | Flag: data_intake | Intake sub-pages |
| `/scan`, `/rfid-registry`, `/my-problems`, `/design-system` | misc | mixed | Field scan, legacy RFID page, issue list, design system |

## 5. System Console (`/console/*`, super-admin, separate tab session)

| Area | Section | Entry | Route | Notes |
|---|---|---|---|---|
| Monitor | Overview | Overview | `/console` | Attention panel ("Waiting on you") |
| Monitor | Overview | System Health | `/console/health` | `system_logs`, health score |
| Monitor | Overview | Platform Map | `/console/platform-map` | Plain-English map of every module + NOT_BUILT gaps (`src/lib/platformMap.js`) |
| Monitor | Analytics | Analytics | `/console/analytics` | Usage |
| Monitor | Alert Center | Alert Center | `/console/alerts` | Alert rules + crash alerts |
| Platform | Users | Users | `/console/users` | Users, sessions, devices, account deletions, support sessions (tabs) |
| Platform | Organizations | Organizations | `/console/organisations` | Orgs, hierarchy (`org_units` = 0 rows), holding company |
| Platform | Billing | Billing | `/console/billing` | Plans, subscriptions (billing not live) |
| Platform | Operations | Operations | `/console/operations` | Module Control (`modules` = 194 rows), navigation editor, vehicle designer, mobile app control, smart import |
| Trust | Access Control | Access Control / Reviews / JIT Elevation / Access Policies / Approvals | `/console/access`, `/access-reviews`, `/jit-elevation`, `/access-policies`, `/approvals` | Role matrix, custom roles (32), per-user grants (85), effective access, four-eyes (OFF) |
| Trust | Security | Security Audit / Sign-in & SSO / Compliance | `/console/security-audit`, `/security`, `/compliance` | Posture score, SSO, SOC2/ISO evidence |
| Trust | Audit Logs | Audit Trail / Audit Integrity | `/console/audit-trail`, `/audit-integrity` | Unified audit viewer, hash-chained seals |
| Runtime | Notifications | Notifications | `/console/notifications` | Delivery, push receipts |
| Runtime | API Monitor | API Monitor | `/console/api-keys` | `api_keys` = 0 rows |
| Runtime | Database | Database Center, Data Browser, Backups, Data Trust & Control, Data Quality, Reconciliation, Correction Center, Lineage | `/console/database/*` (legacy paths redirect) | Metric registry (12), quality rules (10), lineage edges (36), backups, cleanup, duplicates, material master, classification learning |
| Runtime | Storage / Error Center | Storage, Error Center | `/console/storage`, `/console/crash-reports` | Sentry issues proxy |
| Engineering | - | Developer, Releases, Feature Flags, System Settings | `/console/developer`, `/releases`, `/flags`, `/config` | Flutter version gate, releases, flags, `system_config` |

Main-app pages hosted verbatim in the console via `src/console/ConsoleAuthBridge.jsx`: PermissionMatrix, AccessGrantsManager, CustomRolesManager, SecurityCenter, UserManagement, AiAdministration, SsoConfiguration. Coverage tests: `src/test/consoleModuleCoverage.test.js`, `consolePagesSmoke.render.test.jsx`, `platformMap.test.js`.

## 6. Mobile modules (Flutter current, Expo legacy)

Flutter `ModuleRegistry.all` and Expo `mobile/lib/permissions.ts MODULES` share the same 32 keys; `src/lib/mobileModules.js` mirrors them for the web Access Manager and a drift test parses both. Mobile grants are stored as `mobile:<key>` in `module_permissions` / `user_access_grants`; they do NOT feed `app_user_can` (server RLS uses bare web keys).

| Group | Key | Label | Default roles (admin/super always allowed) | Flutter feature dir |
|---|---|---|---|---|
| Field | inspect | New Inspection | manager, director, inspector, tyreMan | `features/inspections` |
| Field | scan | Scan | + mechanic, electrician | `features/scanning` |
| Field | serial | Serial Search | nearly all field roles incl. driver, reporter | `features/search`, `records` |
| Field | tyreChange | Tyre Change | manager, director, inspector | `features/tyre_exchange` |
| Field | checklists | Checklists | most field and supervisor roles incl. driver | `features/checklists` |
| Field | meter | Meter Log | most field roles incl. driver | `features/meter_logs` |
| Field | washing | Vehicle Washing | manager, director, inspector, driver, tyreMan | `features/washing` |
| Field | reportIssue | Report Issue | reporter, driver, trades, supervisors | `features/report_issue`, `problem_report` |
| Field | repairRequest | Repair Request | field roles + trades | `features/extras` |
| Fleet | records | Tyre Records | admin only (bulk listing rule) | `features/records` |
| Fleet | vehicles | Vehicles | field roles (opened 2026-08-05) | `features/assets` |
| Fleet | history | History | admin only | `features/assets` |
| Fleet | alerts | Alerts | manager, director, inspector | `features/alerts` |
| Fleet | calendar | Calendar | manager, director, tyreMan, reporter, supervisors | `features/calendar` |
| Maintenance | accidents / reportAccident | Accidents / File Accident | manager, director, inspector (+ fleetSupervisor) | `features/accidents` |
| Maintenance | workorders | Work Orders | admin only | `features/work_orders` |
| Maintenance | rca / tasks | Root Cause / Tasks | manager, director, inspector | `features/rca`, `tasks` |
| Maintenance | stock | Stock Count | manager, inspector | `features/stock_count` |
| Maintenance | pm | Maintenance Due | manager, director | `features/preventive_maintenance` |
| Maintenance | workshop | My Jobs | field + trades | `features/workshop` |
| Maintenance | workshopStatus | Workshop Status | trades, supervisors, managers | `features/workshop_status` |
| Management | overview, reports, analytics, stockManage, ai, team | management views | admin only (data-heavy, project memory 2026-07-26) | `features/management`, `home` |
| Admin | approvals | Approvals | director + supervisor roles + tyreDataCollector | `features/approvals` |
| Admin | admin, users | Admin Console, User Management | admin only | `features/admin` |

Flutter-only feature dirs with no module key: `auth`, `driver_workspace`, `my_work`, `notifications`, `profile`, `qr_login`, `tyre_diagram`, `home`.

## 7. Modules that are complete interfaces over EMPTY tables (live 2026-11-10)

Fleet movement and logistics: fleet groups, combinations, customers, batteries, check-in/out, handovers, reservations, GPS, trips, trip replay, journeys, route optimisation, geofences, dispatch, load planning, telematics devices, cold chain, weighbridge, proof of delivery, toll transactions, fuel cards, fuel delivery, fuel transactions, EV charging, IFTA.
Tyre lifecycle: rotations, TPMS, tyre service events, tyre pool, retread jobs, retread claims, warranty claims, tyre disposals.
Workshop: bay schedules, service requests, breakdown callouts, repair requests, PM programs and PM service records (0 rows despite the full PM module), DTC codes, shifts, parts requests, equipment, workforce employees and assignments.
Compliance and drivers: alerts, alert thresholds, DVIR, certifications, policies, emissions, hours of service, tachograph, driver documents/training/coaching/expenses, dashcam events, fuel theft alerts.
Procurement: suppliers, purchase orders, requisitions, goods receipts, materials, parts catalog, material issues, marketplace.
Other: insurance claims ledger, recalls, fleet renewal plans, approval matrix, approval delegations, API keys, knowledge documents (RAG has no documents), org units, user org assignments, currency rates (no FX rates entered), TaaS subscriptions, `fleet_master` (legacy table, see doc 03).

## Open decisions for the owner

- Which empty modules to hide from the sidebar per tenant (Module Control can set status Off) versus keep visible as "not in use" (`src/components/ui/NotInUseNotice.jsx`).
- Whether management modules (overview, reports, analytics) should open on mobile for managers once server aggregates exist (V479 `get_mobile_analytics` covers analytics only).

## Next actions

| Action | Phase | Effort |
|---|---|---|
| Generate this inventory in CI from the same sources (script) so it cannot drift | 1 | S |
| Add a per-module "data owner" and "business purpose" column (spec section 1 fields not derivable from code) with the owner | 1 | M |
| Use Module Control to set status Off for unused logistics/telematics modules per tenant | 1 | S |
| Fix the 4 readers of the empty `fleet_master` table (doc 03 D1) | 1 | S |
