---
name: api-testing
description: Test Tyre Pulse APIs - PostgREST table reads/writes, Supabase RPCs, edge functions (supabase/functions/*), the marketing /api/contact route and the public-api edge function - for auth, authorization, validation, status codes, error leakage, pagination, idempotency and CORS. Use for "test the API", "RPC returns wrong data", "edge function error", "check endpoint".
---

# API testing

## Inventory first
- Service layer: `src/lib/api/*.js` (built on `_client.js`: `unwrap`, `applyCountry`, `fetchAllPages`,
  `toServiceError`, `isNotProvisioned`). Mobile: `mobile/lib/*.ts`. Flutter: `tyre_pulse_flutter/lib/**/data/`.
- RPCs: `select proname, prosecdef, pg_get_function_identity_arguments(oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where nspname='public'`.
- Edge functions: `ls supabase/functions` (account-recovery, admin-revoke-sessions, ai-orchestrator,
  billing-checkout, billing-webhook, chat-ai, embed-worker, generate-embedding, public-api, send-email,
  send-scheduled-reports, sentry-crash-alert, sentry-issues, tenant-export, workflow-notify).
- Marketing: `marketing/app/api/contact/route.ts`.

## Checks per endpoint
| Area | Expected |
|---|---|
| No auth | 401 (edge fn) / 42501 or empty (RPC/table). Anon may call only the V500 allowlist |
| Wrong role / other org / other country / other site | refused; never another tenant's rows |
| Input validation | bad UUID, missing field, wrong type, oversized string, unexpected extra field -> clean 4xx, no partial write |
| Error leakage | message is a sentence; no SQL, column names, stack, table names, service keys (web maps via `safeError.toUserMessage`) |
| Status codes | 200/201 success; 400 validation; 401/403 auth; 404 missing; 409 concurrency (PT409, never 40001); 422 semantic; 429 rate limit; 5xx only for real faults |
| Pagination | PostgREST caps at 1000 rows: callers page with `.range()` + unique `.order()` tiebreak; RPCs return `total` where the UI shows a count |
| Sorting / filtering | server-side filters match client assumptions (null-safe country convention `applyCountry`) |
| Nulls / missing fields | UI renders N/A, never 0 for an unmeasured value |
| Idempotency | offline queue writes carry `client_uuid`; repeat submit creates one row; imports use `import_uid` |
| Timeouts / retries | client retries only idempotent calls; mobile reads abort at 12 s |
| Large payloads | uploads chunked (250-500 rows), files size-guarded (email attachments 7 MB) |
| CORS | edge fns allow only `tyrepulse.app`, `www`, localhost dev ports |
| Content types | JSON in/out; file uploads validated by type and size |
| Webhooks | `billing-webhook` verifies the Stripe signature and returns 500 on handler failure; `workflow-notify` requires the shared secret and never fails open |
| Rate limits | chat-ai / ai-orchestrator enforce `ai_rate_limit_per_min` and budget |

## Contract check
Compare the fields each client selects/reads with the real schema (`information_schema.columns`). PostgREST
fails the WHOLE request on an unknown column - a single stale column name empties a page. Compare TypeScript /
Dart models to the RPC's returned JSON keys.

## How to run
- RPC/table checks: Supabase MCP `execute_sql` inside `begin; ... rollback;` with impersonation (see
  database-migration-safety). Never write production data outside a rolled-back transaction.
- Edge functions: read the source; call only functions that are safe to call (read-only) and never with real
  customer recipients.
- Unit coverage: `npm run test:run` (service tests under `src/test`), `npm run test:database`.

## Pass / fail
PASS per endpoint only with evidence for auth, authorization, validation and error format. List untested
endpoints explicitly as NOT RUN.
