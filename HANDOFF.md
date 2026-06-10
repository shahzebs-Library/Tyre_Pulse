# TyrePulse — Developer Handoff
**Last updated:** June 2026
**Branch:** `main` (all work merged)
**Build status:** ✅ Clean — 2179 modules, 0 errors

---

## What Was Done This Session

### 1. Multi-Identifier Login
- Login now accepts **Email**, **Username**, or **Employee ID**
- Animated 3-way mode selector on the login screen
- `AuthContext.signIn()` resolves username/employee_id → email via `profiles` table lookup + `get_user_email_by_id` RPC before calling Supabase auth

### 2. RBAC Tightened
- **Intelligence section** (40+ pages) — **Admin only**
- **Analytics section** (7 pages) — **Admin + Manager + Director**
- `shouldShowGroup()` in `Layout.jsx` hides entire nav group if role doesn't qualify
- All routes in `App.jsx` wrapped with the appropriate `<RoleRoute allowed={[...]}>` 
- `RoleRoute` access-denied screen now shows the user's current role

### 3. 30-Minute Session Timeout
- Idle timeout: 60 min → **30 min**
- Check interval: 60 s → **30 s**
- **Touch events** now tracked alongside mouse/keyboard (mobile support)
- Session-expired banner on login page updated to reference 30 minutes

### 4. Admin Approval Gate
- New signups set `approved: false` in profile insert
- `ProtectedRoute` blocks any profile where `approved === false`
- `null` / `undefined` treated as legacy-approved (existing accounts unaffected)

### 5. Inspection Checklist — Full Overhaul
- **Title** auto-generated: `Daily Tyre Inspection — {site} — {date}`
- **Site** — dropdown populated from `vehicle_fleet.site` (falls back to free-text)
- **Asset** — dropdown from `vehicle_fleet.asset_no` with vehicle type hint; selecting auto-loads fleet info
- **Inspector** — auto-filled from `profile.full_name || profile.username`
- **`tyre_conditions`** (JSONB) and **`vehicle_type`** (text) now saved to `inspections`

### 6. Inspection PDF — Real SVG Capture
- `exportChecklistPdf` is async
- Captures the live `VehicleTyreDiagram` SVG via `XMLSerializer` → Blob → Canvas → PNG
- 2× scale for retina quality; dark background fills canvas before drawing
- Falls through gracefully to table-only if SVG is not mounted

### 7. Vehicle Diagram — Position ID Alignment
- Root cause: `TYRE_POSITIONS` in `Inspections.jsx` used different IDs (`RL1`, `RL2`…) than `VehicleTyreDiagram.jsx` (`RLO3`, `RLI3`…)
- Secondary cause: vehicle type casing mismatch (`'Wheel Loader'` vs `'Wheel loader'`)
- **Fix:** `VehicleTyreDiagram` now normalises `vehicleType` to lowercase (`getLayout` uses `.toLowerCase().trim()`)
- **Fix:** `TYRE_POSITIONS` keys are now lowercase; `normVT()` helper normalises at lookup time
- Canonical position IDs now consistent in both files:
  - Pickup/Wheel loader/Skid loader: `FL FR RL RR`
  - Canter: `FL FR RLO RLI RRI RRO`
  - Tri-mixer: `FL1 FR1 FL2 FR2 RLO3 RLI3 RRI3 RRO3 RLO4 RLI4 RRI4 RRO4`
  - Concrete pump: `FL1 FR1 RLO2 RLI2 RRI2 RRO2 RLO3 RLI3 RRI3 RRO3 RLO4 RLI4 RRI4 RRO4`

### 8. PageHeader Applied to All Pages
All 50+ pages upgraded with the shared `PageHeader` component (`src/components/ui/PageHeader.jsx`). Build errors from orphan `</div>` tags and missing icons were resolved.

