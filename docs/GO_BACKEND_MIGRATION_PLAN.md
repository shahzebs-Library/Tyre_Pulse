# TyrePulse — Go Backend Migration Plan

> **Status:** Step 0 plan. Phased cutover from direct-Supabase to the Go API
> (`docs/TARGET_ARCHITECTURE.md`) **without breaking the running apps**. Legacy
> tables stay read-only until each module is reconciled and validated.

## Principles
- One module at a time. Keep web + mobile working throughout.
- Never delete/rename a production table before its replacement is validated.
- Phase A: Go connects to the **existing Supabase Postgres**; no second source
  of truth. Phase C moves Postgres/storage off Supabase behind the same code.

## Per-module cutover template
For each module:
1. **Canonical schema** — design tables (ADR 0002 shape: org/scope/version/audit).
2. **Data migration + dry-run** — transform legacy → canonical; run dry-run.
3. **Reconciliation report** — old count, new count, failures, duplicates;
   investigate every mismatch.
4. **Route clients through Go** — web/mobile call the API for this module.
5. **Tests** — integration + regression + tenant-isolation + idempotency.
6. **Freeze legacy writes** — clients stop direct writes for this module.
7. **Legacy read-only** — keep old tables readable during the validation window.
8. **Deprecate** — drop old tables only after backup + reconciliation + a
   documented rollback window.
**Rollback (any module):** re-point clients to Supabase direct access, re-enable
legacy writes, keep the canonical tables for re-try. Because legacy stays
read-only (not dropped) until late, rollback is non-destructive.

## Sequence

### Step 0 — Audit & docs *(this phase)*
Architecture docs, current-state, data mapping, security register, API strategy,
ADRs, changelog. No code changes to clients.

### Step 1 — Backend foundation *(this phase)*
Go skeleton: config, pgx pool, slog + request ids, JSON envelope/errors,
CORS/rate-limit/recover middleware, JWT verification, `/health`, `/readyz`,
`/me`; additive `api_audit_events` + `idempotency_keys` migrations; OpenAPI;
docker-compose dev stack; web + mobile `apiClient` foundations (unwired).
**No existing data path changed.**

### Step 2 — First usable foundation (cutover order)
1. **Identity & scope authorization** — `/me`, role/scope resolution, default-org
   backfill (org has 0 rows today), RBAC + scope tables.
2. **Assets/fleet master** — resolve `vehicle_fleet` vs `fleet_master`
   duplication into canonical `assets` (+ `asset_configurations`,
   `asset_status_history`, `asset_meter_readings`, `asset_documents`,
   `asset_assignments`); unified Asset Timeline.
3. **Tyre lifecycle & fitment** — serial-level `tyres`, `tyre_fitments`,
   `tyre_events`, `tyre_measurements`; transactional fitment/removal in Go.
4. **Inspections & findings** — structured `inspection_runs`,
   `inspection_tyre_checks`, `inspection_findings`, `inspection_attachments`;
   keep raw JSONB snapshot; pressure standards from asset config, not the
   client. Auto-create corrective actions for critical findings.
5. **Private uploads & attachment access** — provider interface + signed URLs
   (ADR 0003); migrate accident/inspection media metadata.
6. **Mobile typed offline command sync** — replace `recordQueue.ts` arbitrary
   inserts with typed commands (ADR 0004); idempotent endpoints.

### Step 3 — Operations workflow
Corrective actions → work orders → workshop → quality checks → gate pass →
downtime; inventory as a **movement ledger** (`inventory_movements` /
`inventory_balances`, replacing manually-edited totals in `stock_records`/`stock`);
procurement, suppliers, warranty (the new `warranty_claims` table moves behind
the API).

### Step 4 — Accidents, imports, analytics
Accident + insurance/claims/recovery (already structured: `accidents`,
`accident_parts`, `accident_remarks`); controlled **import pipeline**
(`import_batches`/`import_rows`/`import_errors` with approval + rollback, no
direct-to-live-table Excel ingest); KPI definitions + daily snapshots; report
jobs on the worker; AI gateway (AI recommends only, never writes; usage logged —
`ai_usage_log` already exists).

### Step 5 — Remove legacy direct access
Per validated module: remove direct Supabase calls, delete duplicate/obsolete
tables (after backup + reconciliation + rollback window), retire client-side
business logic. Update the PWA to stop caching authenticated API/user data.

## Acceptance criteria (per completed phase)
1. What changed · 2. Files changed · 3. Modules fully migrated · 4. Modules
still on Supabase · 5. Test results · 6. Security checks performed · 7. Data
migration/reconciliation status · 8. Rollback instructions · 9. Known
limitations · 10. Exact next phase.

## Cross-cutting cleanups tracked here
- Duplicate masters: `vehicle_fleet`/`fleet_master`, `stock_records`/`stock`.
- Audit-log consolidation: `audit_log`, `audit_log_v2`, `inspection_audit_log`,
  `accident_audit_log` → unified audit (`api_audit_events` for API actions).
- 48 fragmented root SQL files → traceable goose migration history.
- PWA caching of authenticated Supabase REST/auth/storage responses.
- Anon key in `mobile/app.json`/`eas.json` → EAS Secrets.
