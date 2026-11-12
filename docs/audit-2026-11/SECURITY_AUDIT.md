# Tyre Pulse security, backend, console and marketing audit - 2026-11-12

Executive summary and full findings register. Detail for each finding is in the linked document.

- Scope: web app (Vite SPA), System Console, Supabase project `jhssdmeruxtrlqnwfksc` (RLS, RPCs, storage, 18 edge
  functions), CI workflows, Flutter and Expo apps (code review only), marketing site (`marketing/`, Next.js).
- Audit method: read-only. Database tests ran as real accounts by impersonation inside transactions that were
  rolled back. No live HTTP probing of `*.supabase.co` or production hosts was possible from the audit host.
- Fix branch: `claude/tyrepulse-inspector-build-7rxp2t` (10 commits ahead of `origin/main`, not merged).
- Evidence sources: audit working notes (SEC, RLS, AUTH, API, CON_AI_FILE, PERF_DEP, WEB), headers of migrations
  `supabase/migrations/20261112140000` to `20261112185000`, `supabase/pending_migrations/`, branch commits.

## Status words used in every document

| Status | Meaning |
|---|---|
| FIXED | Applied to the live database and verified (migration named). |
| STAGED | Written but not live: code on the fix branch (not merged, edge functions not deployed) or a migration parked in `supabase/pending_migrations/`. |
| OPEN | Not fixed. Reason and owner given. |
| NOT VERIFIED | Access was insufficient to confirm the finding or the fix. |
| A / B | Two parts with different states, for example `FIXED / OPEN` = part fixed live, remainder open. |

## Summary

109 findings: SEC 8, RLS 16, AUTH 13, API 14, CON 6, AI 5, FILE 8, PERF 11, DEP 9, WEB 19.

| Severity | Count |
|---|---|
| P0 | 2 |
| P1 | 15 |
| P2 | 45 |
| P3 | 47 |

| Status | Count |
|---|---|
| FIXED | 13 |
| FIXED / STAGED | 3 |
| FIXED / OPEN | 10 |
| STAGED | 8 |
| STAGED / OPEN | 6 |
| NOT VERIFIED | 4 |
| OPEN | 65 |

Headlines:

1. Both P0 findings (another organisation's Manager reading Company A's asset upload table and report recipient
   log) are FIXED live and verified (`20261112140000`).
2. Of the 15 P1 findings: 5 FIXED, 3 fixed in the database with a remainder (AUTH-1, AUTH-2, FILE-1), 3 STAGED in
   code (API-1 and API-3 with a remainder, PERF-1), 2 NOT VERIFIED (DEP-1, WEB-2), 2 OPEN (SEC-1 keystore, WEB-1).
3. The leaked Android signing keystore (SEC-1) is not rotated. Only the owner can do it in Play Console.
4. Every edge-function fix is STAGED: the code is on the branch and no function was redeployed.
5. API-6 (share-link password lockout) is applied live but its verification block was never run.
6. All 19 marketing findings are OPEN or NOT VERIFIED here. A redesign is in progress on branch
   `claude/marketing-premium-pass` and is not assessed in these documents.

Go / no-go: see [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md).

## Documents

| Document | Covers |
|---|---|
| [SUPABASE_RLS_AUDIT.md](SUPABASE_RLS_AUDIT.md) | RLS-1 to RLS-16, tenant matrix |
| [AUTH_AND_OTP_AUDIT.md](AUTH_AND_OTP_AUDIT.md) | AUTH-1 to AUTH-13, flow matrix, dashboard checks |
| [SECRETS_EXPOSURE_AUDIT.md](SECRETS_EXPOSURE_AUDIT.md) | SEC-1 to SEC-8, DEP-9 |
| [API_SECURITY_MATRIX.md](API_SECURITY_MATRIX.md) | API-1 to API-14, endpoint and rate-limit matrix |
| [CONSOLE_SECURITY_REVIEW.md](CONSOLE_SECURITY_REVIEW.md) | CON-1 to CON-6, AI-1 to AI-5, FILE-1 to FILE-8 |
| [MARKETING_WEBSITE_AUDIT.md](MARKETING_WEBSITE_AUDIT.md) | WEB-1 to WEB-19 |
| [MARKETING_DESIGN_SYSTEM.md](MARKETING_DESIGN_SYSTEM.md) | Current marketing tokens, type, components, motion |
| [TEST_RESULTS.md](TEST_RESULTS.md) | Recorded results and what was not run |
| [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md) | PERF-1 to PERF-11, DEP-1 to DEP-8, go / no-go, owner actions |

