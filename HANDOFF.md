# TyrePulse — Developer Handoff
**Project:** Tyre Fleet Intelligence Platform · Readymix Concrete Company
**Built by:** Shahzeb Rahman © 2026
**Branch:** `main`
**Last updated:** June 2026
**Build status:** ✅ Clean — 0 errors

---

## What TyrePulse Is

A full-stack tyre fleet management SPA built on **React 18 + Vite + Tailwind CSS** (frontend) and **Supabase** (PostgreSQL + Auth + Storage — no separate backend). It tracks tyre purchases, failures, CPK, corrective actions, stock, budgets, inspections, KPIs, and engineering intelligence across KSA, UAE and Egypt operations.

---

## Hosting & Deploy

| Layer | Platform | Notes |
|---|---|---|
| Frontend | Netlify (auto-deploy on `git push main`) | Build: `npm run build`, publish: `dist/` |
| Database | Supabase (PostgreSQL) | Free tier |
| Storage | Supabase Storage bucket `tyre-photos` | Public bucket |
| Auth | Supabase Auth (email/password) | Email confirmation ON |

**Env vars required (Netlify → Site settings → Environment variables):**
```
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

**Edge function env vars (Supabase → Edge Functions → Secrets):**
```
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
RESEND_API_KEY=re_...
FROM_EMAIL=noreply@yourdomain.com
```

---

## SQL Migration Order (Run in Supabase SQL Editor)

**Recommended: Just run `MIGRATIONS_SAFE.sql` — fully idempotent, includes everything.**

| Order | File | Purpose |
|---|---|---|
| 1 | `SUPABASE_SCHEMA.sql` | All core tables, RLS enabled |
| 2 | `MIGRATIONS.sql` | Phase 2: due_date, inspections, stock_movements, audit_log, kpi_targets |
| 3 | `BACKEND_RLS.sql` | Role-based policies + `get_my_role()` |
| 4 | `MIGRATIONS_V2.sql` | Multi-country, `km_at_fitment/removal`, currency settings |
| 5 | `MASTER_ENGINE.sql` | Brand aliases, normalize triggers, `v_tyre_master` view, RPC functions |
| 6 | `MIGRATIONS_V3.sql` | `extra_fields jsonb` on `tyre_records` |
| 7 | `MIGRATIONS_V4.sql` | `country` column on `rca_records` |
| ✅ | `MIGRATIONS_SAFE.sql` | **V10–V17 + all bug fixes — run this** |

**Inspections table fix (included in MIGRATIONS_SAFE.sql):**
```sql
ALTER TABLE inspections DROP CONSTRAINT IF EXISTS inspections_inspection_type_check;
-- also adds: country, severity, photo_data, attendees columns
```

---

## Architecture

```
src/
├── App.jsx                        — All routes (73 pages)
├── main.jsx
├── index.css                      — Global styles, .btn-primary, .card, .input
├── contexts/
│   ├── AuthContext.jsx            — Supabase session, profile, signIn/signOut, idle timeout
│   ├── SettingsContext.jsx        — appSettings, activeCountry, activeCurrency
│   └── ThemeContext.jsx           — Dark/light mode
├── components/
│   ├── Layout.jsx                 — Sidebar nav (NAV_GROUPS), GlobalSearch, NotificationCenter
│   ├── GlobalSearch.jsx           — Cmd/Ctrl+K search modal across all data
│   ├── NotificationCenter.jsx     — Realtime bell icon + dropdown notifications
│   ├── VehicleTyreDiagram.jsx     — 3D illustrated SVG vehicle tyre map (Bus, Tata, Ashok Leyland)
│   ├── EmailReportModal.jsx       — Multi-recipient email with PDF attachment
│   ├── ChartModal.jsx             — Full-screen chart zoom modal
│   ├── EmptyState.jsx             — Reusable empty state UI
│   ├── LoadingState.jsx           — Spinner with message/fullPage mode
│   ├── InstallPwaPrompt.jsx       — PWA install banner
│   ├── ProtectedRoute.jsx         — Auth guard + RoleRoute for admin-only pages
│   └── StatCard.jsx               — KPI stat cards
└── lib/
    ├── supabase.js                — Supabase client (reads VITE_ env vars)
    ├── kpiEngine.js               — 18 pure KPI computations
    ├── ragService.js              — RAG retrieval + 5-min cache
    ├── embeddingService.js        — Batch embedding generation
    ├── aiRouter.js                — Query classification → agent routing
    ├── agents/                    — analystAgent, tyreEngineerAgent, qaDataAgent, plannerAgent
    ├── auditLogger.js             — Non-throwing audit_log_v2 wrapper
    ├── alertEngine.js             — Alert detection (velocity, CPK, data quality)
    ├── emailService.js            — PDF generation + Resend email delivery
    ├── performanceMonitor.js      — Query timing, slow query detection
    ├── tyreClassifier.js          — Rule-based auto-classification (13 categories)
    ├── analyticsEngine.js         — Stats, regression, aggregation, radar helpers
    ├── anomalyEngine.js           — Pattern detection (short interval, burst, cost spikes)
    └── exportUtils.js             — Excel (xlsx), PDF (jsPDF+autoTable), PowerPoint (pptxgenjs)
