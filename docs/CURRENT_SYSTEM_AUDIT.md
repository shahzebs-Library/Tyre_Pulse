# Current System Audit — TyrePulse

**Phase 0 — read-only audit. No schema, data, or behaviour changes are made here.**

This document inventories the *existing* TyrePulse platform as built today: Vite + React 19 web, Expo SDK 54 / React Native 0.81.5 mobile, and a Supabase backend (Postgres + GoTrue Auth + Storage + Deno Edge Functions). It is the factual baseline for the in-place hardening track. It does **not** propose a new backend, language, or framework — only an honest map of what is here and where the risk sits.

> Scope guardrail: this audit covers the current React / Expo / Supabase system. The remediation it feeds (Phases 1–6) strengthens that stack in place. No re-platforming is implied or recommended in this document.

---

## 1. Stack at a glance

| Layer | Technology | Footprint |
|---|---|---|
| Web | Vite, React 19, React Router, Tailwind, React Query, `vite-plugin-pwa` | ~78 pages (`src/pages/`), ~24 components (`src/components/`) |
| Mobile | Expo SDK 54, React Native 0.81.5, Expo Router | ~35 screens (`mobile/app/(app)/`) |
| Backend | Supabase Postgres, Auth (GoTrue), Storage, Edge Functions (Deno) | 46 tables, 3 edge functions, 3 storage buckets |
| AI | Anthropic (chat), OpenAI (embeddings) — server-side only via edge functions | `supabase/functions/chat-ai`, `generate-embedding` |
| Reporting | Excel / PDF / PowerPoint libraries in web (`src/lib/exportUtils.js`) | Eager-loaded today |

**Architectural headline:** there is **no application API or service layer**. Web and mobile clients call `supabase.from / rpc / storage / auth` directly from pages, screens, and lib modules. The only server-side boundary is the three edge functions. Security therefore rests almost entirely on Postgres Row Level Security (RLS); the frontend permission system is advisory only.

Direct-call volume (two framings, both valid):
- **Call-site framing (per directive):** ~276 direct Supabase calls in web, ~86 in mobile.
- **File framing (this audit, `grep -rlE "supabase\.(from|rpc|storage|auth)"`):** ~70 web files and ~30 mobile files contain direct calls; ~345 raw `supabase.*` call expressions in `src/` alone.

Both framings agree on the conclusion: data access is diffuse and ungoverned by any shared layer, so every fix that touches access patterns must currently be made in dozens of places.

---

## 2. Active tables and purpose

46 tables exist. Grouped by domain (canonical source noted where duplicates exist — see §6).

### Identity & access
| Table | Purpose |
|---|---|
| `profiles` | User identity, `role`, `approved`, `locked`, `site` (text), `country` (text[]), employee data. Primary RLS subject. |
| `organisations` | **Exists but holds 0 rows and is NOT wired into RLS.** Intended tenant root; currently inert. |
| `app_settings` / `settings` | App- and user-level configuration. |
| `notifications` | In-app notifications. |

### Fleet & assets
| Table | Purpose |
|---|---|
| `vehicle_fleet` | **CANONICAL** master asset/vehicle record. |
| `fleet_master` | **LEGACY** duplicate asset master — overlaps `vehicle_fleet`. |
| `gate_passes` | Vehicle gate-pass / movement records. |

### Tyres
| Table | Purpose |
|---|---|
| `tyre_records` | Serial-level tyre records, fitment, status, lifecycle. |
| `tyre_records_archive` | Archived tyre records. |
| `tyre_record_embeddings` | Vector embeddings for tyre-record RAG. |

### Inspections
| Table | Purpose |
|---|---|
| `inspections` | Inspection events. **Tyre measurements stored as JSONB `tyre_conditions`** rather than structured rows. |
| `inspection_audit_log` | Inspection-specific audit trail. |
| `inspection_embeddings` | Vector embeddings for inspection RAG. |

