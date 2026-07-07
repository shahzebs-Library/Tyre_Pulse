# Handoff — UI/UX Redesign + Vehicle 360 + ERP config (2026-07-06)

## Branch layout (KEEP SEPARATE — do not merge without the user's OK)
| Branch | Head | State |
|---|---|---|
| `main` | `b8f9f02` | **Production (tyrepulse.app).** Only production-safe fixes. NOT the redesign. |
| `claude/ui-ux-redesign` | `f64711a` | **All redesign work.** Fully pushed, gated. For review, not live. |

`main` currently carries (all live): CSV import templates (10 modules), intake
crash fixes, and the **scheduled-reports banner fix** ("delivery IS automated").

---

## What's on `claude/ui-ux-redesign`

### 1. Appearance system + light-first theme
- `src/contexts/ThemeContext.jsx` — full Appearance context: **mode (Light/Dark/System)**,
  **accent colour** (10 presets + custom picker, seeds the whole brand ramp),
  **density** (comfortable/compact), **reduced motion**. Persists per-device.
- **Light is the default.** Settings → Appearance panel (`src/components/settings/AppearancePanel.jsx`)
  toggles the whole app between themes on every page.
- `src/index.css` — calmed foundation (removed glow/shine-sweep/blooms); rebuilt the
  **light palette to clean neutral slate** (was green-tinted); primary button token-driven.
- Personal accent overrides the org brand for that user (TenantContext yields to `userAccent`).

### 2. Vehicle 360 page (per-vehicle telematics)
- Route `/vehicle/:assetNo` → `src/pages/Vehicle360.jsx`. Opened from a **🚚 (Truck) action**
  on each Fleet Master row.
- **Photo upload per vehicle** → private `vehicle-photos` bucket (signed-URL display).
- **Live Leaflet + OpenStreetMap map** (`src/components/ui/VehicleMap.jsx`) with a pin;
  editable lat/long field. Leaflet installed (`leaflet@1.9.4`, lazy in this page's chunk).
- Gauges (health/critical/life-vs-target) + stat tiles + per-vehicle tyre table.
- API: `src/lib/api/vehicle360.js`. **DB: V94 applied live** — added
  `image_path/latitude/longitude/location_updated_at/gps_source` to `vehicle_fleet`,
  extended the `vehicles` view, created the `vehicle-photos` bucket + RLS.

### 3. Dashboard — more advanced (kept all old charts, added)
- `StatTile` (sparkline + delta), **gauge cluster**, **Needs-attention** list,
  **Top-vehicles benchmark bars** (green under fleet avg / red over, link to Vehicle 360).
- Chart grid/tick/legend colours fixed to render on white (canvas can't read CSS vars).

### 4. ERP connection config (the "how to connect my ERP" place)
- ERP Sync page → **ERP connection** card (`src/components/erp/ErpConnectionPanel.jsx`):
  system, https base URL, auth type, entities, frequency, enable (admin-only).
- Stored in `app_settings.erp_connection` (non-secret). **API key never client-side** —
  panel explains `supabase secrets set ERP_API_KEY=…` + a scheduled edge fn stages
  through Data Intake. Guide: `docs/ERP_INTEGRATION.md`. API: `src/lib/api/erp.js`.
- `MIGRATIONS_V95_ERP_CONNECTIONS.sql` exists but was **NOT applied** (MCP perms gated);
  app uses `app_settings` instead — fine as-is.

### 5. Design previews (Artifacts, view without login)
- Dense Grafana-style console (vehicle illustration, GPS map, gauges, histogram,
  scatter, donut, benchmark bars): https://claude.ai/code/artifact/90873374-3ec6-4771-8168-2942d60eb679
- Committed copies under `docs/design/`.

---

## Remaining work (light-safety tail — ~12 pages)
Light-safety = swap hardcoded dark literals (`text-white`, `bg-gray-900`) for theme
tokens so pages are legible in the default light theme. **51/85 pages done.** Not-broken
today — the rest just look dark-on-light in light mode (fully fine in dark mode).

Straightforward remaining: Procurement, WorkOrders, AssetManagement, VendorIntelligence,
Settings, Inspections, ScheduledReports, FuelEfficiency, TyreLifecycle, SerialTracker,
FleetHealthBoard, KnowledgeBase, Anomalies.

**Special cases (do by hand, not agents):**
- `LiveFleetStatus` — deliberate dark "live board"; **needs a decision** (keep dark vs theme-follow).
- `ExecutiveReport` — has a **print stylesheet keyed to classes**; blind swaps break printed reports.
- `DataIntakeCenter` — recently-built features; edit carefully.

### How to resume the light-safety pass
Spec: `scratchpad/LIGHT_SAFETY_SPEC.md`. Per page: swap dark literals → tokens,
**keep** semantic status colours + white text on solid buttons; esbuild-check each;
then gate `npx vite build` + `npm run test:run` (879 tests) before committing.
Agents kept dying on the shared session limit — do the tail in small batches or by hand.

---

## Open decisions for the user
1. **Merge to main?** The redesign is gated (build + 879 tests) but stays on the branch until "merge".
2. **GPS provider** — user doesn't know it yet. Vehicle 360 map plots manual lat/long meanwhile.
3. **ERP system** — user doesn't know it yet. Config surface is ready to fill.
4. **LiveFleetStatus** — keep it a dark board or make it follow the theme?

## Gate (every change)
`npx vite build` + `npm run test:run` (879 tests) + a no-undef lint sweep
(hand-rolled flat config) — the no-undef sweep is important: renamed-constant
crashes pass esbuild + tests but fail at render (bit us 3× earlier).
