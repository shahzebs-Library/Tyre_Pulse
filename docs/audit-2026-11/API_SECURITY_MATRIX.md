# API security matrix - 2026-11-12

Edge functions, anonymous RPCs, webhooks, the marketing contact route and rate limiting.
Read-only audit from source and the live catalog. Live HTTP probing was NOT possible (audit host proxy blocks
`*.supabase.co`), so every status-code and CORS statement is from source, not from the wire.
Status words: see [SECURITY_AUDIT.md](SECURITY_AUDIT.md).

Important: every edge-function change listed as STAGED is in commit d5764687 on the fix branch. No function
was redeployed. The deployed versions are the ones in the matrix below.

## Edge functions (18 deployed at audit time)

| Function (deployed version) | Caller | Auth | Tenant scope | Rate limit at audit time | Findings |
|---|---|---|---|---|---|
| chat-ai v27 | web | JWT + approved elevated role | no data access | 10 / min + 500 / day per user, monthly budget (count-then-act) | API-13 |
| ai-orchestrator v14 | web | JWT + approved role + agent gate | tools run on caller JWT (RLS) | same limiter; atomic budget reserve | - |
| ai-tyre-inspection v24 | web, mobile, cron | JWT or worker secret | enqueue via caller RLS; worker = service role | atomic daily + monthly budget | API-11 |
| generate-embedding v21 (gateway JWT on) | web | JWT + approved elevated role | none needed | none | API-8 |
| embed-worker v11 | cron | cron secret | service role, all orgs (by design) | cron cadence | SEC-6 |
| send-email v23 | web | JWT + approved elevated role | none on recipients | none | API-1 |
| send-scheduled-reports v28 | cron, "Send now" | cron secret or JWT + role | org filter skipped when org is null | cron pacing; send-now none | API-2, API-3 |
| workflow-notify v17 | cron | mandatory secret, constant-time | recipients from payload | queue cadence | - |
| public-api v10 | external systems | API key (hashed lookup) | every query filtered by key org | per key per minute | API-5 |
| billing-webhook v12 | Stripe | HMAC signature, 5 min tolerance | org from event metadata | none | API-7 |
| billing-checkout v11 | web | JWT + admin | org from caller profile | none | - |
| sentry-issues v13 | console | JWT + super admin flag | n/a | none | API-12 |
| sentry-crash-alert v11 | cron | cron secret, constant-time | service role | cron cadence | - |
| account-recovery v9 | anon + signed-in | none / JWT | per-user rows | database counters | AUTH-9 |
| admin-revoke-sessions v7 | console | JWT + super admin + not locked | last-super-admin guard | none | AUTH-13 |
| tenant-export v9 | console, cron | JWT + super admin; job token | SQL re-check, table safelist | one job per org | - |
| qr-login v8 | anon | browser secret, single use | approved / unlocked | 10 / min per IP | - (feature disabled) |
| sign-in v1 | anon | password | n/a | 5 failures / 15 min per identifier; no per-IP | AUTH-4, AUTH-9 |

17 of 18 run with gateway JWT verification off; each has an in-code gate or is public by design. No function
without an in-code gate was found.

## Marketing

| Endpoint | Auth | Validation | Rate limit | Findings |
|---|---|---|---|---|
| `POST /api/contact` | none; same-site check | schema, 16 KB cap, 415 on non-JSON, honeypot | in-memory, per serverless instance | API-4 |

No server actions and no middleware were found.

## Anonymous SECURITY DEFINER RPCs (exactly 14)

| RPC | Abuse control |
|---|---|
| get_report_snapshot, get_report_tyre_maintenance, get_workshop_snapshot | 144-bit token; password lockout added by 20261112156000 (API-6, verification not run); 3 s statement timeout |
| get_accident_portal_snapshot, get_display_snapshot | same |
| get_public_config, get_login_showcase | none needed |
| get_email_by_identifier | returns synthetic addresses only; existence oracle (AUTH-5) |
| login_attempt_status, record_login_failure | database table; anon can lock a known identifier (AUTH-4) |
| request_password_reset | 1 pending per user per hour |
| qr_login_start, qr_login_status | 10 / min per IP, 2,000 / min global |
| log_client_error | 10 / min per IP anon, 60 / min global, 30 / min signed-in |

## Rate-limit table

| Surface | Limit | Enforced where | Status |
|---|---|---|---|
| Login per identifier | 5 failures then 15 min lock | database | exists (see AUTH-4) |
| Login per IP | none in app code | - | OPEN (AUTH-9) |
| Password reset request | 1 / user / hour | database | exists |
| Recovery codes | reserve + attempt counters | database | exists |
| Marketing contact form | 5 / 10 min per IP | memory, per instance | OPEN (API-4) |
| Share-token passwords | 10 wrong in 15 min locks 15 min | database | applied, NOT VERIFIED (API-6) |
| Client error sink | per IP and global | database | exists |
| File upload | none | client only | OPEN (FILE-7) |
| Export / import row caps | 50,000 / 500,000 | client only | OPEN (FILE-7) |
| AI chat / orchestrator | 10 / min, 500 / day, monthly budget | database | exists (chat is racy, API-13) |
| Embedding | none | - | OPEN (API-8) |
| Send email | 20 / hour per user in staged code | database (audit rows) | STAGED (API-1) |
| Send-now report | 300 s cooldown per schedule in staged code | database | STAGED (API-2) |
| public-api | per key per minute | database | exists |

`Retry-After` headers: none anywhere at audit time. STAGED in d5764687 for chat-ai, ai-orchestrator, sign-in,
public-api, account-recovery, send-email, send-now and the marketing contact route.

## Findings

