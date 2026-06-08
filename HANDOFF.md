# TyrePulse — Developer Handoff
**Branch:** `claude/handoff-setup-gZAHb`
**Last updated:** June 2026
**Build status:** ✅ Clean — 2174 modules, 0 errors

---

## ⚠️ SYSTEM CHECK IN PROGRESS
User is manually verifying pages. Do NOT build new pages until system check is complete.
Next session should focus on: fixing any broken pages the user identifies during testing.

---

## Bugs Fixed This Session

| Issue | Root Cause | Fix Applied |
|-------|-----------|-------------|
| SQL serial_number error when running MIGRATIONS_SAFE.sql | `idx_tyre_serial` index was created at line 214 before `serial_number` column added at line 319 | Moved index to after `_add_col_if_missing` call |
| Checklist save silently fails, PDF button does nothing | `inspection_type: 'Daily Checklist'` violated DB CHECK constraint `('Routine','Pressure','Visual','Full','Pre-Trip')`; error was swallowed | Changed to `inspection_type: 'Routine'`; added visible error display in both checklist and main form |
| Main form also fails for 'Site Observation' / 'Safety Training' / 'Training Session' types | Same CHECK constraint | `MIGRATIONS_SAFE.sql` now drops the constraint; also added missing columns: `country`, `severity`, `photo_data`, `attendees` |

---

## How to Fix the Inspections Table (Run Once in Supabase SQL Editor)

The MIGRATIONS_SAFE.sql file now includes the fix. Just re-run it — all statements are idempotent.

Key lines it will execute:
```sql
ALTER TABLE inspections DROP CONSTRAINT IF EXISTS inspections_inspection_type_check;
-- adds: country, severity, photo_data, attendees columns
```

---

## All Pages Built (73 total — Complete Route List)

### Overview
| Route | File |
|-------|------|
| `/` | Dashboard.jsx |

### Analytics (9 pages)
| Route | File |
|-------|------|
| `/analytics` | Analytics.jsx |
| `/brand-perf` | BrandPerformance.jsx |
| `/site-comp` | SiteComparison.jsx |
| `/fleet` | FleetAnalytics.jsx |
| `/kpi` | KpiScorecard.jsx |
| `/country-comp` | CountryComparison.jsx |
| `/comparison` | Comparison.jsx |
| `/ai` | AiAnalytics.jsx (Admin) |
| `/advanced-analytics` | AdvancedAnalytics.jsx |

### Operations (17 pages)
| Route | File |
|-------|------|
| `/tyres` | TyreRecords.jsx |
| `/fleet-master` | FleetMaster.jsx |
| `/assets` | AssetManagement.jsx |
| `/stock` | StockManagement.jsx |
| `/stock-replenishment` | StockReplenishment.jsx |
| `/budgets` | Budgets.jsx |
| `/actions` | CorrectiveActions.jsx |
| `/accidents` | Accidents.jsx |
| `/rca` | RcaRecords.jsx |
| `/inspections` | Inspections.jsx |
| `/inspection-planner` | InspectionPlanner.jsx |
| `/work-orders` | WorkOrders.jsx |
| `/gate-pass` | GatePass.jsx |
| `/reports` | Reports.jsx |
| `/warranty` | WarrantyTracker.jsx |
| `/scrap` | TyreScrapManagement.jsx |
| `/retread` | RetreadManagement.jsx |

### Intelligence (36 pages)
| Route | File |
|-------|------|
| `/kpi-engine` | EngineeringKpi.jsx |
| `/kpi-command` | KpiCommandCenter.jsx |
| `/position-intelligence` | PositionIntelligence.jsx |
| `/pressure-intel` | PressureIntelligence.jsx |
| `/inspection-intelligence` | InspectionIntelligence.jsx |
| `/root-cause` | RootCauseEngine.jsx |
| `/predictive-maintenance` | PredictiveMaintenance.jsx |
| `/vendor-intelligence` | VendorIntelligence.jsx |
| `/driver-management` | DriverManagement.jsx |
| `/fleet-intelligence` | FleetIntelligence.jsx |
| `/fleet-health` | FleetHealthBoard.jsx |
| `/live-fleet` | LiveFleetStatus.jsx |
| `/compliance` | ComplianceDashboard.jsx |
| `/ai-command-center` | AiCommandCenter.jsx |
| `/executive-report` | ExecutiveReport.jsx |
| `/forecasting` | ForecastingEngine.jsx |
| `/continuous-improvement` | ContinuousImprovement.jsx |
| `/erp-sync` | ErpSync.jsx |
| `/maintenance-calendar` | MaintenanceCalendar.jsx |
| `/safety-compliance` | SafetyCompliance.jsx |
| `/cost-center` | CostCenter.jsx |
| `/benchmark` | PerformanceBenchmark.jsx |
| `/procurement` | Procurement.jsx |
| `/suppliers` | SupplierManagement.jsx |
| `/tyre-size` | TyreSizeAnalysis.jsx |
| `/tyre-lifecycle` | TyreLifecycle.jsx |
| `/tyre-exchange` | TyreExchange.jsx |
| `/tyre-specs` | TyreSpecifications.jsx |
| `/rotation` | RotationSchedule.jsx |
| `/recall-tracker` | RecallTracker.jsx |
| `/fuel-efficiency` | FuelEfficiency.jsx |
| `/workshop` | WorkshopManagement.jsx |
| `/downtime` | DowntimeTracker.jsx |
| `/budget-planner` | BudgetPlanner.jsx |
| `/daily-ops` | DailyOps.jsx |
| `/alerts` | Alerts.jsx |

