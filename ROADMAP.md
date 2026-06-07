# TyrePulse — Product Roadmap & Progress
**Readymix Concrete Company · Built by Shahzeb Rahman © 2026**
**Version 3.1 · Updated June 2026 · Branch: `claude/handoff-setup-gZAHb`**

---

## Status Key

| Symbol | Meaning |
|--------|---------|
| ✅ | Complete and deployed to branch |
| 🔄 | In progress this session |
| ⬜ | Planned, not started |
| 🔒 | Blocked on dependency |

---

## Product Health

| Metric | Status |
|--------|--------|
| Build | ✅ 0 errors |
| Test suite | ✅ 369 passing, 0 failures |
| Auth | ✅ RLS + RBAC + idle timeout |
| Migrations | V1–V11 applied |
| Hosting | Vercel (auto-deploy on push to `main`) |
| Database | Supabase PostgreSQL + Auth |

---

## Wave 1 — Security, Auth & Access Control

| # | Feature | Status |
|---|---------|--------|
| 1A | Remove AI/Anthropic branding from visible UI | ✅ |
| 1B | 1-hour idle session timeout with auto sign-out | ✅ |
| 1C | Role-based page access — Admin-only routes | ✅ |
| 1D | Admin-only nav items hidden from non-Admins | ✅ |
| 1E | Forgot password flow + /reset-password page | ✅ |
| 1F | Employee ID field on signup and profile | ✅ |
| 1G | Show/hide password toggle on all password fields | ✅ |
| 1H | Pending admin approval workflow for new accounts | ✅ |
| 1I | UserManagement: Approve button + multi-country assignment | ✅ |
| 1J | MIGRATIONS_V10 — employee_id, approved, country[], upload_batch_id, accidents | ✅ |

---

## Wave 1B — UX & Export Polish

| # | Feature | Status |
|---|---------|--------|
| P1 | PDF export — green header, auto-fit columns, risk-colour cells | ✅ |
| P2 | Remove em-dashes from all UI text and exports | ✅ |
| P3 | Rename AI Analytics → Smart Analytics in UI and nav | ✅ |
| P4 | Dashboard — clickable KPI cards navigating to relevant pages | ✅ |
| P5 | Dashboard — Quick Actions row (Anomaly Scan, Alerts, Upload, Inspections) | ✅ |
| P6 | Anomaly page — search-first drill-down by asset number | ✅ |
| P7 | Upload page — type selector (Tyre / Fleet / Auto-detect) | ✅ |
| P8 | Inspections — Site Observations tab with photo upload | ✅ |
| P9 | Inspections — Training tab (Safety Training, Training Session types) | ✅ |
| P10 | Inspections — Raise Corrective Action from completed observations | ✅ |
| P11 | Corrective Actions and RCA Records — photo attachments | ✅ |
| P12 | Vehicle History — richer inspection history display | ✅ |
| P13 | Data Cleaning — search, pagination, undo last clean, remarks preview | ✅ |
| P14 | Fleet Master — bulk vehicle upload | ✅ |
| P15 | Audit Trail page with upload history and activity log | ✅ |

---

## Wave 2 — Upload Intelligence & Dashboard Depth

| # | Feature | Status |
|---|---------|--------|
| 2A | Multi-sheet Excel upload with sheet picker (select/skip sheets) | ✅ |
| 2B | Stock upload mapping (4th upload type, maps to stock_records) | ✅ |
| 2C | Upload batch delete — Admin can remove all records from a batch | ✅ |
| 2D | Dashboard date shortcuts (Today / This Week / This Month / This Year / Custom) | ✅ |
| 2E | Dashboard period breakdown toggle (Daily / Weekly / Monthly / Yearly) | ✅ |
| 2F | Tyre forecast card on Dashboard (rolling 3-month projection) | ✅ |

---

## Wave 3 — New Pages

| # | Feature | Status |
|---|---------|--------|
| 3A | Accidents / Incident Tracking page with dashboard | ✅ |
| 3B | Custom Reports page (report builder with filters + Excel/PDF output) | ✅ |
| 3C | Chart enlargement modal (fullscreen any chart with date filter + PNG download) | ✅ |

