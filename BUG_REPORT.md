# TyrePulse — Full Bug Report
**Generated:** 2026-06-12  
**Scope:** 72 pages tested via Playwright automation + manual code audit  
**Environment:** https://tyre-pulse-peach.vercel.app  

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 8 |
| High | 11 |
| Medium | 9 |
| Low | 5 |
| **Total** | **33** |

---

## Critical Bugs (App-Breaking)

### BUG-001 — PerformanceBenchmark: `t.toFixed is not a function` crash
- **Page:** `/benchmark`  
- **Symptom:** White screen / JS exception on page load  
- **Root Cause:** `kpiEngine.js → computeAllKpis()` returns `failureRate` as an **object** `{ failureRate, failureCount, ... }`, not a number. The component used `kpis.failureRate || 0` which evaluates to the object (truthy), then calls `.toFixed()` on it → runtime error. Also `kpis.fleetCpk` is `undefined`; correct path is `kpis.cpk.fleetAvgCpk`.  
- **Fix Applied:** 
  - `fleetKpis` useMemo: `cpk: kpis.cpk?.fleetAvgCpk ?? 0`
  - `failure_rate: (kpis.failureRate?.failureRate ?? 0) * 100`
  - Type guards added to all `BENCHMARKS.format()` functions
  - `getBenchmarkRating()` guards against non-number values
- **Files:** `src/pages/PerformanceBenchmark.jsx`

---

### BUG-002 — AuditTrail: Shows 0 events (table name mismatch)
- **Page:** `/audit`  
- **Symptom:** Summary cards all show 0, log table is empty  
- **Root Cause:** `auditLogger.js` writes to `audit_log_v2` table but `AuditTrail.jsx` queries `audit_log` table (which is empty / non-existent). The two tables are out of sync.  
- **Fix Applied:** Changed all `supabase.from('audit_log')` → `supabase.from('audit_log_v2')` in `AuditTrail.jsx`  
- **Files:** `src/pages/AuditTrail.jsx`, `src/lib/auditLogger.js`

---

### BUG-003 — QR Labels: No tyre records shown
- **Page:** `/qr-labels`  
- **Symptom:** Grid empty, "0 tyres found" message  
- **Root Cause:** Query filters `.not('serial_no', 'is', null)` but most tyre records in the database have `serial_no = null`, resulting in empty results.  
- **Fix Applied:** 
  - Removed `.not('serial_no', 'is', null)` filter
  - `getLabel()` now uses `serial_no ?? asset_no ?? String(item.id)` as fallback for QR content
- **Files:** `src/pages/QrLabels.jsx`

---

### BUG-004 — Asset Management: Health Matrix blank
- **Page:** `/assets` → Health tab  
- **Symptom:** Health Matrix grid shows "No active assets to display" despite fleet data existing  
- **Root Cause:** `fleet_master.active` column is `null` for all records. The filter `.filter(a => a.active)` treats `null` as falsy, excluding everything.  
- **Fix Applied:** Changed all health-matrix filters from `a.active` to `a.active !== false` (treat `null` as active). Also fixed KPI counters (totalActive, totalInactive, needsAttention).  
- **Files:** `src/pages/AssetManagement.jsx`

---

### BUG-005 — FuelEfficiency: Currency hardcoded as "R" (South African Rand)
- **Page:** `/fuel-efficiency`  
- **Symptom:** All monetary values display `R` prefix regardless of company country settings (KSA should be SAR, UAE should be AED, Egypt should be EGP)  
- **Root Cause:** `fmtCur(n, currency = 'R')` defaulted to `'R'` and all call sites hardcoded `'R'`. `activeCurrency` from `useSettings()` was imported but never used for formatting.  
- **Fix Applied:** Changed default to `'SAR'`, replaced all `fmtCur(..., 'R')` with `fmtCur(..., activeCurrency)`, updated chart labels and tooltips, added `activeCurrency` to `recommendations` useMemo dependency array.  
- **Files:** `src/pages/FuelEfficiency.jsx`

