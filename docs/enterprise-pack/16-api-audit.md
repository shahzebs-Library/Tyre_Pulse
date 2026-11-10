# 16. API Audit

| Field | Value |
|---|---|
| Deliverable | 16 of 29 |
| Date | 2026-11-10 |
| Status | Partly built. 18 edge functions, ~1,143 public SQL functions, PostgREST table access under RLS, a versioned read-only public API and an outbound webhook pipe all exist. No API contract versioning beyond `/v1`, no edge-function typecheck in CI, and one live regression of the 40001 retry-loop rule. |
| Evidence | Edge-function inventory, secrets and callers verified in code (`supabase/functions/*`, `supabase/config.toml`, `src/lib/engineeringCenter.js`). RPC counts, anon allowlist, cron, webhook and consumer figures measured live on project jhssdmeruxtrlqnwfksc on 2026-11-10 (read-only catalog queries). verify_jwt modes for functions not listed in `config.toml` are taken from PROJECT_MEMORY. |
| Related docs | [17 Security audit](17-security-audit.md), [18 Tenant isolation](18-tenant-isolation-review.md), [21 Monitoring](21-monitoring-and-support-design.md), `docs/API_CONTRACT_STRATEGY.md`, `docs/EDGE_FUNCTION_PRODUCTION_MATRIX_2026-08-30.md` (stale: predates sign-in, qr-login, tenant-export, sentry-*) |

## 1. API surfaces at a glance

| Surface | What it is | Auth boundary | Count (2026-11-10) |
|---|---|---|---|
| PostgREST tables | Direct `supabase.from(table)` reads/writes from web, Expo and Flutter | RLS (org RESTRICTIVE + country + site + role/capability) | 479 public tables |
| PostgREST RPC | `supabase.rpc(fn)` | SECURITY DEFINER fns re-check org/country/site in body; INVOKER fns inherit RLS | 734 DEFINER + 409 INVOKER (live) |
| Edge functions | Deno functions under `supabase/functions` | Gateway JWT and/or in-code checks, cron/shared secrets, Stripe signature, API key | 18 |
| Public API | `public-api` edge fn, `/public-api/v1/<resource>` | Hashed API key + per-org scope + rate limit | 0 API keys issued (live) |
| Outbound webhooks | `domain_events` to `consume_event_webhooks` to `webhook_deliveries` to cron `deliver-webhooks` (every minute) | Per-subscription signing (V99) | 2 subscriptions, 12 deliveries (live) |
| Marketing API | `marketing/app/api/contact` (Next.js route) | Same-site check, content-type 415, 16 KB cap, per-IP throttle | 1 route |

Correction to the brief and to older docs: the platform DOES have outbound webhooks (V99, `20260930181000_webhook_delivery_admin.sql`) and the public API IS path-versioned (`/v1`). What is missing is a versioning POLICY, not the prefix.

## 2. Edge function inventory

verify_jwt: "false" means the gateway lets the request through and the function authenticates itself. Every self-validating function is deployed `verify_jwt=false` on purpose so its CORS-wrapped 401/403 JSON is readable by the browser (PROJECT_MEMORY 2026-07-20, the send-email "edge function missing" incident).