## Full register

Fix reference: migration file prefix under `supabase/migrations/`, or commit on the fix branch.
"Pending" = `supabase/pending_migrations/`.

### SEC - secrets and supply chain ([detail](SECRETS_EXPOSURE_AUDIT.md))

| ID | Sev | Title | Evidence (short) | Status | Fix reference |
|---|---|---|---|---|---|
| SEC-1 | P1 | Android keystore and its password in git history | `tyre_pulse_app/release.jks`, alias `tyre-pulse-key`; opens with the password from workflow history | OPEN | Owner: Play Console upload-key reset |
| SEC-2 | P2 | `screenshots.yml` took a password as a plain input | workflow inputs unmasked | STAGED | d5764687 (now `secrets.*`) |
| SEC-3 | P2 | Third-party actions and CLIs pinned by mutable tag | `@v1`, `@v2`, `@v8`, `vercel@latest`, `eas-version: latest` still at HEAD | STAGED / OPEN | d5764687 adds dependabot only |
| SEC-4 | P2 | Workflows without a `permissions:` block | 8 of 11 had none | STAGED | d5764687 |
| SEC-5 | P3 | Expo package: 4 high, 16 moderate advisories | `npm audit --omit=dev` in `mobile/` | OPEN | Needs Expo major |
| SEC-6 | P3 | Shared-secret compares not constant-time | 3 edge functions used `!==` | STAGED | d5764687 |
| SEC-7 | P3 | Secrets expanded in shell text; signing files left on runner | `flutter-release-play.yml`, `eas-update.yml` | STAGED | d5764687 |
| SEC-8 | P3 | Dev tooling fetched unpinned | `.mcp.json` `@latest`, `audit=false` | OPEN | - |

### RLS - tenant isolation ([detail](SUPABASE_RLS_AUDIT.md))

| ID | Sev | Title | Evidence (short) | Status | Fix reference |
|---|---|---|---|---|---|
| RLS-1 | P1 | User can widen own site scope via own profile row | Driver: tyre_records 2,249 -> 8,353 | FIXED | 20261112141000 |
| RLS-2 | P1 | `tyre_replacement_undo` crosses countries | KSA Manager restored 28 UAE/Egypt rows | FIXED | 20261112142000 |
| RLS-3 | P0 | Other org reads `ksa_asset_master_upload` | 1,236 rows to demo-org Manager | FIXED | 20261112140000 |
| RLS-4 | P0 | Null-organisation rows shared with every tenant | report_send_log 192, system_logs 273 | FIXED | 20261112140000 |
| RLS-5 | P1 | Other org can write shared rows | workflow_definitions 25, kpi_targets 7 | FIXED | 20261112140000 |
| RLS-6 | P1 | Handover sign-off forgeable | Driver inserted an approved row | FIXED | 20261112143000, 20261112155000 |
| RLS-7 | P2 | Site isolation missing on site tables | no-site Driver read 12 tables | FIXED / OPEN | 20261112180000 (11 tables) |
| RLS-8 | P2 | Country gaps on event and audit tables | KSA Manager reads 223,151 domain_events | OPEN | - |
| RLS-9 | P2 | Every member reads every profile row and emails | Driver reads 768 rows | FIXED / STAGED | 20261112170000; pending 20261112171000 |
| RLS-10 | P2 | Field roles: wide reads, blanket update policies | Driver updated 2,416 odometer rows | FIXED / OPEN | 20261112154000, 20261112181000 |
| RLS-11 | P2 | `system_config` readable by all | 62 keys to any account | FIXED / OPEN | 20261112182000 |
| RLS-12 | P3 | Storage policy gaps | upload check, dead admin arm | FIXED / OPEN | 20261112152000 |
| RLS-13 | P3 | Default privileges and non-public schemas | new functions born anon-executable | FIXED / OPEN | 20261112157000 |
| RLS-14 | P3 | 14 anon-executable definer functions | allowlist was 10 | OPEN | Accepted set; see detail |
| RLS-15 | P3 | Advisor counts | 0 ERROR; WARN counts listed | OPEN | - |
| RLS-16 | P3 | Smaller observations | 4 items | OPEN | - |

