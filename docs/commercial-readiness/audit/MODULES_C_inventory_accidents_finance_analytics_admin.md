# Module workflow audit C: Inventory, Accidents, Finance, Analytics, Automation, Administration

Date: 2026-11-12. Auditor scope: the six web menu groups named above (NAV_GROUPS in `src/components/Layout.jsx` on the working tree, compared with `origin/main`), plus routes in `src/App.jsx` on the same subjects that have no menu item. Read-only audit. Database access was SELECT on catalog tables, counts and function source only. No customer records are quoted.

Machine-readable copy: `docs/commercial-readiness/audit/modules_C.json`.

## 1. Method and limits

- For every module: route and guard read in `src/App.jsx`; page and service files read or searched; tables, RPCs, CHECK constraints, NOT NULL columns, column defaults, unique indexes, triggers and RLS policies read from the live catalog; insert payloads compared with those constraints.
- VERIFIED means the evidence is a file and line, a catalog result, or function source read in this audit. PLAUSIBLE means inferred from code without a run. NOT VERIFIED items are listed in section 9.
- No page was opened in a browser and no write was executed, so "save works" is a static conclusion (payload against constraints and policies), not an observed one.
- Tyre and cost formula correctness is out of scope here: see ENGINEERING_CALCULATIONS. Billing and onboarding depth and the restore decision for switched-off modules belong to other reports; they are referenced, not repeated.
- Three existing test files were run to confirm what the tests exercise: `kpiTargets.api.test.js`, `budgets.api.test.js`, `scheduledReports.api.test.js` (24 tests, all pass). They assert call shapes against a mocked client and cannot see the live unique indexes or RLS, which is exactly where findings MODC-03 and MODC-04 sit.

## 2. Two verdicts

**Internal Production Readiness (current company, one tenant, three countries):** 73 modules ready, 19 at risk, 1 broken, of 93 audited entries. The daily-use modules in these groups (Stock, Accidents, Expenses and CPK, Board Overview, Reports, Scheduled Reports, Data Intake, Audit, Settings) work for the current company. The internal problems are narrow: KPI target re-save, budget saving for non-admin roles, the blended-currency scheduled executive email, the TCO benchmark and savings figures, and Stock Replenishment reading an empty legacy table (switched off).

**Commercial SaaS Readiness (a different company starting from zero):** not ready in these groups without the fixes in section 3. Counts by class: class 1 (Commercially ready): 1; class 2 (Functional but requires customer setup or data): 30; class 3 (Needs functional or data-quality repairs): 28; class 4 (Incomplete or future development): 11; class 5 (Duplicate requiring controlled consolidation): 13; class 6 (Internal administrator-only or legacy): 10.

The pattern is consistent: organisation isolation by row (RLS with `app_current_org()`) is in place on every business table checked, but a layer of GLOBAL objects sits beside it (system_config, settings, modules, site_aliases, unique indexes without organisation, shared sequences, one accident mailbox, one company logo). Those are harmless with one tenant and become leaks or collisions with two.

## 3. Cross-cutting findings

### MODC-01 Accident emails use one global mailbox
- Severity: P0. Confidence: VERIFIED.
- Evidence: DB functions consume_event_accident_notify and consume_event_accident_case_notify read system_config keys accident_email_to / accident_email_cc (global table, no organisation column); system_config.accident_emails_enabled = true.
- What happens: Accident emails for every organisation go to ONE global mailbox list. A second company filing an accident would email its case details to the current company mailbox. VERIFIED (function source + config).
- Impact on selling to a second company: A second company would leak accident case details (asset, site, driver context, costs) to the first company. Blocks selling the accident module.
- Internal status: ready. Commercial: blocks or degrades the modules that cite this ID.
- Recommended fix: Store accident mail settings per organisation (organisations.settings or a per-organisation table); consumers read by the event organisation; refuse to send when the organisation has none.
- Risk to the current company: low: copy the current global values into the current organisation before switching the reader.
- Acceptance test: Two test organisations with different mailboxes: an accident in B queues mail only to B recipients; with no B mailbox nothing is queued.
- Implementation area: DB.

### MODC-02 Public boards show a global company name and logo
- Severity: P1. Confidence: VERIFIED.
- Evidence: get_report_snapshot, get_workshop_snapshot, get_report_tyre_maintenance read public.settings key company_name and system_config key company_logo (both global).
- What happens: Public share boards and TV links print one global company name and logo for every organisation. VERIFIED.
- Impact on selling to a second company: Customer-facing TV and share links of company B display company A branding.
- Internal status: ready. Commercial: blocks or degrades the modules that cite this ID.
- Recommended fix: Read name and logo from the token organisation (get_org_branding logic) inside the three snapshot RPCs.
- Risk to the current company: low: confirm the current organisation branding row carries its name and logo first.
- Acceptance test: Share token minted in organisation B returns B name and logo; A unchanged.
- Implementation area: DB.

### MODC-03 KPI targets cannot be re-saved and collide across companies
- Severity: P1. Confidence: VERIFIED.
- Evidence: src/lib/api/kpiTargets.js:44 and src/lib/api/settings.js:61 upsert onConflict metric,year,month,site; live index kpi_targets_scope_uidx (metric, year, COALESCE(month,0), COALESCE(site,''), lower(country)) has no organisation column; src/pages/KpiScorecard.jsx:262 and src/pages/Settings.jsx:516 send month and site as NULL.
- What happens: KPI targets cannot be re-saved: NULL month/site never match the conflict target, so the second save is an INSERT that hits the scope unique index (23505). The same index also blocks any second organisation from saving the same metric and year. Existing 7 rows were last written 2026-06-08. VERIFIED statically (code + catalog), not executed.
- Impact on selling to a second company: Target setting is a first-week action for a new company; it fails for the second save and for a second tenant.
- Internal status: at risk (save path broken on second save; display works). Commercial: blocks or degrades the modules that cite this ID.
- Recommended fix: Rebuild both unique indexes to include organisation_id with NULLS NOT DISTINCT (or coalesced columns) and upsert on that same key; role-gate the editor to the roles RLS allows.
- Risk to the current company: low: 7 rows, same values kept.
- Acceptance test: Save targets twice in one year as Manager: second save updates in place. Two organisations hold the same metric and year.
- Implementation area: DB, web.

### MODC-04 Budget key is global and Managers get a refused save
- Severity: P1. Confidence: VERIFIED.
- Evidence: unique index budgets_site_region_year_month_key (site, region, year, month) has no organisation column; src/lib/api/budgets.js:54,64 and src/pages/BudgetPlanner.jsx:425 upsert on it; budgets INSERT/UPDATE policies allow role Admin (or an explicit capability grant) only; src/pages/Budgets.jsx has no role gate.
- What happens: Two companies with the same site name and month collide on one global key. Inside the current company a Manager or Director sees the editor on /budgets and the save is refused by RLS. VERIFIED (catalog + code).
- Impact on selling to a second company: Budget collisions between companies with common site names; confusing failure for non-admin roles.
- Internal status: at risk. Commercial: blocks or degrades the modules that cite this ID.
- Recommended fix: Add organisation_id to the unique key and to the upsert conflict target; hide or disable editing for roles RLS will refuse (or widen the policy on purpose).
- Risk to the current company: low: 12 rows; index swap inside one migration.
- Acceptance test: Two organisations save the same site and month; a Manager sees read-only or a successful save, never an RLS error.
- Implementation area: DB, web.

### MODC-05 Scheduled executive email blends currencies and uses a different cost source
- Severity: P1. Confidence: VERIFIED.
- Evidence: supabase/functions/send-scheduled-reports/index.ts:1197-1202 (systemCurrency reads system_config.default_currency = SAR), :249-253 report_exec_digest; DB function report_exec_digest sums cost_per_tyre*qty across all countries of the org; :119-193 fixed Riyadh time.
- What happens: Scheduled executive emails add SAR + AED + EGP into one figure and label it with one global currency; spend comes from tyre_records.cost_per_tyre, not the expense grid used on screen; send times are fixed to Riyadh. VERIFIED.
- Impact on selling to a second company: A scheduled report is the artefact a buyer forwards to management; a blended total labelled SAR is wrong for any multi-country or non-SAR tenant.
- Internal status: at risk (current tenant has three currencies). Commercial: blocks or degrades the modules that cite this ID.
- Recommended fix: Render one section per country with its own currency (same rule as the web app), source spend from the expense grid RPC, take timezone from the organisation.
- Risk to the current company: medium: figures in the email will change; announce before deploy.
- Acceptance test: A schedule for an organisation with AED and EGP data shows two sections and no combined total; totals equal the Expenses page for the same window.
- Implementation area: edge fn, DB.

### MODC-06 Accident form hard-codes the current company and Saudi institutions
- Severity: P1. Confidence: VERIFIED.
- Evidence: src/lib/accidentVocab.js:48,50,142,161,162 (NAJM/TAQDEER options, INTERNAL_WORKSHOPS = GCC Workshop, LIABLE_PARTY_OPTS = GCC / Other Party, PAYER_OPTS = GCC / Insurance / Recovery Claim).
- What happens: The accident form hard-codes the current company abbreviation (GCC) as liable party and payer, plus Saudi-only Najm and Taqdeer fields. VERIFIED.
- Impact on selling to a second company: Another company sees GCC as itself in liable party and payer lists and Saudi-only report fields.
- Internal status: ready. Commercial: blocks or degrades the modules that cite this ID.
- Recommended fix: Replace GCC with the organisation name token (stored value stays a neutral code such as own_company), make Najm / Taqdeer fields a country pack shown for KSA only.
- Risk to the current company: low: keep reading the legacy GCC value as own company.
- Acceptance test: Organisation B in another country sees its own name and no Najm / Taqdeer fields; existing records still display.
- Implementation area: web, DB.

### MODC-07 Module Control is global and writable by any organisation Admin
- Severity: P1. Confidence: VERIFIED.
- Evidence: public.modules has no organisation column; policy modules ALL PERMISSIVE: is_super_admin() OR get_my_role() = Admin.
- What happens: Module Control status is one global switch for every organisation and any organisation Admin passes the write policy. See the module-restore agent report; listed here because every route guard in this report depends on it. VERIFIED (catalog).
- Impact on selling to a second company: One customer can switch a module off for every customer. Owned by the module-restore agent.
- Internal status: ready. Commercial: blocks or degrades the modules that cite this ID.
- Recommended fix: Per-organisation module status with a platform default.
- Risk to the current company: low.
- Acceptance test: Admin of B disables a module: A unaffected.
- Implementation area: DB, console.

### MODC-08 Global unique keys and shared number sequences
- Severity: P2. Confidence: VERIFIED.
- Evidence: unique indexes without organisation: supplier_ratings_brand_country_key, recall_number_country_uniq, purchase_orders_po_number_key, work_orders_work_order_no_key; generate_po_number and generate_work_order_no use one global sequence.
- What happens: Document numbers and brand ratings share one namespace across companies: cross-tenant save collisions (ratings, recalls) and shared PO / work order number sequences. VERIFIED (catalog).
- Impact on selling to a second company: Save failures for a second tenant on ratings and recalls; PO and work order numbers interleave between companies.
- Internal status: ready. Commercial: blocks or degrades the modules that cite this ID.
- Recommended fix: Add organisation_id to the four unique keys; per-organisation counters for PO and work order numbers.
- Risk to the current company: low for keys; medium for work order numbering (imports upsert on work_order_no, keep the existing numbers).
- Acceptance test: Two organisations rate the same brand in the same country; each has its own PO-YYYY-00001.
- Implementation area: DB.

### MODC-09 Nine tables accept writes from any signed-in member
- Severity: P2. Confidence: VERIFIED.
- Evidence: INSERT/UPDATE policies equal to auth.uid() IS NOT NULL on goods_receipts, incident_reports, materials, requisitions, sla_records, ocr_scans, onboarding_tasks, fleet_optimizer_scenarios, suppliers.
- What happens: Route guards restrict these pages to Admin or Admin/Manager/Director, but the database lets any signed-in user of the organisation insert and update rows through the API. Organisation isolation still holds. VERIFIED (catalog).
- Impact on selling to a second company: Role separation shown in the UI is not enforced by the database for these registers.
- Internal status: at risk (low exposure: tables are mostly empty). Commercial: blocks or degrades the modules that cite this ID.
- Recommended fix: Replace auth.uid() IS NOT NULL with the role or capability check the route uses.
- Risk to the current company: low.
- Acceptance test: A Driver token cannot insert into requisitions, materials, sla_records and the rest; Manager still can.
- Implementation area: DB.

### MODC-10 Site names rewritten by current-company rules
- Severity: P2. Confidence: VERIFIED.
- Evidence: trigger function normalize_site(): upper-cases, applies global site_aliases, strips a trailing -ST or _ST.
- What happens: Site names are rewritten by rules built for the current company (store suffix -ST) for every tenant. VERIFIED (function source).
- Impact on selling to a second company: A tenant site called NORTH-ST becomes NORTH; global aliases can rename a tenant site.
- Internal status: ready. Commercial: blocks or degrades the modules that cite this ID.
- Recommended fix: Scope site_aliases by organisation and make the -ST strip an alias rule of the current organisation.
- Risk to the current company: low if the current organisation keeps its aliases.
- Acceptance test: Insert site WEST-ST in organisation B: stored unchanged; current organisation behaviour unchanged.
- Implementation area: DB.

### MODC-11 Null-organisation report schedules are shared
- Severity: P2. Confidence: VERIFIED.
- Evidence: report_schedules policies: INSERT/UPDATE WITH CHECK allow org_id IS NULL; SELECT allows org_id IS NULL rows for everyone; no restrictive organisation policy.
- What happens: A schedule saved with no organisation (possible through the API) is visible, editable and deletable by managers of every organisation, including its recipient list. The client and the edge function now refuse null organisation; the policy does not. VERIFIED (catalog).
- Impact on selling to a second company: Recipient lists and schedule names could cross tenants through the API.
- Internal status: ready (0 null rows today). Commercial: blocks or degrades the modules that cite this ID.
- Recommended fix: Make org_id NOT NULL with a default of app_current_org() and add a restrictive organisation policy.
- Risk to the current company: none.
- Acceptance test: Insert with org_id null is refused; a Manager in B cannot read a schedule of A.
- Implementation area: DB.

### MODC-12 No starter configuration for a new organisation
- Severity: P2. Confidence: VERIFIED for the counts, PLAUSIBLE for the absence of seeding.
- Evidence: workflow_definitions 25 rows, departments 12, accident_routing_rules 7, accident_email_templates and approval_policies 3: all belong to one organisation; no seeding function found for a new organisation.
- What happens: A new company starts with no approval workflows, no accident departments, routing rules or email templates. Pages open empty and the related automation does nothing until an admin builds each from scratch. VERIFIED counts; absence of seeding is PLAUSIBLE (searched pages and RPC names only).
- Impact on selling to a second company: Approvals and accident routing do nothing on day one; setup effort is high and undocumented.
- Internal status: ready. Commercial: blocks or degrades the modules that cite this ID.
- Recommended fix: Seed starter workflows, departments, routing rules and templates at organisation creation (from the existing starter templates).
- Risk to the current company: none (additive).
- Acceptance test: A new organisation has working default approval and accident routing after creation.
- Implementation area: DB.

### MODC-13 KSA, SAR and three-country assumptions
- Severity: P2. Confidence: VERIFIED.
- Evidence: column defaults KSA / SAR on budgets, kpi_targets, stock_records, insurance_policies, insurance_claim_register, sany_delay_penalties (rate_per_hour 43); src/contexts/SettingsContext.jsx:21-22 COUNTRIES = KSA, UAE, Egypt and COUNTRY_CURRENCY.
- What happens: Country list, currency map and several column defaults are fixed to the current company footprint. A company outside these three countries gets KSA defaults on rows where the client omits country. VERIFIED.
- Impact on selling to a second company: Rows silently default to KSA; only three countries can be selected in several pickers.
- Internal status: ready. Commercial: blocks or degrades the modules that cite this ID.
- Recommended fix: Drive countries and currencies from organisation configuration; drop KSA / SAR column defaults in favour of the user or organisation default.
- Risk to the current company: low: current organisation keeps the same three countries as configuration.
- Acceptance test: An organisation in another country creates budgets, stock and policies with its own country and currency.
- Implementation area: DB, web.

### MODC-14 Public report links without password or expiry
- Severity: P3. Confidence: VERIFIED.
- Evidence: report_shares: 2 active rows, password_hash null, expires_at null, view_count 230 and 25.
- What happens: Live public report links have no password and no expiry. Optional by design; flagged for the current company. VERIFIED.
- Impact on selling to a second company: Low for sales; a data exposure choice for the current company.
- Internal status: at risk. Commercial: blocks or degrades the modules that cite this ID.
- Recommended fix: Default new links to an expiry; prompt for a password.
- Risk to the current company: none.
- Acceptance test: New link has an expiry by default.
- Implementation area: web.

## 4. Module register

Internal: ready / at risk / broken. Class: commercial class 1 to 6. OFF = switched off in Module Control today (public.modules status disabled).

### Inventory & Procurement