| Function | Purpose | verify_jwt | Auth in code | Secrets read (Deno.env) | Callers |
|---|---|---|---|---|---|
| account-recovery | Self-service recovery, contact enrollment | false (config.toml) | enumeration-safe public path; bearer check for enrollment | RECOVERY_HMAC_SECRET, RESEND_API_KEY, RECOVERY_EMAIL_FROM/FROM_EMAIL, TWILIO_*, APP_URL | `src/lib/accountRecovery.js` |
| admin-revoke-sessions | Sign a user out everywhere | false (memory) | getUser + is_super_admin | SUPABASE_ANON_KEY, SERVICE_ROLE | `src/lib/api/sessionRevocation.js` |
| ai-orchestrator | Multi-agent AI routing | false | requireApprovedRole | ANTHROPIC_API_KEY, OPENAI_API_KEY, AI_RATE_LIMIT_* | `src/lib/aiOrchestratorClient.js` |
| ai-tyre-inspection | Photo analysis worker + admin retry | false (config.toml) | AI_WORKER_SECRET for cron, getUser for users | AI_PROVIDER_KEY, ANTHROPIC_API_KEY, AI_MODEL, AI_FALLBACK_MODEL, AI_ALLOWED_ORIGIN | `src/lib/api/aiTyreInspection.js`, cron `ai-tyre-inspection-worker` */5 |
| billing-checkout | Stripe checkout session | false | requireApprovedRole | STRIPE_SECRET_KEY, APP_URL | `src/lib/api/billing.js` |
| billing-webhook | Stripe events | false | stripe-signature verified | STRIPE_WEBHOOK_SECRET | Stripe only |
| chat-ai | Assistant answers + DB tools | false | requireApprovedRole + system_config AI gates | ANTHROPIC_API_KEY, AI_CACHE_TTL_SECONDS, AI_RATE_LIMIT_* | 7 call sites (`src/lib/agents/index.js`, `askData.js`, `uploads.js`) |
| embed-worker | Background embedding | false | x-cron-secret | OPENAI_API_KEY | cron `embed-knowledge-documents` */10 |
| generate-embedding | Embed one document | true (memory, v15) | requireApprovedRole | OPENAI_API_KEY | `src/lib/embeddingService.js` |
| public-api | External read API | false | sha256 API key lookup, expiry, per-key rate limit | SERVICE_ROLE only | none in repo (customers) |
| qr-login | Finish QR sign-in | false | one-time browser secret + number matching | ALLOWED_ORIGINS | `src/lib/api/loginShowcase.js`, Flutter `qr_login.dart` |
| send-email | Report/case email | false (v13+) | requireApprovedRole(admin,manager,director) | RESEND_API_KEY, FROM_EMAIL | `src/lib/emailService.js`, `Inspections.jsx` |
| send-scheduled-reports | Scheduled + "Send now" reports | false (memory: v21 deployed --no-verify-jwt, dual mode) | x-cron-secret or user JWT + role | RESEND_API_KEY, FROM_EMAIL, APP_URL, ALLOWED_ORIGINS | `ScheduledReports.jsx`, cron */15 |
| sentry-crash-alert | Fatal crash alert | false | x-cron-secret | RESEND_API_KEY, FROM_EMAIL (Sentry token from `cron_config`) | cron */15 |
| sentry-issues | Crash console proxy | false | getUser + is_super_admin | Sentry token read from `cron_config` via service role | `src/lib/api/sentryCrashes.js` |
| sign-in | Username sign-in for real-email accounts | false (memory) | rate-limited, never returns the email | SUPABASE_SECRET_KEYS / SB_SECRET_KEY, ALLOWED_ORIGINS, AUTH_FORWARD_CLIENT_IP | `src/lib/api/loginGuard.js`, Flutter `auth_repository.dart` |
| tenant-export | Server-side tenant dump to private bucket | false (memory v3) | getUser + is_super_admin, or x-cron-secret for cleanup | SERVICE_ROLE | `src/lib/api/tenantExport.js`, cron `tenant-export-retention` |
| workflow-notify | Email/push/WhatsApp fan-out | false (v2+) | MANDATORY x-workflow-secret (env or `cron_config.workflow_notify_secret`), never fails open | RESEND_API_KEY, TWILIO_*, FIREBASE_SERVICE_ACCOUNT, WORKFLOW_NOTIFY_SECRET | cron `deliver-workflow-notifications` every minute |

Shared code: `supabase/functions/_shared/auth.ts` (CORS allowlist + `requireApprovedRole`). Some functions deploy as one self-contained file (workflow-notify, send-scheduled-reports); PROJECT_MEMORY records that hand-inlining the 1,300-line `send-scheduled-reports` for an MCP deploy is a transcription risk and must be followed by a byte diff against the repo.

### Edge-function findings