### Accidents
| Table | Purpose |
|---|---|
| `accidents` | Accident header record. |
| `accident_parts` | **Structured child** — damaged parts per accident. |
| `accident_remarks` | **Structured child** — remarks per accident. |
| `accident_audit_log` *(referenced)* | Accident audit trail. |

### Stock / inventory
| Table | Purpose |
|---|---|
| `stock_records` | **CANONICAL** stock master (with `stock_movements`). |
| `stock_movements` | **CANONICAL** movement ledger. |
| `stock` | **LEGACY** duplicate stock table. |
| `purchase_orders` | Procurement / PO records. |

### Workshop & operations
| Table | Purpose |
|---|---|
| `work_orders` | Workshop job records. |
| `corrective_actions` | Corrective actions (often from inspection findings). |
| `rca_records` | Root-cause-analysis records. |
| `budgets` | Cost / budget planning. |

### Analytics & KPI
| Table | Purpose |
|---|---|
| `kpi_snapshots` | Periodic KPI snapshots. |
| `kpi_targets` | KPI target definitions. |

### Knowledge / RAG
| Table | Purpose |
|---|---|
| `knowledge_documents` | SOPs / manuals / docs metadata. |
| `document_chunks` | Chunked text for retrieval. |

### Data ingestion & quality
| Table | Purpose |
|---|---|
| `upload_history` / `pending_uploads` | Bulk upload tracking & approval queue. |
| `column_mappings` | Saved import column maps. |
| `brand_aliases` | Brand normalisation. |
| `cleaning_log` | Data-cleaning audit. |

### Audit & system
| Table | Purpose |
|---|---|
| `audit_log` | General audit trail (v1). |
| `audit_log_v2` | General audit trail (v2). |
| `inspection_audit_log` / `accident_audit_log` | Module-specific audit trails. |
| `system_health_log` | System health events. |
| `api_rate_limits` | Edge-function rate-limit state. |
| `ai_response_cache` | Cached AI responses. |
| `ai_usage_log` *(referenced by chat-ai)* | Per-user AI usage logging. |

**Audit fragmentation:** four separate audit destinations (`audit_log`, `audit_log_v2`, `inspection_audit_log`, `accident_audit_log`) with no single canonical event format. See §10.

---

## 3. Direct Supabase calls grouped by module

There is no service layer, so "module" here means the page/screen cluster issuing the calls. ~43 of ~78 web pages call `supabase.from/rpc` directly; ~30 mobile files do likewise.

