# Arabic i18n Sweep — Status & Handoff

**Branch holding this work:** `claude/mobile-app-ui-features-tdfxy0` (PENDING — paused, not merged).
**Last commit:** `8d39886` (i18n final checkpoint).
**Deployed to production (main):** through commit `a2c7b95` — Wave 1 + most of Wave 2.

## What Arabic i18n is and how it works
- Languages: **English (`en`) + Arabic (`ar`, RTL)**. No Urdu exists anywhere.
- Infra (do not change): `src/contexts/LanguageContext.jsx` eagerly loads every
  `src/locales/<lang>/<ns>.json`; the file basename is the namespace. Use
  `const { t } = useLanguage()` then `t('ns.key', { vars })`. Arabic auto-sets
  `dir="rtl"` on the document. Missing keys fall back to English, so a
  partially-wired page is always safe.
- A build-time test (`src/test/languageContext.test.jsx`) enforces that every
  English namespace has an Arabic mirror with identical keys.

## Progress: 52 / 84 pages wired
### DONE (English + Arabic, committed)
Shell/nav/shared UI (pre-existing) · Alerts · Dashboard · Inspections · Login ·
Settings · TyreRecords · TyreScan · WorkOrders · ResetPassword · Data Intake
Center (+ all intake panels) · Intake History · Upload Approvals · Upload Data ·
Custom Data · ERP Sync · Executive Report · Reports · Report Center · Scheduled
Reports · KPI Scorecard · KPI Command Center · Analytics · Advanced Analytics ·
Fleet Master · Asset Management · Daily Ops · Corrective Actions · Comparison ·
Country Comparison · Site Comparison · Fleet Analytics · User Management ·
Vehicle History · Live Fleet Status · Fleet Health Board · Fleet Intelligence ·
Cost Center · Budgets · Budget Planner · Downtime Tracker · Fuel Efficiency ·
Tyre Size Analysis · Procurement · Supplier Management · Vendor Intelligence ·
Stock Management · Stock Replenishment · Warranty Tracker + partial: Tyre
Lifecycle, Position Intelligence, Root Cause Engine, AI Analytics.

### REMAINING (English-only — safe, just untranslated) ~30 pages
Tyre engineering: TyreScrapManagement, TyreExchange, TyreSpecifications,
SerialTracker, QrLabels, PressureIntelligence, RetreadManagement,
RotationSchedule, BrandPerformance, PerformanceBenchmark, TyreLifecycle (finish),
PositionIntelligence (finish). Maintenance: MaintenanceCalendar,
PredictiveMaintenance, ForecastingEngine, WorkshopManagement, InspectionPlanner,
InspectionIntelligence. Safety: Accidents, GatePass, SafetyCompliance,
ComplianceDashboard, RecallTracker, DriverManagement. Intelligence:
RootCauseEngine (finish), RcaRecords, Anomalies, EngineeringKpi,
ContinuousImprovement, DataCleaning. AI/admin: AiAnalytics (finish),
AiCommandCenter, AiCostMonitor, KnowledgeBase, AuditTrail, AlertThresholds.

## How to resume
1. Read the spec: `scratchpad/I18N_SPEC.md` (rules, exclusions, Arabic tone).
2. Per remaining page: create `src/locales/{en,ar}/<ns>.json` (identical keys),
   wire `useLanguage()`/`t()`. Each subcomponent that renders text calls
   `useLanguage()` itself. Never translate export-builder (PDF/Excel/PPTX)
   strings or DB values used in comparisons.
3. Gate before push: `node` parity scan → `npx vite build` → `npm run test:run`.

## Lessons learned (cost control)
- Translator subagents must NOT delegate to their own subagents and must save
  files as they go — session-limit kills mid-run otherwise lose everything.
- An auto-checkpoint loop committing verified progress every ~3 min protects
  against interruption; only fully-gated snapshots go to `main`.