### API-1 (P1) `send-email` unrestricted mail relay for elevated roles - STAGED / OPEN
- Evidence (source; deployed copy matched the repo): no recipient allowlist, count cap, size cap or rate
  limit; raw HTML and attachment from the request.
- STAGED (d5764687): 20 recipients, subject 200 chars, body 200 KB, attachment 7 MB, attachment type list,
  20 sends per hour per user with 429 + Retry-After, audit row with the caller id written before sending and
  the request refused if it cannot be written.
- OPEN: recipients are still not limited to the caller's organisation or an allowlist.

### API-2 (P2) "Send now" has no throttle - STAGED
- STAGED (d5764687): 300 s cooldown per schedule, 429 + Retry-After, gate changed to `approved !== true`.

### API-3 (P1 by class, P2 by current exposure) Null-organisation schedule gives a cross-tenant digest - STAGED / OPEN
- Evidence: the function applied no organisation filter when `org_id` was null; live policies on
  `report_schedules` allow an elevated user of any organisation to insert a null-org row. 0 of 7 schedules had
  a null org at audit time. The end-to-end send was not executed.
- STAGED (d5764687): the function refuses a schedule with no organisation (cron and send-now).
- OPEN: the `report_schedules` policies are unchanged; no migration was written.

### API-4 (P2) Contact form rate limit is per instance - STAGED / OPEN
- STAGED (d5764687): `Retry-After` on 429 and a code comment stating the limit is not real.
- OPEN: a real limit needs a Vercel firewall rule or a shared store (owner decision). No CAPTCHA.

### API-5 (P2) `public-api`: two routes always fail; key scopes never enforced - OPEN
- Evidence: the function selects columns that do not exist on `inspections` and `accidents`; `api_keys.scopes`
  is never read. 0 API keys exist, so nothing is exposed or broken for a customer today.
- The staged diff for this function adds `Retry-After` only.

### API-6 (P2) Share-token passwords guessable without limit - NOT VERIFIED
- Evidence: five anon functions compared the password with bare `crypt()`.
- Applied live: `20261112156000_share_token_password_lockout.sql` (counter table, helper, five functions
  rebuilt). The apply call returned success.
- NOT VERIFIED: the runtime verification block was never run (the deployment tool became unavailable). Run
  the VERIFY block at the foot of that file before relying on it.
- OPEN: no default expiry on new links; the 2 live links have no password and no expiry.

### API-7 (P2) `billing-webhook` no event idempotency; accepts a checkout with no organisation - OPEN
- Latent: Stripe is not configured. Confidence PLAUSIBLE (source only).

### API-8 (P3) `generate-embedding` no rate limit, no budget check, caller-chosen model - OPEN

### API-9 (P3) Outbound webhook URL only checked for `https://` (blind SSRF by elevated users) - OPEN
- 2 subscriptions exist, 0 active. Confidence PLAUSIBLE; no request was sent.

### API-10 (P3) Anonymous callers could advance business sequences - FIXED
- Fix: `20261112157000_anon_sequence_and_default_privileges.sql`.
- Verified as anon (rolled back): `generate_work_order_no` and a direct `nextval` -> 42501; every
  allowlisted anon RPC still answers; a Manager still gets a number.

### API-11 (P2) AI tyre worker downloads any `tyre-photos` path with the service role - STAGED / OPEN
- STAGED (d5764687): CORS headers built per request (was a shared mutable variable); worker secret compared
  in constant time.
- OPEN: the worker still does not check that the object belongs to the job's organisation. Paths are not
  org-prefixed (FILE-4). One real tenant today. Not exercised.

### API-12 (P3) `sentry-issues` trusted a stored URL and skipped `locked` - FIXED / STAGED
- FIXED: `20261112184000` (`set_sentry_config` refuses a non-Sentry host). Verified with four URLs.
- STAGED (d5764687): the function re-validates the host and checks `locked`; same host rule in
  `sentry-crash-alert`.

### API-13 (P3) Count-then-act limiter, non constant-time compares, no Retry-After - STAGED / OPEN
- STAGED: constant-time compares and `Retry-After` headers.
- OPEN: `chat-ai` rate limit and budget are still read-then-call.

### API-14 (P3) No automated test exercises edge-function authorization - OPEN
- A source-scan test (`src/test/edgeFunctionGuards.test.js`) was added in d5764687. There are still no
  function-level tests and no `deno check` in CI.

## Outbound cron jobs

One shared cron secret opens four functions (send-scheduled-reports, embed-worker, sentry-crash-alert,
tenant-export cleanup). Secrets are read from the config table or vault at run time, none inline.

## Checked and clean

- Dynamic SQL sample (13 functions): identifiers and values properly quoted; no injection found.
- `workflow-notify`: mandatory secret, never fails open.
- `billing-webhook`: signature verified before parsing. `billing-checkout`: no open redirect.
- `tenant-export`: super-admin gate, SQL re-check, table safelist, private bucket.
- `qr-login`, `sign-in`, `log_client_error`: as described in the matrix.
- Role statement timeouts: anon 3 s, authenticated 8 s.

## NOT VERIFIED

1. Live status codes, CORS headers and gateway behaviour for all functions and `/api/contact`.
2. Deployed-versus-repo source equality for 17 functions (only `send-email` was compared).
3. Whether the first forwarded-for hop is client-controllable at the Supabase edge.
4. Which edge-function secrets are set (allowed origins, app URL, worker and recovery secrets, Stripe).
5. API-3, API-7, API-9, API-11 end to end (each would send mail, write data or call a paid provider).
6. Vercel firewall rules in front of the marketing site and the app.
7. Output filtering inside three snapshot functions beyond the token gate.
