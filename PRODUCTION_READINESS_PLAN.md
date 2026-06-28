# Production-Readiness Plan — Web + Mobile Audit & Completion

**Branch:** `claude/mobile-app-ui-features-tdfxy0` · **Generated:** 2026-06-28

## Context
A full audit ran across all 78 web pages + 35 mobile screens to find and fix every incomplete / CRUD-broken / fabricated-data module and bring the product to production quality.

**Critical correction during the audit:** one analytics audit pass falsely claimed ~10 pages were "broken by phantom columns" (`qty`, `created_at`, `asset_number`, `serial_number`, `inspections.country`, the `tyre_changes` table, etc.). Verified against the live Supabase schema — **all of those exist**. Those pages are NOT broken; acting on that report would have deleted working code. Every change is now verified against the live schema first.

---

## ✅ Done — committed & pushed
- **Security hardening** — AI model locked server-side, account lockout/approval enforced on mobile + realtime, generic auth errors (no user enumeration), accident photos private (signed URLs), photo upload extension/size validation, idle-timeout no longer bypassable via localStorage, bulk-upload server-side validation (DB CHECK constraints + client sanitization).
- **WarrantyTracker** → new `warranty_claims` table (financial recovery records; was localStorage).
- **RecallTracker** → new `recalls` table (safety records; was localStorage).
- **StockReplenishment** → fixed genuinely-broken `stock` schema mapping (`qty_in_stock`→`quantity`; no `qty_on_order` column) + wired Order Generator to real `purchase_orders`.
- **TyreSpecifications** → new `tyre_specifications` table + "Raise Work Order" now inserts into real `work_orders`.
- **RotationSchedule** → new `tyre_rotations` table + **removed fabricated** monthly-compliance chart (replaced with real rotation-event counts).
- **InspectionPlanner** → new `inspection_schedules` table.
- **SupplierManagement** → new `supplier_ratings` + `supplier_contracts` tables.
- **BudgetPlanner** → wired to the existing `budgets` table.
- **Mobile `overview.tsx`** → error + empty states for the summary RPC.

All new tables have RLS: authenticated read, `is_approved_and_unlocked()` writes, elevated-only (Admin/Manager/Director) delete. Every web change verified with a green `npx vite build`.

---

## ⏳ Remaining work

### R1 — Fabricated-metric honesty labeling
Make estimation pages honest (do not invent data sources; label what's derived).
- **DowntimeTracker.jsx** — *done, uncommitted*: real downtime from `work_orders.opened_at→completed_at` (per-severity estimate only as fallback), settings-driven cost/hr (`appSettings.downtime_rate`), "Estimated" banner + "(Est.)" labels + honest export labels.
- **FuelEfficiency.jsx** — *to do*: prominent "MODELLED ESTIMATES, not measured fuel" banner; label assumption constants (fuel cost/L, baseline L/100km from settings w/ fallback); fix hardcoded ZAR `R` currency → `useSettings().activeCurrency`. **Genuine bug fix:** remove the dead `inspections` fetch that selects non-existent `tread_depth`/`position` (it throws and its state is never read).
- **PerformanceBenchmark.jsx** — *to do*: label static `BENCHMARKS` as "Static industry reference (not live data)"; relabel radar baseline of 50 as a reference target. Queries verified correct — leave them.

### R2 — Mobile alerts screen (`mobile/app/(app)/alerts.tsx`)
Currently derives risk alerts from `tyre_records` with no error handling and no acknowledge action; the `alerts` table is unused.
- Add error/retry state (keep empty state).
- "Acknowledge" inserts an `alerts` row (`alert_type:'tyre_risk'`, severity, asset_no, serial/message, site, country, `resolved:true`, `is_active:false`, created_by). RLS confirmed: insert needs `auth.uid()`, SELECT open, UPDATE needs `is_admin_or_above()`.
- On load, fetch resolved `tyre_risk` alerts and filter acknowledged assets out of the derived list. Verify with `npx tsc --noEmit`.

### R3 — AI cost control (`supabase/functions/chat-ai/index.ts`)
Tables `ai_usage_log` and `ai_response_cache` exist but are unused.
- After a successful Anthropic call, best-effort insert an `ai_usage_log` row (tokens from `response.usage`, `cost_usd` from a per-model rate table, user/role/country/site context). Never block the response on logging failure.
- Optional response cache keyed by a hash of (system + messages) with short TTL; model stays server-locked.
- Per-user rate limiting from recent `ai_usage_log` counts → 429 over cap.
- Redeploy `chat-ai` (deploy may need user approval).

### R4 — Final verification + roadmap
- Web `npx vite build` green; mobile `npx tsc --noEmit` clean.
- Supabase `get_advisors` (security) after new tables.
- Update `ROADMAP.md` (mark localStorage→DB modules done; correct stale "6 mobile screens" → 35; AI cost monitor/rate-limit status).

---

## Guardrails (every change)
- **Verify columns against the live schema via `execute_sql` before writing any query** — never trust audit claims about missing columns.
- Whitelist columns in every insert/update; null-safe country filter (`country.eq.X,country.is.null`).
- Remove now-unused imports/vars.
- Build/typecheck green before commit; focused commits; push to the feature branch only.

## Out of scope / follow-up
- Remove the hardcoded Supabase anon key from `eas.json`/`app.json` (needs user to run `eas secret:create`).
- Medium polish: TyreExchange/TyreScrap disposal-status persistence, QrLabels `serial_no` vs `serial_number` inconsistency, work-order data-model de-duplication, AssetManagement vs FleetMaster consolidation.
