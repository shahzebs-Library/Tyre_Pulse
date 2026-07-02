# Product Gap Register - TyrePulse

**Phase 0 - read-only. Companion to `CURRENT_SYSTEM_AUDIT.md` and `SECURITY_HARDENING_PLAN.md`.**

This register enumerates gaps in the *existing* TyrePulse platform (Vite/React 19 web, Expo SDK 54 mobile, Supabase backend) and maps each to a remediation phase. It is scoped to hardening the current stack in place - no re-platforming.

**Phase legend** (in-place hardening track):
- **P1** Security & platform foundation (service layer, permissions, secure files, PWA/cache, secrets)
- **P2** Data-model consolidation (canonical sources, ledger, audit format)
- **P3** Tyre lifecycle, inspections, accidents (structured data + transactional workflows)
- **P4** KPI/analytics centralisation & dashboard consolidation
- **P5** Mobile offline hardening (typed commands, conflict handling)
- **P6** UX consolidation, performance, release hardening

**Severity bands:** Critical (security/data risk) · High (operational risk) · Medium (maintainability/performance) · Product/UX.

Items already addressed on the current branch are marked **RESOLVED** and retained for traceability.

---

## Critical - security / data risk

| ID | Gap | Severity | Evidence (file / table) | Impact | Recommended fix | Phase |
|---|---|---|---|---|---|---|
| C-01 | No organisation scope in RLS; `organisations` table empty & unused | Critical | `organisations` (0 rows); `MIGRATIONS_V40/V41`, `BACKEND_RLS.sql`; `profiles.site`/`country` | Cross-org data exposure - a user can read another org's records via overlapping `country`/`site` | Introduce org_id on operational tables; make RLS org-aware; backfill from geography | P1→P2 |
| C-02 | Mobile `recordQueue` writes to arbitrary client-named tables | Critical | `mobile/lib/recordQueue.ts` `saveRecord(table,payload)`→`from(table).insert` | Client chooses destination table/payload; integrity & privilege risk on flush | Replace with typed offline commands (intent, not table); validate on flush | P1→P5 |
| C-03 | PWA caches authenticated REST/auth/private storage; no logout cache clear | Critical | `vite.config.js` runtimeCaching: `/rest/` 5min, `/auth/` 60s, `/storage/` CacheFirst 24h | Account switch can surface prior user's cached data/files | Cache only app shell/static; drop authed caches; clear on logout/account switch | P1 |
| C-04 | Anon key hardcoded in committed mobile config | Critical | `mobile/app.json`, `mobile/eas.json` (3 profiles) | Secret committed to VCS; rotation hard; bad precedent | Move to EAS Secrets / `EXPO_PUBLIC_*` at build; remove from committed files | P1 |
| C-05 | `hasPermission()` is UI-only and must never be relied on for security | Critical | `src/contexts/AuthContext.jsx` `ROLE_DEFAULTS`, `hasPermission()` | If any write path lacks RLS, UI gating gives false assurance | Confirm RLS authority on every table; keep `hasPermission` as UI guard only; add role tests | P1 |
| C-06 | No file-metadata table; file access not auditable/scopable per record | Critical | No `file_*` table; storage paths embedded in records | Cannot prove who may access which file or audit access by org/entity | Add file-metadata table (owner, org, entity_type, entity_id, bucket, path, type, date) | P1→P2 |
| C-07 | Critical multi-table workflows composed as separate frontend writes | Critical | `mobile/.../tyre-change.tsx`, `src/pages/TyreExchange.jsx`, `TyreLifecycle.jsx` | Mid-sequence failure leaves half-finished tyre/stock state | Wrap remove→event→fit→stock→audit in one RPC/transaction | P3 |
| C-08 | Stock totals editable client-side; not derived from ledger | Critical | `src/pages/StockManagement.jsx`, `StockReplenishment.jsx`; `stock` vs `stock_records`+`stock_movements` | Manual edits can corrupt stock truth | Make `stock_movements` ledger authoritative; derive balances | P2 |
| C-R1 | Accident photos public/permanent URLs | Critical | `accident-photos` bucket; `mobile/lib/photoUpload.ts` | Permanent public links to accident imagery | **RESOLVED** - bucket private, returns `storageRef`, 15-min signed URLs | - |
| C-R2 | User enumeration via auth error messages | Critical | Auth flows | Account discovery | **RESOLVED** - generic auth errors | - |
| C-R3 | Bulk-upload payloads unvalidated server-side | Critical | bulk upload path | Bad/oversized data into DB | **RESOLVED** - DB CHECK constraints + client sanitisation | - |

