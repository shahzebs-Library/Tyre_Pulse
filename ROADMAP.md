# TyrePulse — Complete Product Roadmap
**Readymix Concrete Company · Built by Shahzeb Rahman © 2026**
**Version 5.0 · Updated June 2026 · Governed by CLAUDE.md**

> **This roadmap is derived directly from CLAUDE.md.**
> Every section maps to a specific CLAUDE.md requirement.
> Ordered by business impact — highest value first.

---

## Status Key

| Symbol | Meaning |
|--------|---------|
| ✅ | Complete and deployed |
| 🔄 | Partially implemented |
| ⬜ | Planned, not started |

---

## Product Health

| Metric | Status |
|--------|--------|
| Build | ✅ 0 errors — 2174 modules |
| Pages | ✅ 73 pages registered and routed |
| Auth + RBAC | ✅ RLS, role-based routes, idle timeout |
| Migrations | ✅ MIGRATIONS_SAFE.sql — run once to apply all |
| Hosting | ✅ Vercel (auto-deploy on push to `main`) |
| Database | ✅ Supabase PostgreSQL + Auth + Storage + pgvector |
| Intelligence pages | ✅ 40+ pages (Waves 8–23 UI complete) |
| PWA | ✅ Manifest + service worker + install prompt |
| AI System | ✅ 4-agent router + AiCommandCenter |
| RAG | 🔄 pgvector schema + knowledge base + retrieval service |

---

## ⚠️ SYSTEM CHECK IN PROGRESS
User is manually verifying all 73 pages. Do NOT add new pages until check is complete.
Next session focus: fix any broken pages identified during testing.

---

## Known Bug Fixes Applied (June 2026)

| Bug | Root Cause | Status |
|-----|-----------|--------|
| SQL error when running MIGRATIONS_SAFE.sql | `idx_tyre_serial` index created before `serial_number` column existed | ✅ Fixed |
| Checklist save silently fails | `inspection_type: 'Daily Checklist'` violated DB CHECK constraint | ✅ Fixed — now sends `'Routine'` |
| Checklist PDF button does nothing | Save was failing so `clSaved` stayed null | ✅ Fixed — error display added |
| 'Site Observation' / 'Safety Training' types fail | Same CHECK constraint on inspections table | ✅ Fixed — constraint dropped in MIGRATIONS_SAFE.sql |

**Action Required:** Re-run `MIGRATIONS_SAFE.sql` in Supabase SQL Editor to apply the constraint fix.

---

## Waves 1–7 — Foundation, Operations & Operational Intelligence *(Complete)*

### Wave 1 — Security, Auth & Access Control ✅

| Feature | Status |
|---------|--------|
| Remove AI/Anthropic branding from visible UI | ✅ |
| 1-hour idle session timeout with auto sign-out | ✅ |
| Role-based page access — Admin-only routes | ✅ |
| Admin-only nav items hidden from non-Admins | ✅ |
| Forgot password flow + /reset-password page | ✅ |
| Employee ID field on signup and profile | ✅ |
| Show/hide password toggle on all password fields | ✅ |
| Pending admin approval workflow for new accounts | ✅ |
| UserManagement: Approve + multi-country assignment | ✅ |

### Waves 2–6 — Upload, Dashboard, Inspections, Gate Pass, Comparison ✅

All features complete. See PHASE2_CHECKLIST.md for detail.

### Wave 7 — Operational Intelligence ✅

All 7A–7P features complete including KPI targets, VehicleHistory forecasting, StockManagement velocity, Reports enhancements.

---

## Wave 8 — Engineering KPI Engine ✅
**Page:** `/kpi-engine` → `EngineeringKpi.jsx`

| KPI | Status |
|-----|--------|
| CPK dashboard, per asset, per brand, worst performers | ✅ |
| Average Tyre Life — fleet, by brand, by position | ✅ |
| Remaining Tyre Life — per active tyre forecast | ✅ |
| Tyre Failure Rate — % High/Critical removals | ✅ |
| Pressure Compliance % | ✅ |
| Inspection Compliance % | ✅ |
| Retread Performance — retread CPK vs new | ✅ |
| Scrap Rate % | ✅ |
| Cost Trend Analysis — 13-month rolling | ✅ |
| Vendor Performance KPI | ✅ |
| Engineering KPI PDF/Excel export | ✅ |