| Module | Route | Guard | Internal | Class | Priority | Defect IDs |
|---|---|---|---|---|---|---|
| Stock | `/stock` | ModuleRoute moduleKey="stock" StockManagement  /ModuleRoute  | ready | 2 | P2 | MODC-13, MODC-10, MODC-20 |
| Stock Replenishment (OFF) | `/stock-replenishment` | RoleRoute allowed={['Admin', 'Manager', 'Director']} StockReplenishmen | broken | 3 | P1 | MODC-21 |
| Parts Catalog (OFF) | `/parts-catalog` | RoleRoute allowed={['Admin', 'Manager', 'Director']} PartsCatalog  /Ro | ready | 2 | P3 | MODC-22 |
| Materials (OFF) | `/materials` | RoleRoute allowed={['Admin']} Materials  /RoleRoute  | ready | 5 | P2 | MODC-09, MODC-23 |
| Goods Receipt (OFF) | `/goods-receipt` | RoleRoute allowed={['Admin', 'Manager', 'Director']} GoodsReceipt  /Ro | at risk | 3 | P2 | MODC-09, MODC-24 |
| Material Issue (MIS) | `/store-material-issue` | RoleRoute allowed={['Admin', 'Manager', 'Director']} moduleKey="store_ | ready | 3 | P2 | MODC-25 |
| Procurement | `/procurement` | ModuleRoute moduleKey="stock" Procurement  /ModuleRoute  | ready | 2 | P2 | MODC-08, MODC-26, MODC-27 |
| Requisitions (OFF) | `/requisitions` | RoleRoute allowed={['Admin', 'Manager', 'Director']} Requisitions  /Ro | at risk | 3 | P3 | MODC-09, MODC-28 |
| Supplier Management | `/suppliers` | ModuleRoute moduleKey="stock" SupplierManagement  /ModuleRoute  | at risk | 3 | P2 | MODC-29, MODC-08 |
| Vendor Intelligence (OFF) | `/vendor-intelligence` | ModuleRoute moduleKey="vendor_intelligence" VendorIntelligence  /Modul | at risk | 3 | P3 | MODC-30 |
| Supplier Marketplace (OFF) | `/marketplace` | RoleRoute allowed={['Admin']} SupplierMarketplace  /RoleRoute  | ready | 4 | P2 | MODC-31 |
| Contracts | `/contracts` | RoleRoute allowed={['Admin', 'Manager', 'Director']} Contracts  /RoleR | ready | 2 | P3 | MODC-32 |
| Supplier detail, Recall detail, workflow and rule builders (no menu) | `/suppliers/:supplierId` | ModuleRoute stock; RoleRoute Admin; FlagRoute automation_platform | ready | 2 | P3 | none |

### Accidents & Claims

| Module | Route | Guard | Internal | Class | Priority | Defect IDs |
|---|---|---|---|---|---|---|
| Accidents | `/accidents` | FlagRoute flag="accidents_module" Accidents  /FlagRoute  | ready | 3 | P0 | MODC-01, MODC-06, MODC-12, MODC-33 |
| Accident Cases | `/accident-cases` | RoleRoute allowed={['Admin', 'Manager', 'Director']} AccidentCases  /R | ready | 3 | P2 | MODC-12 |
| Incident Reports | `/incidents` | RoleRoute allowed={['Admin', 'Manager', 'Director']} IncidentReports   | at risk | 5 | P3 | MODC-09, MODC-34 |
| Claims Summary | `/claims-summary` | RoleRoute allowed={['Admin', 'Manager', 'Director']} FlagRoute flag="a | ready | 2 | P3 | MODC-35 |
| Insurance Claims (OFF) | `/insurance-claims` | RoleRoute allowed={['Admin', 'Manager', 'Director']} InsuranceClaims   | ready | 5 | P3 | MODC-36 |
| Insurance Policies | `/insurance-policies` | RoleRoute allowed={['Admin']} InsurancePolicies  /RoleRoute  | ready | 3 | P2 | MODC-13, MODC-37, MODC-38 |
| Recall Tracker (OFF) | `/recall-tracker` | RoleRoute allowed={['Admin']} RecallTracker  /RoleRoute  | ready | 2 | P3 | MODC-08 |
| Accident Workflow | `/accident-workflow-settings` | RoleRoute allowed={['Admin', 'Manager', 'Director']} AccidentWorkflowS | ready | 3 | P0 | MODC-01, MODC-12, MODC-39 |
| Insurer case portal (no menu) | `/accident-portal/:token` | none (anonymous, token RPC) | ready | 2 | P3 | none |
| Accident detail and timeline (no menu) | `/accidents/:id` | FlagRoute accidents_module | ready | 3 | P1 | MODC-06 |

### Finance & Commercial

| Module | Route | Guard | Internal | Class | Priority | Defect IDs |
|---|---|---|---|---|---|---|
| Cost Center | `/cost-center` | ModuleRoute moduleKey="budgets" CostCenter  /ModuleRoute  | ready | 2 | P3 | MODC-40 |
| Budgets & Cost | `/budgets` | ModuleRoute moduleKey="budgets" Budgets  /ModuleRoute  | at risk | 3 | P1 | MODC-04, MODC-13, MODC-41 |
| Budget Planner | `/budget-planner` | ModuleRoute moduleKey="budgets" BudgetPlanner  /ModuleRoute  | at risk | 3 | P1 | MODC-04 |
| Expenses & CPK | `/expense-report` | RoleRoute allowed={['Admin', 'Manager', 'Director']} ExpenseReport  /R | ready | 2 | P2 | MODC-42 |
| Expense Trends | `/expense-trends` | RoleRoute allowed={['Admin', 'Manager', 'Director']} ExpenseTrends  /R | ready | 2 | P3 | none |
| Cost Scenario Planner | `/cost-scenario-planner` | RoleRoute allowed={['Admin', 'Manager', 'Director']} CostScenarioPlann | ready | 1 | P3 | none |
| Cost per M3 | `/cost-per-m3` | RoleRoute allowed={['Admin', 'Manager', 'Director']} CostPerM3  /RoleR | ready | 6 | P1 | MODC-43 |
| Production (M3) | `/production-m3` | RoleRoute allowed={['Admin', 'Manager', 'Director']} ProductionM3  /Ro | ready | 6 | P2 | MODC-10, MODC-44 |
| SCO Cost | `/sco-costs` | RoleRoute allowed={['Admin', 'Manager', 'Director']} ScoCosts  /RoleRo | ready | 6 | P2 | MODC-45 |
| SANY Invoices | `/sany-invoices` | RoleRoute allowed={['Admin', 'Manager', 'Director']} SanyInvoices  /Ro | ready | 6 | P2 | MODC-46 |
| SANY Delay Penalty | `/sany-delay-penalty` | RoleRoute allowed={['Admin', 'Manager', 'Director']} SanyDelayPenalty  | ready | 6 | P2 | MODC-47 |
| ROI Calculator | `/roi-calculator` | RoleRoute allowed={['Admin', 'Manager', 'Director']} RoiCalculator  /R | ready | 2 | P3 | MODC-48 |
| TCO Calculator | `/tco-calculator` | RoleRoute allowed={['Admin', 'Manager', 'Director']} TcoCalculator  /R | at risk | 3 | P2 | MODC-49, MODC-50 |
| Tyre-as-a-Service (OFF) | `/taas` | RoleRoute allowed={['Admin']} Taas  /RoleRoute  | ready | 4 | P3 | MODC-51 |
| Customer Portal (OFF) | `/customer-portal` | RoleRoute allowed={['Admin']} CustomerPortal  /RoleRoute  | ready | 4 | P2 | MODC-52 |
| Billing & Subscription | `/billing` | FlagRoute flag="billing" Billing  /FlagRoute  | at risk | 4 | P1 | MODC-53 |

### Analytics & Reports

| Module | Route | Guard | Internal | Class | Priority | Defect IDs |
|---|---|---|---|---|---|---|
| Board Overview | `/board-overview` | RoleRoute allowed={['Admin', 'Manager', 'Director']} BoardOverview  /R | ready | 2 | P3 | MODC-54 |
| Executive | `/executive` | ExecutiveLanding   then page guards | ready | 5 | P3 | MODC-54 |
| Advanced Analytics | `/advanced-analytics` | ModuleRoute moduleKey="analytics" AdvancedAnalytics  /ModuleRoute  | ready | 5 | P3 | MODC-54 |
| KPI Center | `/kpi` | ModuleRoute moduleKey="kpi_scorecard" KpiScorecard  /ModuleRoute  | at risk | 3 | P1 | MODC-03, MODC-13, MODC-55, MODC-54 |
| Performance Benchmark | `/benchmark` | ModuleRoute moduleKey="analytics" PerformanceBenchmark  /ModuleRoute  | ready | 3 | P3 | MODC-56 |
| SLA Dashboard (OFF) | `/sla-dashboard` | RoleRoute allowed={['Admin']} SlaDashboard  /RoleRoute  | ready | 4 | P3 | MODC-09, MODC-57 |
| Site Comparison | `/site-comp` | ModuleRoute moduleKey="site_comparison" SiteComparison  /ModuleRoute  | ready | 2 | P3 | none |
| Country Comparison | `/country-comp` | ModuleRoute moduleKey="country_comparison" CountryComparison  /ModuleR | ready | 3 | P3 | MODC-13 |
| Fleet Analytics | `/fleet` | ModuleRoute moduleKey="fleet_analytics" FleetAnalytics  /ModuleRoute  | ready | 5 | P3 | MODC-54 |
| Fleet Intelligence | `/fleet-intelligence` | ModuleRoute moduleKey="fleet_intelligence" FleetIntelligence  /ModuleR | ready | 5 | P3 | MODC-54 |
| Ops Intelligence | `/ops-intelligence` | RoleRoute allowed={['Admin']} OpsIntelligence  /RoleRoute  | ready | 5 | P3 | MODC-54 |
| Forecasting Engine | `/forecasting` | ModuleRoute moduleKey="forecasting" ForecastingEngine  /ModuleRoute  | ready | 2 | P3 | none |
| Fleet Optimizer (OFF) | `/fleet-optimizer` | RoleRoute allowed={['Admin']} FleetOptimizer  /RoleRoute  | ready | 4 | P3 | MODC-09, MODC-58 |
| Carbon Tracker (OFF) | `/carbon-tracker` | RoleRoute allowed={['Admin', 'Manager', 'Director']} CarbonTracker  /R | at risk | 3 | P2 | MODC-59, MODC-60 |
| Continuous Improvement | `/continuous-improvement` | ModuleRoute moduleKey="analytics" ContinuousImprovement  /ModuleRoute  | ready | 5 | P3 | MODC-54 |
| Reports | `/reports` | ModuleRoute moduleKey="reports" Reports  /ModuleRoute  | ready | 2 | P3 | MODC-61, MODC-62 |
| Report Center | `/report-center` | ModuleRoute moduleKey="reports" ReportCenter  /ModuleRoute  | ready | 2 | P3 | none |
| Report Sharing | `/report-sharing` | RoleRoute allowed={['Admin']} ReportSharing  /RoleRoute  | ready | 3 | P1 | MODC-02, MODC-14, MODC-63 |
| Scheduled Reports | `/scheduled-reports` | RoleRoute allowed={['Admin', 'Manager', 'Director']} FlagRoute flag="r | at risk | 3 | P1 | MODC-05, MODC-11, MODC-64, MODC-65 |
| Dashboard Builder | `/dashboard-builder` | RoleRoute allowed={['Admin']} DashboardBuilder  /RoleRoute  | ready | 2 | P3 | MODC-66 |
| TV Display Mode | `/display` | ProtectedRoute + FlagRoute tv_display (src/App.jsx:613-619), outside t | ready | 2 | P3 | none |
| Smart Analytics (AI) | `/ai-command-center` | FlagRoute flag="ai_tools" ModuleRoute moduleKey="ai_command_center" Ai | at risk | 3 | P2 | MODC-67 |
| Knowledge Base | `/knowledge-base` | FlagRoute flag="ai_tools" KnowledgeBase  /FlagRoute  | ready | 2 | P3 | MODC-68 |
| AI Cost Monitor | `/ai-cost-monitor` | FlagRoute flag="ai_tools" AiCostMonitor  /FlagRoute  | ready | 6 | P3 | MODC-69 |
| Public report board (no menu) | `/report/:token` | none (anonymous, token RPC) | ready | 3 | P1 | MODC-02, MODC-14 |
| Report Builder (no menu) | `/report-builder` | RoleRoute ['Admin'] | ready | 2 | P3 | none |
| Engineering KPI and KPI Command (menu on main only) | `/kpi-engine` | ModuleRoute kpi_scorecard | ready | 5 | P3 | MODC-54 |
| Executive Report and Executive Analytics | `/executive-report` | ModuleRoute executive_report; RoleRoute Admin/Manager/Director | ready | 5 | P2 | MODC-54, MODC-87 |
| Analytics, Comparison (merged on branch) | `/analytics` | main: ModuleRoute analytics; branch: Navigate redirect | ready | 5 | P3 | MODC-54 |

### Automation

| Module | Route | Guard | Internal | Class | Priority | Defect IDs |
|---|---|---|---|---|---|---|
| Event Stream | `/events` | FlagRoute flag="automation_platform" EventStream  /FlagRoute  | ready | 6 | P3 | MODC-70 |
| Approval Workflows | `/workflow-settings` | FlagRoute flag="automation_platform" WorkflowSettings  /FlagRoute  | ready | 2 | P2 | MODC-12, MODC-71 |
| Approval Delegations | `/approval-delegations` | FlagRoute flag="automation_platform" ApprovalDelegations  /FlagRoute  | ready | 2 | P3 | none |
| Approval Matrix | `/approval-matrix` | RoleRoute allowed={['Admin']} ApprovalMatrix  /RoleRoute  | ready | 2 | P2 | MODC-12, MODC-72 |
| Automation Rules | `/automation-rules` | FlagRoute flag="automation_platform" AutomationRules  /FlagRoute  | at risk | 4 | P2 | MODC-73 |
| API & Webhooks | `/integrations` | FlagRoute flag="automation_platform" Integrations  /FlagRoute  | at risk | 4 | P1 | MODC-74, MODC-75 |

### Administration

| Module | Route | Guard | Internal | Class | Priority | Defect IDs |
|---|---|---|---|---|---|---|
| Data Intake Center | `/data-intake` | RoleRoute allowed={['Admin', 'Manager', 'Director']} FlagRoute flag="d | ready | 3 | P1 | MODC-76, MODC-10 |
| Upload Approvals (OFF) | `/upload-approvals` | FlagRoute flag="data_intake" UploadApprovals  /FlagRoute  | ready | 5 | P3 | MODC-77 |
| Data Cleaning | `/cleaning` | ModuleRoute moduleKey="data_cleaning" DataCleaning  /ModuleRoute  | ready | 2 | P3 | none |
| Data Reconciliation | `/data-reconciliation` | RoleRoute allowed={['Admin','Manager','Director']} DataReconciliation  | ready | 3 | P3 | MODC-78 |
| Custom Data | `/custom-data` | ModuleRoute moduleKey="custom_data" CustomData  /ModuleRoute  | ready | 2 | P3 | none |
| ERP Sync | `/erp-sync` | FlagRoute flag="erp_sync" ModuleRoute moduleKey="erp_sync" ErpSync  /M | ready | 4 | P2 | MODC-79 |
| OCR Scanner (OFF) | `/ocr-scanner` | RoleRoute allowed={['Admin']} OcrScanner  /RoleRoute  | ready | 4 | P3 | MODC-09, MODC-80 |
| Advanced Search | `/advanced-search` | RoleRoute allowed={['Admin', 'Manager', 'Director']} AdvancedSearch  / | ready | 2 | P3 | none |
| Brand Assets | `/brand-assets` | RoleRoute allowed={['Admin']} BrandAssets  /RoleRoute  | ready | 3 | P2 | MODC-02, MODC-81 |
| Onboarding Wizard | `/onboarding-wizard` | RoleRoute allowed={['Admin']} OnboardingWizard  /RoleRoute  | at risk | 3 | P1 | MODC-09, MODC-82 |
| Audit Trail | `/audit` | ModuleRoute moduleKey="audit_trail" AuditTrail  /ModuleRoute  | ready | 2 | P3 | none |
| System Health | `/system-health` | RoleRoute allowed={['Admin']} SystemHealth  /RoleRoute  | ready | 6 | P3 | MODC-83 |
| Usage & Adoption | `/tenant-health` | RoleRoute allowed={['Admin']} TenantHealth  /RoleRoute  | ready | 2 | P3 | none |
| Developer Portal | `/developer-portal` | RoleRoute allowed={['Admin','Manager','Director','Integration Admin']} | at risk | 4 | P2 | MODC-75 |
| Settings | `/settings` | Settings   | ready | 2 | P2 | MODC-03, MODC-84 |
| Request Access | `/request-access` | RequestAccess   | at risk | 3 | P2 | MODC-85 |
| Help & Support | `/help` | HelpCenter   | ready | 3 | P2 | MODC-86 |
| ERP Intake, Expense Import, ERP Data Import (merged on branch) | `/erp-intake` | main: RoleRoute Admin/Manager/Director; branch: Navigate redirect | ready | 6 | P2 | MODC-88 |
| Legacy Upload Data (no menu) | `/upload` | FlagRoute data_intake | at risk | 6 | P2 | MODC-89 |