### AUTH ([detail](AUTH_AND_OTP_AUDIT.md))

| ID | Sev | Title | Evidence (short) | Status | Fix reference |
|---|---|---|---|---|---|
| AUTH-1 | P1 | MFA enforced only in client code | aal1 super admin read everything | FIXED / STAGED | 20261112160000; Flutter 50b17fa6 |
| AUTH-2 | P1 | Locked / unapproved accounts read 27 tables | locked account sweep | FIXED / OPEN | 20261112144000, 20261112182000 |
| AUTH-3 | P1 | Self-rewrite of site scope and login identifiers | rolled-back self update | FIXED | 20261112141000 |
| AUTH-4 | P2 | Lockout stops honest users, not attackers | anon `record_login_failure` | OPEN | - |
| AUTH-5 | P2 | Account enumeration oracles | 3 confirmed, 1 timing | OPEN | - |
| AUTH-6 | P2 | Recovery-contact guard was a no-op | self-set verified recovery email | FIXED | 20261112183000 |
| AUTH-7 | P2 | Sessions never expire server-side | 251 sessions, oldest 156 days | OPEN | Owner: Auth dashboard |
| AUTH-8 | P2 | Weak password change and reset controls | `/reset-password` needs no reauth | OPEN | Owner + code |
| AUTH-9 | P2 | No per-IP throttle before password check | `sign-in` source | OPEN | - |
| AUTH-10 | P3 | Console MFA and IP controls optional | config values | OPEN | - |
| AUTH-11 | P3 | Sign-up trusts client metadata | `handle_new_user` body | FIXED / OPEN | 20261112185000 (region only) |
| AUTH-12 | P3 | Anonymous information disclosure | `get_login_showcase` | OPEN | Owner-accepted |
| AUTH-13 | P3 | `admin-revoke-sessions` CORS too wide | `*.vercel.app` allowed | STAGED | d5764687 |

### API ([detail](API_SECURITY_MATRIX.md))

| ID | Sev | Title | Evidence (short) | Status | Fix reference |
|---|---|---|---|---|---|
| API-1 | P1 | `send-email` is an open relay for elevated roles | no caps, no limit | STAGED / OPEN | d5764687 (no recipient allowlist) |
| API-2 | P2 | "Send now" has no throttle | source | STAGED | d5764687 |
| API-3 | P1 | Null-org schedule gives a cross-tenant digest | policy + code path | STAGED / OPEN | d5764687 (function); policy unchanged |
| API-4 | P2 | Contact form limit is per instance | in-memory `Map` | STAGED / OPEN | d5764687 (Retry-After only) |
| API-5 | P2 | `public-api`: 2 dead routes, scopes ignored | missing columns | OPEN | - |
| API-6 | P2 | Share-token password guessable without limit | bare `crypt()` | NOT VERIFIED | 20261112156000 applied, verify not run |
| API-7 | P2 | `billing-webhook` no idempotency | source | OPEN | Latent (Stripe not live) |
| API-8 | P3 | `generate-embedding` no limit, caller-chosen model | source | OPEN | - |
| API-9 | P3 | Webhook URL SSRF by elevated users | CHECK is `https://` only | OPEN | - |
| API-10 | P3 | Anon can advance business sequences | grants | FIXED | 20261112157000 |
| API-11 | P2 | AI tyre worker reads any `tyre-photos` path | source | STAGED / OPEN | d5764687 (CORS, compare); org check not done |
| API-12 | P3 | `sentry-issues` trusts stored URL, skips `locked` | source | FIXED / STAGED | 20261112184000; d5764687 |
| API-13 | P3 | Count-then-act limiter, no Retry-After | source | STAGED / OPEN | d5764687 (headers, compares) |
| API-14 | P3 | No tests of edge-function authorization | no `*.test.ts` | OPEN | Source-scan test added only |