---

## Wave 9 — Pressure & Inspection Intelligence ✅
**Pages:** `/pressure-intel` → `PressureIntelligence.jsx` | `/inspection-intelligence` → `InspectionIntelligence.jsx`

| Feature | Status |
|---------|--------|
| Pressure compliance % per vehicle, site, fleet | ✅ |
| Pressure anomaly detection — flag out-of-spec readings | ✅ |
| Missing inspection detection — overdue alert banner | ✅ |
| Inspector quality score per inspector | ✅ |
| Inspection compliance % per site | ✅ |
| Tread depth compliance tracking | ✅ |
| Compliance Dashboard — tread + pressure + inspection combined | ✅ `/compliance` |

---

## Wave 10 — Tyre Position Intelligence ✅
**Page:** `/position-intelligence` → `PositionIntelligence.jsx`

| Feature | Status |
|---------|--------|
| Position analytics — CPK per position (Steer/Drive/Trailer/Lift/Tag) | ✅ |
| Average tyre life per position | ✅ |
| Failure rate per position | ✅ |
| Pressure problem positions | ✅ |
| Cost per position ranked | ✅ |
| Position-based corrective action recommendations | ✅ |
| Heat map: position × site matrix | ✅ |
| Rotation compliance tracker | ✅ |

---

## Wave 11 — Root Cause Intelligence Engine ✅
**Page:** `/root-cause` → `RootCauseEngine.jsx`

| Feature | Status |
|---------|--------|
| Automated RCA classification (14 root causes, rule-based) | ✅ |
| Under/over inflation detection | ✅ |
| Alignment issue detection | ✅ |
| Driver behaviour scoring | ✅ |
| Overloading detection | ✅ |
| Root cause frequency dashboard | ✅ |
| RCA → Corrective Action link | ✅ |
| AI fallback for RCA diagnosis | ✅ |

---

## Wave 12 — Predictive Maintenance Engine ✅
**Pages:** `/predictive-maintenance` → `PredictiveMaintenance.jsx` | `/maintenance-calendar` → `MaintenanceCalendar.jsx` | `/inspection-planner` → `InspectionPlanner.jsx`

| Feature | Status |
|---------|--------|
| Fleet-level replacement schedule calendar | ✅ |
| Expected removal date per tyre | ✅ |
| Remaining tread life estimation | ✅ |
| Upcoming tyre purchase calendar (30/60/90-day) | ✅ |
| Future budget requirements — 12-month forecast | ✅ |
| Potential failure risk score | ✅ |
| Maintenance planning calendar | ✅ |
| Workshop load balancing | ✅ |
| Predictive alerts | ✅ |
| Inspection Planner — overdue queue, interval config, scheduling | ✅ |

---

## Wave 13 — Vendor & Workshop Intelligence ✅
**Pages:** `/vendor-intelligence` → `VendorIntelligence.jsx` | `/suppliers` → `SupplierManagement.jsx` | `/retread` → `RetreadManagement.jsx` | `/workshop` → `WorkshopManagement.jsx`

| Feature | Status |
|---------|--------|
| Full vendor scorecard — brands + suppliers + workshops | ✅ |
| CPK per brand — ranked table with trend | ✅ |
| Failure frequency per brand | ✅ |
| Durability ranking — avg km life per brand | ✅ |
| Cost effectiveness score — composite ranked | ✅ |
| Supplier management — contracts, delivery, performance | ✅ |
| Workshop performance metrics | ✅ |
| Retread vendor comparison — CPK vs new, success rate | ✅ |
| Scrap rate per brand | ✅ |
| Procurement recommendation | ✅ |
| Retread management — full lifecycle, ROI calculator | ✅ |

---

## Wave 14 — Fleet Management Intelligence ✅
**Pages:** `/fleet-intelligence` → `FleetIntelligence.jsx` | `/fleet-health` → `FleetHealthBoard.jsx` | `/live-fleet` → `LiveFleetStatus.jsx` | `/downtime` → `DowntimeTracker.jsx` | `/assets` → `AssetManagement.jsx`

