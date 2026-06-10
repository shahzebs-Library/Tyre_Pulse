# TyrePulse — Complete Product Roadmap
**Readymix Concrete Company · Built by Shahzeb Rahman © 2026**
**Version 6.0 · Updated June 2026 · Governed by CLAUDE.md**

> **This roadmap is derived directly from CLAUDE.md.**
> Every section maps to a specific CLAUDE.md requirement.
> Ordered by business impact — highest value first.

---

## Status Key

| Symbol | Meaning |
|--------|---------|
| ✅ | Complete and deployed |
| 🔄 | Partially implemented |
| ⬜ | Planned, not started |

---

## Product Health

| Metric | Status |
|--------|--------|
| Build | ✅ 0 errors — 2179 modules |
| Pages | ✅ 73 pages registered and routed |
| Auth + RBAC | ✅ Role-based routes, 30-min idle timeout, admin approval gate |
| Login | ✅ Email / Username / Employee ID — all three modes |
| Intelligence RBAC | ✅ Admin only — sidebar hidden + route guarded |
| Analytics RBAC | ✅ Admin + Manager + Director only |
| Vehicle Diagram | ✅ Case-insensitive, position IDs consistent across checklist + diagram |
| Checklist | ✅ Master sites/assets, auto-title, inspector auto-fill, SVG PDF |
| Migrations | ✅ MIGRATIONS_SAFE.sql — run once to apply all |
| Hosting | ✅ Vercel (auto-deploy on push to `main`) |
| Database | ✅ Supabase PostgreSQL + Auth + Storage + pgvector |
| PWA | ✅ Manifest + service worker + install prompt |
| AI System | ✅ 4-agent router + AiCommandCenter |
| RAG | 🔄 pgvector schema + knowledge base + retrieval service |

---

## Known Bug Fixes Applied (June 2026)

| Bug | Root Cause | Status |
|-----|-----------|--------|
| SQL error running MIGRATIONS_SAFE.sql | `idx_tyre_serial` created before `serial_number` column existed | ✅ Fixed |
| Checklist save silently fails | `inspection_type: 'Daily Checklist'` violated DB CHECK constraint | ✅ Fixed |
| 'Site Observation' / 'Safety Training' types fail | Same CHECK constraint on inspections table | ✅ Fixed |
| `tyre_conditions` column missing on save | Column not in schema | ✅ Migration applied |
| `vehicle_type` column missing on save | Column not in schema | ✅ Migration applied |
| Build error — AiCommandCenter.jsx | Orphan `</div>` after PageHeader upgrade | ✅ Fixed |
| Build error — RotationSchedule.jsx | Orphan `</div>` after PageHeader upgrade | ✅ Fixed |
| Build error — SiteComparison.jsx | `GitCompareArrows` not in lucide-react v0.263.1 | ✅ Replaced with `GitMerge` |
| Vehicle diagram not matching checklist | Position ID mismatch (`RL1` vs `RLO3`) + casing mismatch | ✅ Fixed |
| Login accepts only email | No username/Employee ID support | ✅ Multi-identifier login added |

---

## Waves 1–7 — Foundation, Operations & Operational Intelligence *(Complete)*

### Wave 1 — Security, Auth & Access Control ✅

| Feature | Status |
|---------|--------|
| Remove AI/Anthropic branding from visible UI | ✅ |
| 30-minute idle session timeout with auto sign-out | ✅ Updated from 60 min |
| Touch events tracked for mobile session activity | ✅ |
| Login via Email, Username, or Employee ID | ✅ |
| Role-based page access — tiered by role group | ✅ |
| Intelligence section — Admin only | ✅ |
| Analytics section — Admin + Manager + Director | ✅ |
| Sidebar hides group if role has no access | ✅ |
| Admin-only nav items hidden from non-Admins | ✅ |
| Forgot password flow + /reset-password page | ✅ |
| Employee ID field on signup and profile | ✅ |
| Show/hide password toggle on all password fields | ✅ |
| Pending admin approval workflow — `approved: false` on signup | ✅ |
| UserManagement: Approve + multi-country assignment | ✅ |

### Waves 2–6 — Upload, Dashboard, Inspections, Gate Pass, Comparison ✅

All features complete. See PHASE2_CHECKLIST.md for detail.

### Wave 7 — Operational Intelligence ✅

All 7A–7P features complete including KPI targets, VehicleHistory forecasting, StockManagement velocity, Reports enhancements.

---

## Wave 8 — Engineering KPI Engine ✅
**Page:** `/kpi-engine` → `EngineeringKpi.jsx`

