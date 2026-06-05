# TyrePulse — Project Handoff

## What This App Is
TyrePulse is a tyre fleet management platform for a construction company operating in KSA/UAE/Gulf. Built with React 18 + Vite 5 + Supabase + Tailwind CSS. Deployed on Netlify. The app tracks tyre replacements, costs, failures, inspections, vehicles, stock, and corrective actions across multiple sites and countries.

## Stack
- **Frontend:** React 18, Vite 5, Tailwind CSS (dark theme, `darkMode: 'class'`)
- **Backend:** Supabase (PostgreSQL + Auth + RLS)
- **Charts:** Chart.js via react-chartjs-2
- **Exports:** XLSX (Excel), jsPDF + jspdf-autotable (PDF), pptxgenjs (PowerPoint)
- **AI:** Anthropic SDK (`claude-haiku-4-5-20251001`) for Smart Analytics page
- **Testing:** Vitest with jsdom

## Repository
- GitHub: `shahzebs-library/tyre_pulse`
- Active branch: `claude/test-coverage-analysis-YsbTg` (all work goes here, merged to `main` for deploy)
- Deployed: Netlify (auto-deploys from `main`)

## Current Roles in `profiles` Table
- `Admin` — full access to everything
- `Manager` — most pages, no user management
- `Inspector` — PLANNED: inspections page only, mobile-optimised
- `Reporter` — standard user
- `Viewer` — read-only

## Database Tables (all in Supabase)
Key tables: `tyre_records`, `profiles`, `corrective_actions`, `rca_records`, `stock_records`, `stock_movements`, `inspections`, `upload_history`, `audit_log`, `vehicle_fleet`, `column_mappings`, `cleaning_log`, `kpi_targets`, `accidents` (planned)

## Migration Files (run in order in Supabase SQL Editor)
- `MIGRATIONS_V5.sql` — profile trigger, RLS
- `MIGRATIONS_V6.sql` — vehicle_fleet table
- `MIGRATIONS_V6_AUDIT.sql` — audit_log table (idempotent, safe to re-run)
- `MIGRATIONS_V7.sql` — km fields, inspections, kpi_targets, stock_movements tables
- `MIGRATIONS_V8.sql` — extend inspections (attendees, severity, photo_data, linked_action_id)
- `MIGRATIONS_V9.sql` — photo_data on corrective_actions and rca_records
- `MIGRATIONS_V10.sql` — PLANNED: employee_id, approved flag, upload_batch_id, accidents table

## Key Source Files
- `src/App.jsx` — all routes
- `src/components/Layout.jsx` — sidebar nav with role-based items
- `src/contexts/AuthContext.jsx` — auth state, profile fetch
- `src/contexts/SettingsContext.jsx` — country filter, currency
- `src/lib/analyticsEngine.js` — CPK, fleet health, seasonal, cost functions
- `src/lib/anomalyEngine.js` — 6 anomaly detectors
- `src/lib/alertEngine.js` — alert detection including VEHICLE_INACTIVE, HIGH_CPK, DATA_QUALITY
- `src/lib/tyreClassifier.js` — rule-based classification with Arabic/Urdu support
- `src/lib/exportUtils.js` — Excel, PDF (green header, auto-fit columns), PowerPoint exports
- `src/lib/aiAnalytics.js` — Claude API integration for Smart Analytics
- `src/lib/auditLogger.js` — logs to audit_log table

## Pages
`/` Dashboard, `/tyres` Tyre Records, `/analytics` Analytics, `/brand-perf`, `/site-comp`, `/fleet` Fleet Analytics, `/kpi` KPI Scorecard, `/country-comp`, `/stock` Stock Management, `/budgets`, `/actions` Corrective Actions, `/rca`, `/inspections` Inspections+Observations+Training, `/alerts`, `/anomalies`, `/vehicle-history`, `/fleet-master`, `/ai` Smart Analytics, `/cleaning` Data Cleaning, `/upload` Upload Data, `/audit` Audit Trail, `/settings`, `/users` User Management

## Fleet Vehicle Types (for tyre diagrams)
- **Pickup** — 4 tyres, emoji 🛻
- **Canter** — 6 tyres (2 front single + 4 rear dual), emoji 🚚
- **Tri-mixer** — 12 tyres (2+2 front single, 4+4 rear dual), emoji 🚛
- **Concrete pump** — 14 tyres (2 front single, 4+4+4 rear dual), emoji 🏗️
- **Wheel loader / Skid loader** — 4 tyres, emoji 🚜

## What Was Just Completed (latest commits on main)
1. Smart Analytics (AI queries via Claude API)
2. Vehicle History with misuse/anomaly detection
3. Fleet Master data management
4. Audit Trail
5. Inspections extended with Site Observations, Training, photo upload, Raise Action
6. Anomaly search-first drill-down
7. Upload page with fleet vs tyre auto-detection
8. Dashboard clickable KPI cards + Quick Actions
9. PDF exports: green header, auto-fit columns, risk colour cells
10. Photo attachments on Corrective Actions and RCA
11. Data Cleaning: search, pagination, undo on cleaned tab

## Next Work to Do (prioritised)

### Wave 1 — Security & Auth (parallel agents)
- **A:** Remove AI/Anthropic references from UI text (`AiAnalytics.jsx`) + 1-hour idle session timeout (`AuthContext.jsx`)
- **B:** Role-based route protection — `RoleRoute` component, admin-only pages (Data Cleaning, Smart Analytics, Anomaly Scan, Vehicle History, Audit Trail)
- **C:** Login improvements — forgot password flow (`Login.jsx` + `ResetPassword.jsx`), employee ID field, show/hide password toggle, pending approval state
- **D:** `MIGRATIONS_V10.sql` — `profiles.employee_id`, `profiles.approved`, `profiles.country`, `tyre_records.upload_batch_id`, `accidents` table

### Wave 2 — Upload Intelligence (parallel)
- **E:** Multi-sheet Excel support in `UploadData.jsx` — sheet picker UI, merge selected sheets
- **F:** Stock upload mapping (`uploadType = 'stock'`) — maps to `stock_records` table
- **G:** Upload batch delete in `AuditTrail.jsx` — tag records with `upload_batch_id`, delete by batch

### Wave 3 — New Features (parallel)
- **H:** Dashboard date shortcuts (Today/Week/Month/Year chips) + breakdown toggle (Daily/Weekly/Monthly) + tyre forecast card
- **I:** Accidents / Incident tracking page (`src/pages/Accidents.jsx`, route `/accidents`)
- **J:** Vehicle tyre position diagram in `VehicleHistory.jsx` — SVG top-down view, colour by risk level

### Wave 4 — Inspection Depth
- **K:** Daily inspection checklist — vehicle-specific tyre count from `vehicle_fleet`, mobile-optimised form with icons, tyre pressure fields, condition icons, PDF report with SVG diagram and vehicle emoji

### Wave 5 — Design & Reports (after UI review)
- Chart enlargement modal
- Custom reports page
- Country-based access lock in SettingsContext
- App logo SVG

## Style Notes
- No em-dashes (—) anywhere — use middle dot (·) or colon
- No "AI", "Claude", "Anthropic" in visible UI text — use "Smart Analytics", "Smart Engine"
- No session URLs in commit messages
- Professional language — no robotic phrases
- Tailwind dark theme; light theme via `html.light { }` CSS overrides in `src/index.css`
- Cards: `className="card"` (defined in `src/index.css`)
- Primary buttons: `className="btn-primary"`
- Form inputs: `className="input"`
- Labels: `className="label"`