---

## High - operational risk

| ID | Gap | Severity | Evidence (file / table) | Impact | Recommended fix | Phase |
|---|---|---|---|---|---|---|
| H-01 | No application service layer; ~276 web / ~86 mobile direct Supabase calls (~70 web + ~30 mobile files) | High | `grep supabase.(from|rpc|storage|auth)` across `src/`, `mobile/` | Cross-cutting controls can't be enforced centrally; every fix touches many files | Create `src/lib/api/*` modules; migrate module-by-module behind them | P1 |
| H-02 | Fragmented audit history across 4 tables, no shared format | High | `audit_log`, `audit_log_v2`, `inspection_audit_log`, `accident_audit_log` | Cannot reliably trace business actions; gaps where audit is an optional client write | Define canonical audit event; backfill; route all writes through it | P2 |
| H-03 | Inspection tyre data stored only as JSONB | High | `inspections.tyre_conditions` (JSONB) | Hard to filter/report on pressure, tread, warranty, CPK, failure analysis | Add structured inspection/tyre-position rows; keep JSON snapshot | P3 |
| H-04 | Server-side validation missing on most write paths | High | tyre/inspection/stock/accident pages; `recordQueue` | Client validation bypassable via direct calls or queue replay | Add DB constraints + RPC validation per module | P1→P3 |
| H-05 | KPI definitions live in client code; risk of divergent numbers | High | `src/lib/kpiEngine.js`, `analyticsEngine.js`, `aiAnalytics.js` | CPK/tyre-life/failure-rate differ across pages | Centralise KPI definitions (DB views / single module) | P4 |
| H-06 | Mobile offline not atomic; no conflict resolution | High | `mobile/lib/offlineQueue.ts`, `recordQueue.ts`, `offlineCommands.ts` | Partial sync of multi-step ops; silent overwrite of concurrent edits | Typed commands + RPC execution + conflict strategy | P5 |
| H-07 | Two parallel asset masters in active use | High | `vehicle_fleet` (canon) vs `fleet_master` (legacy) | Divergent vehicle data; ambiguous source of truth | Compatibility view + reconcile + migrate reads to `vehicle_fleet` | P2 |
| H-R1 | AI feature unbounded cost/abuse | High | `chat-ai`, `api_rate_limits`, `ai_usage_log` | Token/cost abuse | **RESOLVED** - model lock + 20/min & 500/day + cache + usage log | - |
| H-R2 | No idle session timeout (web) | High | `src/contexts/AuthContext.jsx` | Unattended sessions | **RESOLVED** - 30-min in-memory idle timeout + MFA | - |

---

## Medium - maintainability / performance