## 5. Module detail

### Inventory & Procurement

#### Stock (`/stock`)
- Page: `src/pages/StockManagement.jsx`. Module key: stock. Guard: `<ModuleRoute moduleKey="stock"><StockManagement /></ModuleRoute>`.
- Tables: sites, vehicle_fleet. RPCs: reference_site_options, stock_item_suggestions.
- What it does: Stock register on stock_records with quick entry, transfer, issue and count through post_stock_movement, movement ledger, tyre issue timeline, Excel/PDF export. Paged reads with id tiebreak.
- Brand-new empty company: Empty table with a clear first action (add stock item). Min and critical levels can be set; status is derived by trigger.
- Internal: **ready**. Commercial: **class 2, Functional but requires customer setup or data**.
- Defect MODC-13 (P2): see section 3.
- Defect MODC-10 (P2): see section 3.
- Defect MODC-20 (P3): Any signed-in user of the organisation can write movement rows directly; the RPC is the intended path. Evidence: stock_movements policy ALL: auth.role() = authenticated.
- Remediation: Keep. Make country default follow the user country instead of KSA; tighten stock_movements writes to the RPC. Priority P2. Area: DB.
- Tests: page render tests: none; service or engine test files referencing its libraries: 8. All run against a mocked Supabase client.

#### Stock Replenishment (`/stock-replenishment`)
- Page: `src/pages/StockReplenishment.jsx`. Module key: stock_replenishment. Guard: `<RoleRoute allowed={['Admin', 'Manager', 'Director']}><StockReplenishment /></RoleRoute>`.
- Tables: purchase_orders, stock, tyre_records. RPCs: generate_po_number.
- What it does: Replenishment planner: stock on hand vs 90-day tyre issues, suggested order quantity, raise PO.
- Brand-new empty company: Shows no stock for every company, new or existing.
- Internal: **broken**. Commercial: **class 3, Needs functional or data-quality repairs**. Switched off in Module Control today.
- Defect MODC-21 (P1): The planner reads a table nothing writes to, so stock on hand is always empty and every suggestion is computed against zero stock. VERIFIED. Module is switched off today. Evidence: src/lib/api/purchaseOrders.js:50 reads table stock (0 rows, legacy) while the Stock module writes stock_records (36 rows).
- Remediation: Repoint the read to stock_records (brand, tyre_size, stock_qty, unit_cost) and add a test against the real column set. Risk to current company: none while switched off. Priority P1. Area: web.
- Tests: page render tests: none; service or engine test files referencing its libraries: 4. All run against a mocked Supabase client.

#### Parts Catalog (`/parts-catalog`)
- Page: `src/pages/PartsCatalog.jsx`. Module key: parts_catalog. Guard: `<RoleRoute allowed={['Admin', 'Manager', 'Director']}><PartsCatalog /></RoleRoute>`.
- Tables: parts_catalog. RPCs: none.
- What it does: Parts master CRUD (part number, cost, on hand, reorder level) with analytics and export. Service validates status against the CHECK list.
- Brand-new empty company: Honest empty state; first action is add part. Read is capped at 1000 rows with no truncation notice.
- Internal: **ready**. Commercial: **class 2, Functional but requires customer setup or data**. Switched off in Module Control today.
- Defect MODC-22 (P3): Silent cap on a catalogue that can exceed 1000 parts. Evidence: src/lib/api/partsCatalog.js listParts limit 1000.
- Remediation: Page the read. Decide whether it is the same thing as Materials and material_master (three item masters). Priority P3. Area: web.
- Tests: page render tests: partsCostClaimsUtilPages.render.test.jsx; service or engine test files referencing its libraries: 8. All run against a mocked Supabase client.

#### Materials (`/materials`)
- Page: `src/pages/Materials.jsx`. Module key: materials. Guard: `<RoleRoute allowed={['Admin']}><Materials /></RoleRoute>`.
- Tables: materials. RPCs: none.
- What it does: Consumables master CRUD (oil, filter, valve) with reorder point.
- Brand-new empty company: Honest empty state. Admin only route.
- Internal: **ready**. Commercial: **class 5, Duplicate requiring controlled consolidation**. Switched off in Module Control today.
- Defect MODC-09 (P2): see section 3.
- Defect MODC-23 (P2): Duplicate item masters with no link between them. Evidence: tables parts_catalog, materials and material_master are three separate item masters; stock_records is a fourth quantity store.
- Remediation: Consolidate into one item master before selling inventory. Priority P2. Area: web, DB.
- Tests: page render tests: none; service or engine test files referencing its libraries: 8. All run against a mocked Supabase client.

#### Goods Receipt (`/goods-receipt`)
- Page: `src/pages/GoodsReceipt.jsx`. Module key: goods_receipt. Guard: `<RoleRoute allowed={['Admin', 'Manager', 'Director']}><GoodsReceipt /></RoleRoute>`.
- Tables: goods_receipts. RPCs: none.
- What it does: Goods received note register (GRN number, PO reference as free text, quantities, status).
- Brand-new empty company: Honest empty state; first action is add receipt.
- Internal: **at risk**. Commercial: **class 3, Needs functional or data-quality repairs**. Switched off in Module Control today.
- Defect MODC-09 (P2): see section 3.
- Defect MODC-24 (P2): Receiving goods does not increase stock and does not update the purchase order. PO reference is typed text. The chain requisition, PO, receipt, stock is four unlinked registers. VERIFIED. Evidence: src/lib/api/goodsReceipts.js createGoodsReceipt writes goods_receipts only; no reference to stock_records or purchase_orders in page or service.
- Remediation: Link GRN lines to a PO and post a stock receipt movement. Additive; no risk to current data (0 rows). Priority P2. Area: web, DB.
- Tests: page render tests: none; service or engine test files referencing its libraries: 8. All run against a mocked Supabase client.

#### Material Issue (MIS) (`/store-material-issue`)
- Page: `src/pages/StoreMaterialIssue.jsx`. Module key: store_material_issue. Guard: `<RoleRoute allowed={['Admin', 'Manager', 'Director']} moduleKey="store_material_issue"><StoreMaterialIssue /></RoleRoute>`.
- Tables: material_issue_lines, material_issues, material_master, parts_consumption, work_orders. RPCs: get_material_issue_summary, material_master_coverage, material_master_derive, material_master_set, material_master_set_bulk.
- What it does: Material issue slip register built from parts_consumption.issue_number (historical ERP slips), returns view, in-app raise of a slip (material_issues), analytics. Money per country.
- Brand-new empty company: A new company with no imported expense grid sees an empty register and can raise in-app slips, but there is no on-hand balance (the page says so).
- Internal: **ready**. Commercial: **class 3, Needs functional or data-quality repairs**.
- Defect MODC-25 (P2): Depends on the current company ERP export; issuing does not decrement stock_records. Evidence: src/pages/StoreMaterialIssue.jsx header and Raise tab: no live on-hand balance; main value is the imported ERP history.
- Remediation: Position as customer-data dependent; link issues to stock for new tenants. Priority P2. Area: web, DB.
- Tests: page render tests: materialIssue.test.js, materialIssue.history.render.test.jsx; service or engine test files referencing its libraries: 8. All run against a mocked Supabase client.

#### Procurement (`/procurement`)
- Page: `src/pages/Procurement.jsx`. Module key: stock. Guard: `<ModuleRoute moduleKey="stock"><Procurement /></ModuleRoute>`.
- Tables: purchase_orders. RPCs: generate_po_number.
- What it does: Purchase orders with line items, status timeline, PDF, approval panel.
- Brand-new empty company: TableNotInUse notice then empty table; first action is create PO.
- Internal: **ready**. Commercial: **class 2, Functional but requires customer setup or data**.
- Defect MODC-08 (P2): see section 3.
- Defect MODC-26 (P3): A Manager cannot progress a PO raised by someone else. Evidence: purchase_orders UPDATE policy: creator or role Admin only.
- Defect MODC-27 (P3): Fallback number is not guaranteed unique. Evidence: src/pages/Procurement.jsx:401 fallback PO number from Date.now() when the RPC fails.
- Remediation: Per-organisation PO numbering; align update policy with the approval roles. Priority P2. Area: DB.
- Tests: page render tests: none; service or engine test files referencing its libraries: 3. All run against a mocked Supabase client.

#### Requisitions (`/requisitions`)
- Page: `src/pages/Requisitions.jsx`. Module key: requisitions. Guard: `<RoleRoute allowed={['Admin', 'Manager', 'Director']}><Requisitions /></RoleRoute>`.
- Tables: requisitions. RPCs: none.
- What it does: Internal purchase request register with status and export.
- Brand-new empty company: Honest empty state; first action is new requisition.
- Internal: **at risk**. Commercial: **class 3, Needs functional or data-quality repairs**. Switched off in Module Control today.
- Defect MODC-09 (P2): see section 3.
- Defect MODC-28 (P2): Approved requisitions do not become purchase orders. Evidence: src/pages/Requisitions.jsx: po_ref is free text; no conversion to purchase_orders.
- Remediation: Add convert-to-PO or merge into Procurement. Priority P3. Area: web.
- Tests: page render tests: none; service or engine test files referencing its libraries: 8. All run against a mocked Supabase client.

#### Supplier Management (`/suppliers`)
- Page: `src/pages/SupplierManagement.jsx`. Module key: stock. Guard: `<ModuleRoute moduleKey="stock"><SupplierManagement /></ModuleRoute>`.
- Tables: purchase_orders, supplier_contracts, supplier_ratings, tyre_records, warranty_claims. RPCs: none.
- What it does: Supplier scorecard and spend derived from tyre brand, plus ratings and supplier contracts.
- Brand-new empty company: NotInUseNotice; a new company has no way to add a supplier here because the directory is derived from tyre brands.
- Internal: **at risk**. Commercial: **class 3, Needs functional or data-quality repairs**.
- Defect MODC-29 (P2): Supplier Management treats the tyre brand as the supplier. The real supplier master (suppliers) is only reachable through Data Intake. VERIFIED. Evidence: src/lib/api/supplierManagementApi.js:18-25 and src/pages/SupplierManagement.jsx:484-487 (supplier falls back to brand); the suppliers table (0 rows) is never read or written by this page.
- Defect MODC-08 (P2): see section 3.
- Remediation: Read and write the suppliers table; keep brand view as a tab. No risk to current data. Priority P2. Area: web.
- Tests: page render tests: none; service or engine test files referencing its libraries: 8. All run against a mocked Supabase client.

#### Vendor Intelligence (`/vendor-intelligence`)
- Page: `src/pages/VendorIntelligence.jsx`. Module key: vendor_intelligence. Guard: `<ModuleRoute moduleKey="vendor_intelligence"><VendorIntelligence /></ModuleRoute>`.
- Tables: corrective_actions, tyre_records. RPCs: get_cost_cpk_overview, get_expense_by_country, get_tyre_cost_by_asset.
- What it does: Vendor and workshop ranking from tyre records and expense grid; N/A when unmeasurable.
- Brand-new empty company: Empty states with thresholds; needs tyre records with brand and cost.
- Internal: **at risk**. Commercial: **class 3, Needs functional or data-quality repairs**. Switched off in Module Control today.
- Defect MODC-30 (P2): Vendor ranking is brand ranking; see ENGINEERING_CALCULATIONS for the cost maths. Evidence: PROJECT_MEMORY data notes: tyre_records.supplier populated on 0 rows; vendor = brand.
- Remediation: Rename to brand ranking or feed real supplier data. Priority P3. Area: web.
- Tests: page render tests: sizeVendorDriverPages.render.test.jsx; service or engine test files referencing its libraries: 8. All run against a mocked Supabase client.

#### Supplier Marketplace (`/marketplace`)
- Page: `src/pages/SupplierMarketplace.jsx`. Module key: marketplace. Guard: `<RoleRoute allowed={['Admin']}><SupplierMarketplace /></RoleRoute>`.
- Tables: marketplace_listings, marketplace_rfqs. RPCs: none.
- What it does: Internal register of supplier listings and RFQs with comparison and funnel.
- Brand-new empty company: Honest empty state; first action is add listing.
- Internal: **ready**. Commercial: **class 4, Incomplete or future development**. Switched off in Module Control today.
- Defect MODC-31 (P2): Named Supplier Marketplace but there are no external suppliers, no quoting by suppliers and no ordering. It is a private price list. Evidence: src/pages/SupplierMarketplace.jsx header: runs on marketplace_listings / marketplace_rfqs entered by the tenant itself.
- Remediation: Do not market as a marketplace. Rename to supplier price list or leave off. Priority P2. Area: marketing, web.
- Tests: page render tests: none; service or engine test files referencing its libraries: 8. All run against a mocked Supabase client.

#### Contracts (`/contracts`)
- Page: `src/pages/Contracts.jsx`. Module key: contracts. Guard: `<RoleRoute allowed={['Admin', 'Manager', 'Director']}><Contracts /></RoleRoute>`.
- Tables: contracts. RPCs: none.
- What it does: Contract register (vendor, type, dates, value, currency, status) with renewal pipeline.
- Brand-new empty company: Honest empty state or not-provisioned state; first action is add contract.
- Internal: **ready**. Commercial: **class 2, Functional but requires customer setup or data**.
- Defect MODC-32 (P3): Two contract registers (this page and the Suppliers contracts tab). Evidence: tables contracts and supplier_contracts both store supplier agreements.
- Remediation: Merge the two contract stores. Priority P3. Area: web, DB.
- Tests: page render tests: none; service or engine test files referencing its libraries: 3. All run against a mocked Supabase client.

#### Supplier detail, Recall detail, workflow and rule builders (no menu) (`/suppliers/:supplierId`)
- Page: `src/pages/SupplierDetail.jsx, RecallDetail.jsx`. Module key: none. Guard: `ModuleRoute stock; RoleRoute Admin; FlagRoute automation_platform`.
- What it does: Drill-down and builder pages reached from their parents.
- Brand-new empty company: Not found or empty builder.
- Internal: **ready**. Commercial: **class 2, Functional but requires customer setup or data**.
- Remediation: Keep. Priority P3. Area: web.
- Tests: page render tests: none; service or engine test files referencing its libraries: 0. All run against a mocked Supabase client.

### Accidents & Claims

#### Accidents (`/accidents`)
- Page: `src/pages/Accidents.jsx`. Module key: accidents. Guard: `<FlagRoute flag="accidents_module"><Accidents /></FlagRoute>`.
- Tables: accident_email_templates, accident_report_templates, accident_routing_rules, accidents, departments, profiles, report_schedules, sites, system_config, vehicle_fleet. RPCs: reference_asset_options, reference_site_options.
- What it does: Accident register and inline create/edit form, analytics, report builder, claims export; staged workflow, case timeline, team workstreams. Detail routes /accidents/:id and /accidents/:id/timeline.
- Brand-new empty company: Empty register with create action. Departments, routing rules and email templates are empty for a new company, so notifications route to nobody except the global mailbox.
- Internal: **ready**. Commercial: **class 3, Needs functional or data-quality repairs**.
- Defect MODC-01 (P0): see section 3.
- Defect MODC-06 (P1): see section 3.
- Defect MODC-12 (P2): see section 3.
- Defect MODC-33 (P2): Module switch does not gate the accident routes. Evidence: route guard is FlagRoute accidents_module only (src/App.jsx:656); no ModuleRoute, so Module Control status for accidents is not enforced on the route.
- Remediation: Move mailbox, liable-party labels and internal workshop name into per-organisation configuration; seed defaults for a new organisation; keep current values for the existing tenant. Risk to current company: low if the existing values are copied into its configuration first. Priority P0. Area: DB, web.
- Tests: page render tests: accidentIdentifyAsset.test.jsx; service or engine test files referencing its libraries: 8. All run against a mocked Supabase client.

#### Accident Cases (`/accident-cases`)
- Page: `src/pages/AccidentCases.jsx`. Module key: accident_cases. Guard: `<RoleRoute allowed={['Admin', 'Manager', 'Director']}><AccidentCases /></RoleRoute>`.
- Tables: accident_case_tasks, accident_case_workstreams, accidents. RPCs: get_accident_case_kpis, get_accident_case_status_breakdown, get_accident_workstream_bottleneck.
- What it does: Case analytics board and team inbox over accident_case_workstreams with server KPIs.
- Brand-new empty company: Empty board; depends on accidents existing.
- Internal: **ready**. Commercial: **class 3, Needs functional or data-quality repairs**.
- Defect MODC-12 (P2): see section 3.
- Remediation: Follows the accidents fixes. Priority P2. Area: DB.
- Tests: page render tests: none; service or engine test files referencing its libraries: 3. All run against a mocked Supabase client.