```

---

## Supabase Edge Functions

| Function | Input | Purpose |
|----------|-------|---------|
| `chat-ai` | `{ system, user, model }` | Anthropic API proxy |
| `generate-embedding` | `{ text, model }` | OpenAI embeddings proxy |
| `send-email` | `{ to, subject, body }` | Resend API email delivery |

Deploy: `supabase functions deploy chat-ai --project-ref <your-ref>`

---

## All Pages — 73 Total

### Core
| Route | File | Notes |
|---|---|---|
| `/` | Dashboard.jsx | 7 charts, KPI cards, date filter, Excel/PDF/PPTX export |
| `/login` | Login.jsx | Animated truck tyre SVG, glow pulse, dark/light theme toggle |

### Analytics (9 pages)
| Route | File |
|---|---|
| `/analytics` | Analytics.jsx |
| `/brand-perf` | BrandPerformance.jsx |
| `/site-comp` | SiteComparison.jsx |
| `/fleet` | FleetAnalytics.jsx |
| `/kpi` | KpiScorecard.jsx |
| `/country-comp` | CountryComparison.jsx |
| `/comparison` | Comparison.jsx |
| `/ai` | AiAnalytics.jsx (Admin only) |
| `/advanced-analytics` | AdvancedAnalytics.jsx |

### Operations (17 pages)
| Route | File |
|---|---|
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
|---|---|
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
|---|---|
| `/anomalies` | Anomalies.jsx (Admin only) |
| `/vehicle-history` | VehicleHistory.jsx |
| `/serial-tracker` | SerialTracker.jsx |
| `/audit` | AuditTrail.jsx (Admin only) |
| `/users` | UserManagement.jsx (Admin only) |

### Data & Settings (4 pages)
| Route | File |
|---|---|
| `/cleaning` | DataCleaning.jsx |
| `/upload` | UploadData.jsx |
| `/settings` | Settings.jsx |
| `/reset-password` | ResetPassword.jsx |

---

## Multi-Country Architecture

| Country | Currency | DB Value |
|---|---|---|
| KSA (Saudi Arabia) | SAR | `'KSA'` |
| UAE | AED | `'UAE'` |
| Egypt | EGP | `'Egypt'` |

- `SettingsContext` exposes `activeCountry` + `activeCurrency`
- Every page applies `q.eq('country', activeCountry)` when not 'All'
- `MASTER_ENGINE.sql` trigger auto-normalises on insert (Saudi Arabia → 'KSA', Dubai → 'UAE', Cairo → 'Egypt')

---

## User Roles (RBAC)

Stored in `profiles.role`. Managed via Supabase Table Editor.

| Role | Permissions |
|---|---|
| **Admin** | Full access — read, write, update, delete, settings, admin pages |
| **Manager** | Read all + edit records, close CAs, manage stock, set KPI targets |
| **Director** | Read-only across all tables (analytics & reporting) |
| **Reporter** | Read all + upload data, log CAs, log RCA; no deletes |

New accounts default to **Reporter**.

---

## Security

- **1-hour idle timeout** — auto signs out inactive sessions
- **Session expired notice** — shown on timeout rather than silent redirect
- **RLS on all tables** — enforced at Postgres level, not just frontend
- **Role-based route guards** — `RoleRoute` component wraps Admin-only pages
- **Input validation** — all uploads validated before DB insert
- **Audit logging** — `audit_log_v2` table records all significant actions

---

## Data Pipeline

```
Excel upload → UploadData.jsx (column mapping)
  → extra_fields collected for unmapped columns
  → batchClassify() assigns category + risk_level + remarks_cleaned
  → tyre_records INSERT
    → MASTER_ENGINE trigger fires (normalize brand, site, country, enforce qty/cost/km)
  → cleaning_log INSERT (for auto-classified records)
  → upload_history INSERT (audit trail)
