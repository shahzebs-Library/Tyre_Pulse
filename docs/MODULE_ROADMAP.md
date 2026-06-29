# Module Roadmap

**Status:** Phase 0 — planning. Maps the directive's Phases 1–6 onto concrete modules in the existing stack.
**Track:** Harden the current Vite + React 19 / Expo SDK 54 / Supabase system in place. No new backend, no rewrite.
**Stack:** Web (~78 pages, `src/pages/`), Mobile (~35 screens, `mobile/app/(app)/`), Supabase Postgres + Auth + Storage + Edge Functions.

---

## 1. Module inventory (current vs target)

| Module | Primary surfaces | Current state | Target state |
|---|---|---|---|
| **Assets / Fleet** | `FleetMaster.jsx`, `AssetManagement.jsx`, `VehicleHistory.jsx`, mobile `vehicles.tsx` | Two masters (`vehicle_fleet` / `fleet_master`); geographic scope only | Single canonical `vehicle_fleet`, full canonical field set, compatibility views |
| **Tyres** | `TyreRecords.jsx`, `TyreLifecycle.jsx`, `TyreExchange.jsx`, `SerialTracker.jsx`, `RetreadManagement.jsx`, `TyreScrapManagement.jsx`, mobile `tyre-change.tsx`, `scanner.tsx` | Lifecycle spread across screens/JSON; multi-write changes | Serial-level identity + transactional change RPC |
| **Inspections** | `Inspections.jsx`, `InspectionIntelligence.jsx`, `InspectionPlanner.jsx`, mobile `inspection/` | JSONB `tyre_conditions` only | JSON snapshot **plus** structured reporting rows + auto corrective actions |
| **Work orders / Corrective actions** | `WorkOrders.jsx`, `WorkshopManagement.jsx`, `CorrectiveActions.jsx`, `DowntimeTracker.jsx`, `GatePass.jsx`, mobile `work-orders.tsx`, `tasks.tsx` | Partial linkage; closure without evidence gates | Evidence-gated closure, escalation, full cross-links |
| **Stock / Procurement** | `StockManagement.jsx`, `StockReplenishment.jsx`, `Procurement.jsx`, `SupplierManagement.jsx`, mobile `stock.tsx` | Editable totals; `stock` vs `stock_records` | Movement ledger as source of truth; supplier scorecard |
| **Accidents / Insurance** | `Accidents.jsx`, mobile `accident/` | Structured children exist (`accident_parts`, `accident_remarks`); photos public | Private photos via signed URLs; full claim/cost split |
| **Uploads / Files** | `UploadData.jsx`, `UploadApprovals.jsx`, `CustomData.jsx`, `ErpSync.jsx`, mobile `photoUpload.ts` | Public accident-photo URLs; weak validation | Private buckets, signed URLs, file metadata records, validation |
| **Reports / Analytics** | `Reports.jsx`, `ExecutiveReport.jsx`, `ScheduledReports.jsx`, + ~30 analytics/intelligence pages | Heavy static export libs; duplicate journeys; in-page KPI math | Central KPI definitions, lazy-loaded exports, 8 workspaces |
| **Users / Roles** | `UserManagement.jsx`, `Settings.jsx`, `src/contexts/AuthContext.jsx` | Frontend role defaults only | DB-stored module permissions; RLS is the authority |
| **Organisations** | (no UI; `organisations` table = 0 rows, not in RLS) | Geographic scope (`site` + `country[]`) only | Org scope reserved (nullable), activated later; not in scope for in-place phases |

---

## 2. Phase → module mapping

### Phase 1 — Security & platform foundation
**Goal:** real authority moves to RLS; files become private; client cache is safe.

