# TyrePulse — Project Overview

A multi-country fleet, tyre, workshop, accident and inspection intelligence
platform for commercial fleet operators across KSA, UAE, Qatar and Egypt.

_Last updated: 2026-07-03 · migrations through V68._

---

## What it is

TyrePulse turns raw tyre/fleet operational data into engineering and management
intelligence: cost-per-km, tyre life, failure and pressure compliance, root
cause, vendor performance, predictive replacement, and executive reporting — not
just a database, a decision platform.

## Surfaces

| Surface   | Stack                              | Location   |
|-----------|------------------------------------|------------|
| Web app   | Vite + React 19                    | `src/`     |
| Mobile    | Expo React Native (iOS/Android)    | `mobile/`  |
| Backend   | Supabase (Postgres + RLS + Edge)   | project `jhssdmeruxtrlqnwfksc` |
| Console   | Isolated ops/admin console         | `src/console/` |

A Go backend (`backend/`) and native Kotlin app exist on frozen branches and are
**not** part of the production path (see `HANDOFF.md`).

## Multi-tenancy & scope

- **Organisations** (`organisations`): Default + one per country (KSA / UAE /
  Egypt). Every business row carries `organisation_id`; RESTRICTIVE RLS isolates
  orgs (`organisation_id = app_current_org()`).
- **Roles**: super admin & Admin see all orgs (`app_is_org_admin()`); other
  roles are locked to their assigned org/country. Assigning a user's country
  auto-assigns their organisation.
- **Country isolation is sacred**; files stay private (signed URLs); no
  service-role / AI / storage keys ship in web or mobile.

## Core domains (tables)

- **Fleet/assets**: `vehicle_fleet` (canonical), `fleet_master` (legacy view).
- **Tyres**: `tyre_records` (serial-level lifecycle; changes appended);
  `tyre_changes` is a compatibility view.
- **Inventory**: `stock_records` + `stock_movements` (ledger via
  `post_stock_movement`); `stock` (legacy).
- **Operations**: `work_orders`, `corrective_actions`, `inspections`,
  `accidents` (+ `accident_parts`/`accident_remarks`), `gate_pass`.
- **Suppliers/warranty**: `suppliers`, `supplier_ratings`/`supplier_contracts`,
  `warranty_claims`, `recalls`.
- **Data Intake**: `import_*` staging tables + `import_commit_batch` RPC
  (per-row resilient commit, mapping profiles) — see `IMPORT_CENTER_*`.
- **Audit**: canonical `audit_log_v2` via `record_audit_event`.
- **Reporting**: `report_schedules`, `report_send_log`; branded exports.

## Key subsystems

- **Data Intake Center** — controlled staging → validate → approve → commit
  pipeline preserving every original row/file, scoped by org/country, committing
  only via server-side RPCs.
- **Branding & Report Center** — per-org report identity (V68) + on-demand and
  scheduled branded PDF/PPTX/Excel delivery. See
  `BRANDING_AND_REPORT_SETTINGS.md`.
- **KPI registry** — central KPI definitions + resolver.
- **AI** — `chat-ai` edge function (rate-limited, cached, usage-logged); model
  server-locked; RAG-oriented retrieval, no full-dataset prompts.

## Engineering rules (non-negotiable)

- Verify columns/constraints against the live schema before any query/RPC.
- No fabricated values — actual data only; missing metric → 0 or "—".
- Backward-compatible migrations only; no table drops without
  migration + reconciliation + rollback.
- Gate every change: `npm run test:run` · `npx vite build` ·
  `cd mobile && npm run typecheck`. CI runs this on every push.
- Migrations are numbered `MIGRATIONS_V*.sql`, applied live, and proven with
  rolled-back self-asserting SQL tests.

## Where to look

- Session state & roadmap: `HANDOFF.md`
- Engineering log: `CHANGELOG_ENGINEERING.md`
- Architecture: `ARCHITECTURE_CURRENT_STATE.md`, `TARGET_ARCHITECTURE.md`
- Security: `SECURITY_HARDENING_PLAN.md`, `SECURITY_RISK_REGISTER.md`
- Data intake: `IMPORT_CENTER_*.md`
- Reporting/branding: `BRANDING_AND_REPORT_SETTINGS.md`, `EXPORT_GUIDE.md`
- Integrations: `INTEGRATIONS.md`