```

---

## Key Database Objects (MASTER_ENGINE.sql)

| Object | Type | Purpose |
|---|---|---|
| `brand_aliases` | Table | Maps aliases → canonical brand names |
| `tyre_records_master_process_tg` | Trigger | Normalizes every INSERT/UPDATE row |
| `v_tyre_master` | View | Enriched view with CPK, total_cost, age_days |
| `v_data_quality_issues` | View | Flags rows with missing fields, bad costs, inverted KM |
| `get_country_kpi()` | RPC | Per-country KPI summary |
| `check_duplicate_serials()` | RPC | Pre-upload duplicate detection |

---

## Common Tasks

### Add a new user
1. Supabase → Authentication → Users → Invite User
2. After email confirmed: Table Editor → `profiles` → set `role`

### Promote to Admin
```sql
UPDATE profiles SET role = 'Admin' WHERE email = 'user@example.com';
```

### Check data quality
```sql
SELECT * FROM v_data_quality_issues ORDER BY issue_score DESC LIMIT 50;
SELECT * FROM get_country_kpi();
```

### Add a brand alias
```sql
INSERT INTO brand_aliases (alias, canonical) VALUES ('goodyear tires', 'Goodyear');
```

---

## Roadmap — Remaining Work

### 🔴 Immediate (run now)
| Task | Detail |
|---|---|
| Run `MIGRATIONS_SAFE.sql` | Idempotent — fixes inspections constraint, adds all V10-V17 columns |
| Set Supabase Edge Function secrets | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `RESEND_API_KEY`, `FROM_EMAIL` |
| Deploy Edge Functions | `chat-ai`, `generate-embedding`, `send-email` |

### 🟡 Near-term (next sessions)
| Feature | Status |
|---|---|
| End-to-end page testing | User to verify each route works with live data |
| AI Command Center live queries | Requires edge functions deployed + API keys set |
| RAG embedding pipeline | `embeddingService.js` built; needs vector table + Edge Function wired |
| Email report delivery | `emailService.js` built; needs Resend key + `send-email` function deployed |
| PWA offline support | `InstallPwaPrompt.jsx` built; service worker not yet configured |

### 🟢 Future (phase 3)
| Feature | Detail |
|---|---|
| Mobile app | React Native reusing same Supabase backend |
| ERP integration | Bidirectional sync (currently read-only stub in ErpSync.jsx) |
| Predictive ML models | Replace linear regression with time-series forecasting model |
| Driver scorecards | Link tyre wear patterns to driver IDs |
| Inventory auto-ordering | Trigger purchase orders when stock hits reorder level |
| WhatsApp / SMS alerts | Overdue CA / pressure alert notifications |
| Multi-tenant SaaS | Isolate each company's data with tenant_id RLS |

---

## Login Page (Latest)

The login page (`src/pages/Login.jsx`) features:
- **Realistic animated truck tyre SVG** — 3-row tread blocks, green rim with radial gradient, lug nuts, hub cap
- **Floating + glow pulse** animations (`tyre-float`, `tyre-glow-pulse`)
- **Multi-mode login** — Email / Username / Employee ID toggle
- **Particle effects** + scan line + shimmer button
- **Dark/light theme toggle** — top-right fixed position

---

## VehicleTyreDiagram

`src/components/VehicleTyreDiagram.jsx` — 3D illustrated SVG vehicle tyre map supporting:
- Bus, Tata, Ashok Leyland, Pickup, Rigid, Semi, Tri-mixer, Concrete Pump
- Green Concrete Company livery (white + green)
- Risk colour coding per tyre position
- Used in Inspections checklist form and PDF export

---

*TyrePulse v3.0 · Readymix Concrete Company · Built by Shahzeb Rahman © 2026*
