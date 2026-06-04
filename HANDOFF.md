# TyrePulse — Developer Handoff Note
**Readymix Concrete Company · Built by Shahzeb Rahman © 2026**
**Status: Production-Ready · Last updated: June 2026**

---

## What TyrePulse Is

A full-stack tyre fleet management SPA built on **React 18 + Vite + Tailwind CSS** (frontend) and **Supabase** (PostgreSQL + Auth + Storage — no separate backend server). It tracks tyre purchases, failures, costs, corrective actions, stock, budgets and KPIs across KSA, UAE and Egypt operations.

---

## Hosting & Deploy

| Layer | Platform | Notes |
|---|---|---|
| Frontend | Netlify (auto-deploy on `git push main`) | Build: `npm run build`, publish: `dist/` |
| Database | Supabase (PostgreSQL) | Free tier, ~5% of 500 MB used |
| Storage | Supabase Storage bucket `tyre-photos` | Public bucket |
| Auth | Supabase Auth (email/password) | Email confirmation ON |

**Env vars required (Netlify → Site settings → Environment variables):**
```
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

---

## SQL Files — Run Order

Run each file **once** in Supabase SQL Editor (copy → paste → Run). They are all safe to re-run (idempotent `IF NOT EXISTS` / `CREATE OR REPLACE`).

| Order | File | What it installs |
|---|---|---|
| 1 | `SUPABASE_SCHEMA.sql` | All 14 core tables, RLS enabled |
| 2 | `MIGRATIONS.sql` | Phase 2: due_date, inspections, stock_movements, audit_log, kpi_targets |
| 3 | `BACKEND_RLS.sql` | `get_my_role()` helper + role-based policies (Reporter/Manager/Director/Admin) |
| 4 | `MIGRATIONS_V2.sql` | Multi-country: `country` column on 7 tables, `km_at_fitment`/`km_at_removal`, currency settings |
| 5 | `MASTER_ENGINE.sql` | Brand aliases, normalize trigger, `v_tyre_master` view, `v_data_quality_issues`, RPC functions, indexes, backfill |
| 6 | `MIGRATIONS_V3.sql` | `extra_fields jsonb` on `tyre_records` for unmapped Excel columns ✅ Done |
| 7 | `MIGRATIONS_V4.sql` | `country` column on `rca_records` + backfill + index |

> **MIGRATIONS_V4.sql has not been run yet** — run it when you next open Supabase SQL Editor.

---

## Architecture

```
src/
├── App.jsx                  — All routes (19 pages)
├── main.jsx
├── index.css                — Global styles, .btn-primary, .card, .input etc.
├── contexts/
│   ├── AuthContext.jsx      — Supabase session, profile, signIn/signOut
│   └── SettingsContext.jsx  — appSettings, activeCountry, activeCurrency, setActiveCountry
├── components/
│   ├── Layout.jsx           — Sidebar nav, global search (Cmd+K), country switcher
│   ├── StatCard.jsx         — KPI stat cards
│   ├── ProtectedRoute.jsx   — Auth guard
│   └── LoadingSpinner.jsx
└── lib/
    ├── supabase.js          — Supabase client (reads VITE_ env vars)
    ├── tyreClassifier.js    — Rule-based auto-classification engine (13 categories)
    ├── analyticsEngine.js   — Stats, regression, aggregation, radar helpers
    ├── alertEngine.js       — Real-time alert detection (stock, budget, overdue CAs)
    ├── anomalyEngine.js     — Pattern detection (short interval, burst, cost spikes)
    └── exportUtils.js       — Excel (xlsx), PDF (jsPDF+autoTable), PowerPoint (pptxgenjs)