#### Incident Reports (`/incidents`)
- Page: `src/pages/IncidentReports.jsx`. Module key: incidents. Guard: `<RoleRoute allowed={['Admin', 'Manager', 'Director']}><IncidentReports /></RoleRoute>`.
- Tables: incident_reports. RPCs: none.
- What it does: Separate incident register (near miss, damage, breakdown, safety, theft) with analytics.
- Brand-new empty company: Honest empty state; first action is add incident.
- Internal: **at risk**. Commercial: **class 5, Duplicate requiring controlled consolidation**.
- Defect MODC-09 (P2): see section 3.
- Defect MODC-34 (P2): Duplicate of Accidents for damage and breakdown events; no link to accident cases or corrective actions. Evidence: incident_reports is a second incident store beside accidents; 4 rows live.
- Remediation: Controlled consolidation into Accidents (near-miss type) or a clear scope split. Priority P3. Area: web, DB.
- Tests: page render tests: none; service or engine test files referencing its libraries: 8. All run against a mocked Supabase client.

#### Claims Summary (`/claims-summary`)
- Page: `src/pages/ClaimsSummary.jsx`. Module key: claims_summary. Guard: `<RoleRoute allowed={['Admin', 'Manager', 'Director']}><FlagRoute flag="accidents_module"><ClaimsSummary /></FlagRoute></RoleRoute>`.
- Tables: accidents, vehicle_fleet. RPCs: none.
- What it does: Claims dashboard over claim fields on accidents (single engine claimsAnalytics), PDF/Excel.
- Brand-new empty company: Honest empty charts until accidents with claims exist.
- Internal: **ready**. Commercial: **class 2, Functional but requires customer setup or data**.
- Defect MODC-35 (P3): Minor currency fallback. Evidence: src/pages/ClaimsSummary.jsx: one SAR literal fallback.
- Remediation: Keep. Priority P3. Area: web.
- Tests: page render tests: partsCostClaimsUtilPages.render.test.jsx; service or engine test files referencing its libraries: 8. All run against a mocked Supabase client.

#### Insurance Claims (`/insurance-claims`)
- Page: `src/pages/InsuranceClaims.jsx`. Module key: insurance_claims. Guard: `<RoleRoute allowed={['Admin', 'Manager', 'Director']}><InsuranceClaims /></RoleRoute>`.
- Tables: insurance_claims. RPCs: none.
- What it does: Manual claim ledger on insurance_claims.
- Brand-new empty company: Honest empty state.
- Internal: **ready**. Commercial: **class 5, Duplicate requiring controlled consolidation**. Switched off in Module Control today.
- Defect MODC-36 (P2): Duplicate claim registers; this one is switched off. Evidence: three claim stores: claim columns on accidents, insurance_claims (0 rows), insurance_claim_register (59 rows, insurer import).
- Remediation: Retire or merge into the accident claim record. Priority P3. Area: web, DB.
- Tests: page render tests: serviceAndClaimsPages.render.test.jsx; service or engine test files referencing its libraries: 8. All run against a mocked Supabase client.

#### Insurance Policies (`/insurance-policies`)
- Page: `src/pages/InsurancePolicies.jsx`. Module key: insurance_policies. Guard: `<RoleRoute allowed={['Admin']}><InsurancePolicies /></RoleRoute>`.
- Tables: insurance_claim_register, insurance_policies, insurance_policy_conditions, sites, vehicle_fleet. RPCs: reference_site_options.
- What it does: Policy knowledge base, conditions, claim scenario checker, correspondence generator, insurer email analysis, portfolio and coverage tabs. Admin only in route and RLS.
- Brand-new empty company: Empty list; admin adds or imports a policy PDF. Coverage matching needs chassis or plate on fleet rows.
- Internal: **ready**. Commercial: **class 3, Needs functional or data-quality repairs**.
- Defect MODC-13 (P2): see section 3.
- Defect MODC-37 (P2): Policy import and clause model are shaped by two Saudi insurers. Evidence: src/pages/InsurancePolicies.jsx:278 currency fallback SAR; parser and conditions built from the current company insurer documents (PROJECT_MEMORY V466, V526).
- Defect MODC-38 (P3): PII handling needs a decision before opening beyond Admin. Evidence: insurance_claim_register stores driver identity fields; elevated read only.
- Remediation: Generalise the PDF parser or mark import as manual entry for other insurers. Priority P2. Area: web.
- Tests: page render tests: insurancePolicies.render.test.jsx; service or engine test files referencing its libraries: 8. All run against a mocked Supabase client.

#### Recall Tracker (`/recall-tracker`)
- Page: `src/pages/RecallTracker.jsx`. Module key: recall_tracker. Guard: `<RoleRoute allowed={['Admin']}><RecallTracker /></RoleRoute>`.
- Tables: recalls, tyre_records. RPCs: none.
- What it does: Tyre recall register matched against fleet tyres by brand and serial prefix; detail route /recalls/:id.
- Brand-new empty company: Honest empty state; first action is add recall.
- Internal: **ready**. Commercial: **class 2, Functional but requires customer setup or data**. Switched off in Module Control today.
- Defect MODC-08 (P2): see section 3.
- Remediation: Add organisation to the recall unique key. Priority P3. Area: DB.
- Tests: page render tests: none; service or engine test files referencing its libraries: 3. All run against a mocked Supabase client.

#### Accident Workflow (`/accident-workflow-settings`)
- Page: `src/pages/AccidentWorkflowSettings.jsx`. Module key: accident_workflow_settings. Guard: `<RoleRoute allowed={['Admin', 'Manager', 'Director']}><AccidentWorkflowSettings /></RoleRoute>`.
- Tables: accident_email_templates, accident_routing_rules, accidents, departments, profiles, system_config. RPCs: none.
- What it does: Departments, routing rules, email templates and email delivery switch for accident notifications.
- Brand-new empty company: All three lists empty for a new company; admin must build them. The delivery switch and mailbox are global.
- Internal: **ready**. Commercial: **class 3, Needs functional or data-quality repairs**.
- Defect MODC-01 (P0): see section 3.
- Defect MODC-12 (P2): see section 3.
- Defect MODC-39 (P1): A tenant Admin cannot set its own mailbox; whoever can, sets it for all tenants. Evidence: accident_emails_enabled, accident_email_to, accident_email_cc and accident_email_subject_prefix live in global system_config, writable by super admin only.
- Remediation: Per-organisation accident mail settings. Risk to current company: low (copy current values). Priority P0. Area: DB, web.
- Tests: page render tests: accidentWorkflowSettings.page.test.jsx; service or engine test files referencing its libraries: 7. All run against a mocked Supabase client.

#### Insurer case portal (no menu) (`/accident-portal/:token`)
- Page: `src/pages/AccidentPortalView.jsx`. Module key: none. Guard: `none (anonymous, token RPC)`.
- What it does: PII-lean read-only view of one accident case for an insurer.
- Brand-new empty company: Invalid token state.
- Internal: **ready**. Commercial: **class 2, Functional but requires customer setup or data**.
- Remediation: Keep. Priority P3. Area: DB.
- Tests: page render tests: none; service or engine test files referencing its libraries: 0. All run against a mocked Supabase client.

#### Accident detail and timeline (no menu) (`/accidents/:id`)
- Page: `src/pages/AccidentDetail.jsx, AccidentCaseTimeline.jsx`. Module key: none. Guard: `FlagRoute accidents_module`.
- What it does: Case page with tabs per workstream.
- Brand-new empty company: Not found state.
- Internal: **ready**. Commercial: **class 3, Needs functional or data-quality repairs**.
- Defect MODC-06 (P1): see section 3.
- Remediation: See Accidents. Priority P1. Area: web.
- Tests: page render tests: none; service or engine test files referencing its libraries: 0. All run against a mocked Supabase client.

### Finance & Commercial

#### Cost Center (`/cost-center`)
- Page: `src/pages/CostCenter.jsx`. Module key: budgets. Guard: `<ModuleRoute moduleKey="budgets"><CostCenter /></ModuleRoute>`.
- Tables: production_logs. RPCs: get_cost_cpk_overview, get_expense_by_country, get_tyre_cost_by_asset.
- What it does: Cost analysis from the expense grid with tyre vs maintenance switch, cost per unit (km, hour, m3). See ENGINEERING_CALCULATIONS for the maths.
- Brand-new empty company: N/A and empty charts until expense lines and tyre records exist. First action is import in Data Intake.
- Internal: **ready**. Commercial: **class 2, Functional but requires customer setup or data**.
- Defect MODC-40 (P2): Concrete m3 unit is built in; one module key for three pages. Evidence: src/pages/CostCenter.jsx: 62 references to m3 / production; module key budgets shared with Budgets and Budget Planner.
- Remediation: Hide m3 unit unless production logging is enabled for the tenant. Priority P3. Area: web.
- Tests: page render tests: costCenterPage.render.test.jsx; service or engine test files referencing its libraries: 8. All run against a mocked Supabase client.

#### Budgets & Cost (`/budgets`)
- Page: `src/pages/Budgets.jsx`. Module key: budgets. Guard: `<ModuleRoute moduleKey="budgets"><Budgets /></ModuleRoute>`.
- Tables: budgets, tyre_records. RPCs: none.
- What it does: Monthly budget vs tyre spend per site and a 12-month planner grid.
- Brand-new empty company: Empty; first action is set a budget for a site. Site list comes from data.
- Internal: **at risk**. Commercial: **class 3, Needs functional or data-quality repairs**.
- Defect MODC-04 (P1): see section 3.
- Defect MODC-13 (P2): see section 3.
- Defect MODC-41 (P3): Same site can hold two budget rows under different regions. Evidence: src/pages/Budgets.jsx:171-175 writes region from profile.region with KSA fallback while BudgetPlanner writes its own region.
- Remediation: Add organisation to the unique key (backfill is trivial, 12 rows) and gate the editor by role. Risk to current company: low. Priority P1. Area: DB, web.
- Tests: page render tests: financeWorkspace.render.test.jsx; service or engine test files referencing its libraries: 6. All run against a mocked Supabase client.

#### Budget Planner (`/budget-planner`)
- Page: `src/pages/BudgetPlanner.jsx`. Module key: budgets. Guard: `<ModuleRoute moduleKey="budgets"><BudgetPlanner /></ModuleRoute>`.
- Tables: budgets, pm_service_records, tyre_records, work_orders. RPCs: get_maint_tyre_split, get_parts_expense_snapshot, get_tyre_cost_by_asset.
- What it does: Annual budget planning with spend history; Admin edit.
- Brand-new empty company: Empty until tyre or expense data exists.
- Internal: **at risk**. Commercial: **class 3, Needs functional or data-quality repairs**.
- Defect MODC-04 (P1): see section 3.
- Remediation: Same fix as Budgets; consider merging the two pages. Priority P1. Area: DB, web.
- Tests: page render tests: financeWorkspace.render.test.jsx; service or engine test files referencing its libraries: 7. All run against a mocked Supabase client.

#### Expenses & CPK (`/expense-report`)
- Page: `src/pages/ExpenseReport.jsx`. Module key: expense_report. Guard: `<RoleRoute allowed={['Admin', 'Manager', 'Director']}><ExpenseReport /></RoleRoute>`.
- Tables: inspections, odometer_logs, parts_consumption, sites, tyre_records, vehicle_fleet. RPCs: expense_import_count, get_cost_cpk_overview, get_cost_variance, get_cpk_hours_source, get_cpk_km_intelligence, get_cpk_km_source, get_cpk_unit_audit, get_expense_by_country.
- What it does: Expenses and CPK from the expense grid: period bar, comparison, cost per km, what moved, certainty, by site, tyre forecast, row export. Single country deep report; per-country comparison on wider scope.
- Brand-new empty company: Honest empty state linking to the import. A new company must import an expense grid first.
- Internal: **ready**. Commercial: **class 2, Functional but requires customer setup or data**.
- Defect MODC-42 (P2): Classification rules encode one company ERP coding; another company lands mostly in the default bucket until it reviews its item master. Evidence: classifier and intake are built on the current ERP export shape (PROJECT_MEMORY V335-V373: item code ranges 310xxx, TI-GE, OL-; job card prefixes AFKR, GCKR, RM, EG).
- Remediation: Make code ranges and job card prefixes per-organisation configuration. See ENGINEERING_CALCULATIONS. Priority P2. Area: DB.
- Tests: page render tests: expenseReportScopeSurfaces.test.jsx, expenseReportCountryScope.test.js, expenseReportAllScope.test.jsx; service or engine test files referencing its libraries: 8. All run against a mocked Supabase client.

#### Expense Trends (`/expense-trends`)
- Page: `src/pages/ExpenseTrends.jsx`. Module key: expense_trends. Guard: `<RoleRoute allowed={['Admin', 'Manager', 'Director']}><ExpenseTrends /></RoleRoute>`.
- Tables: none direct. RPCs: get_expense_period_trend.
- What it does: Multi-year expense trend and forecast per country, reporting scope aware.
- Brand-new empty company: Honest empty state.
- Internal: **ready**. Commercial: **class 2, Functional but requires customer setup or data**.
- Remediation: Keep. Priority P3. Area: web.
- Tests: page render tests: reportingScopeMount.test.jsx, reportingScopeUrl.test.jsx, expenseTrendsScopeFetch.test.jsx; service or engine test files referencing its libraries: 8. All run against a mocked Supabase client.

#### Cost Scenario Planner (`/cost-scenario-planner`)
- Page: `src/pages/CostScenarioPlanner.jsx`. Module key: cost_scenario_planner. Guard: `<RoleRoute allowed={['Admin', 'Manager', 'Director']}><CostScenarioPlanner /></RoleRoute>`.
- What it does: Client-side what-if model of tyre strategies; user supplies all inputs.
- Brand-new empty company: Works with no data; all numbers are user inputs and labelled as a model.
- Internal: **ready**. Commercial: **class 1, Commercially ready**.
- Remediation: Keep. State clearly that outputs are a model. Priority P3. Area: web.
- Tests: page render tests: deepenedPages.render.test.jsx; service or engine test files referencing its libraries: 2. All run against a mocked Supabase client.

#### Cost per M3 (`/cost-per-m3`)
- Page: `src/pages/CostPerM3.jsx`. Module key: cost_per_m3. Guard: `<RoleRoute allowed={['Admin', 'Manager', 'Director']}><CostPerM3 /></RoleRoute>`.
- Tables: import_batches, import_files, production_logs, production_station_map, sany_invoice_lines, sany_invoices, sco_costs, site_match_keywords, sites. RPCs: apply_production_station_map, apply_station_proposals, get_cost_per_m3, get_cost_per_m3_trend, get_costm3_ledger_monthly, get_production_monthly, get_production_reasons, get_production_rejections.
- What it does: Cost per cubic metre of concrete: internal ERP cost + SCO + SANY divided by approved production, by region Central / Western.
- Brand-new empty company: Empty with N/A; only meaningful for a ready-mix operator that uploads batching, SCO and SANY files.
- Internal: **ready**. Commercial: **class 6, Internal administrator-only or legacy**.
- Defect MODC-43 (P1): Built for one company: named vendors (SANY, SCO), two Saudi regions, one batching plant export and one ERP grid. VERIFIED. Evidence: src/pages/CostPerM3.jsx:466 (tag each site Central or Western), src/lib/costPerM3.js:347-383 (SCO issue grid bj_griddetails, SANY proforma, batching export headers); RPC get_cost_per_m3 names sco_costs and sany_invoices.
- Remediation: Keep for the current tenant behind a per-organisation feature flag; generalise to named cost sources before selling to ready-mix customers. Priority P1. Area: web, DB.
- Tests: page render tests: partsCostClaimsUtilPages.render.test.jsx; service or engine test files referencing its libraries: 6. All run against a mocked Supabase client.

#### Production (M3) (`/production-m3`)
- Page: `src/pages/ProductionM3.jsx`. Module key: production_m3. Guard: `<RoleRoute allowed={['Admin', 'Manager', 'Director']}><ProductionM3 /></RoleRoute>`.
- Tables: import_batches, import_files, production_logs, production_station_map, sany_invoice_lines, sany_invoices, sco_costs, site_match_keywords, sites. RPCs: apply_production_station_map, apply_station_proposals, get_cost_per_m3, get_cost_per_m3_trend, get_costm3_ledger_monthly, get_production_monthly, get_production_reasons, get_production_rejections.
- What it does: Production ledger (batching export) with rejections; summary first.
- Brand-new empty company: Empty; requires the specific batching export or manual entry.
- Internal: **ready**. Commercial: **class 6, Internal administrator-only or legacy**.
- Defect MODC-10 (P2): see section 3.
- Defect MODC-44 (P2): Import format is one plant system export. Evidence: src/lib/costPerM3.js:377-383 batching export header map.
- Remediation: Per-organisation flag; generic template. Priority P2. Area: web.
- Tests: page render tests: executiveReportIntake.render.test.jsx; service or engine test files referencing its libraries: 4. All run against a mocked Supabase client.