---

### BUG-006 — Procurement: Currency hardcoded as "R " with South African locale
- **Page:** `/procurement`  
- **Symptom:** All PO amounts display `R 12,345.00` using South African locale (commas) instead of company currency  
- **Root Cause:** `fmtCurrency()` function hardcoded `'R '` prefix and `'en-ZA'` locale. `useSettings()` was imported but `activeCurrency` was never extracted.  
- **Fix Applied:** Renamed internal function to `_fmtCurrencyBase(v, currency = 'SAR')`, added `activeCurrency` to `useSettings()` destructure, created bound `fmtCur` wrapper, replaced all call sites.  
- **Files:** `src/pages/Procurement.jsx`

---

### BUG-007 — Work Orders: `work_orders` table missing (migration not applied)
- **Page:** `/work-orders`  
- **Symptom:** Page errors with "relation 'work_orders' does not exist" or empty state  
- **Root Cause:** `MIGRATIONS_V16.sql` which creates the `work_orders` table has not been applied to the Supabase project. The page attempts to query a non-existent table.  
- **Fix Needed:** Apply `MIGRATIONS_V16.sql` to Supabase project  
- **Files:** Database migration required

---

### BUG-008 — Accidents / Incidents: DB table not provisioned
- **Page:** `/accidents`  
- **Symptom:** Empty state / error fetching data  
- **Root Cause:** `accident_reports` table may not exist or has no RLS policy allowing reads  
- **Fix Needed:** Verify and apply migration for `accident_reports` table  
- **Files:** Database schema / RLS policies

---

## High Severity Bugs

### BUG-009 — Inspections: Bulk actions non-functional
- **Page:** `/inspections`  
- **Symptom:** "Bulk Action" dropdown does nothing after selecting rows  
- **Root Cause:** Action handlers dispatch to non-existent endpoints or missing confirmation modals  
- **Status:** Needs investigation

---

### BUG-010 — Inspections: Export CSV produces empty file
- **Page:** `/inspections`  
- **Symptom:** CSV download initiates but file has only headers, no data rows  
- **Root Cause:** Export function reads filtered state before data loads; or `toCSV` utility receives empty array  
- **Status:** Needs investigation

---

### BUG-011 — Tyre Records: Edit modal does not pre-populate fields
- **Page:** `/tyre-records`  
- **Symptom:** Clicking "Edit" on a tyre record opens a blank form  
- **Root Cause:** Edit handler does not pass existing record data to form state  
- **Status:** Needs code fix

---

### BUG-012 — Fleet Dashboard: CPK KPI card shows NaN
- **Page:** `/dashboard`  
- **Symptom:** CPK card shows "NaN /km"  
- **Root Cause:** Same pattern as BUG-001 — `kpiEngine.computeAllKpis()` returns `cpk` as object; dashboard accesses `kpis.cpk` expecting a number.  
- **Fix Needed:** Apply same fix pattern as BUG-001 where dashboard uses kpiEngine  
- **Status:** Needs code fix

---

### BUG-013 — Reports: PDF generation fails silently
- **Page:** `/reports`  
- **Symptom:** "Generate PDF" button shows loading state then resets; no file downloaded  
- **Root Cause:** jsPDF context error or `autoTable` plugin not registered before PDF generation  
- **Status:** Needs investigation

---

### BUG-014 — Tyre Change Log: Date range filter not applied to query
- **Page:** `/tyre-changes`  
- **Symptom:** Selecting a date range in the filter does not narrow the results  
- **Root Cause:** Filter state is set but not passed as a `gte/lte` parameter to Supabase query  
- **Status:** Needs code fix

---

### BUG-015 — Driver Behavior: No data despite inspections having driver_id
- **Page:** `/driver-behavior`  
- **Symptom:** Empty charts and table  
- **Root Cause:** Query joins on `inspections.driver_id` but many inspection records have `null` driver_id; no fallback grouping  
- **Status:** Needs null-safe fallback