```

---

## Pages — Feature Status

| Page | Route | Country Filter | Currency | Exports |
|---|---|---|---|---|
| Dashboard | `/` | ✅ | ✅ | Excel, PDF, PowerPoint |
| Tyre Records | `/tyres` | ✅ | ✅ | Excel, PDF |
| Analytics | `/analytics` | ✅ | ✅ | — |
| Brand Performance | `/brand-perf` | ✅ | ✅ | — |
| Site Comparison | `/site-comp` | ✅ | ✅ | — |
| Fleet Analytics | `/fleet` | ✅ | ✅ | — |
| KPI Scorecard | `/kpi` | ✅ | ✅ | — |
| Country Comparison | `/country-comp` | N/A (shows all) | ✅ | — |
| Stock Management | `/stock` | ✅ | — | — |
| Budgets | `/budgets` | ✅ | — | — |
| Corrective Actions | `/actions` | ✅ | — | — |
| Root Cause Analysis | `/rca` | ✅ (needs V4 migration) | — | — |
| Inspections | `/inspections` | ✅ | — | — |
| Alerts | `/alerts` | ✅ | — | — |
| Anomaly Detection | `/anomalies` | ✅ | ✅ | — |
| Data Cleaning | `/cleaning` | ✅ | — | — |
| Upload Data | `/upload` | ✅ | — | — |
| Settings | `/settings` | — | — | — |
| Login | `/login` | — | — | — |

**⚠️ Known limitations:**

- **RCA Records** (`/rca`): Requires `MIGRATIONS_V4.sql` to be run in Supabase SQL Editor to add the `country` column to `rca_records`. The frontend already applies the country filter — just run the migration and it will work automatically.

---

## Multi-Country Architecture

| Country | Currency | DB Value |
|---|---|---|
| KSA (Saudi Arabia) | SAR | `'KSA'` |
| UAE | AED | `'UAE'` |
| Egypt | EGP | `'Egypt'` |
| All | SAR (default) | — |

- `SettingsContext` exposes `activeCountry` (string) and `activeCurrency` (string: 'SAR'/'AED'/'EGP')
- Every page that queries `tyre_records` applies `if (activeCountry !== 'All') q = q.eq('country', activeCountry)`
- `UploadData` defaults new records to `activeCountry` when the spreadsheet has no `country` column
- `MASTER_ENGINE.sql` trigger auto-normalises country names on insert (KSA/SA/Saudi Arabia → 'KSA', UAE/Dubai → 'UAE', Egypt/Cairo → 'Egypt')

---

## User Roles (RLS)

Defined in `BACKEND_RLS.sql`. Stored in `profiles.role`.

| Role | Can do |
|---|---|
| **Admin** | Full access — read, write, update, delete everything, change settings |
| **Manager** | Read everything; edit records, close CAs, manage stock, update KPI targets |
| **Director** | Read-only on all tables (analytics & reporting only) |
| **Reporter** | Read everything; upload data, log CAs, log RCA; cannot delete |

New accounts default to **Reporter**. Promote via Supabase Table Editor → `profiles` table → edit `role` column.

---

## Extra Excel Columns Feature

When uploading an Excel file with columns that don't exist in the schema (e.g. `Driver Name`, `PO Number`, `Fleet Category`):

1. Any unmapped column is automatically stored in `extra_fields jsonb` on the `tyre_records` row
2. Example stored value: `{"Driver Name": "Ahmed Al-Rashidi", "PO Number": "PO-2024-178"}`
3. Visible in the Tyre Records detail modal under "Additional Fields (from upload)"
4. Searchable via PostgreSQL JSONB operators: `extra_fields->>'Driver Name' = 'Ahmed'`
5. **Requires `MIGRATIONS_V3.sql` to be run first** to create the column

---

## Color Theme

Company colors applied throughout:

| Element | Color | Hex |
|---|---|---|
| Primary brand green | Green-700 | `#15803d` |
| Active state green | Green-600 | `#16a34a` |
| Cement gray accent | Stone-500 | `#78716c` |
| Background | Near-black with green glow | `#060a08` |
| Sidebar | Very dark green-black | `#050c07` |

All primary buttons, input focus rings, nav active states, logo, country pills, and card accents use the green palette. The login page glows use green + stone instead of blue + indigo.

---

## Data Pipeline — How a Record Gets Processed

```
Excel upload → UploadData.jsx (column mapping) 
  → extra_fields collected for unmapped columns
  → batchClassify() assigns category + risk_level + remarks_cleaned
  → tyre_records INSERT
    → MASTER_ENGINE trigger fires (normalize brand, site, country, enforce qty/cost/km)
    → Record lands in tyre_records with clean data
  → cleaning_log INSERT (for records that were auto-classified)
  → upload_history INSERT (audit trail)
```

Manual entry follows the same trigger path. Direct SQL inserts are also auto-processed.

---

## Key Database Objects (MASTER_ENGINE.sql)