#### SCO Cost (`/sco-costs`)
- Page: `src/pages/ScoCosts.jsx`. Module key: sco_costs. Guard: `<RoleRoute allowed={['Admin', 'Manager', 'Director']}><ScoCosts /></RoleRoute>`.
- Tables: import_batches, import_files, production_logs, production_station_map, sany_invoice_lines, sany_invoices, sco_costs, site_match_keywords, sites. RPCs: apply_production_station_map, apply_station_proposals, get_cost_per_m3, get_cost_per_m3_trend, get_costm3_ledger_monthly, get_production_monthly, get_production_reasons, get_production_rejections.
- What it does: SCO cost ledger import and summary.
- Brand-new empty company: Empty; not meaningful to another company.
- Internal: **ready**. Commercial: **class 6, Internal administrator-only or legacy**.
- Defect MODC-45 (P2): Company specific. Evidence: table sco_costs, country NOT NULL, page name and import are specific to one outsourced contract.
- Remediation: Hide for other tenants. Priority P2. Area: web.
- Tests: page render tests: executiveReportIntake.render.test.jsx; service or engine test files referencing its libraries: 4. All run against a mocked Supabase client.

#### SANY Invoices (`/sany-invoices`)
- Page: `src/pages/SanyInvoices.jsx`. Module key: sany_invoices. Guard: `<RoleRoute allowed={['Admin', 'Manager', 'Director']}><SanyInvoices /></RoleRoute>`.
- Tables: import_batches, import_files, production_logs, production_station_map, sany_invoice_lines, sany_invoices, sco_costs, site_match_keywords, sites. RPCs: apply_production_station_map, apply_station_proposals, get_cost_per_m3, get_cost_per_m3_trend, get_costm3_ledger_monthly, get_production_monthly, get_production_reasons, get_production_rejections.
- What it does: SANY service invoice import (proforma PDF parser, USD to SAR at 3.75) with line items.
- Brand-new empty company: Empty; not meaningful to another company.
- Internal: **ready**. Commercial: **class 6, Internal administrator-only or legacy**.
- Defect MODC-46 (P2): One vendor invoice format and a fixed exchange rate. Evidence: src/lib/import/parsePdf.js parseSanyProformaPdf; fixed 3.75 rate (PROJECT_MEMORY V464, V525).
- Remediation: Hide for other tenants. Priority P2. Area: web.
- Tests: page render tests: executiveReportIntake.render.test.jsx; service or engine test files referencing its libraries: 4. All run against a mocked Supabase client.

#### SANY Delay Penalty (`/sany-delay-penalty`)
- Page: `src/pages/SanyDelayPenalty.jsx`. Module key: sany_delay_penalty. Guard: `<RoleRoute allowed={['Admin', 'Manager', 'Director']}><SanyDelayPenalty /></RoleRoute>`.
- Tables: sany_delay_penalties. RPCs: get_sany_delay_candidates.
- What it does: Repair delay penalty ledger: 43 SAR per hour over 5 days, deducted from the SANY invoice.
- Brand-new empty company: Empty; rule is one company contract.
- Internal: **ready**. Commercial: **class 6, Internal administrator-only or legacy**.
- Defect MODC-47 (P2): Contract terms hard-coded. Evidence: src/lib/api/sanyDelayPenalty.js:17 DEFAULT_RATE_PER_HOUR = 43, currency SAR, country KSA; column defaults the same.
- Remediation: Hide for other tenants or turn into a configurable vendor penalty rule. Priority P2. Area: web, DB.
- Tests: page render tests: deepenedPages.render.test.jsx; service or engine test files referencing its libraries: 3. All run against a mocked Supabase client.

#### ROI Calculator (`/roi-calculator`)
- Page: `src/pages/RoiCalculator.jsx`. Module key: roi_calculator. Guard: `<RoleRoute allowed={['Admin', 'Manager', 'Director']}><RoiCalculator /></RoleRoute>`.
- Tables: none direct. RPCs: get_cpk_hours_source, get_cpk_km_intelligence, get_cpk_km_source, get_cpk_unit_audit, get_fleet_area_map, get_fleet_cpk.
- What it does: Client-side ROI model, optionally seeded from measured fleet CPK; scenarios saved on the device.
- Brand-new empty company: Works empty with labelled assumptions.
- Internal: **ready**. Commercial: **class 2, Functional but requires customer setup or data**.
- Defect MODC-48 (P3): Scenarios are not shared or backed up. Evidence: src/lib/roiScenarios.js localStorage.
- Remediation: Keep; label as a model. Priority P3. Area: web.
- Tests: page render tests: none; service or engine test files referencing its libraries: 8. All run against a mocked Supabase client.

#### TCO Calculator (`/tco-calculator`)
- Page: `src/pages/TcoCalculator.jsx`. Module key: tco_calculator. Guard: `<RoleRoute allowed={['Admin', 'Manager', 'Director']}><TcoCalculator /></RoleRoute>`.
- Tables: inspections, odometer_logs, tyre_records, vehicle_fleet. RPCs: get_tyre_filter_options, tyre_move.
- What it does: Fleet tyre cost per km by asset, benchmark comparison, what-if calculator.
- Brand-new empty company: Overview shows N/A, but the savings potential and benchmark tabs still show numbers built from constants.
- Internal: **at risk**. Commercial: **class 3, Needs functional or data-quality repairs**.
- Defect MODC-49 (P2): Benchmark variance compares tyre-only cost in SAR or EGP with static whole-vehicle AED figures of no stated source. The variance is meaningless. VERIFIED. Evidence: src/lib/tco.js:195-201 GCC_TCO_BENCHMARKS in AED/km (0.85 to 5.20, whole vehicle) compared at :423-437 with fleet tyre cost per km in the tenant currency.
- Defect MODC-50 (P2): Annual savings potential is computed from hard-coded constants and shown as money even with no data. VERIFIED. Evidence: src/lib/tco.js:189-192, 385, 393-397 (avg_tyre_cost 850 AED fallback, 250 km/day, fuel 2.89 AED).
- Remediation: Remove the benchmark tab or make references tenant-entered; show savings potential only from measured inputs. See ENGINEERING_CALCULATIONS. Risk to current company: none (removes misleading figures). Priority P2. Area: web.
- Tests: page render tests: none; service or engine test files referencing its libraries: 8. All run against a mocked Supabase client.

#### Tyre-as-a-Service (`/taas`)
- Page: `src/pages/Taas.jsx`. Module key: taas. Guard: `<RoleRoute allowed={['Admin']}><Taas /></RoleRoute>`.
- Tables: taas_subscriptions. RPCs: none.
- What it does: Manual register of tyre-as-a-service contracts with MRR roll-up.
- Brand-new empty company: Honest empty state.
- Internal: **ready**. Commercial: **class 4, Incomplete or future development**. Switched off in Module Control today.
- Defect MODC-51 (P2): No billing, no usage feed from odometer logs. A ledger, not a service. Evidence: no database function references taas_subscriptions; km and billed amounts are typed by hand.
- Remediation: Do not market. Future development. Priority P3. Area: web.
- Tests: page render tests: none; service or engine test files referencing its libraries: 8. All run against a mocked Supabase client.

#### Customer Portal (`/customer-portal`)
- Page: `src/pages/CustomerPortal.jsx`. Module key: customer_portal. Guard: `<RoleRoute allowed={['Admin']}><CustomerPortal /></RoleRoute>`.
- Tables: customer_accounts. RPCs: none.
- What it does: Internal list of customer accounts with a portal-enabled flag.
- Brand-new empty company: Honest empty state.
- Internal: **ready**. Commercial: **class 4, Incomplete or future development**. Switched off in Module Control today.
- Defect MODC-52 (P1): There is no customer portal. The flag grants nothing. VERIFIED (routes). Evidence: src/App.jsx has no customer-facing portal route; customer_accounts.portal_enabled is read by no access path.
- Remediation: Must not be marketed. Future development. Priority P2. Area: marketing.
- Tests: page render tests: none; service or engine test files referencing its libraries: 8. All run against a mocked Supabase client.

#### Billing & Subscription (`/billing`)
- Page: `src/pages/Billing.jsx`. Module key: billing. Guard: `<FlagRoute flag="billing"><Billing /></FlagRoute>`.
- Tables: invoices, org_subscriptions, subscription_plans. RPCs: ensure_org_subscription, get_subscription_overview, org_can_add.
- What it does: Subscription overview, plan list, invoices. Depth is owned by the billing agent.
- Brand-new empty company: ensure_org_subscription creates a 14-day trial row on first open.
- Internal: **at risk**. Commercial: **class 4, Incomplete or future development**.
- Defect MODC-53 (P1): Not in use by the live tenant; any role can open the route by URL when the flag is on. See the billing agent report. Evidence: org_subscriptions has 0 rows; route guard is FlagRoute billing only (src/App.jsx), nav is Admin only.
- Remediation: See billing and onboarding report. Priority P1. Area: web, edge fn.
- Tests: page render tests: none; service or engine test files referencing its libraries: 6. All run against a mocked Supabase client.

### Analytics & Reports

#### Board Overview (`/board-overview`)
- Page: `src/pages/BoardOverview.jsx`. Module key: board_overview. Guard: `<RoleRoute allowed={['Admin', 'Manager', 'Director']}><BoardOverview /></RoleRoute>`.
- Tables: accidents, corrective_actions, inspections, stock_movements, stock_records, tyre_records, vehicle_fleet, work_orders. RPCs: generate_work_order_no, get_cost_cpk_overview, get_cpk_hours_source, get_cpk_km_intelligence, get_cpk_km_source, get_cpk_unit_audit, get_expense_by_country, get_fleet_area_map.
- What it does: One consolidated board report: KPIs, 12-month trends, charts, recommendations, PDF; reporting-scope aware, mixed currency withheld.
- Brand-new empty company: N/A tiles and empty charts until data exists.
- Internal: **ready**. Commercial: **class 2, Functional but requires customer setup or data**.
- Defect MODC-54 (P2): Ten overlapping dashboards. The branch merges some into tabs; main still lists them separately. Evidence: KPI Center, Engineering KPI (/kpi-engine), KPI Command (/kpi-command), Board Overview, Executive Report, Executive Analytics, Advanced Analytics, Fleet Analytics, Fleet Intelligence, Ops Intelligence all present overlapping fleet KPIs.
- Remediation: Keep as the executive report of record. Priority P3. Area: web.
- Tests: page render tests: reportingScopeBoard.test.jsx; service or engine test files referencing its libraries: 8. All run against a mocked Supabase client.

#### Executive (`/executive`)
- Page: `src/pages/ExecutiveReport.jsx + src/pages/ExecutiveAnalytics.jsx`. Module key: executive_report / executive_analytics. Guard: `<ExecutiveLanding /> then page guards`.
- What it does: Single menu entry that lands on Executive Report or Executive Analytics by permission.
- Brand-new empty company: Follows the two pages.
- Internal: **ready**. Commercial: **class 5, Duplicate requiring controlled consolidation**.
- Defect MODC-54 (P2): Ten overlapping dashboards. The branch merges some into tabs; main still lists them separately. Evidence: KPI Center, Engineering KPI (/kpi-engine), KPI Command (/kpi-command), Board Overview, Executive Report, Executive Analytics, Advanced Analytics, Fleet Analytics, Fleet Intelligence, Ops Intelligence all present overlapping fleet KPIs.
- Remediation: Branch consolidation is correct; merge after review. Priority P3. Area: web.
- Tests: page render tests: none; service or engine test files referencing its libraries: 0. All run against a mocked Supabase client.
- Branch versus main: BRANCH ONLY. Main has two menu items (/executive-report Admin, /executive-analytics Admin/Manager/Director) and no /executive route. Both pages keep their own guards (ModuleRoute executive_report, RoleRoute).

#### Advanced Analytics (`/advanced-analytics`)
- Page: `src/pages/AdvancedAnalytics.jsx`. Module key: analytics. Guard: `<ModuleRoute moduleKey="analytics"><AdvancedAnalytics /></ModuleRoute>`.
- Tables: tyre_records. RPCs: get_cost_cpk_overview, get_expense_by_country, get_tyre_cost_by_asset.
- What it does: Advanced charts on tyre records and cost; absorbs the old Analytics page as a tab on the branch.
- Brand-new empty company: Empty charts.
- Internal: **ready**. Commercial: **class 5, Duplicate requiring controlled consolidation**.
- Defect MODC-54 (P2): Ten overlapping dashboards. The branch merges some into tabs; main still lists them separately. Evidence: KPI Center, Engineering KPI (/kpi-engine), KPI Command (/kpi-command), Board Overview, Executive Report, Executive Analytics, Advanced Analytics, Fleet Analytics, Fleet Intelligence, Ops Intelligence all present overlapping fleet KPIs.
- Remediation: Consolidate. Priority P3. Area: web.
- Tests: page render tests: none; service or engine test files referencing its libraries: 8. All run against a mocked Supabase client.
- Branch versus main: On the branch /analytics redirects here. On main /analytics is its own page with a menu item (ModuleRoute analytics).

#### KPI Center (`/kpi`)
- Page: `src/pages/KpiScorecard.jsx`. Module key: kpi_scorecard. Guard: `<ModuleRoute moduleKey="kpi_scorecard"><KpiScorecard /></ModuleRoute>`.
- Tables: corrective_actions, engine_hours_logs, kpi_targets, odometer_logs, pm_programs, pm_service_records, tyre_records, vehicle_fleet. RPCs: get_cost_cpk_overview, get_expense_by_country, get_tyre_cost_by_asset, record_pm_service.
- What it does: KPI scorecard with targets, PM tiles, year on year.
- Brand-new empty company: N/A tiles; targets can be typed.
- Internal: **at risk**. Commercial: **class 3, Needs functional or data-quality repairs**.
- Defect MODC-03 (P1): see section 3.
- Defect MODC-13 (P2): see section 3.
- Defect MODC-55 (P2): Director save is refused by RLS; region is hard-coded. Evidence: src/pages/KpiScorecard.jsx:263 region KSA hard-coded on save; kpi_targets INSERT/UPDATE policy Manager and Admin only while the route admits Director.
- Defect MODC-54 (P2): Ten overlapping dashboards. The branch merges some into tabs; main still lists them separately. Evidence: KPI Center, Engineering KPI (/kpi-engine), KPI Command (/kpi-command), Board Overview, Executive Report, Executive Analytics, Advanced Analytics, Fleet Analytics, Fleet Intelligence, Ops Intelligence all present overlapping fleet KPIs.
- Remediation: Fix the unique key and conflict target (include organisation, coalesce nulls), then role-gate the editor. Risk to current company: low (7 rows). Priority P1. Area: DB, web.
- Tests: page render tests: none; service or engine test files referencing its libraries: 8. All run against a mocked Supabase client.
- Branch versus main: On the branch the menu no longer lists /kpi-engine and /kpi-command (routes remain, ModuleRoute kpi_scorecard). On main both have menu items.

#### Performance Benchmark (`/benchmark`)
- Page: `src/pages/PerformanceBenchmark.jsx`. Module key: analytics. Guard: `<ModuleRoute moduleKey="analytics"><PerformanceBenchmark /></ModuleRoute>`.
- Tables: accidents, corrective_actions, inspections, tyre_records. RPCs: report_asset_metrics, report_country_metrics, report_country_trends.
- What it does: Fleet KPIs against a static industry reference; the page states the reference is static.
- Brand-new empty company: Not measurable states.
- Internal: **ready**. Commercial: **class 3, Needs functional or data-quality repairs**.
- Defect MODC-56 (P3): Reference values are constants with no source; disclosed on screen. Evidence: src/pages/PerformanceBenchmark.jsx:364 static industry reference banner.
- Remediation: Let tenants enter their own reference or remove. Priority P3. Area: web.
- Tests: page render tests: none; service or engine test files referencing its libraries: 3. All run against a mocked Supabase client.

#### SLA Dashboard (`/sla-dashboard`)
- Page: `src/pages/SlaDashboard.jsx`. Module key: sla_dashboard. Guard: `<RoleRoute allowed={['Admin']}><SlaDashboard /></RoleRoute>`.
- Tables: sla_records. RPCs: none.
- What it does: Manual SLA record register with status roll-up.
- Brand-new empty company: Honest empty state.
- Internal: **ready**. Commercial: **class 4, Incomplete or future development**. Switched off in Module Control today.
- Defect MODC-09 (P2): see section 3.
- Defect MODC-57 (P2): SLA rows are typed by hand; nothing measures work orders, breakdowns or approvals against an SLA. Evidence: no database function or trigger references sla_records.
- Remediation: Do not market as SLA monitoring. Future development. Priority P3. Area: web.
- Tests: page render tests: none; service or engine test files referencing its libraries: 8. All run against a mocked Supabase client.

#### Site Comparison (`/site-comp`)
- Page: `src/pages/SiteComparison.jsx`. Module key: site_comparison. Guard: `<ModuleRoute moduleKey="site_comparison"><SiteComparison /></ModuleRoute>`.
- Tables: tyre_records. RPCs: none.
- What it does: Site comparison on tyre records; absorbs period Comparison as a tab on the branch.
- Brand-new empty company: Empty; needs sites and tyre records.
- Internal: **ready**. Commercial: **class 2, Functional but requires customer setup or data**.
- Remediation: Keep. Priority P3. Area: web.
- Tests: page render tests: none; service or engine test files referencing its libraries: 7. All run against a mocked Supabase client.
- Branch versus main: On the branch /comparison redirects to /site-comp?tab=periods. On main /comparison is its own page and menu item.

