# Production readiness - 2026-11-12

Honest go / no-go after the audit and the fix batches. Status words: see [SECURITY_AUDIT.md](SECURITY_AUDIT.md).

## Verdict

| Surface | Verdict | Why |
|---|---|---|
| Live database (single tenant, current users) | GO, with the owner actions below | Both P0 and the proven P1 database holes are fixed live and verified. |
| Merge and deploy of the fix branch (web + edge functions) | NO-GO until the checks in section 2 are done | No recorded test run on the branch; edge functions not deployed; one live change unverified (API-6). |
| Onboarding a second real tenant | NO-GO | CON-5, API-3 policy half, AI-2, RLS-8, FILE-4 / API-11 are open and all matter once two tenants hold data. |
| Next Android release | NO-GO until SEC-1 is resolved | The signing keystore in git history has not been rotated. |
| Marketing site | Not assessed for go-live here | Baseline has 1 P1 open and 1 P1 not verified; redesign in progress on `claude/marketing-premium-pass`. |

## 1. Owner actions (cannot be done from code)

| # | Action | Finding | Why it blocks |
|---|---|---|---|
| 1 | Play Console > App integrity: compare each app's upload certificate with the leaked keystore (`tyre_pulse_app/release.jks` in history, alias `tyre-pulse-key`); request an upload-key reset where it matches; store the new key only in GitHub secrets | SEC-1 | Anyone with repository read access can sign builds with that key. If an app uses it as its app-signing key without Play App Signing, it cannot be rotated: treat as P0. |
| 2 | Supabase Dashboard > Authentication: session time-box and inactivity timeout, JWT expiry, leaked-password protection, minimum password rules, secure password change, sign-up and rate-limit settings, redirect allow-list. Keep CAPTCHA off until the mobile apps send a token | AUTH-7, AUTH-8, AUTH-2 | 251 sessions never expire server-side; password rules are browser-only. Full list in [AUTH_AND_OTP_AUDIT.md](AUTH_AND_OTP_AUDIT.md). |
| 3 | After merging the fix branch: deploy every edge function from the repo with the manual workflow `deploy-edge-functions.yml` (commit bb05eb55, needs the `SUPABASE_ACCESS_TOKEN` repository secret) | API-1, API-2, API-3, API-11, API-12, API-13, SEC-6, AUTH-13 | All edge-function fixes are STAGED only. The deployed functions are the pre-audit versions. |
| 4 | Confirm the function secret `ALLOWED_ORIGINS` contains the app host `https://app.tyrepulse.app` (or redeploy, step 3, which carries it in the defaults). Then check an `OPTIONS` request from that origin on each function | DEP-1 | Deployed code predates the allowlist change. If no override is set, browser calls from the app host to sign-in, report email, AI chat, tenant export and session revoke fail. NOT VERIFIED either way. |
| 5 | After the web build from the fix branch is live in production (confirm on the deployed commit, not the merged pull request), apply `supabase/pending_migrations/20261112171000_profiles_secret_columns_not_selectable.sql`, then move it to `supabase/migrations/` | RLS-9 | Applying it before the web deploy locks console sign-in (the old bundle selects withheld columns). Until applied, any member can still read colleagues' push tokens and admin notes. |
| 6 | Trigger a Flutter build (owner decides when) so the sign-in code (MFA) screen reaches phones | AUTH-1 | Without it a super admin has only ordinary rights in the Flutter app. Not a security hole; a function gap. |
| 7 | Run the VERIFY block at the foot of `20261112156000_share_token_password_lockout.sql` | API-6 | Applied live, never verified. |
| 8 | Paste the one statement at the foot of `20261112152000_storage_photo_write_rules.sql` in the SQL editor | RLS-12 | The tool could not apply a statement that names a removal policy. Low risk (bucket holds 0 objects). |
| 9 | Confirm the platform backup / point-in-time recovery tier and retention in the Supabase dashboard | DEP-5 | The nightly snapshot skips work orders and does not cover expense lines; platform PITR is the real recovery path and was not readable. |
| 10 | Set `APP_URL` to the app host as a function secret; confirm which Vercel project serves the apex domain | DEP-3 | Report email links and the billing return URL default to the apex host. |
| 11 | GitHub: confirm repository visibility, default token permission, secret scanning, branch protection; if `screenshots.yml` was ever run, change that account's password | SEC-1, SEC-2, SEC-4 | Decides SEC-1 severity. |
| 12 | Run `VACUUM (ANALYZE)` on parts_consumption, work_orders, tyre_records | PERF-7 | Index-only scans are disabled on the three most-read tables. |

## 2. Before merging the fix branch

1. Run the web suite, lint and build on the branch and record the result (none is recorded: see
   [TEST_RESULTS.md](TEST_RESULTS.md)).
2. Confirm Flutter CI is green on the head commit.
3. Merge once (each merge to main is a production build), confirm the production deployment carries the
   merged commit, then do owner actions 3, 4 and 5 in that order.

## 3. Remaining blockers by severity

P0: none open.

P1:

| ID | State | What remains |
|---|---|---|
| SEC-1 | OPEN | Keystore rotation (owner action 1). |
| AUTH-1 | FIXED / STAGED | Flutter build; two older config policies and one RPC still test the profile flag directly. |
| AUTH-2 | FIXED / OPEN | Sign-up trigger ignores `registration_open`; a lock does not end the Auth session. |
| API-1 | STAGED / OPEN | Deploy; no recipient allowlist yet. |
| API-3 | STAGED / OPEN | Deploy; `report_schedules` policies still accept a null organisation. |
| FILE-1 | FIXED / OPEN | Flutter accident case documents need a path convention. |
| PERF-1 | STAGED | Web deploy (commit 207472c4). |
| DEP-1 | NOT VERIFIED | Owner action 4. |
| WEB-1 | OPEN | Mobile menu (marketing). |
| WEB-2 | NOT VERIFIED | Confirm the app host and the marketing env var. |