| Object | Type | Purpose |
|---|---|---|
| `brand_aliases` | Table | Maps brand aliases (bridgestone/bs/Bridge Stone → Bridgestone) |
| `normalize_brand()` | Function | Alias lookup → canonical name |
| `normalize_site()` | Function | Trims whitespace, title-cases site names |
| `normalize_country()` | Function | Maps KSA/SA/Saudi Arabia → 'KSA' etc. |
| `calc_cpk()` | Function | Null-safe cost per kilometre |
| `tyre_records_master_process_tg` | Trigger | Runs BEFORE INSERT OR UPDATE on every row |
| `v_tyre_master` | View | Clean enriched view: CPK, total_cost, age_days |
| `v_data_quality_issues` | View | Flags rows with missing fields, bad costs, inverted KM |
| `get_country_kpi()` | RPC | Per-country KPI summary (callable from app) |
| `check_duplicate_serials()` | RPC | Pre-upload duplicate detection |

---

## Data Quality Views

Run these in Supabase SQL Editor anytime:

```sql
-- See all clean, enriched records
SELECT * FROM v_tyre_master LIMIT 100;

-- See records with data quality issues
SELECT asset_no, brand, site, issue_date, issue_score, 
       missing_brand, missing_site, missing_serial, cost_too_high, km_order_wrong
FROM v_data_quality_issues
ORDER BY issue_score DESC
LIMIT 50;

-- KPI summary per country
SELECT * FROM get_country_kpi();
SELECT * FROM get_country_kpi('KSA');
```

---

## Common Tasks

### Add a new user
1. Supabase dashboard → Authentication → Users → Invite User
2. After they confirm email: Table Editor → `profiles` → set their `role`

### Add a new brand alias
```sql
INSERT INTO brand_aliases (alias, canonical) VALUES ('newbrand', 'NewBrand');
```

### Check what Excel columns are being saved as extra_fields
```sql
SELECT asset_no, issue_date, extra_fields 
FROM tyre_records 
WHERE extra_fields != '{}' 
LIMIT 20;
```

### Find records for a specific driver (extra_fields example)
```sql
SELECT * FROM tyre_records 
WHERE extra_fields->>'Driver Name' ILIKE '%Ahmed%';
```

---

## What Was Built — Complete Feature List

**Analytics:**
- Dashboard with 7 charts + date range filter + instant search + Excel/PDF/PPTX export
- Analytics (cost by site/brand, monthly trend, asset breakdown)
- Brand Performance (failure rate, risk score, drill-down trend)
- Site Comparison (radar chart, head-to-head KPIs, monthly cost trend)
- Fleet Analytics (per-asset history, CPK, lifecycle, regression trend)
- KPI Scorecard (targets vs actuals, forecasting, budget tracking)
- Country Comparison (cross-country metrics side by side)
- Anomaly Detection (6 pattern types: short interval, burst, rapid recurrence, cost spike, serial reuse, duplicates)
- Alerts (live feed: stock low, budget overrun, overdue CA, risk spike)

**Operations:**
- Tyre Records (full CRUD, bulk edit, CPK column, date/brand/site/risk filters, export)
- Stock Management (levels by site, movement history)
- Budgets (monthly + annual planner, vs actuals)
- Corrective Actions (full CRUD, priority, due dates, country filter)
- Root Cause Analysis (CRUD, link to CAs, contributing factors)
- Inspections (schedule, track)

**Data Management:**
- Upload Data (Excel/CSV, auto column mapping, memory of past mappings, duplicate detection, auto-classify, extra columns capture, batch progress)
- Data Cleaning Engine (rule-based classifier, 13 categories, bulk approve, re-classify, confidence filter)
- Settings (company name, cost per tyre, currencies, KPI targets)

**Infrastructure:**
- Multi-country (KSA/UAE/Egypt) with dynamic currency (SAR/AED/EGP)
- Role-based RLS (Admin/Manager/Director/Reporter)
- Global search (Cmd+K, searches tyre records, CAs, RCA, stock)
- Real-time alert badge in sidebar
- DB-level data normalisation trigger
- Extra Excel fields preserved in `extra_fields jsonb`
- Green + cement company color theme throughout

---

## Immediate Next Steps (Recommended)

| Priority | Task |
|---|---|
| 🔴 Now | Run **`MIGRATIONS_V4.sql`** in Supabase SQL Editor to add `country` to `rca_records` |
| 🟢 Later | Add photo upload to tyre records (Supabase Storage bucket already set up) |
| 🟢 Later | Email notifications for overdue corrective actions |
| 🟢 Later | Mobile app (React Native) reusing the same Supabase backend |

---

*TyrePulse v2.0 · Readymix Concrete Company · Built by Shahzeb Rahman © 2026*