| KPI | Status |
|-----|--------|
| CPK dashboard, per asset, per brand, worst performers | ✅ |
| Average Tyre Life — fleet, by brand, by position | ✅ |
| Remaining Tyre Life — per active tyre forecast | ✅ |
| Tyre Failure Rate — % High/Critical removals | ✅ |
| Pressure Compliance % | ✅ |
| Inspection Compliance % | ✅ |
| Retread Performance — retread CPK vs new | ✅ |
| Scrap Rate % | ✅ |
| Cost Trend Analysis — 13-month rolling | ✅ |
| Vendor Performance KPI | ✅ |
| Engineering KPI PDF/Excel export | ✅ |

---

## Wave 9 — Pressure & Inspection Intelligence ✅
**Pages:** `/pressure-intel` | `/inspection-intelligence` | `/compliance`

| Feature | Status |
|---------|--------|
| Pressure compliance % per vehicle, site, fleet | ✅ |
| Pressure anomaly detection — flag out-of-spec readings | ✅ |
| Missing inspection detection — overdue alert banner | ✅ |
| Inspector quality score per inspector | ✅ |
| Inspection compliance % per site | ✅ |
| Tread depth compliance tracking | ✅ |
| Compliance Dashboard — tread + pressure + inspection combined | ✅ |

---

## Wave 10 — Tyre Position Intelligence ✅
**Page:** `/position-intelligence` → `PositionIntelligence.jsx`

| Feature | Status |
|---------|--------|
| Position analytics — CPK per position | ✅ |
| Average tyre life per position | ✅ |
| Failure rate per position | ✅ |
| Pressure problem positions | ✅ |
| Cost per position ranked | ✅ |
| Position-based corrective action recommendations | ✅ |
| Heat map: position × site matrix | ✅ |
| Rotation compliance tracker | ✅ |

---

## Wave 11 — Root Cause Intelligence Engine ✅
**Page:** `/root-cause` → `RootCauseEngine.jsx`

All RCA features complete. 14 root causes, automated classification, AI fallback, corrective action linking.

---

## Wave 12 — Predictive Maintenance Engine ✅
**Pages:** `/predictive-maintenance` | `/maintenance-calendar` | `/inspection-planner`

All predictive maintenance features complete. Replacement schedules, tread life estimation, 30/60/90-day purchase calendar, workshop load balancing.

---

## Wave 13 — Vendor & Workshop Intelligence ✅
**Pages:** `/vendor-intelligence` | `/suppliers` | `/retread` | `/workshop`

Full vendor scorecard, CPK ranking, retread ROI calculator, supplier performance, workshop metrics.

---

## Wave 14 — Fleet Management Intelligence ✅
**Pages:** `/fleet-intelligence` | `/fleet-health` | `/live-fleet` | `/downtime` | `/assets`

Fleet availability, downtime tracking, asset utilization, live fleet status, health board.

---

## Wave 15 — Advanced Analytics ✅
**Pages:** `/advanced-analytics` | `/cost-center` | `/benchmark` | `/tyre-size` | `/fuel-efficiency` | `/comparison`

Seasonal analysis, country/branch/vehicle/driver comparison, trend analysis, AI-narrated summaries.

---

## Wave 16 — Data Quality Intelligence ✅
**Pages:** `/cleaning` | `/compliance` | `/serial-tracker`

Duplicate detection, invalid readings, missing inspection flags, data quality score, compliance certificate PDF.

---

## Wave 17 — Executive Intelligence & Reporting ✅
**Pages:** `/executive-report` | `/reports` | `/kpi-command`

One-click monthly executive PDF, KPI narrative, root cause section, financial impact, recommendations, action plan.

---

## Wave 18 — Forecasting Engine ✅
**Pages:** `/forecasting` | `/budget-planner` | `/stock-replenishment`

Annual budget forecast, 30/60/90-day demand, vendor requirements, stock replenishment matrix, budget planner grid.

---

## Wave 19 — Continuous Improvement Engine ✅
**Page:** `/continuous-improvement` → `ContinuousImprovement.jsx`

Cost reduction identification, reliability tracking, procurement optimization, improvement scorecard.

---

## Wave 20 — Daily Operations & Checklist ✅
**Pages:** `/daily-ops` | `/inspections` (Checklist tab)

| Feature | Status |
|---------|--------|
| Daily Ops dashboard | ✅ |
| Tyre inspection checklist — bilingual (EN/AR) | ✅ |
| Auto-title: `Daily Tyre Inspection — {site} — {date}` | ✅ |
| Site dropdown from `vehicle_fleet` master | ✅ |
| Asset dropdown from `vehicle_fleet` master | ✅ |
| Inspector auto-filled from logged-in profile | ✅ |
| Vehicle diagram — SVG, case-insensitive, correct positions | ✅ |
| Diagram click → scroll to tyre position | ✅ |
| tyre_conditions JSONB saved to inspections | ✅ |
| vehicle_type saved to inspections | ✅ |
| PDF export — captures actual SVG diagram | ✅ |
| PDF — colour legend, tyre table, notes, signature | ✅ |

