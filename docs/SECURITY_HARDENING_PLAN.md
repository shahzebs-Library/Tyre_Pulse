# Security Hardening Plan - TyrePulse

**Phase 0 - read-only plan. Companion to `CURRENT_SYSTEM_AUDIT.md` and `PRODUCT_GAP_REGISTER.md`.**

This plan hardens the *existing* TyrePulse stack in place - Vite/React 19 web, Expo SDK 54 / RN 0.81.5 mobile, Supabase (Postgres + GoTrue Auth + Storage + Deno Edge Functions). It maps the directive's security rules and the 10 confirmed issues to current reality, records what is already mitigated, and defines required actions by phase. No re-platforming, no new backend.

**Phase legend:** P1 Security & platform foundation · P2 Data-model/audit consolidation · P3 Lifecycle/structured data · P5 Mobile offline hardening · P6 Release/perf hardening.

---

## 1. Security posture summary

The entire security boundary today is **Postgres RLS plus three role-gated edge functions**. There is no application API layer, so RLS *must* be correct and complete. Recent work materially improved posture (private buckets + signed URLs, AI model lock + rate limiting, idle timeout, RLS broad-policy cleanup, bulk-upload constraints, generic auth errors). The remaining structural risks are **absence of organisation isolation**, **client-trusted mobile writes**, **authenticated-data caching in the PWA**, and **no per-file metadata/authority**.

**Secret boundary (correct today):** Anthropic, OpenAI, Resend, and `service_role` keys live only in edge-function secrets (`supabase/functions/`). Clients hold only the public Supabase URL + anon key. The one exposure is the anon key being *committed* into mobile config (S-01) - RLS-protected, but it must not live in VCS.

---

## 2. Directive security rules → current reality

| Directive rule | Current reality | Status |
|---|---|---|
| Never expose service-role/AI/email/storage/DB secrets to web/mobile | Only in edge-function secrets; clients hold URL + anon key | MET (except anon key committed - S-01) |
| No public URLs for accident/inspection/warranty/vehicle/report files | All three buckets private; `tp-storage://` refs → 15-min signed URLs | MET (comment cleanup pending - S-08) |
| Don't trust hidden buttons as access control | `hasPermission()` is UI-only; RLS is authority | MET in principle - must verify RLS on every table (S-04) |
| RLS must enforce tenant isolation, org scope, roles, private storage, correct writes | Role + geographic scope present; **org isolation absent**; `organisations` empty | PARTIAL - S-05 |
| Validate file ext/MIME/size/path/uploader; collision-resistant paths; file metadata record | ext/size validated; collision-resistant paths; **no file-metadata table** | PARTIAL - S-06 |
| PWA must not cache auth/authed REST/private files; clear cache on logout | Caches `/rest/`, `/auth/`, `/storage/`; no logout clear | NOT MET - S-02 |
| Mobile clients must not choose DB table names | `recordQueue` passes arbitrary `table` to `insert` | NOT MET - S-03 |
| Confirm VITE/EXPO_PUBLIC vars hold only public URL + anon key; add startup checks | `.env.example` uses `VITE_SUPABASE_URL`/`ANON_KEY`; anon key committed in mobile; no startup secret check | PARTIAL - S-01, S-07 |
| One consistent audit event format | Four audit tables, no shared schema | NOT MET - S-09 |

---

## 3. The 10 confirmed issues → mapping

| # (directive) | Issue | Maps to | Phase |
|---|---|---|---|
| 1 | ~276 web / ~86 mobile direct Supabase calls | Service layer `src/lib/api/*` (foundation for all controls) | P1 |
| 2 | `AuthContext` frontend role defaults = visibility only | S-04 (RLS authority) | P1 |
| 3 | `recordQueue` arbitrary-table inserts | S-03 (typed offline commands) | P1→P5 |
| 4 | `photoUpload` accident photos → public URL | S-08 (**code RESOLVED**, comment cleanup) | P1 |
| 5 | PWA caches REST/Auth/Storage | S-02 (cache hardening + logout clear) | P1 |
| 6 | Duplicate data sources (fleet/stock/audit) | Consolidation + S-09 audit format | P2 |
| 7 | JSON where structured reporting needed | Structured inspection/tyre data | P3 |
| 8 | Overlapping web pages | UX consolidation (see UX plan) | P6 |
| 9 | Heavy export libs eager-loaded | Lazy-load exports | P6 |
| 10 | RLS review for isolation/org/roles/storage/writes | S-05, S-04, S-06 | P1→P2 |