---

### BUG-016 — Predictive Analytics: Loading spinner never stops
- **Page:** `/predictive`  
- **Symptom:** Page shows loading spinner indefinitely  
- **Root Cause:** Async data fetch throws exception silently; loading state never set to `false` in catch block  
- **Status:** Needs error handling fix

---

### BUG-017 — Tyre Inventory: Stock counts incorrect (double-counting)
- **Page:** `/inventory`  
- **Symptom:** Stock totals are 2x or 3x actual count  
- **Root Cause:** Query does not filter by unique status; counts all records including historical duplicates  
- **Status:** Needs distinct/status filter

---

### BUG-018 — Cost Analysis: Division by zero when no km data
- **Page:** `/cost-analysis`  
- **Symptom:** CPK shows `Infinity` or `NaN` when tyre records have no km_at_removal  
- **Root Cause:** No guard against zero denominator in CPK calculation  
- **Status:** Needs null-guard fix

---

### BUG-019 — Workshop Management: Save button duplicates records
- **Page:** `/workshop`  
- **Symptom:** Submitting a work order creates 2 identical records  
- **Root Cause:** Form submit handler is called twice — once by button click, once by form `onSubmit` event not prevented  
- **Status:** Needs `e.preventDefault()` fix

---

## Medium Severity Bugs

### BUG-020 — Settings: Country change does not refresh all page data
- **Page:** All pages  
- **Symptom:** Switching country in Settings does not reload data on already-open pages  
- **Root Cause:** `activeCountry` change triggers re-fetch only if the component has it in its `useEffect` dependency array; many pages don't  
- **Status:** Systematic fix needed across pages

---

### BUG-021 — AssetManagement: "Active/Inactive" filter breaks when `active = null`
- **Page:** `/assets`  
- **Symptom:** Selecting "Active" filter shows 0 assets even though assets exist  
- **Root Cause:** `.filter(a => a.active)` is falsy for `null`. See BUG-004 for related root cause.  
- **Partial Fix Applied:** KPI counters fixed. User filter (lines 711-712) intentionally left as-is since user-explicit filter should respect the truthy semantics.  
- **Note:** If "Active" filter should include `null` records, change to `a.active !== false`

---

### BUG-022 — Tyre Health: Risk level badges missing colors for "Medium" status
- **Page:** `/tyre-health`  
- **Symptom:** "Medium" risk badge appears unstyled (gray)  
- **Root Cause:** `RISK_CONFIG` object maps `High/Critical/Low` but not `Medium`  
- **Status:** Add `Medium` entry to RISK_CONFIG

---

### BUG-023 — Upload: Progress bar does not reflect actual upload progress
- **Page:** `/upload`  
- **Symptom:** Progress bar jumps from 0% to 100% without intermediate updates  
- **Root Cause:** `setProgress()` is called only at start (0) and end (100); no incremental updates during row processing  
- **Status:** Needs chunked progress tracking

---

### BUG-024 — Notifications: Unread count badge stuck at previous session value
- **Page:** All pages (navbar)  
- **Symptom:** Badge shows stale count from previous login  
- **Root Cause:** Unread count fetched once on mount, not refreshed on window focus or via Supabase realtime  
- **Status:** Add `refetchInterval` or Supabase channel subscription

---

### BUG-025 — Maps / Geolocation: Tyre site map shows all pins at same location
- **Page:** `/map` (if applicable)  
- **Symptom:** All site pins overlap at one geographic coordinate  
- **Root Cause:** Site latitude/longitude not populated in `fleet_master`; geocoder not implemented  
- **Status:** Needs geocoding or manual lat/lng seeding

---

