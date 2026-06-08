# TyrePulse — Developer Handoff
**Branch:** `claude/handoff-setup-gZAHb`
**Last updated:** June 2026
**Build status:** ✅ Clean — 2252 modules, 0 errors

---

## Next Session — Priority Order

1. **Cost Center page** — `/cost-center` (multi-dimensional cost analysis by site/brand/vehicle/month)
2. **Procurement Management page** — `/procurement` (purchase orders, vendor orders, budget tracking)
3. **Apply migrations V12-V16** — User must run in Supabase SQL Editor
4. **Supabase Realtime tables** — Enable Realtime on `tyre_records` + `alerts` tables in Supabase Dashboard
5. **Deploy Edge Functions** — `supabase functions deploy chat-ai`, `generate-embedding`, `send-email`

---

## Migrations Pending (apply in Supabase SQL Editor in order)

| File | Purpose |
|------|---------|
| `MIGRATIONS_V12.sql` | `app_settings` table (Wave 7B thresholds) |
| `MIGRATIONS_V13.sql` | pgvector, knowledge_documents, embedding tables |
| `MIGRATIONS_V14.sql` | Seed SOP/policy knowledge documents |
| `MIGRATIONS_V15.sql` | organisations, audit_log_v2, performance indexes, archive |
| `MIGRATIONS_V16.sql` | work_orders table with generate_work_order_no() function |

---

## Supabase Edge Functions

| Function | Status | Input | Purpose |
|----------|--------|-------|---------|
| `chat-ai` | Created | `{ system, user, model }` | Anthropic API proxy |
| `generate-embedding` | Created | `{ text, model }` | OpenAI embeddings proxy |
| `send-email` | Created | `{ to, subject, body, ... }` | Resend API email delivery |

Env vars needed: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `FROM_EMAIL`

Deploy: `supabase functions deploy chat-ai --project-ref <your-ref>`

---

## All Pages Built (Complete Route List)

| Route | File | Category |
|-------|------|----------|
| `/` | Dashboard.jsx | Overview |
| `/tyres` | TyreRecords.jsx | Operations |
| `/analytics` | Analytics.jsx | Analytics |
| `/brand-perf` | BrandPerformance.jsx | Analytics |
| `/site-comp` | SiteComparison.jsx | Analytics |
| `/fleet` | FleetAnalytics.jsx | Analytics |
| `/kpi` | KpiScorecard.jsx | Analytics |
| `/country-comp` | CountryComparison.jsx | Analytics |
| `/comparison` | Comparison.jsx | Analytics |
| `/fleet-master` | FleetMaster.jsx | Operations |
| `/stock` | StockManagement.jsx | Operations |
| `/budgets` | Budgets.jsx | Operations |
| `/actions` | CorrectiveActions.jsx | Operations |
| `/accidents` | Accidents.jsx | Operations |
| `/rca` | RcaRecords.jsx | Operations |
| `/inspections` | Inspections.jsx | Operations |
| `/work-orders` | WorkOrders.jsx | Operations |
| `/gate-pass` | GatePass.jsx | Operations |
| `/reports` | Reports.jsx | Operations |
| `/kpi-engine` | EngineeringKpi.jsx | Intelligence |
| `/position-intelligence` | PositionIntelligence.jsx | Intelligence |
| `/inspection-intelligence` | InspectionIntelligence.jsx | Intelligence |
| `/root-cause` | RootCauseEngine.jsx | Intelligence |
| `/predictive-maintenance` | PredictiveMaintenance.jsx | Intelligence |
| `/vendor-intelligence` | VendorIntelligence.jsx | Intelligence |
| `/driver-management` | DriverManagement.jsx | Intelligence |
| `/fleet-intelligence` | FleetIntelligence.jsx | Intelligence |
| `/advanced-analytics` | AdvancedAnalytics.jsx | Intelligence |
| `/ai-command-center` | AiCommandCenter.jsx | Intelligence |
| `/executive-report` | ExecutiveReport.jsx | Intelligence |
| `/forecasting` | ForecastingEngine.jsx | Intelligence |
| `/continuous-improvement` | ContinuousImprovement.jsx | Intelligence |
| `/erp-sync` | ErpSync.jsx | Intelligence |
| `/maintenance-calendar` | MaintenanceCalendar.jsx | Intelligence |
| `/safety-compliance` | SafetyCompliance.jsx | Intelligence |
| `/alerts` | Alerts.jsx | Intelligence |
| `/anomalies` | Anomalies.jsx | Admin |
| `/vehicle-history` | VehicleHistory.jsx | Admin |
| `/serial-tracker` | SerialTracker.jsx | Intelligence |
| `/ai` | AiAnalytics.jsx | Admin |
| `/cleaning` | DataCleaning.jsx | Data |
| `/upload` | UploadData.jsx | Data |
| `/audit` | AuditTrail.jsx | Admin |
| `/settings` | Settings.jsx | Data |
| `/users` | UserManagement.jsx | Admin |

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

- **Anthropic SDK** used directly in `agents/index.js` (`dangerouslyAllowBrowser: true`, `VITE_ANTHROPIC_API_KEY`)
- **EmailReportModal** wired into: ExecutiveReport, EngineeringKpi, Reports, ForecastingEngine, VendorIntelligence, FleetIntelligence
- **NotificationCenter** in Layout sidebar footer — subscribes to `tyre_records` + `alerts` via Supabase Realtime
- **GlobalSearch** in Layout — searches tyres, vehicles, inspections, work orders, stock + nav shortcuts
- All new intelligence pages follow: Supabase load on mount → useMemo computed → Chart.js → Excel/PDF export
- Build: `npm run build` → 2252 modules, 0 errors, ~975KB gzip

---

## Infrastructure

| File | Purpose |
|------|---------|
| `public/manifest.json` | PWA manifest (8 icons, 4 shortcuts) |
| `public/sw.js` | Service worker (cache-first) |
| `public/icons/icon-{72..512}x{size}.png` | PWA icon set (8 sizes, dark theme) |
| `supabase/config.toml` | Supabase project config |
| `supabase/functions/chat-ai/` | Anthropic API proxy |
| `supabase/functions/generate-embedding/` | OpenAI embeddings proxy |
| `supabase/functions/send-email/` | Resend email proxy |
| `src/index.css` | Theme depth: gradients, card shadows, custom scrollbar |
| `MIGRATIONS_V12-V16.sql` | Database migrations |