---

## 4. Remediation table

| ID | Risk | Severity | Current state | Already mitigated? | Required action | Phase |
|---|---|---|---|---|---|---|
| **S-01** | Anon key committed in mobile config | Critical | Anon key hardcoded in `mobile/app.json` (`extra.supabaseAnonKey`) and `mobile/eas.json` (3 build profiles); RLS-protected but in VCS | No | Move to **EAS Secrets** / build-time `EXPO_PUBLIC_SUPABASE_ANON_KEY`; remove literals from committed files; rotate key; document. Confirm only URL + anon key ever reach the client | P1 |
| **S-02** | PWA caches authenticated data; no logout clear | Critical | `vite.config.js` runtimeCaching: `/rest/` NetworkFirst 5min, `/auth/` NetworkFirst 60s, `/storage/` **CacheFirst 24h** | No | Cache only app shell, icons, fonts, safe static assets. **Remove** caching of `/rest/`, `/auth/`, `/storage/`. Clear all user-scoped caches + service-worker caches on logout and on account switch so a new user never sees prior cached data/files | P1 |
| **S-03** | Mobile client chooses DB table & payload | Critical | `mobile/lib/recordQueue.ts` `saveRecord(table,payload)` → `supabase.from(table).insert(payload)`; flush replays raw payloads | No | Replace with **typed offline commands** (`offlineCommands.ts`): client emits an *intent* (e.g. `submitTyreChange`), never a table name. Validate on flush; route critical multi-table ops through RPC. Retire generic `recordQueue` | P1→P5 |
| **S-04** | UI permission mistaken for security | Critical | `src/contexts/AuthContext.jsx` `ROLE_DEFAULTS` + `hasPermission()` (UI guard) + `rpc get_user_module_permissions`; RLS helpers `app_role()`/`app_is_active()`/`app_is_elevated()`/`get_my_role()` | Partial (V41 dropped broad "full access" policies) | Audit **every** table to confirm RLS read/write authority independent of UI. Keep `hasPermission` strictly as UI guard. Store real module permissions server-side. Add automated access tests for Admin, Manager, Director, Inspector, Tyre Man, Reporter, Driver | P1 |
| **S-05** | No organisation isolation in RLS (cross-org access) | Critical | `organisations` table EXISTS but 0 rows and **not referenced in any policy**; scope is geographic only - `profiles.site` (text) + `profiles.country` (text[]); overlapping country/site can expose another org's data | No | Add `org_id` to operational tables; backfill from geography; make RLS org-aware (every operational policy filters by caller's org). Prevent access via URL/payload/browser-state tampering. Normalise loose `site`/`country` to referenced dimensions. Add cross-org isolation tests | P1→P2 |
| **S-06** | No file-metadata table; file access not auditable/scopable | Critical | Buckets private + signed URLs, but no DB record binds a file to owner/org/entity; storage paths embedded ad hoc in records | Partial (storage RLS + signed URLs) | Add **file-metadata table** (owner, organisation, entity_type, entity_id, bucket, storage_path, file_type, uploaded_at). Store only bucket + path in records. Issue signed URLs only after authorising the requester against the metadata row. Add test proving one org cannot access another org's files | P1→P2 |
| **S-07** | No startup secret/env validation | High | `.env.example` uses `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`; no guard prevents a secret key in `VITE_*`/`EXPO_PUBLIC_*` | No | Add startup checks (web + mobile) asserting only public URL + anon key are present and that no service-role/AI/email pattern appears in client env. Add developer docs. Block local shortcuts that put secret keys in browser/Expo vars | P1 |
| **S-08** | Stale "public bucket / public URL" comments | Medium | Code path is private + ref-based, but `mobile/lib/photoUpload.ts` (~L70) and `recordQueue.ts` (~L11) comments still describe public buckets/permanent public URLs | Code **RESOLVED**; comments not | Correct comments to reflect private `storageRef` + signed-URL model. Documentation-only cleanup; no code-path change | P1 |
| **S-09** | Fragmented audit; no canonical event format | High | Four audit tables (`audit_log`, `audit_log_v2`, `inspection_audit_log`, `accident_audit_log`); some business actions have no guaranteed audit (audit is an optional client write) | No | Define canonical audit event `{org_id, user_id, action, module, entity_type, entity_id, prev_value, new_value, device/ip, timestamp, source}`. Route all writes through it (ideally server-side/trigger so it can't be skipped). Backfill; consolidate legacy tables | P2 |
| **S-10** | SQL/migration sprawl obscures live policy set | Medium | 48 root SQL files (`MIGRATIONS_V1..V41` + `MASTER_MIGRATION` + `MIGRATIONS_SAFE` + `BACKEND_RLS` + more); no single ordered history | No | Consolidate into ordered `supabase/migrations`; snapshot the live schema + RLS policy set so the effective security configuration is provable from one source | P2 |

---

## 5. Already-mitigated controls (DONE - recent work on this branch)

Retained for traceability; do not re-implement.

| Control | Where | Effect |
|---|---|---|
| AI model lock | `supabase/functions/chat-ai` (`claude-haiku-4-5-20251001`) | Prevents model override / cost-tier escalation |
| AI per-user rate limit | `chat-ai`, `api_rate_limits` (20/min + 500/day) | Abuse / cost protection |
| AI response cache + usage logging | `ai_response_cache`, `ai_usage_log` | Cost control + auditability |
| Edge-function role gate | `_shared/auth.ts → requireApprovedRole` | Blocks unapproved/locked accounts; origin allowlist |
| In-memory idle timeout (30 min) + MFA | `src/contexts/AuthContext.jsx` | Limits unattended-session exposure |
| Generic auth errors | auth flows | No user enumeration |
| Bulk-upload DB CHECK constraints + client sanitisation | bulk upload path | Server-side data integrity on import |
| Accident photos private + signed URLs | `accident-photos` bucket, `photoUpload.ts`, `storageRefs.ts` | No permanent public links to accident imagery |
| Photo extension/size validation | `photoUpload.ts` (`ALLOWED_EXTS`, `MAX_PHOTO_BYTES`), collision-resistant paths | Rejects unsafe/oversized uploads |
| RLS broad-policy cleanup | `MIGRATIONS_V41_RLS_POLICY_CLEANUP.sql` | Dropped legacy "Auth users full access" policies |

---

## 6. Storage & file access model (target state)

Current (correct, keep): private buckets `inspection-photos`, `tyre-photos`, `accident-photos`; uploads return `tp-storage://<bucket>/<path>`; `resolveStorageUrl()` mints 15-min signed URLs on demand (`mobile/lib/storageRefs.ts`).

Add to close S-06:
1. **File-metadata table** binding each file to owner + organisation + entity_type + entity_id + bucket + path + type + uploaded_at.
2. Signed-URL issuance authorises the requester against the metadata row **and** org scope before minting.
3. Records store only bucket + path (never URLs); validate ext, MIME, size, path, and uploader on write.
4. Cross-org file-access test in the suite.

---

## 7. Permission architecture (target state)

- Keep existing role names (Admin, Manager, Director, Inspector, Tyre Man, Reporter, Driver) for compatibility.
- Store **real module permissions in the database**; `rpc get_user_module_permissions` feeds the UI only.
- `hasPermission()` is and remains a **UI guard** - RLS is the sole authority for reads/writes.
- Every operational policy enforces **role + organisation + site** scope.
- Users cannot reach another org's records by editing a URL, payload, or browser/local state.
- Automated tests cover all seven roles plus cross-org isolation, run in CI before each phase merge.

---

## 8. Sequencing & guardrails

**P1 (foundation):** S-01, S-02, S-04, S-07, S-08; stand up `src/lib/api/*`; begin S-03 (typed commands) and S-06 (file metadata) groundwork.
**P2:** S-05 (org-aware RLS), S-06 completion, S-09 (audit format), S-10 (migration consolidation); canonical fleet/stock cutover.
**P3:** structured inspection/tyre data + transactional tyre-change RPC (removes the half-finished-state risk).
**P5:** complete S-03 (retire generic `recordQueue`), offline conflict handling.
**P6:** lazy-load exports, PWA shell-only cache verification, release hardening.

**Guardrails (non-negotiable):** no destructive DB change without backward-compatible migration + reconciliation + rollback + tests; no secret in client env; no public URLs for business files; small, phase-scoped commits; web build, web tests, and mobile TypeScript checks must pass after every phase.
