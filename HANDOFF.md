# TyrePulse — Developer Handoff
**Readymix Concrete Company · Built by Shahzeb Rahman © 2026**
**Status: Production · Last updated: June 2026**

---

## Hosting

| Layer | Platform | Notes |
|---|---|---|
| Frontend | **Vercel** (auto-deploy on push to `main`) | Build: `npm run build`, output: `dist/` |
| Database | Supabase (PostgreSQL + Auth + RLS) | Free tier |
| Auth | Supabase Auth — email/password | Email confirmation ON |

**Vercel env vars required (Project Settings → Environment Variables):**
```
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
VITE_ANTHROPIC_API_KEY=sk-ant-...   (optional - enables Smart Analytics)
```

---

## SQL Migrations — Run in Supabase SQL Editor

All files are idempotent (IF NOT EXISTS, ADD COLUMN IF NOT EXISTS). Safe to re-run.

| File | What it adds |
|---|---|
| `SUPABASE_SCHEMA.sql` | Core tables, RLS scaffolding |
| `MIGRATIONS.sql` | due_date, inspections, stock_movements, audit_log, kpi_targets |
| `BACKEND_RLS.sql` | get_my_role() + role-based policies |
| `MIGRATIONS_V2.sql` | country column, km fields, currency settings |
| `MIGRATIONS_V3.sql` | extra_fields jsonb on tyre_records |
| `MIGRATIONS_V4.sql` | country on rca_records |
| `MIGRATIONS_V5.sql` | handle_new_user trigger, profile defaults |
| `MIGRATIONS_V6.sql` | vehicle_fleet table |
| `MIGRATIONS_V6_AUDIT.sql` | audit_log with user_id (idempotent) |
| `MIGRATIONS_V7.sql` | km fields, tyre_positions, inspections expansion |
| `MIGRATIONS_V8.sql` | inspections: attendees, severity, photo_data, linked_action_id |
| `MIGRATIONS_V9.sql` | photo_data on corrective_actions and rca_records |
| `MIGRATIONS_V10.sql` | profiles: employee_id, approved, country[]; tyre_records: upload_batch_id; accidents table |
| `MIGRATIONS_V11.sql` | gate_passes table |

After running V10: existing accounts are auto-approved. New sign-ups start as approved=false and require admin approval before logging in.

---

## Tech Stack

- React 18 + Vite 5 + Tailwind CSS (dark theme)
- Supabase: PostgreSQL, Auth, Row Level Security
- Chart.js v4 via react-chartjs-2
- jsPDF + jspdf-autotable for PDF exports
- XLSX (SheetJS) for Excel
- pptxgenjs for PowerPoint
- framer-motion for animations
- lucide-react for icons

---

## Architecture

```
src/
├── App.jsx                      — 30+ routes, ProtectedRoute, RoleRoute
├── contexts/
│   ├── AuthContext.jsx          — Session, profile, 1-hour idle timeout, signOut
│   └── SettingsContext.jsx      — activeCountry (locked for non-Admin with assigned country)
├── components/
│   ├── Layout.jsx               — Sidebar nav, TyreManShell (Tyre Man), role-based filtering
│   ├── ProtectedRoute.jsx       — Auth guard, pending approval screen, RoleRoute component
│   ├── ChartModal.jsx           — Fullscreen chart with date filter + PNG download
│   ├── VehicleTyreDiagram.jsx   — SVG top-down vehicle diagram, risk colour coding
│   └── StatCard.jsx             — KPI cards (clickable, navigate to relevant page)
└── lib/
    ├── supabase.js
    ├── tyreClassifier.js        — 13-category auto-classification
    ├── analyticsEngine.js       — Stats, regression, brand/site/asset metrics
    ├── alertEngine.js           — Stock, budget, overdue, risk spike alerts
    ├── anomalyEngine.js         — 6 pattern types: short interval, burst, cost spike, etc.
    ├── aiAnalytics.js           — Smart Analytics (internal API, not visible in UI)
    └── exportUtils.js           — Excel, PDF (branded), PowerPoint exports
```

---

## Pages and Routes