| # | Finding | Severity | Status |
|---|---|---|---|
| E1 | No typecheck or test of edge functions in CI (`.github/workflows/ci.yml` has no `deno check`). 13+ production functions handle billing, email, AI and push. | High | Open |
| E2 | Deployed-vs-repo drift is checked only by hand (download + diff). Several past sessions found drift (chat-ai, workflow-notify). | Medium | Open |
| E3 | `send-scheduled-reports` workshop digest: the 2026-07-20 "not redeployed" note was CLOSED on 2026-09-23 (deployed == repo byte for byte, later v21). Older docs that still list it as pending are stale. | Info | Closed |
| E4 | `send-email` has no recipient allowlist or per-user rate limit (insider brand-domain relay risk, MEDIUM per 2026-07-19 audit). | Medium | Open |
| E5 | `public-api` exists with 0 keys issued: unused, but reachable. Keep, or gate behind a flag until the first customer. | Low | Decision |
| E6 | Raw provider error text can surface from send-email/generate-embedding (2026-07-19 audit). | Low | Open |

## 3. RPC surface

| Metric (live 2026-11-10) | Value |
|---|---|
| SECURITY DEFINER functions in `public` | 734 |
| INVOKER functions in `public` | 409 |
| Functions with `plan_cache_mode = force_custom_plan` | 91 |
| Functions raising/handling PT409 | 17 |
| Functions still referencing ERRCODE 40001 | 3 (see R1) |
| Anon-executable DEFINER functions | 16 |

### Anon allowlist

The intended list (V500, extended by V587/qr-login/password-reset work) is the pre-auth and public-token surface. Live it is 16:

`get_accident_portal_snapshot`, `get_display_snapshot`, `get_email_by_identifier`, `get_login_showcase`, `get_public_config`, `get_report_snapshot`, `get_report_tyre_maintenance`, `get_workshop_snapshot`, `log_client_error`, `login_attempt_status`, `qr_login_start`, `qr_login_status`, `record_login_failure`, `request_password_reset`, `reset_login_attempts`, `tyre_one_price_per_tyre`.

- 14 match the reviewed allowlist recorded 2026-10-25 plus `request_password_reset` (20261108120000, intended).
- `tyre_one_price_per_tyre` is a TRIGGER function (`trg_zz_one_price_per_tyre`, 20261109100000) that inherited the default PUBLIC grant. A trigger function needs no EXECUTE grant; it cannot be invoked usefully over PostgREST, but it breaks the allowlist invariant. Same class as the 2026-10-25 fix of `tp_notify_action_assignee`. Fix: revoke from PUBLIC then anon.
- `reset_login_attempts` is listed anon-executable live, while PROJECT_MEMORY V287 records it as "authenticated only". The function clears only the CALLER's own counter via auth.uid(), so anon calls are no-ops, but the grant should match the design.
- `get_email_by_identifier` remains an anon account-enumeration oracle, now narrowed to `@users.tyrepulse.app` synthetic addresses (20261108130000); real-email accounts go through the `sign-in` edge fn which never returns the address.

### RPC rules (enforce in review)

| Rule | Why | Source |
|---|---|---|
| Never RAISE ERRCODE 40001 or 40P01 on purpose. Use PT409 (HTTP 409). | PostgREST (hasql-transaction) retries 40001 with NO limit; a deterministic refusal looped for a week at ~100/s and produced 8.6M log lines/day. | 20260926090000 |
| Read RPCs with nullable filter args set `plan_cache_mode = force_custom_plan`. | Pooled connections switch to a generic plan after ~5 calls and lose the date/country index (3.1 s to 0.2 s measured). | 20261011110000 |
| A DEFINER fn re-checks org, country and site in body. RLS does not run inside it (owner has BYPASSRLS). | V545 to V578 sweep found cross-country and cross-tenant reads and writes. | V545-V578, V580 |
| A DEFINER helper that takes an org id is never executable by `authenticated`. | V378 cross-tenant hole. | V378 |
| After CREATE FUNCTION: grant authenticated+service_role, revoke PUBLIC, then revoke anon by name. | Revoking anon is a no-op against a PUBLIC grant; revoking PUBLIC alone strips authenticated. | V500, V480 |
| Order a paged RPC by a total key and page it by identity. | Non-unique ORDER BY makes offset paging lossy (V593). | V593 |