| Feature | Status |
|---------|--------|
| Fleet availability % — by site, trend | ✅ |
| Vehicle downtime tracking | ✅ |
| Maintenance efficiency score | ✅ |
| Asset utilization analysis | ✅ |
| Operating cost per vehicle | ✅ |
| Replacement planning dashboard | ✅ |
| Fleet health board — per-vehicle health score matrix | ✅ |
| Live fleet status — real-time mission control, auto-refresh | ✅ |
| Asset management — full vehicle register, health scores | ✅ |
| Tyre scrap management — disposal log, brand/site analysis | ✅ `/scrap` |

---

## Wave 15 — Advanced Analytics ✅
**Pages:** `/advanced-analytics` → `AdvancedAnalytics.jsx` | `/cost-center` → `CostCenter.jsx` | `/benchmark` → `PerformanceBenchmark.jsx` | `/tyre-size` → `TyreSizeAnalysis.jsx` | `/fuel-efficiency` → `FuelEfficiency.jsx` | `/comparison` → `Comparison.jsx`

| Feature | Status |
|---------|--------|
| Seasonal analysis — monthly patterns across years | ✅ |
| Country comparison enhanced — CPK, failure rate, compliance | ✅ |
| Branch comparison enhanced — all KPIs, ranking, trends | ✅ |
| Vehicle comparison | ✅ |
| Driver comparison | ✅ |
| Brand comparison enhanced | ✅ |
| Failure pattern analysis | ✅ |
| Trend analysis — acceleration/deceleration detection | ✅ |
| Analytics insights panel — AI-narrated summaries | ✅ |
| Cost center — multi-dimensional cost breakdown | ✅ |
| Performance benchmark — site/fleet vs targets | ✅ |
| Tyre size analysis — size optimizer | ✅ |
| Fuel efficiency — tyre impact on fuel consumption | ✅ |

---

## Wave 16 — Data Quality Intelligence ✅
**Pages:** `/cleaning` → `DataCleaning.jsx` | `/compliance` → `ComplianceDashboard.jsx` | `/serial-tracker` → `SerialTracker.jsx`

| Feature | Status |
|---------|--------|
| Incorrect tyre serial detection | ✅ |
| Duplicate tyre number detection | ✅ |
| Invalid pressure readings auto-flag | ✅ |
| Missing tread depth detection | ✅ |
| Missing inspection record detection | ✅ |
| Inconsistent odometer detection | ✅ |
| Unrealistic tyre life flagging | ✅ |
| Upload batch quality score | ✅ |
| Data cleaning auto-run on upload | ✅ |
| Compliance dashboard — tread + pressure + inspection | ✅ |
| Compliance certificate PDF | ✅ |

---

## Wave 17 — Executive Intelligence & Reporting ✅
**Pages:** `/executive-report` → `ExecutiveReport.jsx` | `/reports` → `Reports.jsx` | `/kpi-command` → `KpiCommandCenter.jsx`

| Feature | Status |
|---------|--------|
| Executive Summary — auto-generated monthly PDF | ✅ |
| KPI Dashboard narrative | ✅ |
| Root Cause Analysis section | ✅ |
| Financial Impact section | ✅ |
| Risk Assessment section | ✅ |
| Recommendations section | ✅ |
| Action Plan section | ✅ |
| One-click Monthly Executive PDF | ✅ |
| KPI Command Center — Director/Admin C-suite view | ✅ |
| Reports page — configurable, paginated, print-to-window | ✅ |

---

## Wave 18 — Forecasting Engine ✅
**Pages:** `/forecasting` → `ForecastingEngine.jsx` | `/budget-planner` → `BudgetPlanner.jsx` | `/stock-replenishment` → `StockReplenishment.jsx`

| Feature | Status |
|---------|--------|
| Annual tyre budget forecast — 12-month by site | ✅ |
| Future tyre demand by site (30/60/90-day) | ✅ |
| Replacement schedule with procurement timeline | ✅ |
| Vendor/supplier requirements forecast | ✅ |
| Inventory requirements by site | ✅ |
| Expected failure count forecast | ✅ |
| Budget vs forecast tracking | ✅ |
| Stock replenishment — consumption analysis, order generator | ✅ |
| Budget planner — 12-month inline editable grid | ✅ |

---

## Wave 19 — Continuous Improvement Engine ✅
**Page:** `/continuous-improvement` → `ContinuousImprovement.jsx`