| Deliverable | Modules touched | Order |
|---|---|---|
| Central data-service layer `src/lib/api/` (auth, assets, tyres, inspections, workOrders, stock, accidents, uploads, reports, organisations, users) | All web | 1 |
| Permissions in DB; `hasPermission()` becomes UI guard only; RLS authoritative; site/country scope on operational reads/writes | Users, Assets, Tyres, Inspections, WorkOrders, Stock, Accidents | 2 |
| Private buckets, remove public accident URLs, signed URLs, file-metadata records, upload validation | Uploads, Accidents, Inspections | 3 |
| PWA: stop caching authenticated REST/Auth/private storage; clear user cache on logout | Web shell | 4 |
| Secret checks: only public URL + anon key client-side; server secrets in Edge Functions | All | 5 |

### Phase 2 — Data model consolidation (see DATA_MODEL_CONSOLIDATION_PLAN.md)
| Deliverable | Modules | Order |
|---|---|---|
| Canonical `vehicle_fleet` + compatibility view over `fleet_master` | Assets | 1 |
| Stock movement ledger; `stock_records`/`stock_movements` canonical; `stock` compatibility view | Stock | 2 |
| Unified `audit_events` format; backfill 4 legacy audit tables | Audit (all modules) | 3 |
| Serial-level tyre lifecycle + transactional change RPC | Tyres | 4 |
| Structured inspection rows alongside JSONB snapshot + auto corrective actions | Inspections | 5 |

### Phase 3 — Operational workflow
**Flow:** inspection finding → corrective action → supervisor review → work order → stock reservation/issue → repair/tyre activity → quality check → gate pass → downtime & cost closure.

| Deliverable | Modules |
|---|---|
| Mandatory priority/due date, status history, overdue escalation, evidence + quality review before closure, full cross-links | WorkOrders, CorrectiveActions |
| Block gate pass while critical safety defects open; condition + approval history | GatePass |
| Bin/location, serial issue tracking, transfers, adjustment approvals, reserved stock, reorder points, PO/GRN linkage, supplier scorecard | Stock, Procurement, SupplierManagement |
| Accident ↔ asset/driver/site/work order/downtime/tyre/cost; cost & claim split; insurer/policy/claim timeline; private attachments | Accidents |

### Phase 4 — Mobile reliability
| Deliverable | Modules |
|---|---|
| Replace generic `recordQueue.ts` with **typed offline commands**: `CreateInspection`, `SubmitTyreChange`, `CreateWorkOrder`, `ReportVehicleIssue`, `SubmitRCA`, `UploadAttachment` (local command id, idempotency key, user, scope, retry, sync state, error, attachments) | Mobile all |
| No arbitrary table names from client; retry with backoff; no duplicate creation; pending/syncing/failed/completed visibility; preserve offline photos; tokens in secure storage; Expo SQLite for operational offline records; clear org cache on logout; conflict handling | Mobile all |

### Phase 5 — Analytics consolidation
| Deliverable | Modules |
|---|---|
| Group ~78 pages into 8 workspaces (see UX_NAVIGATION_PLAN.md), routes preserved | Reports/Analytics |
| Central KPI registry (name, definition, formula, source tables, filters, target, owner, refresh) — CPK, cost/vehicle, cost/site, pressure compliance, inspection compliance, failure rate, warranty recovery, downtime, accident loss recovery, stock availability, supplier performance, overdue corrective actions | Reports |
| Move heavy KPI math out of components into SQL views / RPCs / scheduled snapshots / React Query | Reports, all dashboards |
| Lazy-load `xlsx`, `jspdf`, `pptxgenjs` only on export action | Reports |
| Every chart drill-down to source records | All analytics |

### Phase 6 — UX & quality
| Deliverable | Modules |
|---|---|
| Consistent light/dark, RTL/Arabic readiness, responsive, empty/loading/error states, fewer charts, large-table search/filter/pagination/virtualisation, validation-before-submit, destructive-action confirmation, plain language for field users | All surfaces |

---

## 3. Execution order & rules

1. Phase 1 before any data-model change.
2. Phases run in order; each ends with the release gate green (`npm run test:run`, `npm run build`, `cd mobile && npm run typecheck`).
3. Module-by-module migration to the data-service layer — never all at once.
4. Backward-compatible migrations only; no table drop/rename without reconciliation + rollback.
5. Small, logical commits; `docs/CHANGELOG_ENGINEERING.md` updated each phase.