---

## Wave 4 — Inspections & Vehicle Diagrams

| # | Feature | Status |
|---|---------|--------|
| 4A | Vehicle tyre position SVG diagram in Vehicle History | ✅ |
| 4B | Vehicle type icons (🛻 Pickup, 🚛 Tri-mixer, 🏗️ Pump, 🚚 Canter, 🚜 Loader) | ✅ |
| 4C | Daily inspection checklist — mobile-optimised with tyre pressure fields | ✅ |
| 4D | Inspection PDF with pressure readings and condition colours | ✅ |
| 4E | Tyre Man role — inspections checklist only, mobile shell, no sidebar | ✅ |

---

## Wave 5 — Polish & Access

| # | Feature | Status |
|---|---------|--------|
| 5A | App logo SVG (tyre/wheel icon, sidebar and login header) | ✅ |
| 5B | Country-based access lock (non-Admin locked to assigned country) | ✅ |
| 5C | Navigation auto-collapse during active upload | ✅ |
| 5D | Email generation with attached reports (PDF emailed to recipients) | ⬜ |
| 5E | Theme improvements — depth, gradients, card shadows, dark palette refinement | ⬜ |
| 5F | Empty state cleanup — meaningful empty states across all pages | ⬜ |

---

## Wave 6 — Operational Features

| # | Feature | Status |
|---|---------|--------|
| 6A | Gate Pass system — daily inspection clearance, issue/deny, policy PDF | ✅ |
| 6B | Smart cross-user duplicate detection on upload (exact dups, serial conflicts, re-upload warning) | ✅ |
| 6C | Serial number lifecycle tracker page | ✅ |
| 6D | Month/year comparison analytics (Period A vs B, bar chart, summary table) | ✅ |
| 6E | MIGRATIONS_V11 — gate_passes table with RLS | ✅ |

---

## Wave 7 — Operational Intelligence *(Completed June 2026)*

| # | Feature | Status |
|---|---------|--------|
| 7A | Settings — KPI Targets Editor (load/upsert `kpi_targets` table, Admin-only edit, read-only for other roles) | ✅ |
| 7B | Settings — Enhanced Alert Thresholds (5 fields persisted to `app_settings` table: stock critical %, budget warning %, budget critical %, days overdue, high risk %) | ✅ |
| 7C | KPI Scorecard — Site Breakdown tab (per-site 5-KPI comparison table, red/green colouring, totals footer) | ✅ |
| 7D | KPI Scorecard — Year-over-Year toggle (prior-year data overlay on chart, delta column in table, YoY on KpiCards) | ✅ |
| 7E | KPI Scorecard — Performance alerts banner (amber/red when any metric >20% over target) | ✅ |
| 7F | VehicleHistory — Forecast tab: tyre health score per position (0–100, risk + age decay, colour-coded bar) | ✅ |
| 7G | VehicleHistory — Replacement forecast per position (km-based, Fleet Master policy or 60k default, "Due soon" flag) | ✅ |
| 7H | VehicleHistory — Top 3 action recommendations (priority scored, Urgent/Soon/Monitor badges) | ✅ |
| 7I | VehicleHistory — 3-month cost projection (historical average, budget indicator vs Fleet Master budget) | ✅ |
| 7J | StockManagement — Consumption velocity columns (avg tyres/month from last 3 months, Days Left with colour coding) | ✅ |
| 7K | StockManagement — Reorder suggestion chips (auto-calculates order qty when Days Left < 30) | ✅ |
| 7L | StockManagement — Inter-site Transfer tab (From/To selects, dual stock_movements insert, live qty preview) | ✅ |
| 7M | Reports — Vehicle History report now groups by asset_no with aggregated cost, count, brands, high-risk count | ✅ |
| 7N | Reports — Full preview with pagination (100 rows/page, Prev/Next, page counter) | ✅ |
| 7O | Reports — Print button (opens styled print window with report title and table) | ✅ |
| 7P | Reports — Save/restore report config per type via localStorage | ✅ |