---

## Wave 21 — RAG & Knowledge System Infrastructure 🔄

| Component | Status |
|-----------|--------|
| pgvector extension | ✅ |
| `knowledge_documents` table | ✅ |
| `ai_response_cache` table | ✅ |
| `kpi_snapshots` table | ✅ |
| `ragService.js` — retrieval + 5-min cache | ✅ |
| `embeddingService.js` — batch embedding | ✅ |
| Edge Function: `generate-embedding` | ✅ |
| Document ingestion pipeline (SOPs, manuals) | ⬜ Pending |
| Nightly inspection comment embedding job | ⬜ Pending |
| Historical data archiving strategy | ⬜ Pending |

---

## Wave 22 — Multi-Agent AI System 🔄
**Pages:** `/ai-command-center` | `/ai`

| Component | Status |
|-----------|--------|
| `aiRouter.js` — query classification | ✅ |
| `analystAgent.js` | ✅ |
| `tyreEngineerAgent.js` | ✅ |
| `qaDataAgent.js` | ✅ |
| `plannerAgent.js` | ✅ |
| AI Command Center UI | ✅ |
| AiAnalytics — Smart Analytics | ✅ |
| AI cost monitor dashboard | ⬜ Pending |
| Per-user rate limiting | ⬜ Pending |
| Response format enforcement | 🔄 Partial |

---

## Wave 23 — Enterprise & Scale 🔄
**Pages:** `/erp-sync` | `/audit` | `/users`

| Feature | Status |
|---------|--------|
| ERP Sync UI | ✅ |
| Audit trail | ✅ |
| Multi-country architecture (KSA/UAE/Egypt) | ✅ |
| Role-based access control — tiered (Admin/Manager/Director/Inspector/Tyre Man) | ✅ |
| API webhook system for ERP write-back | ⬜ |
| Scheduled report delivery — cron email | ⬜ |
| Multi-tenant architecture (tenant_id on all tables) | ⬜ |
| SSO / SAML integration | ⬜ |
| White-label branding per tenant | ⬜ |
| Offline PWA — sync queue for inspections | ⬜ |

---

## Wave 24 — Mobile & Integrations ⬜

| Feature | Status |
|---------|--------|
| React Native mobile app — Tyre Man workflow | ⬜ |
| SAP/Oracle ERP integration | ⬜ |
| Tyre supplier portal | ⬜ |
| Barcode / QR code scanner | ⬜ |
| GPS telematics integration | ⬜ |

---

## Migrations — Current State

**Run `MIGRATIONS_SAFE.sql` — fully idempotent, includes all fixes.**

Additionally run these two statements once in Supabase SQL Editor:
```sql
-- Add tyre_conditions column (if not already present)
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS tyre_conditions jsonb;
CREATE INDEX IF NOT EXISTS idx_inspections_tyre_conditions ON inspections USING gin(tyre_conditions);

-- Add vehicle_type column (if not already present)
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS vehicle_type text;
CREATE INDEX IF NOT EXISTS idx_inspections_vehicle_type ON inspections (vehicle_type);

-- Multi-identifier login RPC
CREATE OR REPLACE FUNCTION get_user_email_by_id(user_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_email text;
BEGIN
  SELECT email INTO v_email FROM auth.users WHERE id = user_id;
  RETURN v_email;
END;
$$;
GRANT EXECUTE ON FUNCTION get_user_email_by_id(uuid) TO authenticated;

-- Indexes for username/employee_id login
CREATE INDEX IF NOT EXISTS profiles_employee_id_idx ON profiles (employee_id);
CREATE INDEX IF NOT EXISTS profiles_username_idx ON profiles (username);
```

---

## Supabase Edge Functions

| Function | Status | Input | Purpose |
|----------|--------|-------|---------|
| `chat-ai` | ✅ | `{ system, user, model, max_tokens }` | Anthropic API proxy |
| `generate-embedding` | ✅ | `{ text, model }` | OpenAI embeddings proxy |
| `send-email` | ✅ | `{ to, subject, body }` | Resend API email delivery |

Env vars needed: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `FROM_EMAIL`

---

## Next Session Priorities

1. **RAG document ingestion** — SOP/policy PDF upload pipeline (Wave 21)
2. **AI cost monitor** — token usage dashboard per day/month (Wave 22)
3. **Offline PWA** — service worker sync queue for inspections (Wave 23)
4. **Scheduled reports** — monthly email of executive PDF (Wave 23)
5. **Barcode / QR scanner** on checklist for tyre serial scanning (Wave 24)

---

*TyrePulse v6.0 · Readymix Concrete Company · Shahzeb Rahman © 2026*
*Fully governed by CLAUDE.md — every section maps to a specific instruction*