### CON, AI, FILE ([detail](CONSOLE_SECURITY_REVIEW.md))

| ID | Sev | Title | Evidence (short) | Status | Fix reference |
|---|---|---|---|---|---|
| CON-1 | P2 | Any user could forge console audit rows | Driver call accepted | FIXED | 20261112150000 |
| CON-2 | P2 | Privileged audit depends on the browser | catalog | FIXED / OPEN | 20261112184000 (4 writers) |
| CON-3 | P2 | No step-up on destructive console actions | absence in source | OPEN | - |
| CON-4 | P3 | Dual control off, covers 4 actions | config | OPEN | Owner decision |
| CON-5 | P2 | Tenant suspension recorded, not enforced | 0 policies reference `organisations` | OPEN | - |
| CON-6 | P3 | Console stats and config readable by all | Driver call | FIXED | 20261112182000 |
| AI-1 | P2 | Any user could exhaust the AI budget | Driver insert cost 1000 | FIXED | 20261112151000 |
| AI-2 | P3 | AI budget is global, not per tenant | config | OPEN | - |
| AI-3 | P3 | Knowledge search bypasses country / site | function body | OPEN | Latent (0 documents) |
| AI-4 | P3 | AI cache and messages never purged | 39 of 39 cache rows expired | OPEN | - |
| AI-5 | P3 | `chat-ai` narrates browser-computed figures | source | OPEN | - |
| FILE-1 | P1 | Storage ignores role and country | Driver saw 29 import files | FIXED / OPEN | 20261112153000 |
| FILE-2 | P2 | `inspection-photos` upload by locked accounts | locked account insert | FIXED | 20261112152000 |
| FILE-3 | P3 | `vehicle-photos` overwrite by anyone | Driver update 1 row | FIXED / OPEN | 20261112152000 |
| FILE-4 | P3 | `tyre-photos` paths not org-prefixed | 26,976 objects | OPEN | - |
| FILE-5 | P2 | Formula-injection sanitising incomplete | 17 direct sheet writers | STAGED | d5764687 |
| FILE-6 | P3 | Expo PDF injects signature SVG as HTML | source | OPEN | - |
| FILE-7 | P3 | Upload and export caps browser-only | catalog | OPEN | - |
| FILE-8 | P3 | No deletion or retention path for media | no DELETE policy | OPEN | - |

### PERF and DEP ([detail](PRODUCTION_READINESS.md))

| ID | Sev | Title | Evidence (short) | Status | Fix reference |
|---|---|---|---|---|---|
| PERF-1 | P1 | Work Orders export dropped most rows | 600 of 2,371 exported | STAGED | 207472c4 |
| PERF-2 | P2 | `get_work_orders_page` full scan per page | 15,408 buffers + temp spill | OPEN | - |
| PERF-3 | P2 | Realtime WAL decoder dominant load | 52% time, 82% buffers | OPEN | - |
| PERF-4 | P2 | Report RPCs near the 8 s timeout | max 7,814 ms | OPEN | - |
| PERF-5 | P2 | Alert badge pages 2,000 tyre rows per tab | 4,405 calls | OPEN | - |
| PERF-6 | P2 | ERP intake de-dup read is quadratic | 24.5 M buffers | OPEN | - |
| PERF-7 | P2 | Visibility map stale on hot tables | parts_consumption 0% | OPEN | Owner: VACUUM |
| PERF-8 | P3 | Eager bundle 546 kB gzip | build output | OPEN | - |
| PERF-9 | P3 | About 1 GB of snapshots and staging | relation sizes | OPEN | Owner decision |
| PERF-10 | P3 | Policies with bare helper calls | 12 storage policies | OPEN | - |
| PERF-11 | P3 | Small N+1 write loops | 4 sites | OPEN | - |
| DEP-1 | P1 | Deployed edge functions may reject the app origin | deployed code predates allowlist change | NOT VERIFIED | Owner: check `ALLOWED_ORIGINS`, redeploy (bb05eb55) |
| DEP-2 | P2 | Two production deploys per merge, not gated on CI | deployment pairs | OPEN | - |
| DEP-3 | P2 | Marketing project not inspectable; `APP_URL` default | 404 on project read | NOT VERIFIED | Owner |
| DEP-4 | P3 | App header gaps | 4 items | OPEN | - |
| DEP-5 | P2 | Snapshot backup covers a small part | work_orders skipped | OPEN | Owner: confirm PITR |
| DEP-6 | P2 | CI gaps | no `deno check`, no E2E | OPEN | - |
| DEP-7 | P2 | No uptime check | absence | OPEN | - |
| DEP-8 | P3 | Preview builds on first push | ignore script | OPEN | - |
| DEP-9 | P3 | Supply chain small items | no lockfile for analytics | OPEN | - |

