# TyrePulse — Current State Architecture

> **Status:** Step 0 baseline (as-built). This document describes the system **exactly as it exists today**, before the Go-backend migration. It is the reference point for every cutover in `docs/GO_BACKEND_MIGRATION_PLAN.md` and every risk in `docs/SECURITY_RISK_REGISTER.md`.
>
> **Verified:** 2026-06-29. Facts here are sourced from the live repository (`src/`, `mobile/`, `supabase/functions/`, root SQL files).

---

## 1. Executive Summary

TyrePulse is a fleet tyre-intelligence platform delivered as:

- A **React 19 + Vite** web dashboard (PWA).
- A **React Native 0.81.5 / Expo SDK 54** field mobile app.
- A **Supabase** backend: PostgreSQL, Auth (GoTrue), Storage, and Deno Edge Functions.

**The defining architectural characteristic of the current system is the absence of an application API layer.** Both clients talk **directly** to Supabase via the JS SDK (`supabase.from(...)`, `.rpc(...)`, `.storage`, `.auth`). All business authorization is enforced at the database edge through Postgres **Row-Level Security (RLS)** policies. Edge Functions exist only for privileged side-effects that must not run on the client (AI proxy, email, embeddings).

This model is functional and RLS-protected today, but it couples both clients to the physical schema, makes the database the only authorization boundary, and blocks server-owned workflow, validation, and idempotency. The migration target (`docs/TARGET_ARCHITECTURE.md`) introduces a **Go API** as the single write/authorization boundary.

---

## 2. Technology Stack

| Layer | Technology | Notes |
|---|---|---|
| Web framework | React 19 + Vite | SPA, `registerType: 'prompt'` PWA via `vite-plugin-pwa` |
| Web data access | `@supabase/supabase-js` v2 | `src/lib/supabase.js` is the single shared client |
| Web state/query | TanStack Query | `src/lib/queryClient.js` |
| Mobile framework | React Native 0.81.5 / Expo SDK 54 | Expo Router |
| Mobile data access | `@supabase/supabase-js` v2 | `mobile/lib/supabase.ts` |
| Mobile local storage | Expo SecureStore / AsyncStorage | offline queues |
| Database | Supabase PostgreSQL | 46 tables, RLS-enforced |
| Auth | Supabase Auth (GoTrue) + MFA (TOTP) | JWT bearer tokens |
| File storage | Supabase Storage | private buckets, signed URLs |
| Server compute | Supabase Edge Functions (Deno) | `chat-ai`, `send-email`, `generate-embedding` |
| AI | Anthropic (chat), OpenAI (embeddings) | keys server-side only |
| Email | Resend | key server-side only |

---

## 3. Data-Access Model: Direct Client Calls

There is **no `src/api/` or service API layer**. The web app contains **69 files** that call `supabase.from/rpc/storage/auth` directly; the mobile app has **~12** such call sites.

### 3.1 Shared web libraries (`src/lib/`)

| File | Responsibility |
|---|---|
| `supabase.js` | Single Supabase client instance (URL + anon key from `VITE_` env). |
| `fetchAll.js` | Range-based pagination helper to defeat the 1000-row PostgREST cap. |
| `ragService.js` | Retrieval over `knowledge_documents` / `document_chunks` for AI grounding. |
| `auditLogger.js` | Writes enriched audit rows to **`audit_log_v2`** (org_id, old/new, IP). |
| `auditDiff.js` | Computes old/new field diffs for audit entries. |
| `emailService.js` | Invokes the `send-email` Edge Function (Resend). |
| `storageRefs.js` | Resolves `tp-storage://bucket/path` refs to **1-hour signed URLs**. |
| `offlineQueue.js` | PWA inspection write queue (background sync). |
| `embeddingService.js` | Invokes `generate-embedding` Edge Function. |
| `aiRouter.js`, `agents/` | Classify requests and call the `chat-ai` Edge Function. |
| `kpiEngine.js`, `analyticsEngine.js`, `anomalyEngine.js`, `alertEngine.js` | Client-side KPI/analytics/anomaly/alert computation. |
| `countryFilter.js` | Applies the user's `country[]` scope to client queries. |
| `exportUtils.js` | Client-side Excel/PDF/PPTX generation (heavy bundle). |