| Module | Web entry points (`src/pages/…`) | Mobile (`mobile/app/(app)/…`, `mobile/lib/…`) | Access pattern |
|---|---|---|---|
| Auth / session | `Login.jsx`, `ResetPassword.jsx`, `src/contexts/AuthContext.jsx` | `mobile/contexts/AuthContext.tsx`, `mobile/lib/supabase.ts` | `supabase.auth.*`, `rpc('get_user_module_permissions')` |
| Fleet / assets | `FleetMaster.jsx`, `AssetManagement.jsx`, `VehicleHistory.jsx`, `LiveFleetStatus.jsx` | `vehicles.tsx`, `history.tsx` | `from('vehicle_fleet')` / legacy `from('fleet_master')` |
| Tyres | `TyreRecords.jsx`, `TyreLifecycle.jsx`, `SerialTracker.jsx`, `RetreadManagement.jsx`, `TyreScrapManagement.jsx`, `TyreExchange.jsx` | `tyre-change.tsx`, `records/`, `mobile/lib/tyreLookup.ts`, `tyreConditions.ts` | `from('tyre_records')` + multi-step writes from frontend |
| Inspections | `Inspections.jsx`, `InspectionIntelligence.jsx`, `InspectionPlanner.jsx` | `inspection/`, `mobile/lib/offlineQueue.ts` | `from('inspections')`, JSONB `tyre_conditions` |
| Accidents | `Accidents.jsx`, `components/AccidentDetailModal.jsx` | `accident/`, `mobile/lib/photoUpload.ts`, `accidentPdf.ts` | `from('accidents'/'accident_parts'/'accident_remarks')`, storage |
| Stock | `StockManagement.jsx`, `StockReplenishment.jsx` | `stock.tsx`, `mobile/lib/recordQueue.ts` | `from('stock_records'/'stock_movements')` / legacy `from('stock')` |
| Workshop / work orders | `WorkOrders.jsx`, `WorkshopManagement.jsx` | `work-orders.tsx`, `workorders/` | `from('work_orders')` |
| RCA / corrective | `RcaRecords.jsx`, `RootCauseEngine.jsx`, `CorrectiveActions.jsx` | `rca.tsx`, `report-issue.tsx` | `from('rca_records'/'corrective_actions')` |
| Procurement / vendors | `Procurement.jsx`, `SupplierManagement.jsx`, `VendorIntelligence.jsx` | — | `from('purchase_orders')` |
| Users / admin | `UserManagement.jsx`, `Settings.jsx`, `UploadApprovals.jsx` | `admin/`, `team.tsx`, `profile.tsx` | `from('profiles')`, `rpc` |
| Data upload / cleaning | `UploadData.jsx`, `DataCleaning.jsx`, `CustomData.jsx`, `ErpSync.jsx` | — | `from('upload_history'/'pending_uploads'/'column_mappings')` |
| Audit | `AuditTrail.jsx` | `mobile/lib/auditDiff.ts` | `from('audit_log'/'audit_log_v2')` |
| Analytics / KPI / AI | `Analytics.jsx`, `KpiCommandCenter.jsx`, `AiAnalytics.jsx`, `AiCommandCenter.jsx`, + ~30 analytics pages | `analytics/`, `ai/`, `overview.tsx` | `from('kpi_snapshots')`, edge-function `chat-ai` |

**Risk:** because access is spread across ~100 files, any cross-cutting control (org/site scope, validation, audit) cannot be enforced in one place. This is the structural driver behind the Phase 1 service-layer work (`src/lib/api/*`).

---

## 4. Edge functions and responsibilities

All three live in `supabase/functions/` and gate every request through `_shared/auth.ts → requireApprovedRole()`, which validates the bearer token, loads `profiles`, and rejects `approved === false` or `locked === true`. CORS is origin-allowlisted (`ALLOWED_ORIGINS` env, with a localhost+prod default list).

| Function | Responsibility | Controls in place |
|---|---|---|
| `chat-ai` | Anthropic proxy for AI features. | Model **locked** to `claude-haiku-4-5-20251001`; rate-limit **20/min + 500/day** per user (`api_rate_limits`); response cache (`ai_response_cache`); usage logging (`ai_usage_log`); role gate. |
| `send-email` | Transactional email via Resend. | Role gate; server-side Resend key only. |
| `generate-embedding` | OpenAI embedding generation for RAG. | Role gate; server-side OpenAI key only. |

**Server-side secret boundary is correct here:** Anthropic, OpenAI, Resend, and `service_role` keys live only inside edge-function secrets, never in client bundles. (The mobile anon-key exposure in §8 is a *separate* issue — anon key only.)

---

## 5. Storage buckets (public/private)

| Bucket | Visibility | Notes |
|---|---|---|
| `inspection-photos` | **Private** | Resolved via short-lived signed URLs. |
| `tyre-photos` | **Private** | Resolved via signed URLs. |
| `accident-photos` | **Private** | Made private via migration; `photoUpload.ts` now returns a private `storageRef`. |

Access mechanics (`mobile/lib/storageRefs.ts`): uploads store a `tp-storage://<bucket>/<path>` reference, not a URL. `resolveStorageUrl()` mints a **15-minute** signed URL on demand. This is the correct pattern.