---

## Wave 8 — Predictive Analytics & AI

*Priority order. Approach selected per CLAUDE.md AI cost standards.*

### Tier 1 — Rule-Based (Zero AI Cost)

| # | Feature | Approach | Status |
|---|---------|----------|--------|
| 8A | Data cleaning auto-run on upload (brand/size normalization, alias resolution) | Rule-based engine | ⬜ |
| 8B | Advanced Excel parser — merged cells, hidden columns, multi-currency date formats | Rule-based | ⬜ |
| 8C | Manager Decision Support Center — top cost vehicles, CPK league table, recommendations panel | SQL aggregation | ⬜ |
| 8D | Enhanced Fraud Detection — serial conflicts across fleets, workshop abuse patterns, mileage manipulation scoring | Rule-based + anomaly | ⬜ |
| 8E | Tyre Life Prediction engine — fleet-level rolling regression, replacement schedule calendar | SQL + stats | ⬜ |
| 8F | Vendor / Brand Performance Scorecard — CPK ranking, failure rate, cost efficiency per supplier | SQL aggregation | ⬜ |
| 8G | Driver Behaviour Scoring — link tyre wear patterns to driver ID, rank drivers by tyre cost impact | Rule-based | ⬜ |

### Tier 2 — Hybrid (Low AI Cost, Cached)

| # | Feature | Approach | AI Cost | Status |
|---|---------|----------|---------|--------|
| 8H | RCA Hybrid Engine — rules-first, AI fallback when confidence < 70%, result cached 24h | Hybrid | Low | ⬜ |
| 8I | AI Fleet Assistant — context-limited natural language queries, structured retrieval first, 24h cache | RAG + AI on-demand | Low | ⬜ |
| 8J | Predictive alert generation — AI narrates why an alert fired and suggests action | AI on structured data | Low | ⬜ |

### Tier 3 — AI Vision (Medium Cost)

| # | Feature | Approach | AI Cost | Status |
|---|---------|----------|---------|--------|
| 8K | OCR tyre image upload — extract brand, size, DOT, serial from tyre sidewall photo | AI vision | Medium | ⬜ |
| 8L | Inspection photo analysis — detect visible damage patterns from uploaded inspection photos | AI vision | Medium | ⬜ |

### Infrastructure

| # | Feature | Status |
|---|---------|--------|
| 8M | Token usage monitor + cache table (`ai_response_cache`) targeting < SAR 75/month | ⬜ |
| 8N | Embedding pipeline for inspection comments, RCA notes, SOP documents (pgvector) | ⬜ |
| 8O | RAG retrieval layer — chunk, embed, retrieve relevant context before any AI call | ⬜ |

---

## Wave 9 — Enterprise & Scale

| # | Feature | Status |
|---|---------|--------|
| 9A | Multi-tenant architecture — tenant_id isolation, per-tenant settings, billing hooks | ⬜ |
| 9B | SSO / SAML integration (Azure AD, Google Workspace) | ⬜ |
| 9C | API webhook system — push events to ERP on tyre change, alert, inspection completion | ⬜ |
| 9D | Scheduled report emails — cron-triggered PDF reports sent to configured recipients | ⬜ |
| 9E | Data retention policy enforcement — auto-archive records older than configurable threshold | ⬜ |
| 9F | White-label branding — company logo, colour palette, report header per tenant | ⬜ |
| 9G | Advanced RBAC — custom role builder, field-level permissions, approval workflows | ⬜ |
| 9H | Offline mode — PWA with service worker, sync queue for inspections without internet | ⬜ |
| 9I | Performance monitoring — Supabase query time tracking, slow query alerts | ⬜ |
| 9J | Automated backup verification — weekly backup restore test, alert on failure | ⬜ |

---

## Wave 10 — Mobile & Integrations