### 9. Build Errors Fixed
| File | Error | Fix |
|------|-------|-----|
| `AiCommandCenter.jsx` | Orphan `</div>` after PageHeader upgrade | Removed |
| `RotationSchedule.jsx` | Orphan `</div>` after PageHeader upgrade | Removed |
| `SiteComparison.jsx` | `GitCompareArrows` not in lucide-react v0.263.1 | Replaced with `GitMerge` |

---

## Supabase — Required One-Time SQL

Run in Supabase SQL Editor (all idempotent):

```sql
-- Checklist columns on inspections
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS tyre_conditions jsonb;
CREATE INDEX IF NOT EXISTS idx_inspections_tyre_conditions ON inspections USING gin(tyre_conditions);
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS vehicle_type text;
CREATE INDEX IF NOT EXISTS idx_inspections_vehicle_type ON inspections (vehicle_type);

-- Multi-identifier login
CREATE OR REPLACE FUNCTION get_user_email_by_id(user_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_email text;
BEGIN
  SELECT email INTO v_email FROM auth.users WHERE id = user_id;
  RETURN v_email;
END;
$$;
GRANT EXECUTE ON FUNCTION get_user_email_by_id(uuid) TO authenticated;
CREATE INDEX IF NOT EXISTS profiles_employee_id_idx ON profiles (employee_id);
CREATE INDEX IF NOT EXISTS profiles_username_idx ON profiles (username);
```

---

## Architecture Reference

### Auth & RBAC

| Role | Intelligence | Analytics | Operations | Admin pages |
|------|-------------|-----------|------------|-------------|
| Admin | ✅ | ✅ | ✅ | ✅ |
| Manager | ❌ | ✅ | ✅ | ❌ |
| Director | ❌ | ✅ | ✅ | ❌ |
| Tyre Man | ❌ | ❌ | ✅ | ❌ |
| Inspector | ❌ | ❌ | Inspections + Settings only | ❌ |
| Reporter | ❌ | ❌ | ✅ | ❌ |

RBAC is enforced at two levels:
1. **Sidebar** — `shouldShowGroup()` in `Layout.jsx` hides the entire group
2. **Route** — `<RoleRoute allowed={[...]}>` in `App.jsx` shows access-denied if navigated directly

### Session

```
Idle timeout:    30 minutes
Check interval:  30 seconds
Events tracked:  mousemove, keydown, click, touchstart
Storage key:     tp_last_activity (localStorage)
Expiry flag:     tp_session_expired = '1' → banner shown on login
```

### Login Identifier Resolution

```
User enters identifier
  └─ includes '@' → treat as email directly
  └─ no '@' → query profiles WHERE username = ? OR employee_id = ?
                └─ found → call get_user_email_by_id(profile.id) RPC
                └─ not found → show "No account found" error
```

### Vehicle Diagram

```
vehicle_type from DB (any case)
  └─ normVT() → lowercase trim
  └─ TYRE_POSITIONS[normVT] → position array (or DEFAULT_POSITIONS)
  └─ VehicleTyreDiagram receives vehicleType prop → getLayout normalises internally
  └─ position IDs are identical in both TYRE_POSITIONS and VehicleTyreDiagram layout
```

---

## All Pages (73 total)

### Overview (2)
`/` Dashboard · `/tyres` TyreRecords

### Analytics — Admin + Manager + Director (7)
`/analytics` · `/brand-perf` · `/site-comp` · `/fleet` · `/kpi` · `/country-comp` · `/comparison`

### Operations — All roles (17)
`/fleet-master` · `/assets` · `/stock` · `/stock-replenishment` · `/budgets` · `/actions` · `/accidents` · `/rca` · `/inspections` · `/inspection-planner` · `/work-orders` · `/gate-pass` · `/reports` · `/warranty` · `/scrap` · `/retread` · `/alerts`