#### Country Comparison (`/country-comp`)
- Page: `src/pages/CountryComparison.jsx`. Module key: country_comparison. Guard: `<ModuleRoute moduleKey="country_comparison"><CountryComparison /></ModuleRoute>`.
- Tables: tyre_records. RPCs: get_expense_period_trend.
- What it does: Country comparison, each country in its own currency.
- Brand-new empty company: Empty; offers KSA, UAE, Egypt only.
- Internal: **ready**. Commercial: **class 3, Needs functional or data-quality repairs**.
- Defect MODC-13 (P2): see section 3.
- Remediation: Drive the country list from the tenant sites. Priority P3. Area: web.
- Tests: page render tests: none; service or engine test files referencing its libraries: 8. All run against a mocked Supabase client.

#### Fleet Analytics (`/fleet`)
- Page: `src/pages/FleetAnalytics.jsx`. Module key: fleet_analytics. Guard: `<ModuleRoute moduleKey="fleet_analytics"><FleetAnalytics /></ModuleRoute>`.
- Tables: accidents, corrective_actions, inspections, pm_service_records, tyre_records, work_orders. RPCs: get_maint_tyre_split, get_parts_expense_snapshot, get_tyre_cost_by_asset, report_asset_metrics, report_country_metrics, report_country_trends.
- What it does: Fleet analytics by asset and country from report RPCs.
- Brand-new empty company: Empty.
- Internal: **ready**. Commercial: **class 5, Duplicate requiring controlled consolidation**.
- Defect MODC-54 (P2): Ten overlapping dashboards. The branch merges some into tabs; main still lists them separately. Evidence: KPI Center, Engineering KPI (/kpi-engine), KPI Command (/kpi-command), Board Overview, Executive Report, Executive Analytics, Advanced Analytics, Fleet Analytics, Fleet Intelligence, Ops Intelligence all present overlapping fleet KPIs.
- Remediation: Consolidate. Priority P3. Area: web.
- Tests: page render tests: none; service or engine test files referencing its libraries: 8. All run against a mocked Supabase client.

#### Fleet Intelligence (`/fleet-intelligence`)
- Page: `src/pages/FleetIntelligence.jsx`. Module key: fleet_intelligence. Guard: `<ModuleRoute moduleKey="fleet_intelligence"><FleetIntelligence /></ModuleRoute>`.
- Tables: inspections, tyre_records, vehicle_fleet. RPCs: none.
- What it does: Fleet insight page on tyres, fleet and inspections.
- Brand-new empty company: Empty.
- Internal: **ready**. Commercial: **class 5, Duplicate requiring controlled consolidation**.
- Defect MODC-54 (P2): Ten overlapping dashboards. The branch merges some into tabs; main still lists them separately. Evidence: KPI Center, Engineering KPI (/kpi-engine), KPI Command (/kpi-command), Board Overview, Executive Report, Executive Analytics, Advanced Analytics, Fleet Analytics, Fleet Intelligence, Ops Intelligence all present overlapping fleet KPIs.
- Remediation: Consolidate. Priority P3. Area: web.
- Tests: page render tests: none; service or engine test files referencing its libraries: 2. All run against a mocked Supabase client.

#### Ops Intelligence (`/ops-intelligence`)
- Page: `src/pages/OpsIntelligence.jsx`. Module key: ops_intelligence. Guard: `<RoleRoute allowed={['Admin']}><OpsIntelligence /></RoleRoute>`.
- Tables: budgets, engine_hours_logs, inspections, odometer_logs, pm_programs, pm_service_records, tyre_records, vehicle_fleet, work_orders. RPCs: get_cost_cpk_overview, get_expense_by_country, get_tyre_cost_by_asset, record_pm_service.
- What it does: Fleet health pulse, anomaly feed, financials (N/A on mixed currency).
- Brand-new empty company: Empty; health score N/A.
- Internal: **ready**. Commercial: **class 5, Duplicate requiring controlled consolidation**.
- Defect MODC-54 (P2): Ten overlapping dashboards. The branch merges some into tabs; main still lists them separately. Evidence: KPI Center, Engineering KPI (/kpi-engine), KPI Command (/kpi-command), Board Overview, Executive Report, Executive Analytics, Advanced Analytics, Fleet Analytics, Fleet Intelligence, Ops Intelligence all present overlapping fleet KPIs.
- Remediation: Consolidate. Priority P3. Area: web.
- Tests: page render tests: none; service or engine test files referencing its libraries: 8. All run against a mocked Supabase client.

#### Forecasting Engine (`/forecasting`)
- Page: `src/pages/ForecastingEngine.jsx`. Module key: forecasting. Guard: `<ModuleRoute moduleKey="forecasting"><ForecastingEngine /></ModuleRoute>`.
- Tables: tyre_records, vehicle_fleet. RPCs: none.
- What it does: Tyre demand and spend forecast by size with stated period and stale-data warning.
- Brand-new empty company: Empty until tyre fitment history exists (needs several months).
- Internal: **ready**. Commercial: **class 2, Functional but requires customer setup or data**.
- Remediation: Keep. See ENGINEERING_CALCULATIONS. Priority P3. Area: web.
- Tests: page render tests: none; service or engine test files referencing its libraries: 4. All run against a mocked Supabase client.

#### Fleet Optimizer (`/fleet-optimizer`)
- Page: `src/pages/FleetOptimizer.jsx`. Module key: fleet_optimizer. Guard: `<RoleRoute allowed={['Admin']}><FleetOptimizer /></RoleRoute>`.
- Tables: fleet_optimizer_scenarios. RPCs: none.
- What it does: Manual scenario register (keep, replace, redeploy, dispose) per asset.
- Brand-new empty company: Honest empty state.
- Internal: **ready**. Commercial: **class 4, Incomplete or future development**. Switched off in Module Control today.
- Defect MODC-09 (P2): see section 3.
- Defect MODC-58 (P2): Named optimizer but performs no optimisation. Evidence: fleet_optimizer_scenarios rows are typed by the user; no optimisation is computed.
- Remediation: Do not market. Rename or build. Priority P3. Area: web.
- Tests: page render tests: none; service or engine test files referencing its libraries: 8. All run against a mocked Supabase client.

#### Carbon Tracker (`/carbon-tracker`)
- Page: `src/pages/CarbonTracker.jsx`. Module key: carbon_tracker. Guard: `<RoleRoute allowed={['Admin', 'Manager', 'Director']}><CarbonTracker /></RoleRoute>`.
- Tables: carbon_initiatives, carbon_offsets, tyre_records, vehicle_fleet. RPCs: none.
- What it does: Lifecycle CO2 estimate from tyre fitments, offsets and initiatives registers.
- Brand-new empty company: Estimates appear as soon as tyres exist; offsets empty.
- Internal: **at risk**. Commercial: **class 3, Needs functional or data-quality repairs**. Switched off in Module Control today.
- Defect MODC-59 (P2): A cost the user never entered is stored as fact. VERIFIED. Evidence: src/lib/api/carbon.js:186 aed_cost defaults to Math.round(tonnes * 90) when the user leaves cost blank.
- Defect MODC-60 (P2): Emission factors and currency are fixed to the UAE. Evidence: src/pages/CarbonTracker.jsx:344 transport to the UAE factor; :545,561 cost shown as AED; column carbon_offsets.aed_cost.
- Remediation: Store null when cost is blank; make factors and currency configurable. Module is switched off, so no risk today. Priority P2. Area: web, DB.
- Tests: page render tests: none; service or engine test files referencing its libraries: 3. All run against a mocked Supabase client.

#### Continuous Improvement (`/continuous-improvement`)
- Page: `src/pages/ContinuousImprovement.jsx`. Module key: analytics. Guard: `<ModuleRoute moduleKey="analytics"><ContinuousImprovement /></ModuleRoute>`.
- Tables: corrective_actions, inspections, kpi_targets, tyre_records. RPCs: none.
- What it does: Improvement tracking from tyre records, inspections, corrective actions and KPI targets.
- Brand-new empty company: Empty.
- Internal: **ready**. Commercial: **class 5, Duplicate requiring controlled consolidation**.
- Defect MODC-54 (P2): Ten overlapping dashboards. The branch merges some into tabs; main still lists them separately. Evidence: KPI Center, Engineering KPI (/kpi-engine), KPI Command (/kpi-command), Board Overview, Executive Report, Executive Analytics, Advanced Analytics, Fleet Analytics, Fleet Intelligence, Ops Intelligence all present overlapping fleet KPIs.
- Remediation: Consolidate. Priority P3. Area: web.
- Tests: page render tests: none; service or engine test files referencing its libraries: 3. All run against a mocked Supabase client.

#### Reports (`/reports`)
- Page: `src/pages/Reports.jsx`. Module key: reports. Guard: `<ModuleRoute moduleKey="reports"><Reports /></ModuleRoute>`.
- Tables: engine_hours_logs, inspections, odometer_logs, pm_programs, pm_service_records, tyre_records, vehicle_fleet. RPCs: record_pm_service.
- What it does: Report wizard: Tyre replacement, cost, risk, vehicle history, inspection, PM reports; column chooser; Excel/PDF; paged reads up to 100000.
- Brand-new empty company: Empty result with disabled export.
- Internal: **ready**. Commercial: **class 2, Functional but requires customer setup or data**.
- Defect MODC-61 (P3): Site suggestion list can be incomplete. Evidence: src/pages/Reports.jsx:178 site suggestions from the first 200 tyre rows, unordered.
- Defect MODC-62 (P3): Risk report is empty for the current data. Evidence: Risk Summary filters tyre_records.risk_level (PROJECT_MEMORY: populated on 0 rows).
- Remediation: Use the site register for suggestions. Priority P3. Area: web.
- Tests: page render tests: none; service or engine test files referencing its libraries: 4. All run against a mocked Supabase client.

#### Report Center (`/report-center`)
- Page: `src/pages/ReportCenter.jsx`. Module key: reports. Guard: `<ModuleRoute moduleKey="reports"><ReportCenter /></ModuleRoute>`.
- Tables: accident_report_templates, audit_log_v2, corrective_actions, report_schedules, report_send_log, tyre_records. RPCs: report_tyre_summary.
- What it does: Report hub with history of sent reports and quick packs.
- Brand-new empty company: Empty history.
- Internal: **ready**. Commercial: **class 2, Functional but requires customer setup or data**.
- Remediation: Keep. Priority P3. Area: web.
- Tests: page render tests: none; service or engine test files referencing its libraries: 8. All run against a mocked Supabase client.

#### Report Sharing (`/report-sharing`)
- Page: `src/pages/ReportSharing.jsx`. Module key: report_sharing. Guard: `<RoleRoute allowed={['Admin']}><ReportSharing /></RoleRoute>`.
- Tables: report_shares. RPCs: create_report_share, get_report_snapshot, get_report_tyre_maintenance, get_workshop_snapshot, revoke_report_share.
- What it does: Mint and manage public rotating report boards (/report/:token) with custom layouts; anonymous read through token RPCs.
- Brand-new empty company: Admin can mint a link; the board shows zeros or N/A with no data.
- Internal: **ready**. Commercial: **class 3, Needs functional or data-quality repairs**.
- Defect MODC-02 (P1): see section 3.
- Defect MODC-14 (P3): see section 3.
- Defect MODC-63 (P2): Public board content includes company-specific cost sources. Evidence: get_report_snapshot returns cost block from SCO and SANY sources and ops panels (PROJECT_MEMORY V522, V279).
- Remediation: Read company name and logo from the token organisation branding (get_org_branding already exists). Risk to current company: low; verify the board still shows its logo. Priority P1. Area: DB.
- Tests: page render tests: none; service or engine test files referencing its libraries: 2. All run against a mocked Supabase client.

#### Scheduled Reports (`/scheduled-reports`)
- Page: `src/pages/ScheduledReports.jsx`. Module key: scheduled_reports. Guard: `<RoleRoute allowed={['Admin', 'Manager', 'Director']}><FlagRoute flag="report_scheduling"><ScheduledReports /></FlagRoute></RoleRoute>`.
- Tables: accident_report_templates, report_schedules. RPCs: none.
- What it does: Create schedules (13 types plus saved builder layouts), Generate now PDF/Excel, Send now, delivery log; cron every 15 minutes through the send-scheduled-reports edge function.
- Brand-new empty company: Admin can create a schedule; an empty company receives an email of zeros.
- Internal: **at risk**. Commercial: **class 3, Needs functional or data-quality repairs**.
- Defect MODC-05 (P1): see section 3.
- Defect MODC-11 (P2): see section 3.
- Defect MODC-64 (P2): One sender for all tenants; digest row lists are capped at 1000. Evidence: supabase/functions/send-scheduled-reports/index.ts:1285 FROM_EMAIL default reports@tyrepulse.app, :1039 limit(5000) on a 1000-row capped API (count is exact).
- Defect MODC-65 (P3): Delivery works today for the current tenant; deployed version parity NOT VERIFIED. Evidence: report_send_log: 197 sent (latest 2026-11-12), 61 failed (latest 2026-07-11); deployed function body not compared with the repo in this audit.
- Remediation: Per-country sections with their own currency in the digest; per-organisation timezone; add a restrictive organisation policy on report_schedules. Risk to current company: medium for the digest change (numbers in the email will change), none for the policy. Priority P1. Area: edge fn, DB.
- Tests: page render tests: none; service or engine test files referencing its libraries: 8. All run against a mocked Supabase client.

#### Dashboard Builder (`/dashboard-builder`)
- Page: `src/pages/DashboardBuilder.jsx`. Module key: dashboard_builder. Guard: `<RoleRoute allowed={['Admin']}><DashboardBuilder /></RoleRoute>`.
- What it does: Widget dashboard builder with global filters; layouts saved per user or in organisation settings.
- Brand-new empty company: Widgets show empty states.
- Internal: **ready**. Commercial: **class 2, Functional but requires customer setup or data**.
- Defect MODC-66 (P3): Persistence path depends on a migration whose live state was NOT VERIFIED. Evidence: src/lib/api/savedViews.js header: falls back to one shared app_settings row when per-user tables are absent.
- Remediation: Verify report_definitions and user_dashboards exist live. Priority P3. Area: DB.
- Tests: page render tests: none; service or engine test files referencing its libraries: 5. All run against a mocked Supabase client.

#### TV Display Mode (`/display`)
- Page: `src/pages/DisplayDashboard.jsx`. Module key: display. Guard: `ProtectedRoute + FlagRoute tv_display (src/App.jsx:613-619), outside the Layout`.
- What it does: Authenticated TV kiosk boards (today, fleet, tyres, accidents, PM, workshop).
- Brand-new empty company: Boards render zeros or N/A.
- Internal: **ready**. Commercial: **class 2, Functional but requires customer setup or data**.
- Remediation: Keep. Priority P3. Area: web.
- Tests: page render tests: none; service or engine test files referencing its libraries: 0. All run against a mocked Supabase client.

#### Smart Analytics (AI) (`/ai-command-center`)
- Page: `src/pages/AiCommandCenter.jsx`. Module key: ai_command_center. Guard: `<FlagRoute flag="ai_tools"><ModuleRoute moduleKey="ai_command_center"><AiCommandCenter /></ModuleRoute></FlagRoute>`.
- Tables: ai_models, ai_token_logs, ai_usage_log, alerts, organisations, pm_programs, report_send_log. RPCs: none.
- What it does: AI chat with six agents over loaded context. Depth is owned by the AI agent.
- Brand-new empty company: Agents answer with little or no data.
- Internal: **at risk**. Commercial: **class 3, Needs functional or data-quality repairs**.
- Defect MODC-67 (P2): AI budget and switches are platform wide, not per tenant. See AI_READINESS. Evidence: system_config ai_enabled, ai_model, ai_monthly_budget_usd, ai_rate_limit_per_min are global.
- Remediation: See AI report. Priority P2. Area: edge fn.
- Tests: page render tests: none; service or engine test files referencing its libraries: 7. All run against a mocked Supabase client.

#### Knowledge Base (`/knowledge-base`)
- Page: `src/pages/KnowledgeBase.jsx`. Module key: knowledge_base. Guard: `<FlagRoute flag="ai_tools"><KnowledgeBase /></FlagRoute>`.
- Tables: knowledge_documents. RPCs: kb_approve_document, kb_withdraw_document.
- What it does: Document knowledge base with lifecycle (draft, approved, superseded) and embeddings.
- Brand-new empty company: Empty (0 documents live); first action is add document.
- Internal: **ready**. Commercial: **class 2, Functional but requires customer setup or data**.
- Defect MODC-68 (P3): Any role can open the page by URL; writes are refused by RLS for others. Evidence: route guard FlagRoute ai_tools only; write policy Admin and Manager.
- Remediation: Add a role guard. Priority P3. Area: web.
- Tests: page render tests: knowledgeBaseLifecycle.render.test.jsx; service or engine test files referencing its libraries: 8. All run against a mocked Supabase client.

#### AI Cost Monitor (`/ai-cost-monitor`)
- Page: `src/pages/AiCostMonitor.jsx`. Module key: ai_cost_monitor. Guard: `<FlagRoute flag="ai_tools"><AiCostMonitor /></FlagRoute>`.
- What it does: AI token usage and cost by model and feature.
- Brand-new empty company: Empty.
- Internal: **ready**. Commercial: **class 6, Internal administrator-only or legacy**.
- Defect MODC-69 (P3): Other roles reach an empty page by URL. Evidence: route guard FlagRoute ai_tools only; ai_token_logs SELECT limited to Admin, Manager, Director.
- Remediation: Internal or platform tool; role guard. Priority P3. Area: web.
- Tests: page render tests: aiCostMonitor.render.test.jsx; service or engine test files referencing its libraries: 8. All run against a mocked Supabase client.