### 3.2 Mobile libraries (`mobile/lib/`)

| File | Responsibility |
|---|---|
| `supabase.ts` | Single mobile Supabase client. |
| `offlineQueue.ts` | Inspection queue in AsyncStorage key `tp_inspection_queue_v1`. |
| `recordQueue.ts` | **Generic** offline queue: `saveRecord(table, payload)` inserts into an **arbitrary client-chosen table** (key `tp_record_queue_v1`). See §7.2 and the Security Register. |
| `photoUpload.ts` | Uploads to **private** buckets; returns `storageRef` + signed URLs (accident-photos bucket is now private). |
| `storageRefs.ts` | Mobile equivalent of `tp-storage://` ref resolution. |
| `secureStorage.ts` | SecureStore-backed persistence for queues/tokens. |
| `permissions.ts` | Client-side role/permission helpers (advisory, not security). |
| `accidentPdf.ts`, `tyreConditions.ts`, `tyreLookup.ts`, `auditDiff.ts` | Domain helpers. |

---

## 4. Module → Table Map

| Module | Primary tables | Notes |
|---|---|---|
| Identity / Users | `profiles`, `module_permissions` | `profiles` carries `role`, `approved`, `locked`, `site`, `country[]`. |
| Organisation / Scope | `organisations`, `sites` | `organisations` **exists but has 0 rows** and is **not wired into RLS**; scoping is geographic (`site` + `country[]`). |
| Assets / Fleet | `vehicle_fleet` (canonical), `fleet_master` (legacy) | Duplicate masters — see §5. |
| Tyres | `tyre_records`, `tyre_specifications`*, `tyre_rotations`* | `*` = newer tables. |
| Inspections | `inspections`, `inspection_schedules`*, `inspection_audit_log` | Tyre data stored as **JSONB `tyre_conditions`** (GIN-indexed). |
| Stock / Inventory | `stock_records` (canonical), `stock_movements` (append-only audit), `stock` (legacy) | See §5. |
| Work Orders | `work_orders` | |
| Accidents | `accidents`, `accident_parts`, `accident_remarks`, `accident_audit_log` | Structured children (not JSONB). |
| RCA | `rca_records`, `corrective_actions` | |
| Procurement | `purchase_orders`, `gate_passes` | |
| Warranty / Recalls | `warranty_claims`*, `recalls`* | Newer modules. |
| Suppliers | `supplier_ratings`*, `supplier_contracts`* | |
| Budgets / Cost | `budgets` | |
| Alerts / Notifications | `alerts`, `alert_thresholds`, `notifications` | |
| Reports | `report_schedules` | |
| AI / Knowledge | `ai_response_cache`, `ai_usage_log`, `knowledge_documents`, `document_chunks` | RAG corpus + cost log. |
| Audit | `audit_log` (v1), `audit_log_v2` (enriched), `inspection_audit_log`, `accident_audit_log` | **Four** audit surfaces — see §5. |
| Uploads | `pending_uploads` | |
| Config | `system_config` | |

> Total: **46 tables**. `*` marks recently added modules now persisting to the database.

---

## 5. Duplicate / Overlapping Tables (Source-of-Truth Ambiguity)

| Domain | Canonical (keep) | Legacy / overlapping | Origin files | Resolution |
|---|---|---|---|---|
| Assets / fleet | `vehicle_fleet` | `fleet_master` | `MASTER_MIGRATION.sql` (canon) vs `MIGRATIONS_SAFE.sql` (legacy) | Migrate both → canonical `assets` (target). |
| Stock | `stock_records` + `stock_movements` (append-only) | `stock` | `MASTER_MIGRATION.sql` (canon) vs `MIGRATIONS_SAFE.sql` (legacy) | Migrate → `items` / `inventory_movements` / `inventory_balances`. |
| Audit | `audit_log_v2` (enriched: org_id, old/new, ip) | `audit_log` (v1), `inspection_audit_log`, `accident_audit_log` | Multiple | Consolidate → single immutable `audit_events`. |

Detailed transform, dedupe keys, and reconciliation are in `docs/LEGACY_DATA_MAPPING.md`.

---

## 6. Authentication & Authorization Flow

### 6.1 Client (web) — `src/contexts/AuthContext.jsx`