| Page | Route | Access |
|---|---|---|
| Dashboard | / | All |
| Tyre Records | /tyres | All |
| Analytics | /analytics | All |
| Brand Performance | /brand-perf | All |
| Site Comparison | /site-comp | All |
| Fleet Analytics | /fleet | All |
| KPI Scorecard | /kpi | All |
| Country Comparison | /country-comp | All |
| Stock Management | /stock | All |
| Budgets | /budgets | All |
| Corrective Actions | /actions | All |
| Root Cause Analysis | /rca | All |
| Inspections and Observations | /inspections | All (Tyre Man: checklist only) |
| Alerts | /alerts | All |
| Accidents and Incidents | /accidents | All |
| Gate Pass | /gate-pass | All |
| Serial Tracker | /serial-tracker | All |
| Comparison | /comparison | All |
| Reports Builder | /reports | All |
| Anomaly Scan | /anomalies | Admin only |
| Vehicle History | /vehicle-history | Admin only |
| Smart Analytics | /ai | Admin only |
| Data Cleaning | /cleaning | Admin only |
| Audit Trail | /audit | Admin only |
| User Management | /users | Admin only |
| Settings | /settings | All |
| Login | /login | Public |
| Reset Password | /reset-password | Public |

---

## User Roles

| Role | Badge colour | Access |
|---|---|---|
| Admin | Red | Full access including User Management, Audit, Anomaly Scan |
| Manager | Orange | All operational pages, analytics read |
| Inspector | Purple | Inspections and Settings only |
| Director | Blue | Read-only analytics and reports |
| Reporter | Gray | Upload, Tyre Records, Corrective Actions, Inspections |
| Tyre Man | Teal | Inspections checklist only (mobile shell UI, no sidebar) |

New accounts start as approved=false. Admin must approve in User Management. Country can be assigned per user; non-Admin users with an assigned country see only that country's data.

---

## Key Features

### Auth and Security
- 1-hour idle timeout with automatic sign-out
- Forgot password flow with email link to /reset-password
- Pending approval screen for new accounts (not visible until admin approves)
- Employee ID field stored on profiles

### Upload Data
- Multi-sheet Excel: sheet selector before column mapping
- Auto-detect file type (tyre records vs stock)
- Smart column mapping with header name guessing
- upload_batch_id on every inserted record: batch delete available from Audit Trail
- Separate field maps for Tyre Records and Stock Records

### Inspections
- Types: Routine, Pressure, Visual, Full, Pre-Trip, Site Observation, Safety Training, Training Session
- Daily Checklist tab: vehicle-specific tyre positions, interactive SVG diagram (tap to jump)
- PDF export: A4 with vehicle diagram (circles coloured by condition + pressure values inside), data table, notes, inspector signature lines
- Observations: photo upload, severity, raise corrective action button
- Training: attendees field, bilingual (EN/AR)

### Dashboard
- Daily, Weekly, Monthly, Yearly granularity toggle on main chart
- Tyre forecast card: rolling 3-month average, projections for next 2 months
- Clickable KPI cards navigate to relevant pages
- Quick action row: Run Anomaly Scan, View Alerts, Upload Data

### User Management
- 3-tab layout: Users, Access Matrix, Activity
- Inline role dropdown: auto-saves immediately with spinner and checkmark animation
- Edit modal: full name, username, employee ID, region, role, country multi-select, approved toggle
- Delete modal: type DELETE to confirm hard delete
- Access Matrix: 14 features x 6 roles read-only grid (Full, Read, Write, Checklist)
- Activity tab: last 100 audit log entries, expandable details

### PDF Exports
- All PDFs: green TYREPULSE header, auto-fit column widths, risk-coloured cells, footer with page numbers
- Inspection checklist PDF: vehicle diagram + tyre data table + signature lines

---

## Test Suite

Run: npx vitest run

| File | What it covers |
|---|---|
| tyreClassifier.test.js | Auto-classification rules (13 categories) |
| analyticsEngine.test.js | Stats, regression, brand and site metrics |
| anomalyEngine.test.js | 6 anomaly patterns, edge cases, empty arrays |
| alertEngine.test.js | Stock, budget, overdue, HIGH_CPK, VEHICLE_INACTIVE |
| exportUtils.test.js | Excel, PDF, PowerPoint generation |

369 tests passing, 0 failures.

---

## Common Admin Tasks

Approve a new user: User Management > find Pending badge > Approve button or Edit modal > toggle Approved on.

Assign country to user: User Management > Edit > Country Access > select countries > Save. User will only see data for assigned countries.

Delete an upload batch: Audit Trail > Upload History tab > Delete Batch > type DELETE to confirm. Removes all tyre records from that batch.

Add brand alias:
```sql
INSERT INTO brand_aliases (alias, canonical) VALUES ('bs', 'Bridgestone');
```

Check upload batches:
```sql
SELECT upload_batch_id, count(*) FROM tyre_records
WHERE upload_batch_id IS NOT NULL
GROUP BY upload_batch_id ORDER BY count DESC LIMIT 10;
```

---

*TyrePulse v3.0 · Readymix Concrete Company · Shahzeb Rahman © 2026*
