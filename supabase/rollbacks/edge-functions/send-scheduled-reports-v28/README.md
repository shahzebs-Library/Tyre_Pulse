# send-scheduled-reports, version 28 (rollback package)

This folder keeps the exact source of edge function `send-scheduled-reports`
**version 28**, so it can be redeployed if version 29 has to be rolled back.

It is NOT a live function. Supabase deploys only read `supabase/functions/<name>/`,
and the manual deploy workflow (`.github/workflows/deploy-edge-functions.yml`)
deploys only from there. Nothing in CI lints, type-checks or tests this folder.
Do not move it under `supabase/functions/`.

## Version details

| Item | Value |
|---|---|
| Function | `send-scheduled-reports` |
| Project | `jhssdmeruxtrlqnwfksc` |
| Version kept here | 28 |
| Replaced by | 29, deployed 2026-11-21 from main `3f5134ff` |
| Gateway JWT check | `verify_jwt = false` (the function checks the caller itself) |
| Entry point | single file `index.ts` (no other files, no import map) |
| Size | 73,710 bytes / 73,085 characters / 1,331 lines, LF line endings |
| sha256 | `f7695da2ae4f70372f31b72b834f2538028a7d53312a3ba67037d21879c01f87` (also in `SHA256SUMS`) |

Secret check (2026-11-21): the whole file was read. It holds no keys, tokens,
passwords, connection strings or customer data. Every secret is read at run time
from environment variables or the `cron_config` table. The only literals are
public defaults (`https://tyrepulse.app`, `reports@tyrepulse.app`, allowed CORS
origins).

## What you lose by rolling back to v28

v28 predates the inventory report and per-country money in the executive digest.

- `report_type = 'inventory'` and `'workshop_status'` have no digest in v28 and
  fall back to the executive digest. Pause those schedules first, or accept that.
- The executive digest sums money from `report_exec_digest` alone (v29 adds
  `report_exec_money_by_country`, so currencies are not blended).
- Cron responses are `{processed, sent, failed, skipped}` only.

## Imports

- `https://deno.land/std@0.177.0/http/server.ts` (`serve`)
- `https://esm.sh/@supabase/supabase-js@2` (`createClient`)
- Outbound HTTPS to `https://api.resend.com/emails`

## Environment variables (names only)

Required: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`
(for "Send now" session checks), `RESEND_API_KEY`.
Optional: `APP_URL` (default `https://tyrepulse.app`), `FROM_EMAIL`
(default `reports@tyrepulse.app`), `ALLOWED_ORIGINS` (comma list).

## Database objects it needs (names only)

- `cron_config` row `name = 'cron_secret'` (compared to the `x-cron-secret` header)
- `system_config` row `key = 'default_currency'` (optional)
- RPC `report_exec_digest(p_org, p_days)`
- `report_schedules` (reads `SCHEDULE_COLS`; writes `last_sent_at`,
  `last_status`, `last_error`, `next_run_at`, `updated_at`)
- `report_send_log` (insert)
- Read for digests: `accidents`, `tyre_records`, `inspections`,
  `goods_receipts`, `purchase_orders`, `pm_programs`, `work_orders`,
  `stock_records`, `profiles`
- pg_cron job `send-scheduled-reports` (every 15 minutes) posts to the function
  with the `x-cron-secret` header

## How to deploy

Option A, Supabase MCP: `deploy_edge_function` with project
`jhssdmeruxtrlqnwfksc`, name `send-scheduled-reports`, `verify_jwt: false`,
`entrypoint_path: index.ts`, and exactly ONE file named `index.ts` whose content is
this folder's `index.ts`. Note: the MCP tool decodes backslash-u escapes in
file text (PROJECT_MEMORY 2026-11-10). This file has none; confirm with
`grep -c '\\u' index.ts` (must print 0) before deploying.

Option B, Supabase CLI (authenticated):

```bash
tmp=$(mktemp -d) && mkdir -p "$tmp/supabase/functions/send-scheduled-reports"
cp supabase/rollbacks/edge-functions/send-scheduled-reports-v28/index.ts \
   "$tmp/supabase/functions/send-scheduled-reports/index.ts"
cd "$tmp" && supabase functions deploy send-scheduled-reports \
   --project-ref jhssdmeruxtrlqnwfksc --no-verify-jwt
```

Deploying creates a NEW version number (30 or later) carrying v28 code.

## Verify after a rollback

1. Fetch the deployed source back (MCP `get_edge_function`) and byte-compare
   with this `index.ts`; `sha256sum` must match the value above.
   `list_edge_functions` must show `verify_jwt: false`.
2. No-auth probes (send no emails):
   - `GET` with no headers returns **401** `{"error":"unauthorised"}`.
   - `POST {"schedule_id":"<any uuid>"}` with no bearer returns **401**
     `{"error":"Missing bearer token"}`.
3. Cron path: do not call it by hand (a correct secret sends every due schedule).
   Wait for the next 15-minute run and check:
   ```sql
   select status_code, created, left(content::text, 160)
   from net._http_response
   where content::text ilike '%"processed"%' and created > now() - interval '30 minutes'
   order by created desc;
   ```
   Expect **200** with `{"processed":N,"sent":N,"failed":0,"skipped":N}`, and
   `cron.job_run_details` for job `send-scheduled-reports` showing `succeeded`.
4. After the next real send, `report_send_log` gains a `status = 'sent'` row and
   `report_schedules.last_status` reads `sent`.