P2 open items most relevant to go-live: AUTH-4, AUTH-5, AUTH-7, AUTH-8, AUTH-9 (sign-in hardening); CON-3
(no step-up); CON-5 (suspension not enforced); API-4, API-5, API-7; RLS-8; DEP-2, DEP-5, DEP-6, DEP-7;
PERF-2 to PERF-7.

## 4. Performance findings (PERF)

Measured on the live database over about 2.9 days of statistics, read-only.

| ID | Sev | Finding | Evidence | Status |
|---|---|---|---|---|
| PERF-1 | P1 | Work Orders export asked for 1,000 rows a page while the server returns 200, so most rows were skipped silently | October KSA: 600 of 2,371 rows exported | STAGED (207472c4; test updated, run not recorded) |
| PERF-2 | P2 | `get_work_orders_page` reads the whole table and sorts on disk for a 20-row page | 15,408 shared buffers + 27 MB temp per call | OPEN |
| PERF-3 | P2 | Realtime WAL decoder is the dominant load again | 52% of execution time, 82% of buffer traffic | OPEN (cause PLAUSIBLE, not proven) |
| PERF-4 | P2 | Report RPCs close to the 8 s statement timeout | `get_cost_cpk_overview` max 7,814 ms | OPEN |
| PERF-5 | P2 | Alert badge pages up to 2,000 tyre rows per tab every 5 minutes | 4,405 calls, 14.9 M buffers | OPEN |
| PERF-6 | P2 | ERP intake de-dup read pages by offset over 97k work orders | 24.5 M buffers in 571 calls | OPEN |
| PERF-7 | P2 | Visibility map stale on hot tables | parts_consumption 0%, tyre_records 12.5%, work_orders 32.1% | OPEN (owner action 12) |
| PERF-8 | P3 | Eager bundle grew to 546 kB gzip | build output | OPEN |
| PERF-9 | P3 | About 1 GB of a 2.6 GB database is snapshots, rollback copies and staging | relation sizes | OPEN (owner decision) |
| PERF-10 | P3 | 12 storage policies and two meter-log tables call helpers per row | catalog | OPEN |
| PERF-11 | P3 | Small N+1 write loops in 4 places | source | OPEN |

No regression on the tyre running-life page (46,424 buffers). Connections 27 of 60.

## 5. Deployment findings (DEP)

| ID | Sev | Finding | Evidence | Status |
|---|---|---|---|---|
| DEP-1 | P1 if the origin secret is unset, P3 if set | Deployed edge functions predate the app-host allowlist change | `sign-in` v1 default list read live has no app origin | NOT VERIFIED (owner actions 3 and 4) |
| DEP-2 | P2 | Two production deployments per merge; neither waits for CI | deployment pairs for 3 commits | OPEN |
| DEP-3 | P2 | Marketing project not inspectable; function `APP_URL` defaults to the apex host | project read returned 404 | NOT VERIFIED |
| DEP-4 | P3 | App headers: obsolete XSS header, no COOP / CORP, blanket 1-year cache on unhashed root js / css, wide `img-src` | `vercel.json` | OPEN |
| DEP-5 | P2 | Nightly snapshot healthy but small: work orders skipped as too large; expense lines, line items, production logs, audit log, profiles not covered | latest snapshot contents | OPEN (owner action 9) |
| DEP-6 | P2 | CI gaps: no edge-function type check, no end-to-end run, no migration drift check, no bundle budget; deploy not gated | `ci.yml` | OPEN (branch protection NOT VERIFIED) |
| DEP-7 | P2 | No external uptime or synthetic check; no alert on statement timeouts | absence in repo | OPEN |
| DEP-8 | P3 | A first push of an unlisted branch still builds a preview | ignore script | OPEN |
| DEP-9 | P3 | Supply chain small items | see [SECRETS_EXPOSURE_AUDIT.md](SECRETS_EXPOSURE_AUDIT.md) | OPEN |

App security headers that are in place: CSP with no inline or eval scripts, HSTS with preload, frame deny,
nosniff, referrer policy, permissions policy. App production deployment was READY on the exact `origin/main`
commit at audit time. All 2026-11-11 and 2026-11-12 migration files carry a rollback section.

## 6. What is solid today (verified)

- Organisation wall: another organisation's Manager reads only its own rows on every org-keyed business table.
- Country wall: 0 foreign-country rows on country tables for the tested KSA and Egypt accounts; direct
  cross-country writes refused.
- 0 public tables with RLS off; 0 anon table grants; 0 definer functions with an unpinned search path.
- Locked or unapproved accounts read nothing on the 25 gated tables and no config rows.
- A super admin with an enrolled factor has super-admin rights only in an MFA-completed session.
- Console audit trail can no longer be forged by ordinary users; AI budget ledger is server-write only.
- No privileged key in the tree or reachable history other than SEC-1.

## 7. NOT VERIFIED items that affect this verdict

- Supabase Auth dashboard settings, edge-function secrets, Vercel env for both projects, PITR tier.
- Live HTTP behaviour of every function and production response headers.
- Play Console key registration; repository visibility.
- Test results on the fix branch (web and Flutter).
- Git history before 2026-06-04.