### WEB - marketing site ([detail](MARKETING_WEBSITE_AUDIT.md))

| ID | Sev | Title | Status |
|---|---|---|---|
| WEB-1 | P1 | Mobile menu taller than the screen, cannot scroll | OPEN |
| WEB-2 | P1 | Login and legal links default to a host of unverified state | NOT VERIFIED |
| WEB-3 | P2 | Home h1 hidden after first slide; hero cannot be paused | OPEN |
| WEB-4 | P2 | Contact WhatsApp fallback link malformed | OPEN |
| WEB-5 | P2 | Contact delivery depends on unset env; 429 has no fallback | OPEN |
| WEB-6 | P2 | iOS availability stated three ways | OPEN |
| WEB-7 | P2 | Floating dock covers a footer legal link | OPEN |
| WEB-8 | P2 | Mobile home page 13,326 px tall | OPEN |
| WEB-9 | P2 | LCP render-delayed; fonts and CSS block paint | OPEN |
| WEB-10 | P3 | About 29 prefetch requests per page | OPEN |
| WEB-11 | P3 | Desktop dropdown stays open after focus leaves | OPEN |
| WEB-12 | P3 | `/ar`: `dir` on wrapper only | OPEN |
| WEB-13 | P3 | Form required and invalid states weak | OPEN |
| WEB-14 | P3 | Tap targets under 44 px | OPEN |
| WEB-15 | P3 | Walkthrough labels truncate at tablet width | OPEN |
| WEB-16 | P3 | Text-only 200% resize clips on home | OPEN |
| WEB-17 | P3 | SEO small items | OPEN |
| WEB-18 | P3 | Photo repetition | OPEN |
| WEB-19 | P3 | Landmark and semantics gaps | OPEN |

WEB fixes, if any, are on branch `claude/marketing-premium-pass` and were not reviewed for this document.

## Limits of this audit (applies to every document)

- Git history is a shallow clone (oldest reachable commit 2026-06-04, 2,766 commits). Older history was not scanned.
- No request was sent to production hosts or to `*.supabase.co` (blocked by the audit host proxy).
- Supabase Auth dashboard settings, edge-function secrets, Vercel environment variables, GitHub repository
  settings and Play Console state were not readable.
- No plain (non-super) Admin account exists, so that role was not tested as a real user.
- No account is narrowed to a real site list, so site WRITE isolation was not exercised.
- Flutter and Expo were reviewed in source only. Nothing ran on a device.

## Lead corrections after assembly (2026-11-12)

These override the status shown in the tables above and in the area documents.

| ID | Corrected status | Evidence |
|---|---|---|
| API-6 | FIXED | Share-link lockout checked at runtime by the audit lead after the migration: both live shares still open, repeated wrong passwords lock out. |
| RLS-12 | FIXED | The owner ran the delete-policy statement in the SQL editor; the lead then confirmed the policy is live. |
| DEP-1 / WEB-2 | NOT VERIFIED (host exists) | app.tyrepulse.app is the app's only Vercel domain. Whether the deployed edge functions allow it in CORS is still to be checked by using AI chat on that host. |
| Flutter CI | See PR 501 | Format, analyze and tests were run locally after commit 50b17fa6: 3657 passed, 18 golden picture diffs (Linux vs Windows). |