#### Public report board (no menu) (`/report/:token`)
- Page: `src/pages/ReportShare.jsx`. Module key: none. Guard: `none (anonymous, token RPC)`.
- What it does: Anonymous rotating board for a share token.
- Brand-new empty company: Zeros or N/A.
- Internal: **ready**. Commercial: **class 3, Needs functional or data-quality repairs**.
- Defect MODC-02 (P1): see section 3.
- Defect MODC-14 (P3): see section 3.
- Remediation: See Report Sharing. Priority P1. Area: DB.
- Tests: page render tests: none; service or engine test files referencing its libraries: 0. All run against a mocked Supabase client.

#### Report Builder (no menu) (`/report-builder`)
- Page: `src/pages/ReportBuilder.jsx`. Module key: none. Guard: `RoleRoute ['Admin']`.
- What it does: Multi-block report builder over datasets, saved per user.
- Brand-new empty company: Empty preview.
- Internal: **ready**. Commercial: **class 2, Functional but requires customer setup or data**.
- Remediation: Add a menu entry or fold into Reports. Priority P3. Area: web.
- Tests: page render tests: none; service or engine test files referencing its libraries: 0. All run against a mocked Supabase client.

#### Engineering KPI and KPI Command (menu on main only) (`/kpi-engine`)
- Page: `src/pages/EngineeringKpi.jsx, KpiCommandCenter.jsx`. Module key: none. Guard: `ModuleRoute kpi_scorecard`.
- What it does: Engineering KPI home and KPI command centre. See ENGINEERING_CALCULATIONS.
- Brand-new empty company: N/A.
- Internal: **ready**. Commercial: **class 5, Duplicate requiring controlled consolidation**.
- Defect MODC-54 (P2): Ten overlapping dashboards. The branch merges some into tabs; main still lists them separately. Evidence: KPI Center, Engineering KPI (/kpi-engine), KPI Command (/kpi-command), Board Overview, Executive Report, Executive Analytics, Advanced Analytics, Fleet Analytics, Fleet Intelligence, Ops Intelligence all present overlapping fleet KPIs.
- Remediation: Controlled consolidation into KPI Center. Priority P3. Area: web.
- Tests: page render tests: none; service or engine test files referencing its libraries: 0. All run against a mocked Supabase client.
- Branch versus main: Main: two menu items. Branch: routes kept, menu items removed.

#### Executive Report and Executive Analytics (`/executive-report`)
- Page: `src/pages/ExecutiveReport.jsx, ExecutiveAnalytics.jsx`. Module key: none. Guard: `ModuleRoute executive_report; RoleRoute Admin/Manager/Director`.
- What it does: Customisable executive report with PDF/PPTX/Excel; chart-rich executive analytics.
- Brand-new empty company: N/A.
- Internal: **ready**. Commercial: **class 5, Duplicate requiring controlled consolidation**.
- Defect MODC-54 (P2): Ten overlapping dashboards. The branch merges some into tabs; main still lists them separately. Evidence: KPI Center, Engineering KPI (/kpi-engine), KPI Command (/kpi-command), Board Overview, Executive Report, Executive Analytics, Advanced Analytics, Fleet Analytics, Fleet Intelligence, Ops Intelligence all present overlapping fleet KPIs.
- Defect MODC-87 (P2): Two spend sources on one report. NOT re-verified in this audit; see ENGINEERING_CALCULATIONS. Evidence: PROJECT_MEMORY 2026-07-24: ExecutiveReport totalSpend sums cost_per_tyre while the cost panel uses the grid.
- Remediation: Consolidate. Priority P2. Area: web.
- Tests: page render tests: none; service or engine test files referencing its libraries: 0. All run against a mocked Supabase client.
- Branch versus main: Main: two menu items. Branch: one Executive entry.

#### Analytics, Comparison (merged on branch) (`/analytics`)
- Page: `src/pages/Analytics.jsx, Comparison.jsx`. Module key: none. Guard: `main: ModuleRoute analytics; branch: Navigate redirect`.
- What it does: Older analytics and period comparison pages.
- Brand-new empty company: Empty charts.
- Internal: **ready**. Commercial: **class 5, Duplicate requiring controlled consolidation**.
- Defect MODC-54 (P2): Ten overlapping dashboards. The branch merges some into tabs; main still lists them separately. Evidence: KPI Center, Engineering KPI (/kpi-engine), KPI Command (/kpi-command), Board Overview, Executive Report, Executive Analytics, Advanced Analytics, Fleet Analytics, Fleet Intelligence, Ops Intelligence all present overlapping fleet KPIs.
- Remediation: Branch consolidation is correct. Priority P3. Area: web.
- Tests: page render tests: none; service or engine test files referencing its libraries: 0. All run against a mocked Supabase client.
- Branch versus main: Main: live pages with menu items. Branch: /analytics redirects to /advanced-analytics, /comparison to /site-comp?tab=periods.

### Automation

#### Event Stream (`/events`)
- Page: `src/pages/EventStream.jsx`. Module key: events. Guard: `<FlagRoute flag="automation_platform"><EventStream /></FlagRoute>`.
- Tables: domain_events, event_consumers. RPCs: none.
- What it does: Domain event stream viewer (latest 500) with consumer list.
- Brand-new empty company: Empty for a new company.
- Internal: **ready**. Commercial: **class 6, Internal administrator-only or legacy**.
- Defect MODC-70 (P3): Platform internals are shown to tenant managers. Evidence: route guard FlagRoute automation_platform only; event_consumers is a global table readable by elevated users.
- Remediation: Keep as an admin diagnostic. Priority P3. Area: web.
- Tests: page render tests: none; service or engine test files referencing its libraries: 3. All run against a mocked Supabase client.

#### Approval Workflows (`/workflow-settings`)
- Page: `src/pages/WorkflowSettings.jsx`. Module key: workflow_settings. Guard: `<FlagRoute flag="automation_platform"><WorkflowSettings /></FlagRoute>`.
- Tables: approval_delegations, workflow_definitions, workflow_instances, workflow_step_events. RPCs: approval_dashboard, my_pending_approvals, start_workflow, workflow_act, workflow_cancel.
- What it does: Approval workflow definitions with builder and starter templates, runs and decisions.
- Brand-new empty company: No definitions for a new company; starter templates can be used to create them.
- Internal: **ready**. Commercial: **class 2, Functional but requires customer setup or data**.
- Defect MODC-12 (P2): see section 3.
- Defect MODC-71 (P3): Non-admin roles reach the page by URL; saves are refused by RLS. Evidence: route guard FlagRoute automation_platform only (nav is Admin only); writes need elevated role by RLS.
- Remediation: Seed starter workflows on organisation creation. Priority P2. Area: DB.
- Tests: page render tests: deepenedPages.render.test.jsx; service or engine test files referencing its libraries: 8. All run against a mocked Supabase client.

#### Approval Delegations (`/approval-delegations`)
- Page: `src/pages/ApprovalDelegations.jsx`. Module key: approval_delegations. Guard: `<FlagRoute flag="automation_platform"><ApprovalDelegations /></FlagRoute>`.
- Tables: approval_delegations. RPCs: none.
- What it does: Delegate approvals for a date window.
- Brand-new empty company: Empty; first action is add delegation.
- Internal: **ready**. Commercial: **class 2, Functional but requires customer setup or data**.
- Remediation: Keep. Priority P3. Area: web.
- Tests: page render tests: none; service or engine test files referencing its libraries: 8. All run against a mocked Supabase client.

#### Approval Matrix (`/approval-matrix`)
- Page: `src/pages/ApprovalMatrix.jsx`. Module key: approval_matrix. Guard: `<RoleRoute allowed={['Admin']}><ApprovalMatrix /></RoleRoute>`.
- Tables: approval_policies, approval_policy_events, custom_roles, sites, vehicle_fleet. RPCs: approval_region_coverage, reference_site_options.
- What it does: Approval policies (who signs what) with coverage check; governed versions.
- Brand-new empty company: Empty; admin must publish policies. 3 policies exist for the current company.
- Internal: **ready**. Commercial: **class 2, Functional but requires customer setup or data**.
- Defect MODC-12 (P2): see section 3.
- Defect MODC-72 (P2): A buyer sees two places to configure approvals. Evidence: two approval engines in use: workflow_definitions (Approval Workflows) and approval_policies (Approval Matrix).
- Remediation: Document which engine governs which approval, or merge. Priority P2. Area: web.
- Tests: page render tests: approvalPolicies.page.test.jsx; service or engine test files referencing its libraries: 8. All run against a mocked Supabase client.

#### Automation Rules (`/automation-rules`)
- Page: `src/pages/AutomationRules.jsx`. Module key: automation_rules. Guard: `<FlagRoute flag="automation_platform"><AutomationRules /></FlagRoute>`.
- Tables: business_rules, rule_executions. RPCs: none.
- What it does: Event rules (if event and conditions then action) with builder.
- Brand-new empty company: Empty; first action is create rule.
- Internal: **at risk**. Commercial: **class 4, Incomplete or future development**.
- Defect MODC-73 (P2): No rule has ever executed in production; the engine is unproven. Null-organisation rules would be shared. Evidence: rule_executions has 0 rows; business_rules has 1 row; SELECT policy shows organisation_id IS NULL rules to every tenant.
- Remediation: Prove with an end to end test before marketing. Priority P2. Area: DB.
- Tests: page render tests: none; service or engine test files referencing its libraries: 2. All run against a mocked Supabase client.

#### API & Webhooks (`/integrations`)
- Page: `src/pages/Integrations.jsx`. Module key: integrations. Guard: `<FlagRoute flag="automation_platform"><Integrations /></FlagRoute>`.
- Tables: api_keys, invoices, org_subscriptions, subscription_plans, webhook_deliveries, webhook_subscriptions. RPCs: create_api_key, ensure_org_subscription, get_subscription_overview, org_can_add, revoke_api_key.
- What it does: API keys and outbound webhooks (webhook_subscriptions delivered by pg_net cron).
- Brand-new empty company: Empty; admin can create a key or webhook.
- Internal: **at risk**. Commercial: **class 4, Incomplete or future development**.
- Defect MODC-74 (P1): Outbound webhooks have never delivered successfully and no API key has been issued in production. VERIFIED counts; cause not investigated. Evidence: webhook_deliveries: 9 pending since 2026-07-14, 3 failed, 0 delivered; 0 of 2 subscriptions active; api_keys 0 rows.
- Defect MODC-75 (P2): Two webhook registries; the Developer Portal one delivers nothing. Evidence: src/pages/DeveloperPortal.jsx uses webhook_endpoints, which no delivery function reads; Integrations uses webhook_subscriptions.
- Remediation: Fix or retire one registry; prove delivery end to end. See API_SECURITY_MATRIX. Priority P1. Area: DB, edge fn.
- Tests: page render tests: none; service or engine test files referencing its libraries: 7. All run against a mocked Supabase client.

### Administration

#### Data Intake Center (`/data-intake`)
- Page: `src/pages/DataIntakeCenter.jsx`. Module key: data_intake. Guard: `<RoleRoute allowed={['Admin', 'Manager', 'Director']}><FlagRoute flag="data_intake"><DataIntakeCenter /></FlagRoute></RoleRoute>`.
- Tables: alerts, corrective_actions, currency_rates, custom_field_catalog, import_attachment_matches, import_batch_sheets, import_batches, import_files, import_mapping_profiles, import_mapping_rules, import_master_aliases, import_row_issues. RPCs: admin_check_import_fingerprint, admin_import_history, admin_unlogged_imports, cost_apply_actual_budgets, cost_budget_overview, cost_clear_value, cost_convert_line_totals, cost_set_monthly_budget.
- What it does: Import centre: generic staged import for 10 modules with mapping memory, validation, approval, commit and reversal; plus ERP report auto-detect, expense grid, templates, production, SCO and SANY tabs.
- Brand-new empty company: A new company can import fleet, tyres, stock and more from Excel with reversible batches. This is the main first action.
- Internal: **ready**. Commercial: **class 3, Needs functional or data-quality repairs**.
- Defect MODC-76 (P1): Null-organisation imports are stamped to the current company while single tenant mode is on; company-specific tabs are shown to every tenant. Evidence: trigger stamp_import_default_org with system_config.single_tenant_mode = true; src/pages/DataIntakeCenter.jsx:1089-1095 tabs for ERP reports, production, SCO Cost, SANY Invoices; src/lib/erpIntake.js Ramco detection.
- Defect MODC-10 (P2): see section 3.
- Remediation: Per-organisation flag for the ERP specific tabs; switch off single tenant mode before a second tenant. Risk to current company: medium (dashboard CSV loads rely on the stamp). Priority P1. Area: DB, web.
- Tests: page render tests: executiveReportIntake.render.test.jsx; service or engine test files referencing its libraries: 8. All run against a mocked Supabase client.
- Branch versus main: On the branch /erp-intake, /expense-import and /erp-import redirect here as tabs. On main they are three separate pages with menu items.

#### Upload Approvals (`/upload-approvals`)
- Page: `src/pages/UploadApprovals.jsx`. Module key: upload_approvals. Guard: `<FlagRoute flag="data_intake"><UploadApprovals /></FlagRoute>`.
- Tables: alerts, corrective_actions, currency_rates, custom_field_catalog, import_attachment_matches, import_batch_sheets, import_batches, import_files, import_mapping_profiles, import_mapping_rules, import_master_aliases, import_row_issues. RPCs: cost_apply_actual_budgets, cost_budget_overview, cost_clear_value, cost_convert_line_totals, cost_set_monthly_budget, data_completeness, data_link_audit, data_link_create_missing_assets.
- What it does: Approver desk for import batches and legacy pending uploads.
- Brand-new empty company: Empty queues.
- Internal: **ready**. Commercial: **class 5, Duplicate requiring controlled consolidation**. Switched off in Module Control today.
- Defect MODC-77 (P3): Legacy path kept beside the new one. Evidence: two queues: import_batches and legacy pending_uploads.
- Remediation: Retire pending_uploads when mobile no longer writes it. Priority P3. Area: web.
- Tests: page render tests: none; service or engine test files referencing its libraries: 8. All run against a mocked Supabase client.

#### Data Cleaning (`/cleaning`)
- Page: `src/pages/DataCleaning.jsx`. Module key: data_cleaning. Guard: `<ModuleRoute moduleKey="data_cleaning"><DataCleaning /></ModuleRoute>`.
- What it does: Data cleaning scans over tyre records with paged reads.
- Brand-new empty company: Nothing to clean.
- Internal: **ready**. Commercial: **class 2, Functional but requires customer setup or data**.
- Remediation: Keep. Priority P3. Area: web.
- Tests: page render tests: dataCleaning.page.test.jsx; service or engine test files referencing its libraries: 8. All run against a mocked Supabase client.

#### Data Reconciliation (`/data-reconciliation`)
- Page: `src/pages/DataReconciliation.jsx`. Module key: data_reconciliation. Guard: `<RoleRoute allowed={['Admin','Manager','Director']}><DataReconciliation /></RoleRoute>`.
- What it does: Data quality hub: orphans, duplicates, brand gaps, job card dates, trust scores, tyre price and evidence sections.
- Brand-new empty company: Empty sections.
- Internal: **ready**. Commercial: **class 3, Needs functional or data-quality repairs**.
- Defect MODC-78 (P2): Guard mismatch; company-specific sections. Evidence: nav is Admin only but the route admits Manager and Director; several sections are built on the current company data history (KSA master upload, job card date repair).
- Remediation: Align guard; hide master-upload sections for other tenants. Priority P3. Area: web.
- Tests: page render tests: dataReconciliationPage.render.test.jsx; service or engine test files referencing its libraries: 8. All run against a mocked Supabase client.

#### Custom Data (`/custom-data`)
- Page: `src/pages/CustomData.jsx`. Module key: custom_data. Guard: `<ModuleRoute moduleKey="custom_data"><CustomData /></ModuleRoute>`.
- Tables: alerts, audit_event_reviews, corrective_actions, currency_rates, custom_field_catalog, field_synonyms, import_attachment_matches, import_batch_sheets, import_batches, import_files, import_mapping_profiles, import_mapping_rules. RPCs: cost_apply_actual_budgets, cost_budget_overview, cost_clear_value, cost_convert_line_totals, cost_set_monthly_budget, data_completeness, data_link_audit, data_link_create_missing_assets.
- What it does: Custom field manager for unmapped import columns and synonyms.
- Brand-new empty company: Empty.
- Internal: **ready**. Commercial: **class 2, Functional but requires customer setup or data**.
- Remediation: Keep. Priority P3. Area: web.
- Tests: page render tests: customData.page.test.jsx; service or engine test files referencing its libraries: 8. All run against a mocked Supabase client.

