# Test & Release Plan

**Status:** Phase 0 - planning.
**Track:** In-place hardening of the existing Vite + React 19 / Expo SDK 54 / Supabase stack. No rewrite.
**Test runner:** Vitest (web). Mobile: TypeScript compile check (`tsc --noEmit`).

---

## 1. Release gate

Before any phase is called complete, all three commands must pass. These are the **exact scripts** defined in `package.json` and `mobile/package.json`:

```bash
npm run test:run          # vitest run  (web unit/integration tests)
npm run build             # vite build  (web production build)
cd mobile && npm run typecheck   # tsc --noEmit  (mobile type safety)
```

| Command | Defined in | Underlying |
|---|---|---|
| `npm run test:run` | `package.json` | `vitest run` |
| `npm run build` | `package.json` | `vite build` |
| `npm run typecheck` (in `mobile/`) | `mobile/package.json` | `tsc --noEmit` |

A phase that does not produce a green gate is **not complete**. No merge to the default branch without the gate passing.

> Supporting scripts (not gates): `npm run test` (watch), `npm run test:coverage` (`vitest run --coverage`). Coverage is tracked but the gate is `test:run`.

---

## 2. Test matrix

Each row below is a required test suite. Tests are added as the relevant module lands; the gate enforces them thereafter.

| # | Suite | What it proves | Phase |
|---|---|---|---|
| 1 | **Data-service unit tests** | `src/lib/api/*` services map inputs/outputs correctly and contain the data logic (pages don't). | 1 |
| 2 | **Permission / role rules** | Access for **Admin, Manager, Director, Inspector, Tyre Man, Reporter, Driver** matches expected module rights; frontend `hasPermission()` is UI-only. | 1 |
| 3 | **Tenant / org isolation** | A user cannot read/write another scope's records by changing URL, payload, or browser state. Today scoping is geographic (`site` + `country[]` on `profiles`); org dimension reserved for activation. | 1 |
| 4 | **File access + signed-URL rules** | Business buckets are private; accident/inspection/warranty/vehicle/report files served only via short-lived signed URLs; one scope cannot fetch another's files; extension/MIME/size/path/uploader validated. | 1 |
| 5 | **Tyre-change workflow** | The transactional change RPC (remove → record KM/reason → event → status → fit replacement → update layout → stock movement → audit) is atomic and idempotent; no half-finished state on failure. | 2 |
| 6 | **Stock-movement calculation** | `opening + receipts + returns + transfer_in - issues - transfer_out - scrap ± adjustments = current`; balance is derived from the ledger, not editable totals; compatibility view matches legacy figures. | 2 |
| 7 | **Inspection + corrective-action creation** | Structured rows are written alongside the JSONB `tyre_conditions` snapshot; critical findings auto-create/propose corrective actions with standard failure categories. | 2 |
| 8 | **Offline queue retry / idempotency** | Typed mobile commands (`CreateInspection`, `SubmitTyreChange`, `CreateWorkOrder`, `ReportVehicleIssue`, `SubmitRCA`, `UploadAttachment`) retry with backoff and never create duplicates on replay; arbitrary table names are rejected. | 4 |
| 9 | **Logout cache clearing** | On logout / account switch, user-scoped client cache is cleared; a new account cannot see the previous account's cached data; PWA does not cache auth/REST/private storage. | 1 |
| 10 | **Regression - key screens** | Critical journeys keep rendering and functioning: Operations dashboard, Tyre records/lifecycle, Inspections, Work orders, Stock, Accidents, Reports/exports, Gate pass. | every phase |

---

## 3. Per-phase exit criteria

A phase exits only when its gate is green **and** the criteria below are met.

| Phase | Exit criteria |
|---|---|
| **1 - Security & foundation** | Data-service layer in use for migrated modules; DB-backed permissions with RLS authoritative; private buckets + signed URLs; PWA cache safe + logout clears cache; secret checks pass. Suites 1-4, 9 added and green. |
| **2 - Data model** | Canonical `vehicle_fleet` + `fleet_master` compatibility view; stock movement ledger live with compatibility view; unified `audit_events` backfilled; tyre-change RPC; structured inspection rows. Reconciliation reports clean. Suites 5-7 added and green. |
| **3 - Operational workflow** | Evidence-gated work-order/corrective-action closure, escalation, full cross-links; gate-pass blocks on open critical defects; stock reservations/PO/GRN/supplier scorecard; accident cost & claim split with private attachments. Regression (suite 10) green. |
| **4 - Mobile reliability** | Generic `recordQueue` replaced by typed commands on Expo SQLite; backoff retry; no duplicates; pending/syncing/failed/completed visibility; offline photos preserved; org cache cleared on logout; conflict handling. Suite 8 green; `mobile typecheck` green. |
| **5 - Analytics** | 8 workspaces live with routes preserved; central KPI registry; heavy math in SQL views/RPCs/snapshots; exports lazy-loaded; chart drill-down to source. Build size reduced; regression green. |
| **6 - UX & quality** | Consistent light/dark, RTL-ready, responsive, full empty/loading/error states, table search/filter/pagination/virtualisation, validation-before-submit, destructive-action confirmation, plain language. Regression green. |

---

## 4. Engineering changelog cadence

Maintain **`docs/CHANGELOG_ENGINEERING.md`**, updated **once per phase** (and per significant migration). Each entry records:

- Phase / date
- Files changed
- Database changes (migration id, reconciliation report reference, rollback note)
- Tests run and results (gate output)
- Features improved
- Risks remaining
- Exact next phase

No phase is closed without its changelog entry.

---

## 5. Working rules

- Keep build, web tests, and mobile typecheck **passing after every phase** - never merge a red gate.
- Small, logical commits; no single mega-commit across modules.
- Migrations backward-compatible; no table drop/rename without reconciliation report, backup, and rollback.
- Migrate to the data-service layer module by module; add the matching test suite as each module lands.