| # | Feature | Status |
|---|---------|--------|
| 10A | React Native mobile app (iOS + Android) — Tyre Man workflow, inspections, gate pass | ⬜ |
| 10B | ERP integration (SAP / Oracle) — read-only fleet data sync, tyre change write-back | ⬜ |
| 10C | Tyre supplier portal — supplier submits invoices, matched against stock_movements | ⬜ |
| 10D | Workshop management — job cards, technician assignment, labour cost tracking | ⬜ |
| 10E | Barcode / QR code scanner for tyre serial registration | ⬜ |
| 10F | GPS fleet integration — auto-populate odometer readings from telematics data | ⬜ |

---

## Migrations Reference

| File | Status | What it adds |
|------|--------|--------------|
| `SUPABASE_SCHEMA.sql` | ✅ Applied | Core tables, RLS scaffolding |
| `MIGRATIONS.sql` | ✅ Applied | due_date, inspections, stock_movements, audit_log, kpi_targets |
| `BACKEND_RLS.sql` | ✅ Applied | get_my_role() + role-based policies |
| `MIGRATIONS_V2.sql` | ✅ Applied | country column, km fields, currency settings |
| `MIGRATIONS_V3.sql` | ✅ Applied | extra_fields jsonb on tyre_records |
| `MIGRATIONS_V4.sql` | ✅ Applied | country on rca_records |
| `MIGRATIONS_V5.sql` | ✅ Applied | handle_new_user trigger, profile defaults |
| `MIGRATIONS_V6.sql` | ✅ Applied | vehicle_fleet table |
| `MIGRATIONS_V6_AUDIT.sql` | ✅ Applied | audit_log with user_id |
| `MIGRATIONS_V7.sql` | ✅ Applied | km fields, tyre_positions, inspections expansion |
| `MIGRATIONS_V8.sql` | ✅ Applied | inspections: attendees, severity, photo_data, linked_action_id |
| `MIGRATIONS_V9.sql` | ✅ Applied | photo_data on corrective_actions and rca_records |
| `MIGRATIONS_V10.sql` | ✅ Applied | profiles: employee_id, approved, country[]; tyre_records: upload_batch_id; accidents table |
| `MIGRATIONS_V11.sql` | ✅ Applied | gate_passes table with RLS |
| `MIGRATIONS_V12.sql` | ⬜ Needed | `app_settings` table (key/value store for alert_thresholds and global config) |

---

## Architecture Reference

```
src/
├── App.jsx                      — 30+ routes, ProtectedRoute, RoleRoute
├── contexts/
│   ├── AuthContext.jsx          — Session, profile, 1-hour idle timeout
│   └── SettingsContext.jsx      — activeCountry, currency, global settings
├── components/
│   ├── Layout.jsx               — Sidebar, Cmd+K search, role-based nav, alert badge
│   ├── ProtectedRoute.jsx       — Auth guard, pending approval screen, RoleRoute
│   ├── ChartModal.jsx           — Fullscreen chart + date filter + PNG download
│   ├── VehicleTyreDiagram.jsx   — SVG top-down diagram, risk colour coding
│   └── StatCard.jsx             — KPI cards (clickable, navigate to page)
└── lib/
    ├── supabase.js
    ├── tyreClassifier.js        — 13-category auto-classification
    ├── analyticsEngine.js       — Stats, regression, brand/site/asset/KPI metrics
    ├── alertEngine.js           — Stock, budget, overdue, risk spike, vehicle inactive
    ├── anomalyEngine.js         — 6 anomaly patterns
    ├── aiAnalytics.js           — Smart Analytics (internal Anthropic API)
    └── exportUtils.js           — Excel, branded PDF, PowerPoint
```

---

## User Roles

| Role | Badge | Access |
|------|-------|--------|
| Admin | Red | Full access including User Management, Audit, Anomaly Scan, Settings edit |
| Manager | Orange | All operational pages, analytics read |
| Inspector | Purple | Inspections and Settings read-only |
| Director | Blue | Read-only analytics and reports |
| Reporter | Gray | Upload, Tyre Records, Corrective Actions, Inspections |
| Tyre Man | Teal | Inspections checklist only (mobile shell UI) |

---

*TyrePulse v3.1 · Readymix Concrete Company · Shahzeb Rahman © 2026*