#### ERP Sync (`/erp-sync`)
- Page: `src/pages/ErpSync.jsx`. Module key: erp_sync. Guard: `<FlagRoute flag="erp_sync"><ModuleRoute moduleKey="erp_sync"><ErpSync /></ModuleRoute></FlagRoute>`.
- What it does: Statement that no ERP connector is provisioned, with target systems listed as not configured and a link to Data Intake.
- Brand-new empty company: Same for every company.
- Internal: **ready**. Commercial: **class 4, Incomplete or future development**.
- Defect MODC-79 (P1): There is no ERP sync. The page is honest about it. Evidence: src/pages/ErpSync.jsx:13-18 no ERP connector is provisioned.
- Remediation: Must not be marketed as ERP integration. Hide from the menu. Priority P2. Area: marketing, web.
- Tests: page render tests: none; service or engine test files referencing its libraries: 0. All run against a mocked Supabase client.

#### OCR Scanner (`/ocr-scanner`)
- Page: `src/pages/OcrScanner.jsx`. Module key: ocr_scanner. Guard: `<RoleRoute allowed={['Admin']}><OcrScanner /></RoleRoute>`.
- Tables: ocr_scans. RPCs: none.
- What it does: Scan record and review queue; no OCR provider is connected (stated on the page).
- Brand-new empty company: Empty.
- Internal: **ready**. Commercial: **class 4, Incomplete or future development**. Switched off in Module Control today.
- Defect MODC-09 (P2): see section 3.
- Defect MODC-80 (P1): No OCR happens. Evidence: src/pages/OcrScanner.jsx header: extraction provider NOT connected.
- Remediation: Must not be marketed. Priority P3. Area: marketing.
- Tests: page render tests: none; service or engine test files referencing its libraries: 8. All run against a mocked Supabase client.

#### Advanced Search (`/advanced-search`)
- Page: `src/pages/AdvancedSearch.jsx`. Module key: advanced_search. Guard: `<RoleRoute allowed={['Admin', 'Manager', 'Director']}><AdvancedSearch /></RoleRoute>`.
- Tables: saved_searches. RPCs: none.
- What it does: Cross-entity search (assets, tyres, work orders, inspections) and saved searches.
- Brand-new empty company: No results.
- Internal: **ready**. Commercial: **class 2, Functional but requires customer setup or data**.
- Remediation: Keep. Priority P3. Area: web.
- Tests: page render tests: none; service or engine test files referencing its libraries: 8. All run against a mocked Supabase client.

#### Brand Assets (`/brand-assets`)
- Page: `src/pages/BrandAssets.jsx`. Module key: brand_assets. Guard: `<RoleRoute allowed={['Admin']}><BrandAssets /></RoleRoute>`.
- Tables: brand_asset_registry, system_config. RPCs: get_org_branding, set_org_branding.
- What it does: Brand gallery, tenant logo placements and governance.
- Brand-new empty company: Shipped library only.
- Internal: **ready**. Commercial: **class 3, Needs functional or data-quality repairs**.
- Defect MODC-02 (P1): see section 3.
- Defect MODC-81 (P2): A tenant Admin cannot change the report logo used by PDFs and public boards. Evidence: src/pages/BrandAssets.jsx header: reads system_config company_logo (global, super admin write) beside per-organisation branding.
- Remediation: Use organisation branding everywhere. Priority P2. Area: DB, web.
- Tests: page render tests: none; service or engine test files referencing its libraries: 7. All run against a mocked Supabase client.

#### Onboarding Wizard (`/onboarding-wizard`)
- Page: `src/pages/OnboardingWizard.jsx`. Module key: onboarding_wizard. Guard: `<RoleRoute allowed={['Admin']}><OnboardingWizard /></RoleRoute>`.
- Tables: module_permissions, onboarding_tasks, profiles. RPCs: create_workspace_owner.
- What it does: Go-live readiness measured from live data plus a hand-kept task checklist.
- Brand-new empty company: Readiness shows fails with next steps; checklist empty (0 rows, no default tasks).
- Internal: **at risk**. Commercial: **class 3, Needs functional or data-quality repairs**.
- Defect MODC-09 (P2): see section 3.
- Defect MODC-82 (P1): Self-serve workspace creation is not available. See the onboarding agent report. Evidence: RPC create_workspace_owner: authenticated has no EXECUTE (catalog); src/lib/api/onboarding.js:223 calls it.
- Remediation: See onboarding report. Priority P1. Area: DB.
- Tests: page render tests: none; service or engine test files referencing its libraries: 8. All run against a mocked Supabase client.

#### Audit Trail (`/audit`)
- Page: `src/pages/AuditTrail.jsx`. Module key: audit_trail. Guard: `<ModuleRoute moduleKey="audit_trail"><AuditTrail /></ModuleRoute>`.
- Tables: access_audit, audit_event_reviews, audit_log_v2, console_sessions, import_batches, profiles, upload_history. RPCs: reverse_legacy_upload.
- What it does: Audit trail with device, severity, uploads, exports tabs and Excel export.
- Brand-new empty company: Empty.
- Internal: **ready**. Commercial: **class 2, Functional but requires customer setup or data**.
- Remediation: Keep. Priority P3. Area: web.
- Tests: page render tests: auditTrail.page.test.jsx; service or engine test files referencing its libraries: 8. All run against a mocked Supabase client.

#### System Health (`/system-health`)
- Page: `src/pages/SystemHealth.jsx`. Module key: system_health. Guard: `<RoleRoute allowed={['Admin']}><SystemHealth /></RoleRoute>`.
- What it does: Subsystem reachability board (database, tables, buckets, edge functions, auth).
- Brand-new empty company: Same for every company.
- Internal: **ready**. Commercial: **class 6, Internal administrator-only or legacy**.
- Defect MODC-83 (P3): Platform internals shown to a tenant Admin. Evidence: src/pages/SystemHealth.jsx header: internal admin-only health board.
- Remediation: Move to the platform console only. Priority P3. Area: web.
- Tests: page render tests: none; service or engine test files referencing its libraries: 3. All run against a mocked Supabase client.

#### Usage & Adoption (`/tenant-health`)
- Page: `src/pages/TenantHealth.jsx`. Module key: tenant_health. Guard: `<RoleRoute allowed={['Admin']}><TenantHealth /></RoleRoute>`.
- What it does: Usage and adoption from profiles, audit log and AI logs.
- Brand-new empty company: Low numbers.
- Internal: **ready**. Commercial: **class 2, Functional but requires customer setup or data**.
- Remediation: Keep. Priority P3. Area: web.
- Tests: page render tests: none; service or engine test files referencing its libraries: 2. All run against a mocked Supabase client.

#### Developer Portal (`/developer-portal`)
- Page: `src/pages/DeveloperPortal.jsx`. Module key: developer_portal. Guard: `<RoleRoute allowed={['Admin','Manager','Director','Integration Admin']}><DeveloperPortal /></RoleRoute>`.
- Tables: api_keys, webhook_endpoints. RPCs: create_api_key, revoke_api_key.
- What it does: API keys (canonical api_keys) and a webhook endpoint register.
- Brand-new empty company: Empty.
- Internal: **at risk**. Commercial: **class 4, Incomplete or future development**.
- Defect MODC-75 (P2): Webhooks registered here are never delivered. Duplicate of API and Webhooks. Evidence: src/lib/api/developerPortal.js:129-200 webhook_endpoints; no delivery function reads that table.
- Remediation: Merge with API and Webhooks. Priority P2. Area: web.
- Tests: page render tests: developerPortalCanonicalKeys.test.jsx; service or engine test files referencing its libraries: 8. All run against a mocked Supabase client.

#### Settings (`/settings`)
- Page: `src/pages/Settings.jsx`. Module key: settings. Guard: `<Settings />`.
- Tables: account_deletion_requests, kpi_targets, notification_preferences, profiles, report_schedules, upload_history. RPCs: none.
- What it does: Profile, notifications, organisation settings (per organisation through RPC), KPI targets, feature flags, account deletion.
- Brand-new empty company: Defaults; admin sets company name and currency.
- Internal: **ready**. Commercial: **class 2, Functional but requires customer setup or data**.
- Defect MODC-03 (P1): see section 3.
- Defect MODC-84 (P2): Two sources of company name. Evidence: public.settings (global, 7 keys incl. company_name, currency_KSA) still exists beside per-organisation configuration and is read by public report RPCs.
- Remediation: Retire the global settings table after repointing the RPCs. Priority P2. Area: DB.
- Tests: page render tests: settings.configuration.page.test.jsx; service or engine test files referencing its libraries: 8. All run against a mocked Supabase client.

#### Request Access (`/request-access`)
- Page: `src/pages/RequestAccess.jsx`. Module key: request_access. Guard: `<RequestAccess />`.
- Tables: profiles. RPCs: admin_decide_elevation, admin_grant_elevation, admin_list_elevations, admin_revoke_elevation, cancel_elevation, my_elevation_requests, request_elevation.
- What it does: User requests a temporary capability; a super admin decides in the platform console.
- Brand-new empty company: Works; request waits.
- Internal: **at risk**. Commercial: **class 3, Needs functional or data-quality repairs**.
- Defect MODC-85 (P2): A customer Admin cannot approve requests from their own users; only the platform owner can. Evidence: src/pages/RequestAccess.jsx header: a super admin approves in /console/jit-elevation.
- Remediation: Let organisation Admins decide for their own organisation. Priority P2. Area: DB, console.
- Tests: page render tests: none; service or engine test files referencing its libraries: 8. All run against a mocked Supabase client.

#### Help & Support (`/help`)
- Page: `src/pages/HelpCenter.jsx`. Module key: help. Guard: `<HelpCenter />`.
- Tables: support_tickets. RPCs: none.
- What it does: FAQs, raise a ticket, my tickets, triage for organisation admins.
- Brand-new empty company: FAQs; no tickets.
- Internal: **ready**. Commercial: **class 3, Needs functional or data-quality repairs**.
- Defect MODC-86 (P2): Customer tickets do not reach the vendor support team. PLAUSIBLE (console issue inbox not traced). Evidence: src/pages/HelpCenter.jsx header: tickets land with the organisation administrators; support_tickets is organisation isolated.
- Remediation: Route a copy to vendor support. Priority P2. Area: web, console.
- Tests: page render tests: helpCenter.render.test.jsx; service or engine test files referencing its libraries: 8. All run against a mocked Supabase client.

#### ERP Intake, Expense Import, ERP Data Import (merged on branch) (`/erp-intake`)
- Page: `src/pages/ErpIntake.jsx, ExpenseImport.jsx, ErpImport.jsx`. Module key: none. Guard: `main: RoleRoute Admin/Manager/Director; branch: Navigate redirect`.
- What it does: Importers for the current company ERP exports (Ramco report auto-detect, expense grid, staging templates).
- Brand-new empty company: A new company without that ERP has nothing to load here.
- Internal: **ready**. Commercial: **class 6, Internal administrator-only or legacy**.
- Defect MODC-88 (P2): Company-specific import formats. Evidence: src/lib/erpIntake.js:4 customer ERP (Ramco) report detection; PROJECT_MEMORY V404: erp_*_import staging tables have no promotion until V415.
- Remediation: Keep for the current tenant behind a flag. Priority P2. Area: web.
- Tests: page render tests: none; service or engine test files referencing its libraries: 0. All run against a mocked Supabase client.
- Branch versus main: Main: three pages and three menu items. Branch: tabs of /data-intake (reports, expenses, templates).

#### Legacy Upload Data (no menu) (`/upload`)
- Page: `src/pages/UploadData.jsx`. Module key: none. Guard: `FlagRoute data_intake`.
- What it does: Legacy upload page kept reachable by URL.
- Brand-new empty company: Upload form.
- Internal: **at risk**. Commercial: **class 6, Internal administrator-only or legacy**.
- Defect MODC-89 (P2): Legacy import path without the staged, reversible pipeline; any role can open it by URL. Evidence: src/App.jsx:762 route with flag guard only; upload_history.organisation_id has no default.
- Remediation: Retire or role-guard. Priority P2. Area: web.
- Tests: page render tests: none; service or engine test files referencing its libraries: 0. All run against a mocked Supabase client.

## 6. Branch versus main (unmerged consolidation)

`git diff origin/main -- src/App.jsx src/components/Layout.jsx` on branch `claude/tyrepulse-inspector-build-7rxp2t`:

| Subject | origin/main | Working branch |
|---|---|---|
| Executive | Two menu items: `/executive-report` (Admin), `/executive-analytics` (Admin, Manager, Director) | One menu item `/executive` that redirects to whichever page the user may open; both routes and guards unchanged |
| Analytics | `/analytics` page and menu item (ModuleRoute analytics) | `/analytics` redirects to `/advanced-analytics` |
| Comparison | `/comparison` page and menu item | Redirects to `/site-comp?tab=periods` |
| KPI | Menu items for `/kpi-engine` and `/kpi-command` | Routes kept (ModuleRoute kpi_scorecard), menu items removed; KPI Center is the entry |
| ERP imports | `/erp-import`, `/erp-intake`, `/expense-import` pages and menu items (Admin, Manager, Director) | All three redirect to tabs of `/data-intake` (templates, reports, expenses) |
| Outside this report | `/asset-management`, `/safety-compliance`, `/tyre-failure-cpk`, `/workshop` pages | Redirects into their keeper pages |

Assessment: the branch direction is right for class 5 duplicates and changes no guard on a kept page. One access change to check before merge: on main the three ERP import pages admit Admin, Manager and Director by RoleRoute; on the branch they are tabs of Data Intake, which is RoleRoute Admin, Manager, Director plus FlagRoute data_intake, so access is the same when the flag is on. The public.modules rows `erp_import`, `erp_intake`, `expense_import`, `tyre_failure_cpk` and `safety_compliance` are still live and will describe pages that no longer have a route after the merge.

## 7. Reports, scheduled delivery, share links, imports

- Report creation and download: Reports wizard, Report Center, Report Builder, Board Overview and the accident builder generate PDF and Excel in the browser through `src/lib/exportUtils.js` and `src/lib/pdfEngine.js`. `src/test/pdfEngine.test.js` uses the real PDF libraries; other export tests mock them. Export size is governed by global system_config keys `export_enabled` and `max_export_rows` (platform wide, not per tenant).
- Scheduled delivery: pg_cron job `send-scheduled-reports` every 15 minutes calls the edge function; it now refuses a schedule with no organisation (`requireOrg`, index.ts:77) and scopes every dataset query by organisation. Delivery is observed working for the current tenant (report_send_log: 197 sent, latest today). Open issues: MODC-05, MODC-11, one sender address for all tenants, and no attachment (the email is an HTML digest; PDF and Excel exist only through Generate now in the browser).
- Share links: `create_report_share` mints a token; anonymous viewers read aggregates through SECURITY DEFINER RPCs that derive the organisation from the token. Open issues: MODC-02 and MODC-14.
- Imports: Data Intake staged import is reversible per batch (commit and reverse RPCs) and is the right first action for a new company. The ERP report auto-detect, expense grid, production, SCO and SANY tabs are built on the current company file formats (Ramco exports, one batching system, two vendor documents) and should be hidden for other tenants. Expense imports are idempotent only when the line number column is mapped (PROJECT_MEMORY V363). The legacy `/upload` route is still reachable (MODC-89).

## 8. Modules that must not be marketed as they stand

- Customer Portal: there is no customer-facing portal (MODC-52).
- ERP Sync: no connector exists (MODC-79).
- OCR Scanner: no OCR provider is connected (MODC-80).
- Supplier Marketplace: a private price list, not a marketplace (MODC-31).
- Tyre-as-a-Service, SLA Dashboard, Fleet Optimizer: manual registers with no engine behind the name (MODC-51, MODC-57, MODC-58).
- Automation Rules and API and Webhooks: never executed or delivered successfully in production (MODC-73, MODC-74). Developer Portal webhooks deliver nothing (MODC-75).
- Cost per M3, Production (M3), SCO Cost, SANY Invoices, SANY Delay Penalty: specific to the current company contracts and file formats (MODC-43 to MODC-47).
- Accidents, Accident Workflow, Report Sharing, Scheduled Reports, KPI Center, Budgets: sellable only after MODC-01 to MODC-06.
- TCO Calculator benchmark and savings tabs, Carbon Tracker: figures built from constants (MODC-49, MODC-50, MODC-59, MODC-60).

## 9. Not verified

- No browser session: loading, saving, pagination and export were judged from code, constraints and policies, not observed.
- KPI target re-save failure (MODC-03) and the cross-tenant budget collision (MODC-04) are derived from code plus catalog; no write was executed to confirm the error text.
- The deployed `send-scheduled-reports` function body was not compared with the repository file.
- Whether a seeding routine for new organisations exists outside the functions and pages searched (MODC-12).
- Whether Help tickets reach the vendor through the platform console inbox (MODC-86).
- Live existence of `report_definitions` and `user_dashboards` used by the builders (MODC-66).
- Cause of the undelivered webhooks (MODC-74).
- RLS was read from policy definitions; no impersonation probe was run for these tables in this audit.
- Cost and KPI formula correctness on every analytics page: see ENGINEERING_CALCULATIONS.
- Flutter and Expo counterparts of these modules were not inspected.