**R1 (live regression, High):** `save_stock_entry` and `transfer_stock_entry` (migration `20261018120550_stock_quick_entry.sql`, lines 139 and 205) RAISE `USING ERRCODE='40001'` for optimistic-concurrency refusals and are executable by `authenticated`. This is exactly the shape that caused the September retry loop: a stale stock count or transfer request will be retried by PostgREST indefinitely. Fix: rewrite both to `PT409` from the live `pg_get_functiondef` (anchored replace, abort unless matched once), and widen the client handlers in `src/lib/api/stockQuickEntry.js` to accept both codes. The third reference, `tyre_change_approval_context`, only catches 40001 and is fine.

## 4. PostgREST table access pattern

- Client reads go through the service layer `src/lib/api/_client.js`: explicit column lists, `applyCountry` (null-safe country scoping), `unwrap` (sanitises the message, keeps the raw error on `.cause`), `toServiceError`, `isNotProvisioned` (code-based, the only path allowed to degrade a missing relation to `[]`), `isMissingColumn` (retry with base columns, used by accident panels ahead of migrations).
- An unknown column fails the WHOLE request (42703 / PGRST204). Verify every column against `information_schema` before adding it to a select (Board Overview "overdue 0" and `listWorkOrdersForOps` returning nothing were both this).
- Writes from browsers go through RLS write policies or guarded DEFINER RPCs. Capability enforcement (`app_user_can`) covers 11+ tables (V238, V241); other tables rely on role policies.

### The 1000-row cap

| Rule | Implementation |
|---|---|
| PostgREST returns at most `max_rows = 1000` per response regardless of `.limit()` | `supabase/config.toml`, live db-max-rows |
| Tables: page with `.range()` and an `.order(<unique>)` tiebreak | `fetchAllPages(pageFn, {pageSize, max, concurrency=4})` in `src/lib/fetchAll.js`, `fetchAllOrThrow` in `_client.js` |
| Set-returning RPCs: page by identity, stop on the first page that adds nothing | `fetchAllRpcPages(pageFn, keyOf, {max})` in `src/lib/fetchAll.js` |
| A `.limit(N>1000)` is not a bound | Enforced by `src/test/rowCapGuard.test.js` (scans src/pages, src/lib, src/components, src/console and mobile) |
| Totals use server counts (`count:'exact', head:true`) or server aggregates, never `.length` of a capped read | Policy; several fixes recorded 2026-08-02 |

## 5. Gaps against the spec (section 16 / 22)

| Gap | Phase | Effort |
|---|---|---|
| No API versioning policy (deprecation, changelog, contract tests) beyond `/v1` | 4 | M |
| No OpenAPI/contract document for public-api and the RPCs it promises | 4 | M |
| No edge-function typecheck/lint/test in CI | 1 | S |
| No automated deployed-vs-repo drift check for edge functions | 1 | S |
| No request/correlation ID propagated client to edge to DB (spec error-handling requirement) | 4 | M |
| Inbound webhooks: only Stripe. No ERP push endpoint (ERP is file intake) | 4 | L |
| 40001 regression on two stock RPCs (R1) | 1 | S |
| `tyre_one_price_per_tyre` and `reset_login_attempts` anon grants | 1 | S |
| No automated guard that fails CI when a new anon-executable DEFINER fn appears | 1 | S |

## Open decisions for the owner

- Keep `public-api` reachable with no customers, or gate it behind a feature flag until the first key is issued.
- Whether `send-email` should be restricted to org-member and allowlisted recipient domains.

## Next actions

1. Phase 1 (S): migration rewriting `save_stock_entry` / `transfer_stock_entry` to PT409 + client handler update; revoke the two stray anon grants; add a catalog guard test listing the anon allowlist.
2. Phase 1 (S): add a `deno check supabase/functions/**/index.ts` job to `ci.yml` (runs on GitHub runners; deno.land is blocked only in this sandbox).
3. Phase 1 (S): script that downloads each deployed function and diffs it against the repo; run before each release.
4. Phase 4 (M): publish an OpenAPI document for `public-api` v1 and a deprecation policy; add a request ID header end to end.