**Cleanup item (doc/comment only, not a code bug):** `mobile/lib/photoUpload.ts` (~line 70) still carries a stale comment describing the "public `accident-photos` bucket" and returning a "permanent public URL." The code path is private and ref-based; the comment must be corrected to avoid misleading future maintainers. The `recordQueue.ts` header comment (~line 11) similarly references "permanent public URLs" and should be corrected.

---

## 6. Duplicate data models & recommended canonical source

| Domain | Tables | Recommended canonical | Action |
|---|---|---|---|
| Fleet / assets | `vehicle_fleet` (canon) vs `fleet_master` (legacy) | **`vehicle_fleet`** | Build compatibility view, reconcile rows, migrate reads, then retire `fleet_master`. Do not delete in Phase 0. |
| Stock / inventory | `stock_records` + `stock_movements` (canon) vs `stock` (legacy) | **`stock_records` + ledger `stock_movements`** | Make the movement ledger authoritative; keep `stock` as read-compat until cutover. |
| Audit | `audit_log`, `audit_log_v2`, `inspection_audit_log`, `accident_audit_log` | **One consolidated event format** (see §10) | Define canonical schema; backfill; route all writes through it. |
| Embeddings | `tyre_record_embeddings`, `inspection_embeddings`, `document_chunks` | Domain-specific by design | Keep separate; standardise embedding pipeline. |

Detailed cutover sequencing belongs in `docs/DATA_MODEL_CONSOLIDATION_PLAN.md`; this audit only fixes the canonical decision.

---

## 7. Modules with business logic only in the frontend

These compose multi-table writes or financial/KPI logic on the client, with no transactional or server-side guarantee:

| Module | Location | Risk |
|---|---|---|
| Tyre change / exchange | `mobile/app/(app)/tyre-change.tsx`, `src/pages/TyreExchange.jsx`, `TyreLifecycle.jsx` | Remove → record reason/KM → fit replacement → adjust stock → audit is done as **separate frontend writes**; a failure mid-sequence leaves a half-finished state. Needs a single RPC/transaction. |
| Stock adjustments | `src/pages/StockManagement.jsx`, `StockReplenishment.jsx` | Totals editable client-side rather than derived from the ledger. |
| KPI computation | `src/lib/kpiEngine.js`, `analyticsEngine.js`, `aiAnalytics.js` | CPK, tyre life, failure-rate definitions live in client code; risk of divergent numbers across pages. Needs a central KPI definition source. |
| Offline record creation | `mobile/lib/recordQueue.ts` | Client supplies arbitrary `table` + payload to `supabase.from(table).insert` — see §8. |

---

## 8. Security-relevant findings (cross-reference: SECURITY_HARDENING_PLAN.md)

| # | Finding | Evidence | State |
|---|---|---|---|
| 1 | **Anon key hardcoded in mobile config** | `mobile/app.json` (`extra.supabaseAnonKey`), `mobile/eas.json` (all 3 profiles) | OPEN — move to EAS Secrets. Anon key is RLS-protected, but should not be committed. |
| 2 | **PWA caches authenticated data** | `vite.config.js` runtimeCaching: `/rest/` NetworkFirst 5min, `/auth/` NetworkFirst 60s, `/storage/` **CacheFirst 24h** | OPEN — stop caching authed REST/auth/private storage; clear caches on logout/account switch. |
| 3 | **`recordQueue` arbitrary-table writes** | `mobile/lib/recordQueue.ts` `enqueueRecord(table,payload)` → `supabase.from(table).insert(payload)` | OPEN — client chooses the table. Replace with typed offline commands. |
| 4 | **`hasPermission()` is UI-only** | `src/contexts/AuthContext.jsx` `ROLE_DEFAULTS` + `hasPermission()` | By design advisory; RLS must be the authority. Verify no table relies on UI gating. |
| 5 | **No org/site scope in RLS** | `organisations` table empty & unused; RLS scoped geographically via `profiles.site` (text) + `profiles.country` (text[]) | OPEN — cross-org isolation not enforced. |
| 6 | **No file-metadata table** | No `file_*` table exists; storage paths embedded in records | OPEN — add owner/org/entity/path metadata table for auditable file access. |

