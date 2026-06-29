# UX & Navigation Plan

**Status:** Phase 0 — planning.
**Track:** In-place hardening of the existing Vite + React 19 / React Router / Tailwind web app and Expo mobile app. No rewrite.
**Goal:** Reduce ~78 web pages (`src/pages/`) with overlapping analytics/intelligence journeys into **8 clear workspaces**, without breaking routes or removing functionality.

---

## 1. Route-preservation & de-duplication rule

> **Keep every existing route working.** Workspaces are a **navigation grouping**, not a routing rewrite. A duplicate journey is **only** removed after its replacement is confirmed to cover the same use case — never before.

| Rule | Behaviour |
|---|---|
| Routes stay live | All existing `/path` routes resolve. Pages move under a workspace shell; deep links and bookmarks keep working. |
| Group, don't delete | Overlapping pages are collected into a workspace with sub-tabs/sections; the underlying components are reused. |
| Replace-then-retire | When two pages serve the same journey, build/confirm the canonical view first; redirect the duplicate route to it; retire the duplicate's nav entry last. |
| No feature loss | Complex pages are not removed merely for being complex. Filters, actions, and data they expose are preserved in the consolidated view. |

---

## 2. The 8 workspaces

### 1. Operations
Day-to-day fleet status and live operations.
`Dashboard.jsx`, `DailyOps.jsx`, `LiveFleetStatus.jsx`, `FleetHealthBoard.jsx`, `FleetIntelligence.jsx`, `FleetMaster.jsx`, `AssetManagement.jsx`, `VehicleHistory.jsx`, `DriverManagement.jsx`, `MaintenanceCalendar.jsx`, `Alerts.jsx`, `AlertThresholds.jsx`, `Anomalies.jsx`

### 2. Tyre Performance
Tyre lifecycle, serials, wear and tyre-specific intelligence.
`TyreRecords.jsx`, `TyreLifecycle.jsx`, `TyreExchange.jsx`, `SerialTracker.jsx`, `TyreScan.jsx`, `QrLabels.jsx`, `RetreadManagement.jsx`, `TyreScrapManagement.jsx`, `TyreSpecifications.jsx`, `TyreSizeAnalysis.jsx`, `RotationSchedule.jsx`, `PositionIntelligence.jsx`, `PressureIntelligence.jsx`, `BrandPerformance.jsx`, `PredictiveMaintenance.jsx`

### 3. Workshop & Downtime
Work orders, corrective actions, repairs, downtime, gate pass.
`WorkOrders.jsx`, `WorkshopManagement.jsx`, `CorrectiveActions.jsx`, `DowntimeTracker.jsx`, `GatePass.jsx`, `RcaRecords.jsx`, `RootCauseEngine.jsx`

### 4. Stock & Procurement
Inventory ledger, replenishment, suppliers, procurement.
`StockManagement.jsx`, `StockReplenishment.jsx`, `Procurement.jsx`, `SupplierManagement.jsx`, `VendorIntelligence.jsx`

### 5. Safety & Compliance
Inspections, compliance, recalls, warranty.
`Inspections.jsx`, `InspectionIntelligence.jsx`, `InspectionPlanner.jsx`, `SafetyCompliance.jsx`, `ComplianceDashboard.jsx`, `RecallTracker.jsx`, `WarrantyTracker.jsx`

### 6. Accident & Insurance
Accident records, claims, insurance.
`Accidents.jsx`

### 7. Reports & Executive
Reporting, executive views, KPIs, forecasting, analytics roll-ups.
`Reports.jsx`, `ExecutiveReport.jsx`, `ScheduledReports.jsx`, `Analytics.jsx`, `AdvancedAnalytics.jsx`, `FleetAnalytics.jsx`, `AiAnalytics.jsx`, `AiCommandCenter.jsx`, `EngineeringKpi.jsx`, `KpiCommandCenter.jsx`, `KpiScorecard.jsx`, `ForecastingEngine.jsx`, `BudgetPlanner.jsx`, `Budgets.jsx`, `CostCenter.jsx`, `FuelEfficiency.jsx`, `Comparison.jsx`, `CountryComparison.jsx`, `SiteComparison.jsx`, `PerformanceBenchmark.jsx`, `ContinuousImprovement.jsx`

### 8. Administration & Data Control
Users, settings, uploads, data hygiene, ERP, audit.
`UserManagement.jsx`, `Settings.jsx`, `UploadData.jsx`, `UploadApprovals.jsx`, `CustomData.jsx`, `DataCleaning.jsx`, `ErpSync.jsx`, `AuditTrail.jsx`

> **Known overlaps to resolve via replace-then-retire (not delete):** Operations dashboards (`Dashboard` / `DailyOps` / `LiveFleetStatus` / `FleetHealthBoard` / `FleetIntelligence`); KPI surfaces (`EngineeringKpi` / `KpiCommandCenter` / `KpiScorecard`); analytics (`Analytics` / `AdvancedAnalytics` / `FleetAnalytics` / `AiAnalytics`); comparison (`Comparison` / `CountryComparison` / `SiteComparison` / `PerformanceBenchmark`); budgets (`BudgetPlanner` / `Budgets` / `CostCenter`). Each cluster collapses into one canonical view with filter-driven sub-views once parity is confirmed.

---

## 3. UX requirements (Phase 6)

| Requirement | Standard |
|---|---|
| **Theme** | Consistent light/dark across all workspaces. No mismatched colours, random fonts, or inconsistent spacing. Strong contrast; readable tables. |
| **RTL / Arabic** | Layout RTL-ready; directional styles, mirrored navigation, Arabic-capable typography. |
| **Responsive** | Mobile, tablet, and desktop layouts for every workspace. |
| **States** | Every data surface shows explicit empty, loading, and error states — no blank or thin screens. |
| **Fewer charts** | Remove decorative/redundant charts; keep charts that drive a decision. |
| **Chart drill-down** | Every chart drills down to its **source records** (filtered table view), tied to the central KPI definition. |
| **Large tables** | Search, filters, pagination, and virtualisation where row counts are high. |
| **Form validation** | Validate **before submission**; show field-level errors inline. |
| **Destructive actions** | Confirmation dialog with a clear explanation of impact before any destructive action. |
| **Plain language** | Field-user labels avoid technical jargon; engineering terms only where the audience is technical. |

---

## 4. Performance & navigation hygiene

- **Lazy-load export libraries** (`xlsx`, `jspdf`, `pptxgenjs`) only when the user triggers an Excel/PDF/PowerPoint export — they are currently statically imported in web pages and inflate the bundle.
- Heavy KPI calculations move out of page components into SQL views / RPCs / scheduled snapshots / React Query caches; pages render retrieved results.
- Workspace shells code-split per workspace so first paint loads only the active group.

---

## 5. Guardrails

- Do not break or remove a route before its consolidated replacement is confirmed at parity.
- Do not remove a feature for being complex.
- Navigation simplification is additive first (group), subtractive last (retire duplicate nav entry after redirect).