### Admin (5 pages)
| Route | File |
|-------|------|
| `/anomalies` | Anomalies.jsx |
| `/vehicle-history` | VehicleHistory.jsx |
| `/serial-tracker` | SerialTracker.jsx |
| `/audit` | AuditTrail.jsx |
| `/users` | UserManagement.jsx |

### Data (4 pages)
| Route | File |
|-------|------|
| `/cleaning` | DataCleaning.jsx |
| `/upload` | UploadData.jsx |
| `/settings` | Settings.jsx |
| `/inspection-planner` | InspectionPlanner.jsx |

---

## Migrations to Run (in order in Supabase SQL Editor)

**RECOMMENDED: Just run `MIGRATIONS_SAFE.sql` — it's fully idempotent and includes everything.**

Individual files if needed:
| File | Purpose | Status |
|------|---------|--------|
| `SUPABASE_SCHEMA.sql` | Core tables | Required first run |
| `MIGRATIONS.sql` | Phase 2 tables | Required |
| `BACKEND_RLS.sql` | Role-based policies | Required |
| `MIGRATIONS_V2.sql` | Multi-country + CPK columns | Required |
| `MASTER_ENGINE.sql` | Data normalisation triggers + views | Required |
| `MIGRATIONS_V3.sql` | extra_fields jsonb | Required |
| `MIGRATIONS_V4.sql` | RCA country column | Required |
| `MIGRATIONS_SAFE.sql` | **All V10-V17 + bug fixes** | ✅ Run this |

---

## Supabase Edge Functions

| Function | Input | Purpose |
|----------|-------|---------|
| `chat-ai` | `{ system, user, model }` | Anthropic API proxy |
| `generate-embedding` | `{ text, model }` | OpenAI embeddings proxy |
| `send-email` | `{ to, subject, body }` | Resend API email delivery |

Env vars needed: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `FROM_EMAIL`
Deploy: `supabase functions deploy chat-ai --project-ref <your-ref>`

---

## Key Libraries and Utilities

| File | Purpose |
|------|---------|
| `src/lib/kpiEngine.js` | 18 pure KPI computations |
| `src/lib/ragService.js` | RAG retrieval + 5-min cache |
| `src/lib/embeddingService.js` | Batch embedding generation |
| `src/lib/aiRouter.js` | Query classification → agent routing |
| `src/lib/agents/` | analystAgent, tyreEngineerAgent, qaDataAgent, plannerAgent |
| `src/lib/auditLogger.js` | Non-throwing audit_log_v2 wrapper |
| `src/lib/alertEngine.js` | Alert detection (velocity, CPK, data quality) |
| `src/lib/emailService.js` | PDF generation + Resend email delivery |
| `src/lib/performanceMonitor.js` | Query timing, slow query detection |
| `src/lib/exportUtils.js` | Excel/PDF export utilities |
| `src/lib/analyticsEngine.js` | Legacy analytics (CPK, trends) |

## Key Components

| File | Purpose |
|------|---------|
| `src/components/Layout.jsx` | Main sidebar nav with NAV_GROUPS, GlobalSearch, NotificationCenter |
| `src/components/GlobalSearch.jsx` | Cmd/Ctrl+K search modal across all data |
| `src/components/NotificationCenter.jsx` | Realtime bell icon + dropdown notifications |
| `src/components/EmailReportModal.jsx` | Multi-recipient email with PDF attachment |
| `src/components/EmptyState.jsx` | Reusable empty state UI |
| `src/components/LoadingState.jsx` | Spinner with message/fullPage mode |
| `src/components/InstallPwaPrompt.jsx` | PWA install banner |

## Key Hooks

| File | Purpose |
|------|---------|
| `src/hooks/useRealtimeAlerts.js` | Supabase Realtime subscription for Critical tyres + 50-item ring buffer |

---

## Architecture Notes

- **Anthropic API key** — calls go through `supabase.functions.invoke('chat-ai')` — never exposed client-side
- **EmailReportModal** wired into: ExecutiveReport, EngineeringKpi, Reports, ForecastingEngine, VendorIntelligence, FleetIntelligence
- **NotificationCenter** in Layout sidebar footer — subscribes to `tyre_records` + `alerts` via Supabase Realtime
- **GlobalSearch** in Layout — searches tyres, vehicles, inspections, work orders, stock + nav shortcuts
- All intelligence pages: Supabase load on mount → useMemo computed → Chart.js → Excel/PDF export
- **uuid** package NOT installed — use `crypto.randomUUID()` everywhere
- Build: `npm run build` → 2174 modules, 0 errors, ~1159KB gzip (chunk size warnings expected)

---

## Infrastructure

| File | Purpose |
|------|---------|
| `public/manifest.json` | PWA manifest (8 icons, 4 shortcuts) |
| `public/sw.js` | Service worker (cache-first) |
| `supabase/config.toml` | Supabase project config |
| `supabase/functions/chat-ai/` | Anthropic API proxy |
| `supabase/functions/generate-embedding/` | OpenAI embeddings proxy |
| `supabase/functions/send-email/` | Resend email proxy |
| `src/index.css` | Theme depth: gradients, card shadows, custom scrollbar |