Already-mitigated controls (listed DONE in the security plan): AI model lock, in-memory idle timeout (30 min), generic auth errors (no user enumeration), bulk-upload DB CHECK constraints + client sanitisation, accident photos private + signed URLs, photo extension/size validation, AI per-user rate-limit + response cache + usage logging.

---

## 9. RLS policies and their risks

RLS is the real security boundary. Helper functions (`MIGRATIONS_V40_SECURITY_HARDENING.sql`, `V41_RLS_POLICY_CLEANUP.sql`, `BACKEND_RLS.sql`):

| Helper | Returns |
|---|---|
| `app_role()` | Current user's role from `profiles`. |
| `app_is_active()` | `approved === true && locked !== true`. |
| `app_is_elevated()` | role ∈ {admin, manager, director}. |
| `get_my_role()` | Raw role lookup. |

V41 dropped legacy broad `"Auth users full access"` policies on `tyre_records`, `stock_records`, `budgets`, `corrective_actions`, `rca_records`, `upload_history` — a real improvement.

**Risks:**
1. **No organisation scope.** RLS keys off role + geography (`site` text, `country` text[]) only. `organisations` is empty and not referenced in any policy. A user whose `country` array overlaps another org's data can read it. Multi-tenant isolation is effectively absent.
2. **`site` / `country` are loose text.** Free-text `site` and a `country` array make scope checks fragile and typo-sensitive.
3. **Mobile generic insert bypasses module intent.** With table-level RLS only, `recordQueue` can insert into any table the role can write — RLS may permit rows the UI never intended.
4. **No file-row authority.** Storage RLS guards buckets, but there is no DB record binding a file to an owner/org/entity, so file access can't be reasoned about per-record.
5. **Policy provenance is fragmented** across 48 SQL files (see §11), making it hard to prove the live policy set.

---

## 10. Modules with incomplete audit history, missing validation, or unsafe file access

**Incomplete / fragmented audit history:** writes land in four different audit tables with no shared schema. Many frontend-composed operations (tyre change, stock adjustment) have no guaranteed audit record because the audit write is just another optional client call. Target canonical event: `{ org_id, user_id, action, module, entity_type, entity_id, prev_value, new_value, device/ip, timestamp, source }`.

**Missing validation (server-side):** validation largely lives in React/RN forms. Server-side guarantees exist only where DB CHECK constraints were added (bulk upload). Tyre, inspection, stock, and accident writes rely on client validation that a direct Supabase call or `recordQueue` can bypass.

**Unsafe file access:** buckets are private and signed-URL based (good). The gap is the **absence of a file-metadata table** — file access cannot be audited or scoped per record/org. Plus the stale "public bucket" comments (§5).

**Missing org/site scope:** all operational modules (fleet, tyres, inspections, accidents, stock, work orders) lack organisation scope; site/country scope is text-based and unenforced at the data-model level.

---

## 11. SQL / migration sprawl

48 fragmented root SQL files: `MIGRATIONS_V1..V41`, plus `MASTER_MIGRATION.sql`, `MIGRATIONS_SAFE.sql`, `MIGRATIONS.sql`, `BACKEND_RLS.sql`, `MASTER_ENGINE.sql`, `SUPABASE_SCHEMA.sql`, `MIGRATION_ADMIN_PROFILES.sql`. There is no single ordered migration history, so the *live* schema and policy set cannot be reconstructed from one file. This is a maintainability and audit risk in its own right and complicates every RLS/data-model change.

---

## 12. Current mobile offline flow & failure scenarios

Mobile offline today is split across multiple queues:

| File | Role |
|---|---|
| `mobile/lib/offlineQueue.ts` | Inspection offline queue. |
| `mobile/lib/recordQueue.ts` | **Generic** queue: `saveRecord(table, payload)` → `supabase.from(table).insert`. |
| `mobile/lib/offlineCommands.ts` | Typed-command scaffolding (partial). |
| `mobile/lib/secureStorage.ts` | Encrypted local persistence for queues. |
| `mobile/lib/photoUpload.ts` | Photo upload → private storage ref. |

**Failure scenarios:**
1. **Arbitrary-table writes** — `recordQueue` trusts the client for the destination table (security + integrity risk).
2. **Multi-table operations are not atomic offline** — a tyre change queued as separate inserts can partially sync, leaving inconsistent state (no transaction across the queue).
3. **Photo/record ordering** — records may flush before their photos upload; the header comment's "upload before queuing" assumption breaks fully offline.
4. **No conflict resolution** — last-write-wins on flush; concurrent edits from another device are silently overwritten.
5. **No server-side validation on flush** — queued payloads bypass form validation when replayed directly to `from(table).insert`.

Target: replace generic `recordQueue` with **typed offline commands** (the client names an *intent*, never a table), validated and ideally executed via RPC on flush.

---

## 13. Current dashboard pages & duplicate user journeys

~78 web pages include heavily overlapping analytics and dashboard surfaces, producing menu clutter and duplicate journeys for the same task.

**Overlapping dashboard/KPI surfaces:**
`Dashboard.jsx`, `Analytics.jsx`, `AdvancedAnalytics.jsx`, `FleetAnalytics.jsx`, `FleetIntelligence.jsx`, `FleetHealthBoard.jsx`, `EngineeringKpi.jsx`, `KpiCommandCenter.jsx`, `KpiScorecard.jsx`, `ExecutiveReport.jsx`, `PerformanceBenchmark.jsx`, `LiveFleetStatus.jsx`.

**Overlapping AI surfaces:** `AiAnalytics.jsx`, `AiCommandCenter.jsx`, `FleetIntelligence.jsx`, `ForecastingEngine.jsx`, `PredictiveMaintenance.jsx`.

**Overlapping comparison surfaces:** `Comparison.jsx`, `CountryComparison.jsx`, `SiteComparison.jsx`, `BrandPerformance.jsx`, `PerformanceBenchmark.jsx`.

**Overlapping tyre-intelligence surfaces:** `PositionIntelligence.jsx`, `PressureIntelligence.jsx`, `TyreSizeAnalysis.jsx`, `Anomalies.jsx`, `RootCauseEngine.jsx`, `RcaRecords.jsx`.

**Duplicate journeys** (same job, multiple entry points): root-cause analysis (`RootCauseEngine` + `RcaRecords`), corrective actions (`CorrectiveActions` + inspection findings), budgeting (`Budgets` + `BudgetPlanner` + `CostCenter`), data upload (`UploadData` + `CustomData` + `ErpSync` + `DataCleaning`).

**Recommendation (UX, non-destructive):** consolidate into a small set of operational workspaces (Fleet, Tyres, Inspections, Workshop, Stock, Accidents, Intelligence, Admin) without removing functionality. Detailed plan in `docs/UX_NAVIGATION_PLAN.md`.

---

## 14. Audit conclusion

The platform is feature-rich but rests on a **single thin security layer (RLS) with no application boundary**, **no tenant/org isolation**, **fragmented data, audit, and migration models**, and a **client-trusted mobile offline path**. The mitigations already landed (private buckets + signed URLs, AI model lock + rate limiting, idle timeout, RLS cleanup, bulk-upload constraints) are real and correctly scoped. The remaining work is structural: introduce a service layer, make RLS organisation-aware, replace generic offline writes with typed commands, consolidate duplicate data/audit/dashboard surfaces, and harden client caching — all **in place** on the current React / Expo / Supabase stack.