1. Sign-in via Supabase Auth → JWT.
2. On session load, three parallel calls:
   - `profiles` select (`id, full_name, username, role, email, employee_id, site, country, approved, locked, created_at`)
   - `supabase.rpc('get_user_module_permissions')`
   - `supabase.auth.mfa.listFactors()`
3. **Client-side enforcement (advisory only):**
   - Immediately blocks if `locked === true` or `approved === false`.
   - **MFA**: checks `getAuthenticatorAssuranceLevel()`; returns `{ mfaRequired: true }` until satisfied.
   - **30-minute in-memory idle timeout** (`IDLE_MS = 30 * 60 * 1000`).
4. **Hardcoded `ROLE_DEFAULTS`** map (Admin / Manager / Director / Inspector / Tyre Man / Reporter / Driver) provides default module visibility. This is **UX gating, not a security control** — see Security Register.

### 6.2 Real authorization boundary — Postgres RLS

All enforcement that matters happens in RLS policies (V40/V41 hardening). Helper functions:

| Helper | Meaning |
|---|---|
| `app_role()` | Current user's role from `profiles`. |
| `app_is_active()` | `approved === true && locked !== true`. |
| `app_is_elevated()` | role ∈ {admin, manager, director}. |
| `get_my_role()` | Hardened role accessor (V40/V41). |

**Scope is geographic, not organisational:** policies filter on `site` and `country[]` columns on `profiles`. `organisations` exists but is **empty and not referenced by RLS**.

### 6.3 Edge Function authorization — `supabase/functions/_shared/auth.ts`

`requireApprovedRole(req, allowedRoles)`:
1. Extracts `Bearer` token; 401 if missing.
2. Creates a per-request Supabase client bound to the caller's token.
3. `auth.getUser(token)` → 401 on invalid session.
4. Loads `profiles(id, role, approved, locked)`; 403 if missing.
5. 403 if `approved === false` **or** `locked === true`.
6. Normalises role and 403 if not in `allowedRoles`.

CORS is origin-allowlisted (`ALLOWED_ORIGINS` env, default `tyrepulse.app` + localhost). This server-side gate is the model the Go API will generalise.

---

## 7. File-Upload & Storage Flow

### 7.1 Storage reference model — `src/lib/storageRefs.js` / `mobile/lib/storageRefs.ts`

- Files are stored in **private** Supabase Storage buckets.
- The database persists an **opaque reference** `tp-storage://<bucket>/<path>`, never a public URL.
- `resolveStorageUrl(value)`:
  - Pass-through for already-resolved `http`/`data:`/`blob:` values.
  - For a `tp-storage://` ref, calls `storage.from(bucket).createSignedUrl(path, 3600)` → **1-hour** signed URL.
  - Returns `null` (and warns) on failure.
- `resolveStorageUrls()` batches and filters nulls.

### 7.2 Mobile upload — `mobile/lib/photoUpload.ts`

- Uploads to private buckets; persists `storageRef` + returns signed URLs.
- **Accident-photos bucket is now private** (previously public via `getPublicUrl()` — fixed).

> **Gap:** server-side MIME/size validation is not enforced; uploads are validated client-side only. Tracked in the Security Register.

---

## 8. Mobile Offline Flow

| Queue | Storage key | Mechanism |
|---|---|---|
| Inspections | `tp_inspection_queue_v1` (AsyncStorage) | `mobile/lib/offlineQueue.ts` — submit-or-queue, auto-flush on reconnect. |
| Generic records | `tp_record_queue_v1` (SecureStore) | `mobile/lib/recordQueue.ts` — `saveRecord(table, payload)` tries `supabase.from(table).insert(payload)` immediately; on any error enqueues and retries on sync. |
| PWA inspections (web) | Workbox background sync | `src/lib/offlineQueue.js` — POST queued `NetworkOnly` + background sync. |

**Critical issue:** `recordQueue.ts` lets the **client choose the destination table** (`saveRecord(table, …)`), and `syncRecordQueue()` replays `supabase.from(item.table).insert(item.payload)`. A mobile client must never decide which table to write to. The Go API replaces this with typed, server-routed commands. See Security Register **R-03**.

---

## 9. Edge Functions (`supabase/functions/`, Deno)