| ID | Gap | Severity | Evidence (file / table) | Impact | Recommended fix | Phase |
|---|---|---|---|---|---|---|
| M-01 | 48 fragmented root SQL files; no single ordered migration history | Medium | `MIGRATIONS_V1..V41`, `MASTER_MIGRATION.sql`, `MIGRATIONS_SAFE.sql`, `BACKEND_RLS.sql`, etc. | Live schema/policy set unprovable from one source; risky changes | Consolidate into ordered `supabase/migrations`; snapshot live schema | P2 |
| M-02 | Export libraries (Excel/PDF/PPT) eager-loaded | Medium | `src/lib/exportUtils.js` | Heavy initial bundle; slower TTI | Lazy-load export libs on export action only | P6 |
| M-03 | Stale "public bucket" / "public URL" comments | Medium | `mobile/lib/photoUpload.ts` (~L70), `recordQueue.ts` (~L11) | Misleads maintainers; code is already private | Correct comments to reflect private ref-based storage | P1 |
| M-04 | `site` (text) / `country` (text[]) scope is loose & typo-prone | Medium | `profiles.site`, `profiles.country` | Fragile scope checks; data-entry drift | Normalise to referenced site/country dimensions tied to org | P2 |
| M-05 | Duplicate stock table lingering | Medium | `stock` (legacy) vs `stock_records`+`stock_movements` | Confusion, accidental writes to legacy | Read-compat then retire `stock` after cutover | P2 |
| M-06 | Embedding pipelines split across tables | Medium | `tyre_record_embeddings`, `inspection_embeddings`, `document_chunks` | Inconsistent RAG indexing | Standardise embedding generation/refresh pipeline | P4 |
| M-07 | Multiple overlapping offline queue modules | Medium | `offlineQueue.ts`, `recordQueue.ts`, `offlineCommands.ts` | Divergent sync logic, hard to reason about | Unify under typed-command queue | P5 |

---

## Product / UX

| ID | Gap | Severity | Evidence (file / table) | Impact | Recommended fix | Phase |
|---|---|---|---|---|---|---|
| U-01 | ~78 pages with heavy dashboard/analytics overlap | Product/UX | `Dashboard`, `Analytics`, `AdvancedAnalytics`, `FleetAnalytics`, `FleetIntelligence`, `FleetHealthBoard`, `EngineeringKpi`, `KpiCommandCenter`, `KpiScorecard`, `ExecutiveReport` | Menu clutter; users unsure which screen to use | Consolidate into operational workspaces; retain all functionality | P6 |
| U-02 | Duplicate RCA journeys | Product/UX | `RootCauseEngine.jsx`, `RcaRecords.jsx`, `rca_records` | Two entry points for one job | Merge into one RCA workspace | P6 |
| U-03 | Duplicate budgeting journeys | Product/UX | `Budgets.jsx`, `BudgetPlanner.jsx`, `CostCenter.jsx` | Fragmented cost workflows | Consolidate cost/budget workspace | P6 |
| U-04 | Duplicate upload/data journeys | Product/UX | `UploadData.jsx`, `CustomData.jsx`, `ErpSync.jsx`, `DataCleaning.jsx` | Confusing ingestion paths | Unified data-ingestion workspace with clear states | P6 |
| U-05 | Overlapping AI surfaces | Product/UX | `AiAnalytics.jsx`, `AiCommandCenter.jsx`, `FleetIntelligence.jsx`, `ForecastingEngine.jsx`, `PredictiveMaintenance.jsx` | Redundant AI entry points | Single AI/intelligence workspace | P6 |
| U-06 | Critical inspection findings don't auto-create corrective actions | Product/UX | `Inspections.jsx`, `corrective_actions` | Manual follow-up; findings slip | Auto-propose corrective action on critical finding | P3 |
| U-07 | Comparison views fragmented | Product/UX | `Comparison`, `CountryComparison`, `SiteComparison`, `BrandPerformance` | Same analysis, many pages | Parameterised comparison workspace | P6 |

---

## Summary

- **Critical open:** C-01..C-08 (org scope, arbitrary writes, PWA cache, anon key, UI-only perms, file metadata, non-atomic workflows, client stock totals).
- **Resolved:** accident photos private+signed, generic auth errors, bulk-upload constraints, AI model lock + rate-limit + cache + usage log, web idle timeout + MFA, RLS broad-policy cleanup (V41).
- **Highest-leverage next steps (P1):** service layer (`src/lib/api/*`), org-aware RLS foundation, PWA/cache fix, anon-key relocation, file-metadata table, confirm RLS authority behind every UI guard.