### Intelligence — Admin only (36)
`/kpi-engine` · `/kpi-command` · `/position-intelligence` · `/pressure-intel` · `/inspection-intelligence` · `/root-cause` · `/predictive-maintenance` · `/vendor-intelligence` · `/driver-management` · `/fleet-intelligence` · `/fleet-health` · `/live-fleet` · `/compliance` · `/ai-command-center` · `/executive-report` · `/forecasting` · `/continuous-improvement` · `/erp-sync` · `/maintenance-calendar` · `/safety-compliance` · `/cost-center` · `/benchmark` · `/procurement` · `/suppliers` · `/tyre-size` · `/tyre-lifecycle` · `/tyre-exchange` · `/tyre-specs` · `/rotation` · `/recall-tracker` · `/fuel-efficiency` · `/workshop` · `/downtime` · `/budget-planner` · `/daily-ops` · `/advanced-analytics`

### Admin only (5)
`/anomalies` · `/vehicle-history` · `/ai` · `/serial-tracker` · `/audit`

### Data (3)
`/cleaning` (Admin) · `/users` (Admin) · `/upload` (All) · `/settings` (All)

---

## Key Files Changed This Session

| File | What Changed |
|------|-------------|
| `src/contexts/AuthContext.jsx` | 30-min timeout, touch events, multi-identifier signIn |
| `src/components/ProtectedRoute.jsx` | RoleRoute improved; approval check comment clarified |
| `src/components/Layout.jsx` | `groupRoles` + `shouldShowGroup()` + INTELLIGENCE_ROLES/ANALYTICS_ROLES constants |
| `src/App.jsx` | All Intelligence routes → `RoleRoute(['Admin'])`, Analytics → `RoleRoute(['Admin','Manager','Director'])` |
| `src/pages/Login.jsx` | 3-way ID mode selector, `identifier` state, session expiry banner text |
| `src/pages/Inspections.jsx` | Checklist overhaul — dropdown inputs, normVT, PDF async SVG capture, tyre_conditions/vehicle_type save |
| `src/components/VehicleTyreDiagram.jsx` | Case-insensitive getLayout, correct position IDs for all vehicle types |

---

## Key Libraries & Utilities

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
| `src/lib/exportUtils.js` | Excel/PDF export utilities |
| `src/components/ui/PageHeader.jsx` | Shared page header with title, subtitle, icon, actions |
| `src/components/Layout.jsx` | Main sidebar nav, GlobalSearch, NotificationCenter |
| `src/components/GlobalSearch.jsx` | Cmd/Ctrl+K search modal across all data |
| `src/components/VehicleTyreDiagram.jsx` | SVG vehicle layout with clickable tyre positions |

---

## Architecture Notes

- **Anthropic API key** — calls go through `supabase.functions.invoke('chat-ai')` — never exposed client-side
- **uuid** — NOT installed. Use `crypto.randomUUID()` everywhere
- **lucide-react** is v0.263.1 — many newer icons don't exist. Check before using
- **Build** — `npm run build` → 2179 modules, 0 errors, ~1170KB gzip. Chunk size warnings are expected and non-blocking
- **Supabase RLS** — enabled on all tables. Profile lookup for multi-identifier login requires the `get_user_email_by_id` SECURITY DEFINER RPC
- All intelligence pages follow the same pattern: load on mount → useMemo computed → Chart.js visuals → Excel/PDF export

---

## Supabase Edge Functions

| Function | Input | Purpose |
|----------|-------|---------|
| `chat-ai` | `{ system, user, model }` | Anthropic API proxy |
| `generate-embedding` | `{ text, model }` | OpenAI embeddings proxy |
| `send-email` | `{ to, subject, body }` | Resend API email delivery |

Env vars: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `FROM_EMAIL`
Deploy: `supabase functions deploy chat-ai --project-ref <your-ref>`

---

## Next Session Priorities

1. **RAG document ingestion** — SOP/policy PDF upload pipeline
2. **AI cost monitor** — token usage dashboard per day/month
3. **Offline PWA** — service worker sync queue for inspections without internet
4. **Scheduled reports** — monthly email of executive PDF
5. **QR/barcode scanner** — tyre serial scan on checklist (mobile)

---

*TyrePulse v6.0 · Readymix Concrete Company · Shahzeb Rahman © 2026*