| Function | Purpose | Controls |
|---|---|---|
| `chat-ai` | Anthropic proxy. | Model **locked** to `claude-haiku-4-5-20251001`; rate limit **20/min + 500/day**; **5-min** response cache (`ai_response_cache`); usage logged to `ai_usage_log`; `requireApprovedRole`. |
| `send-email` | Resend transactional email. | `requireApprovedRole`; Resend key server-side only. |
| `generate-embedding` | OpenAI `text-embedding-3-small`. | `requireApprovedRole`; OpenAI key server-side only. |
| `_shared/auth.ts` | Shared CORS + `requireApprovedRole`. | See §6.3. |

All AI/email/embedding provider keys live **only** in Edge Function environment — never shipped to clients.

---

## 10. Secrets Handling

| Secret | Location | Status |
|---|---|---|
| Supabase URL | `VITE_SUPABASE_URL` (web), `EXPO_PUBLIC_SUPABASE_URL` (mobile) | OK (public). |
| Supabase **anon** key | `VITE_SUPABASE_ANON_KEY`; **hardcoded in `mobile/app.json` and `mobile/eas.json`** | Public by design (RLS-protected) but **should be EAS Secrets** — **OPEN**, R-01. |
| Supabase **service_role** key | Edge Function env only | Correct — never client-exposed. |
| Anthropic / OpenAI / Resend keys | Edge Function env only | Correct. |

`.env.example` documents `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.

---

## 11. PWA Caching Rules (`vite.config.js`, Workbox)

| Pattern | Strategy | TTL | Concern |
|---|---|---|---|
| `*.supabase.co/rest/*` | NetworkFirst | 5 min | **Caches authenticated REST/user data** in a generic browser cache. |
| `*.supabase.co/auth/*` | NetworkFirst | 60 s | Caches auth responses. |
| `*.supabase.co/storage/*` | CacheFirst | 24 h | Caches (signed) storage objects. |
| POST inspections | NetworkOnly + background sync | — | Correct for offline writes. |

`registerType: 'prompt'`, large-bundle allowance raised above the 2 MB Workbox default. **Caching authenticated REST/auth/user data in a shared cache is a confidentiality risk** — Security Register **R-02**.

---

## 12. Database Migration History

- **48 fragmented root SQL files**: `MIGRATIONS_V1` … `MIGRATIONS_V41` plus `MASTER_MIGRATION.sql` (**canonical, 1039 lines**), `MASTER_ENGINE.sql`, `MIGRATIONS_SAFE.sql`, `BACKEND_RLS.sql`, `SUPABASE_SCHEMA.sql`, `MIGRATION_ADMIN_PROFILES.sql`.
- No single linear, traceable migration chain. `MASTER_MIGRATION.sql` is the canonical schema; `MIGRATIONS_SAFE.sql` carries legacy variants.
- V40 (`MIGRATIONS_V40_SECURITY_HARDENING.sql`) and V41 (`MIGRATIONS_V41_RLS_POLICY_CLEANUP.sql`) hardened RLS helpers and policies.
- Consolidation into one ordered, version-controlled migration set is a Step-1 prerequisite — Security Register **R-06**.

---

## 13. External Services

| Service | Used by | Key location |
|---|---|---|
| Supabase (PG/Auth/Storage/Edge) | Web + Mobile | URL/anon public; service_role server-only. |
| Anthropic | `chat-ai` | Edge env. |
| OpenAI | `generate-embedding` | Edge env. |
| Resend | `send-email` | Edge env. |

---

## 14. Architectural Risks (Summary)

1. **No API boundary** — clients are coupled to the physical schema; the database is the only authorization layer.
2. **Client decides write targets** (`recordQueue.ts` arbitrary tables).
3. **Authenticated data cached** by the PWA service worker.
4. **Source-of-truth ambiguity** across duplicate masters and four audit logs.
5. **Fragmented migration history** (48 files).
6. **No server-side upload validation** (MIME/size).
7. **Multi-tenancy not enforced** — `organisations` empty and unused; scope is geographic text columns.

Each maps to a mitigation in `docs/SECURITY_RISK_REGISTER.md` and a cutover in `docs/GO_BACKEND_MIGRATION_PLAN.md`.
