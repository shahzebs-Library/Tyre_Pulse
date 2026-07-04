# TyrePulse - Security Risk Register

> **Status:** Step 0 baseline. Maps the directive's security rules and audit
> findings to current reality. Severity: **C**ritical / **H**igh / **M**edium /
> **L**ow. Re-reviewed each migration phase.

## Already mitigated (recent hardening on this branch)
- **AI model lock** - `chat-ai` model fixed server-side; no client override.
- **Accident photos private** - moved off public `getPublicUrl` to a private
  bucket with signed URLs.
- **AI keys server-side only** - Anthropic/OpenAI/Resend keys live in Edge
  Function secrets; never in client bundles.
- **Idle timeout** - moved from tamperable `localStorage` to in-memory ref.
- **Auth error normalization** - generic login errors (no user enumeration).
- **Bulk-upload validation** - DB CHECK constraints + client sanitization on
  `tyre_records`.
- **AI cost controls** - per-user rate limiting + response cache + `ai_usage_log`.

### 2026-07-04 hardening pass (live, gated)
- **Profiles org isolation (V70)** — `profiles` SELECT policy was
  `auth.role()='authenticated'` (every signed-in user could read all orgs'
  profiles). Added RESTRICTIVE `profiles_org_isolation` (own row · org admin ·
  same org). Proven with a rolled-back two-tenant probe.
- **Scheduled-report tenant scoping (V71)** — `send-scheduled-reports` digest
  aggregated counts/spend across ALL orgs; now scoped to the schedule's
  `org_id` via the new service-role-only `report_org_tyre_spend` RPC.
- **Daily Ops print XSS** — DB fields in `printBriefing()` now HTML-escaped.
- **`useRealtimeAlerts`** — mark-read RPCs moved out of the state updater.
- **anon read re-verified** — impersonating `anon`, all sensitive tables return
  0 rows (RLS holds despite default table grants).
- **Search-filter injection** — `sanitizeSearchTerm` strips PostgREST `.or()`
  metacharacters from user search terms (9 sites) + the country value.
- **Import Center country isolation (V76/V77)** — commit + read gates.
- **Mobile offline idempotency (V81)** — `client_uuid` + UNIQUE dedup so a
  crash / lost response / overlapping sync can't double-insert.
- **No-email signup (V82)** — username + Employee ID only; synthetic auto-confirmed
  address; unique username/employee_id; `approved=false` admin gate retained.
- **CSP header** added (`vercel.json`) — non-breaking; `connect-src` self+supabase,
  `object-src none`, `frame-ancestors none`. Completes the secure-headers set
  (HSTS/X-Frame-Options/nosniff/Referrer/Permissions were already present).
- **Advisor:** `get_advisors(security)` → 0 ERROR-level findings.
- **Deferred (owner decision):** `get_email_by_identifier` reveals account
  existence (inherent to username/emp-code login); accepted as UX trade-off.

## Open risks

| ID | Risk | Sev | Current state | Required action | Phase |
|----|------|-----|---------------|-----------------|-------|
| R1 | Supabase anon key committed in `mobile/app.json` + `eas.json` | C | Anon key is RLS-protected but hardcoded in VCS-tracked config | Move to EAS Secrets (`eas secret:create`); rotate if history exposure matters | Now (user) |
| R2 | Authorization lives only in RLS / client | H | No server authz layer; client role defaults in `AuthContext` | Go API owns RBAC + scope; RLS = defense-in-depth | Step 1-2 |
| R3 | Mobile writes arbitrary tables | H | `recordQueue.saveRecord(table,payload)` → `supabase.from(table).insert` | Typed offline commands via API (ADR 0004) | Step 2 |
| R4 | PWA caches authenticated data | H | `vite.config.js` caches Supabase REST 5m / auth 60s / storage 24h | Stop caching authed REST/auth/private files; cache static assets only; clear on logout | Step 5 |
| R5 | No server-side input validation/workflow | H | Validation is client/RLS only; multi-table ops not transactional | API validates + runs workflow in DB transactions | Step 2+ |
| R6 | Duplicate master tables / source-of-truth ambiguity | M | `vehicle_fleet`/`fleet_master`, `stock_records`/`stock` | Canonical `assets`/inventory; deprecate legacy after reconcile | Step 2-3 |
| R7 | Fragmented migration history | M | 48 root SQL files (V1-V41 + MASTER_*) | Traceable goose history; consolidate canonical schema | Step 1+ |
| R8 | File MIME/size/extension/ownership checks ad hoc | M | Client-side checks; signed URLs partly in place | Centralize validation + signed URLs in storage provider (ADR 0003) | Step 2 |
| R9 | Audit fragmentation / mutability assurance | M | 4 audit tables, varied coverage | Append-only `api_audit_events` for API actions; immutable by policy | Step 1+ |
| R10 | Stock totals manually editable | M | `stock`/`stock_records` totals edited directly | Movement-ledger source of truth (`inventory_movements`) | Step 3 |
| R11 | Excel imported into live tables | M | Upload paths write toward live data | Controlled import batches with approval + rollback | Step 4 |
| R12 | No idempotency on mobile writes | M | Retries can double-apply | `Idempotency-Key` + `idempotency_keys` table | Step 1-2 |
| R13 | DB reachable with broad creds | M | App uses anon/RLS; service_role only in edge fns | Least-privilege DB roles for the API; DB not publicly exposed in prod | Step 2 / Phase C |
| R14 | Secrets sprawl / rotation | L | `.env.example` documents keys; edge secrets in dashboard | Central secret management + rotation runbook | Phase C |
| R15 | Backups not restore-tested | L | Supabase-managed backups | Add restore tests + storage backup to runbooks | Phase C |
| R16 | 2FA / step-up for admin actions | L | MFA supported (web); no fresh-session step-up for critical changes | Step-up confirmation for sensitive admin ops | Step 2+ |

## Directive security rules → coverage
No client secrets (✓ except R1); private file URLs (✓ inspections/accidents,
generalize R8); validate file uploads (R8); HTTPS in prod (deploy); secure
headers + CORS allow-list + rate limits (✓ API foundation); request ids +
structured logs, no secret logging (✓ foundation); immutable audit (R9);
least-privilege DB (R13); backup **restore** testing (R15); DB not public (R13);
AI must not write, logs usage, respects scope (✓ recommends-only + `ai_usage_log`).