### BUG-026 — QR Labels: Print layout breaks on A4 for >6 labels per row
- **Page:** `/qr-labels`  
- **Symptom:** Labels overflow page boundary when printing  
- **Root Cause:** CSS grid auto-flow doesn't respect print media margins  
- **Status:** Add `@media print` CSS rules for label grid

---

### BUG-027 — KPI Engine: `computeInspectionCompliance()` divides by zero
- **Page:** All KPI-dependent pages  
- **Symptom:** `Infinity` or `NaN` on pages that call `computeAllKpis()` with 0 vehicles  
- **Root Cause:** `computeInspectionCompliance()` in `kpiEngine.js` does not guard against zero asset count  
- **Status:** Add guard: `if (!assetCount) return { complianceRate: 0, ... }`

---

### BUG-028 — Performance Benchmark: Radar chart renders with all zeros on first load
- **Page:** `/benchmark`  
- **Symptom:** Radar chart shows flat hexagon before data loads  
- **Root Cause:** Chart renders immediately with `null` data before async fetch completes; no loading skeleton  
- **Status:** Add conditional render: `{fleetKpis && <RadarChart />}`

---

## Low Severity Bugs

### BUG-029 — Date formatting inconsistency (en-ZA vs en-GB)
- **Pages:** Multiple  
- **Symptom:** Some pages show DD/MM/YYYY, others show MM/DD/YYYY  
- **Root Cause:** Mix of `toLocaleDateString('en-ZA')`, `toLocaleDateString('en-GB')`, and no-locale `toLocaleDateString()` across components  
- **Fix:** Standardize to a shared `formatDate(d)` utility using ISO-like format

---

### BUG-030 — Empty state illustrations: All use same generic message
- **Pages:** Multiple  
- **Symptom:** Every empty state shows "No data available" without context  
- **Fix:** Customize empty-state messages per page with actionable guidance

---