| Feature | Status |
|---------|--------|
| Cost reduction opportunity identification | ✅ |
| Reliability improvement tracking | ✅ |
| Process improvement recommendations | ✅ |
| Inspection improvement suggestions | ✅ |
| Maintenance improvement tracking | ✅ |
| Procurement optimization | ✅ |
| Workshop productivity improvement | ✅ |
| Improvement scorecard | ✅ |

---

## Wave 20 — RAG & Knowledge System Infrastructure 🔄
**Status:** Schema complete, service layer partially implemented

| Component | Status |
|-----------|--------|
| pgvector extension — enabled in MIGRATIONS_SAFE.sql | ✅ |
| `knowledge_documents` table | ✅ MIGRATIONS_V13.sql |
| `ai_response_cache` table | ✅ MIGRATIONS_V13.sql |
| `kpi_snapshots` table | ✅ MIGRATIONS_V15.sql |
| `ragService.js` — retrieval + 5-min cache | ✅ Implemented |
| `embeddingService.js` — batch embedding generation | ✅ Implemented |
| Edge Function: `generate-embedding` | ✅ Created |
| Document ingestion pipeline (SOPs, manuals, policies) | ⬜ Pending |
| Nightly inspection comment embedding job | ⬜ Pending |
| Inspection comments / RCA notes indexed in vector DB | ⬜ Pending |
| Historical data archiving strategy | ⬜ Pending |

---

## Wave 21 — Multi-Agent AI System 🔄
**Pages:** `/ai-command-center` → `AiCommandCenter.jsx` | `/ai` → `AiAnalytics.jsx`

| Component | Status |
|-----------|--------|
| `aiRouter.js` — query classification | ✅ |
| `analystAgent.js` — trends, KPIs, cost | ✅ |
| `tyreEngineerAgent.js` — wear, pressure, alignment | ✅ |
| `qaDataAgent.js` — clean, deduplicate, normalize | ✅ |
| `plannerAgent.js` — schedule, forecast, balance | ✅ |
| AI Command Center UI — multi-agent chat + visualizations | ✅ |
| AiAnalytics — Smart Analytics with charts | ✅ |
| AI cost monitor dashboard | ⬜ Pending |
| Per-user rate limiting | ⬜ Pending |
| Response format enforcement (Observation→RCA→Risk→Action) | 🔄 Partial |

---

## Wave 22 — Enterprise & Scale 🔄
**Pages:** `/erp-sync` → `ErpSync.jsx` | `/audit` → `AuditTrail.jsx` | `/users` → `UserManagement.jsx`

| Feature | Status |
|---------|--------|
| ERP Sync UI — read-only fleet data import | ✅ |
| Audit trail — full action log | ✅ |
| Multi-country architecture (KSA/UAE/Egypt) | ✅ |
| Role-based access control (5 roles) | ✅ |
| API webhook system for ERP write-back | ⬜ Pending |
| Scheduled report delivery — cron email | ⬜ Pending |
| Multi-tenant architecture (tenant_id on all tables) | ⬜ Pending |
| SSO / SAML integration | ⬜ Pending |
| White-label branding per tenant | ⬜ Pending |
| Advanced RBAC — custom role builder | ⬜ Pending |
| Performance monitoring dashboard | ⬜ Pending |
| Offline PWA — sync queue for inspections | ⬜ Pending |

---

## Wave 23 — Mobile & Integrations ⬜

| Feature | Status |
|---------|--------|
| React Native mobile app — Tyre Man workflow | ⬜ |
| SAP/Oracle ERP integration | ⬜ |
| Tyre supplier portal | ⬜ |
| Barcode / QR code scanner | ⬜ |
| GPS telematics integration | ⬜ |

---

## Additional Pages Built (Outside Original Wave Plan)

These pages were added beyond the original wave plan to complete the product:

| Route | Page | Purpose |
|-------|------|---------|
| `/tyres` | TyreRecords.jsx | Master tyre records with full CRUD |
| `/accidents` | Accidents.jsx | Incident/accident tracking |
| `/gate-pass` | GatePass.jsx | Tyre gate pass management |
| `/serial-tracker` | SerialTracker.jsx | Serial number tracking across fleet |
| `/warranty` | WarrantyTracker.jsx | Warranty claims + credit recovery ROI |
| `/tyre-lifecycle` | TyreLifecycle.jsx | Full lifecycle from purchase to disposal |
| `/tyre-exchange` | TyreExchange.jsx | Tyre exchange / swap management |
| `/tyre-specs` | TyreSpecifications.jsx | Tyre specs database |
| `/rotation` | RotationSchedule.jsx | Rotation schedule management |
| `/recall-tracker` | RecallTracker.jsx | Manufacturer recall tracking |
| `/procurement` | Procurement.jsx | Purchase orders + vendor management |
| `/daily-ops` | DailyOps.jsx | Daily operational dashboard |
| `/safety-compliance` | SafetyCompliance.jsx | Safety + compliance management |
| `/driver-management` | DriverManagement.jsx | Driver behaviour + cost impact |
| `/work-orders` | WorkOrders.jsx | Workshop work order management |
| `/scrap` | TyreScrapManagement.jsx | Scrap tracking + disposal log |
| `/retread` | RetreadManagement.jsx | Retread management + ROI calculator |
| `/live-fleet` | LiveFleetStatus.jsx | Real-time fleet mission control |
| `/compliance` | ComplianceDashboard.jsx | Tread + pressure + inspection compliance |
| `/stock-replenishment` | StockReplenishment.jsx | Replenishment matrix + order generator |
| `/assets` | AssetManagement.jsx | Vehicle asset register + health scores |
| `/inspection-planner` | InspectionPlanner.jsx | Inspection scheduling + overdue queue |

---

## Migrations — Current State

**Recommended: Run `MIGRATIONS_SAFE.sql` — fully idempotent, includes all fixes.**

| File | Status | What it adds |
|------|--------|--------------|
| `SUPABASE_SCHEMA.sql` | ✅ | Core tables |
| `MIGRATIONS.sql` | ✅ | Phase 2 tables (inspections, stock_movements, audit_log) |
| `BACKEND_RLS.sql` | ✅ | Role-based policies |
| `MIGRATIONS_V2–V9` | ✅ | km fields, photo_data, positions, country |
| `MIGRATIONS_V10.sql` | ✅ | profiles: employee_id, approved; accidents table |
| `MIGRATIONS_V11.sql` | ✅ | gate_passes table |
| `MIGRATIONS_V12.sql` | ✅ (in SAFE) | app_settings table |
| `MIGRATIONS_V13.sql` | ✅ (in SAFE) | ai_response_cache + knowledge_documents |
| `MIGRATIONS_V14.sql` | ✅ (in SAFE) | Seed knowledge documents |
| `MIGRATIONS_V15.sql` | ✅ (in SAFE) | organisations, audit_log_v2, kpi_snapshots |
| `MIGRATIONS_V16.sql` | ✅ (in SAFE) | work_orders table |
| `MIGRATIONS_V17.sql` | ✅ (in SAFE) | purchase_orders table |
| `MIGRATIONS_SAFE.sql` | ⚠️ **Run this** | All V10–V17 + serial_number index fix + inspections CHECK fix |

---

## Next Session — After System Check

Once user completes manual system check and reports broken pages:

1. **Fix any broken pages** identified during testing
2. **RAG document ingestion** — SOP/policy PDF upload pipeline (Wave 20B)
3. **AI cost monitor** — dashboard showing token usage per day/month (Wave 21F)
4. **Offline PWA** — service worker sync queue for inspections without internet (Wave 22)
5. **Scheduled reports** — monthly email of executive PDF (Wave 22D)

---

## Supabase Edge Functions

| Function | Status | Input | Purpose |
|----------|--------|-------|---------|
| `chat-ai` | ✅ Created | `{ system, user, model, max_tokens }` | Anthropic API proxy |
| `generate-embedding` | ✅ Created | `{ text, model }` | OpenAI embeddings proxy |
| `send-email` | ✅ Created | `{ to, subject, body }` | Resend API email delivery |

Env vars needed: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `FROM_EMAIL`
Deploy: `./scripts/deploy-edge-functions.sh <project-ref>`

---

*TyrePulse v5.0 · Readymix Concrete Company · Shahzeb Rahman © 2026*
*Fully governed by CLAUDE.md — every section maps to a specific instruction*