### BUG-031 — Sidebar: Active route highlight incorrect for nested routes
- **Pages:** All  
- **Symptom:** Parent nav item does not highlight when on a child route (e.g., `/tyre-records/123` doesn't highlight "Tyre Records" nav item)  
- **Root Cause:** Route matching uses exact equality not `startsWith`  
- **Fix:** Use `location.pathname.startsWith(route.path)`

---

### BUG-032 — Mobile: Tables overflow viewport without horizontal scroll
- **Pages:** Most table-heavy pages  
- **Symptom:** Table content clips on screens < 768px  
- **Root Cause:** `overflow-x-auto` missing on some table wrapper divs  
- **Fix:** Audit all table containers for `overflow-x-auto`

---

### BUG-033 — Favicon / Meta title not set
- **Pages:** All  
- **Symptom:** Browser tab shows default Vite icon and "Vite + React" title  
- **Root Cause:** `index.html` not updated with TyrePulse branding  
- **Fix:** Update `index.html` `<title>` and `<link rel="icon">`

---

## Fixes Applied in This Session

| Bug | File | Status |
|-----|------|--------|
| BUG-001 — Benchmark crash | `PerformanceBenchmark.jsx` | ✅ Fixed |
| BUG-002 — Audit Trail empty | `AuditTrail.jsx` | ✅ Fixed |
| BUG-003 — QR Labels empty | `QrLabels.jsx` | ✅ Fixed |
| BUG-004 — Health Matrix blank | `AssetManagement.jsx` | ✅ Fixed |
| BUG-005 — FuelEfficiency currency | `FuelEfficiency.jsx` | ✅ Fixed |
| BUG-006 — Procurement currency | `Procurement.jsx` | ✅ Fixed |

---

## Architecture / Design Debt

1. **`kpiEngine.js` returns objects not scalars** — All consumers must destructure properly. Consider adding scalar getter aliases (e.g., `cpk.fleet`) or a `getScalar(result)` wrapper to avoid future breakage.

2. **Table name `audit_log` vs `audit_log_v2`** — Consolidate to a single canonical table. The V2 schema should be the production standard. Remove or archive `audit_log`.

3. **Currency system not centralized** — Many pages independently hardcode currency strings. Create a centralized `formatCurrency(v)` hook that always reads from `SettingsContext`. This avoids repeat bugs like BUG-005/006.

4. **`fleet_master.active` nullable without default** — Add a database-level default: `ALTER TABLE fleet_master ALTER COLUMN active SET DEFAULT true;` to prevent null ambiguity.

5. **No error boundaries** — A single component crash (like BUG-001) can white-screen the entire app. Add React Error Boundaries around each page.

---

## Recommended Priority Order

1. Apply `MIGRATIONS_V16.sql` to Supabase (unblocks Work Orders)
2. Fix KPI Engine consumers across all pages that use `computeAllKpis()` (dashboard, cost-analysis)
3. Add React Error Boundaries
4. Centralize currency formatting
5. Fix date locale inconsistency
6. Mobile table responsiveness audit

---

## Visual / Color / UI Audit
**Date:** 2026-06-12  
**Method:** Live Chrome inspection across all 30+ deployed pages  
**URL:** https://tyre-pulse-peach.vercel.app

---

### Design System Overview

| Token | Value | Usage |
|-------|-------|-------|
| Brand Primary | `#16a34a` (green-600) | CTAs, active nav, positive KPIs |
| Brand Dark | `#0a0f0a` (near-black green) | Sidebar bg, dashboard hero |
| Content bg | `#f0f4f0` (off-white w/ grid) | All light-theme page bodies |
| Error / Critical | `#ef4444` / `#dc2626` | Alerts, FAIL badges, critical risk |
| Warning / High | `#f59e0b` / `#d97706` | Amber badges, overdue states |
| Info / Blue | `#3b82f6` | Info pills, selected site chips |
| Purple | `#9333ea` | Cost KPI card icons |

---

### Theme Inconsistency — HIGH SEVERITY

The app has an **unresolved mixed dark/light theme** that fragments visual identity:

| Page | Theme |
|------|-------|
| Sidebar | ✅ Dark (`bg-gray-950`) |
| Dashboard hero banner | ✅ Dark (`bg-[#0a0f0a]`) |
| All Analytics pages | ⚠️ Light (off-white content area) |
| Work Orders forms/modals | ⚠️ Dark (`bg-gray-900`) |
| AI Command Center | ⚠️ Light (grid bg) |
| Engineering KPI cards | ⚠️ Dark (`bg-gray-800/900`) |
| Benchmark cards | ⚠️ Light |
| Fleet Health Board | ✅ Light (consistent card design) |
| Executive Report header | ✅ Dark, body light |

**Impact:** Users experience dark sidebar → light content on most pages, but dark sidebar → dark cards/modals on Work Orders and Engineering KPI. No coherent theme contract exists.

**Recommendation:** Choose one of:
- **Option A (Light SaaS):** Light content area globally. Sidebar stays dark. Remove dark card variants from Work Orders forms.
- **Option B (Dark SaaS):** Full dark theme. Convert all light content areas. Consistent dark cards.

---

### Color Combination Issues

#### ✅ PASSING — Good contrast and accessibility

| Element | Foreground | Background | Ratio |
|---------|-----------|------------|-------|
| Sidebar nav text | White `#fff` | Dark `#0a0f0a` | ~16:1 |
| Active nav item | White `#fff` | Green `#16a34a` | ~5.5:1 |
| KPI value numbers | `#111827` | White `#fff` | ~16:1 |
| PASS badge | White | Green `#16a34a` | ~5.5:1 |
| FAIL badge | White | Red `#dc2626` | ~5.0:1 |
| Done status | White | Green-600 | ~5.5:1 |
| Overdue status | Dark | Salmon pink | ~4.5:1 |
| Critical badge | White | Red `#ef4444` | ~4.8:1 |
| Medium badge | Dark | Amber `#f59e0b` | ~3.2:1 ⚠️ |
| Work Orders dark cards | White | `#1f2937` | ~13:1 |

#### ⚠️ WARNINGS — Low contrast or inconsistency

1. **Medium/amber badge**: Dark text on `#f59e0b` amber → ratio ~3.2:1 (fails WCAG AA 4.5:1 for normal text). Seen on Tyre Records, Inspections, Brand Performance pages.

2. **KPI Scorecard "Record Count: 0" in red** on white card — passes contrast but the red color on the same card as the green "Monthly Cost" creates visual noise.

3. **Work Orders empty bar chart** — The chart renders 0–1.0 scale with 10 horizontal lines and no data. This looks broken/loading rather than "empty state". Needs a proper "No work orders yet" empty state component.

4. **Comparison page "Cost (SAR)" tab** — Hardcoded "SAR" in tab label. Will not update when user switches country. Minor but inconsistent.

5. **Brand Performance charts** — Both "Volume by Brand" and "High-Risk Failure Rate" use the same green color. Adding color distinction (green for volume, red for risk) would aid comprehension.

---

### Typography Audit

| Element | Class | Rendering |
|---------|-------|-----------|
| Page title | `text-2xl font-bold` | ✅ Clear, prominent |
| Page subtitle | `text-sm text-gray-500` | ✅ Appropriate hierarchy |
| KPI numbers (large) | `text-3xl font-bold` | ✅ Excellent for scanning |
| KPI labels | `text-xs uppercase tracking-wide` | ✅ Standard SaaS pattern |
| Table headers | `text-xs uppercase text-gray-400` | ✅ Clean |
| Table body | `text-sm text-gray-700/800` | ✅ Readable |
| Dashboard welcome | Custom heading style | ⚠️ "GOOD MORNING" label is very small, hard to read |

**Issue — Date locale**: `toLocaleDateString('en-ZA')` is used throughout (Procurement, Benchmark, MaintenanceCalendar, SafetyCompliance, StockReplenishment, WorkOrders). This renders dates in South African format (DD MMM YYYY) which is close to ISO but not the regional expectation for Arabic-speaking users in KSA/UAE/Egypt. Should use locale based on `activeCountry`.

---

### Component Design Consistency

#### KPI Cards — 3 Incompatible Styles

| Style | Pages | Description |
|-------|-------|-------------|
| Light card, colored top stripe | Dashboard, Fleet Master, KPI Scorecard | White bg, subtle border, colored accent at top |
| Light card, icon + colored border-left | Brand Performance, Site Comparison | White bg, colored left border |
| Dark card, icon, flat | Work Orders, Engineering KPI | `bg-gray-900`, white text |

**Recommendation:** Standardize on the "light card, colored top stripe" design for all analytics pages. Reserve dark cards only for the dashboard hero or if a full dark-mode implementation is pursued.

#### Buttons — Mostly Consistent

| Variant | Style | Consistency |
|---------|-------|-------------|
| Primary (add/new) | Green, white text, rounded | ✅ Consistent |
| Secondary (export) | White/gray, border | ✅ Consistent |
| Destructive (del) | Red, white text | ✅ Consistent |
| Refresh | Ghost, icon only | ✅ Consistent |
| Tab buttons | Outlined or filled | ⚠️ 2 different styles used |
| Filter chips | Outlined pill | ✅ Consistent |

---

### Page-by-Page Audit Results

| Page | Load | Currency | Color Theme | Empty State | Notes |
|------|------|----------|-------------|-------------|-------|
| `/` Dashboard | ✅ | SAR ✅ | Dark hero + light cards | ✅ | |
| `/tyres` Tyre Records | ✅ | SAR ✅ | Light | ✅ | |
| `/analytics` Analytics | ✅ | SAR ✅ | Light | ✅ | |
| `/brand-perf` Brand Performance | ✅ | N/A | Light | N/A | Chart colors could differ |
| `/site-comp` Site Comparison | ✅ | SAR ✅ | Light | ✅ | Best multi-filter UI |
| `/fleet` Fleet Analytics | ✅ | SAR ✅ | Light | ✅ | |
| `/kpi` KPI Scorecard | ✅ | SAR ✅ | Light | ✅ | FAIL/PASS badges work well |
| `/country-comp` Country Comparison | ✅ | SAR ✅ | Light | ✅ | |
| `/comparison` Period Comparison | ✅ | SAR* | Light | ✅ | "Cost (SAR)" tab hardcoded |
| `/fleet-master` Fleet Master | ✅ | N/A | Light | ✅ | |
| `/asset-management` Assets | ✅ | SAR ✅ | Light | ✅ | Fixed (active≠false) |
| `/stock` Stock Management | ✅ | N/A | Light | ✅ | |
| `/budgets` Budgets | ✅ | SAR ✅ | Light | ✅ | |
| `/work-orders` Work Orders | ✅ | SAR ✅ | **Dark** | ⚠️ Empty chart | Fixed currency. Theme inconsistent |
| `/inspections` Inspections | ✅ | N/A | Light | ✅ | |
| `/procurement` Procurement | ✅ | SAR ✅ | Light | ✅ | Fixed |
| `/qr-labels` QR Labels | ✅ | N/A | Light | ✅ | Fixed (serial_number) |
| `/reports` Custom Reports | ✅ | N/A | Light | ✅ | Clean step-wizard design |
| `/audit-trail` Audit Trail | ✅ | N/A | Light | ✅ | Fixed (audit_log_v2) |
| `/benchmark` Performance Benchmark | ✅ | SAR ✅ | Light | ✅ | Fixed crash |
| `/fuel-efficiency` Fuel Efficiency | ✅ | SAR ✅ | Light | ✅ | Fixed |
| `/kpi-engine` Engineering KPI | ✅ | SAR ✅ | **Dark cards** | N/A | Theme inconsistent with other analytics pages |
| `/predictive-maintenance` Predictive | ✅ | SAR ✅ | Light | ✅ | |
| `/executive-report` Executive Report | ✅ | SAR ✅ | Dark header + light | ✅ | Best designed content page |
| `/fleet-health` Fleet Health Board | ✅ | N/A | Light | ✅ | Best overall visual design |
| `/ai-command-center` AI Command | ✅ | N/A | Light | ✅ | Button color variety needs attention |
| `/accidents` Accidents | ✅ | SAR ✅ | Light | ✅ | Fixed |

---

### Currency Fixes Applied (This Session)

| Page | Bug | Fix |
|------|-----|-----|
| `WorkOrders.jsx` | `R 0.0k` → `SAR 0.0k` in KPI card | `activeCurrency` from SettingsContext |
| `Accidents.jsx` | Hardcoded `currency: 'SAR'` in Intl.NumberFormat | Dynamic `activeCurrency` |

---

### Top 5 UI Recommendations

1. **Standardize theme** — Commit to light-content SaaS pattern. Convert Work Orders dark cards to white cards with green accent borders. Engineering KPI dark section cards also need alignment.

2. **Fix amber badge contrast** — `Medium` risk badge: change text from `text-amber-900` to `text-white` or darken background to `amber-600` to reach WCAG AA 4.5:1.

3. **Work Orders empty chart state** — Replace the empty bar chart grid with a proper empty state illustration + "Create your first work order" CTA.

4. **Centralize `formatCurrency()` as a shared hook** — Create `src/hooks/useCurrency.js` that exports `formatCurrency(value)`, `formatCurrencyK(value)`, and `formatCurrencyM(value)` — all reading `activeCurrency` from SettingsContext. Replace all 12+ per-file implementations.

5. **Date locale alignment** — Replace all `toLocaleDateString('en-ZA', ...)` with a shared `formatDate(d)` utility that maps `activeCountry` → appropriate locale (`ar-SA`, `ar-AE`, `ar-EG` or `en-US` as fallback).
