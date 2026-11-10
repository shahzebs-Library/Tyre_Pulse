# 17 - Security Audit

| Field | Value |
|---|---|
| Deliverable | 17 of 29 |
| Date | 2026-11-10 |
| Status | Partly built. Database-level controls are strong and re-verified live today (0 tables without RLS, 0 anon table grants, 0 TRUNCATE grants, 0 unpinned definer functions, 0 owner-rights views, 0 public buckets, both super admins on MFA). Open: one new anon-executable definer function, an undocumented live reader layer, profile read breadth, export enforcement app-side only, sign-in email exposure partly mitigated, mobile dependency findings. |
| Evidence | Live catalog queries 2026-11-10 (read-only) against project jhssdmeruxtrlqnwfksc, marked "live". Code read: `src/lib/safeError.js`, `src/lib/supabase.js`, `src/lib/authAssurance.js`, `src/lib/api/loginGuard.js`, `vercel.json` (CSP), `supabase/functions/*`, migrations named below. Earlier measurements (dates given) from PROJECT_MEMORY.md. No penetration test, no OWASP ZAP run, no dependency audit was run for this document. |
| Related docs | [07 Access](07-master-access-control.md), [18 Tenant isolation](18-tenant-isolation-review.md), [09 Console](09-admin-console-structure.md) |

## 1. Current posture (live, 2026-11-10)

| Check | Result | Note |
|---|---|---|
| Public tables without RLS | 0 of 479 | |
| Tables granted to `anon` | 0 | V281 revoked all; default privileges revoked |
| TRUNCATE / TRIGGER grants to client roles | 0 | V379 (TRUNCATE bypasses RLS) |
| SECURITY DEFINER functions | 734, all with pinned search_path | |
| Definer functions executable by `anon` | 16 | 15 intended, 1 regression (see R1) |
| Views without security_invoker | 0 | V543 fixed the two that leaked |
| Public storage buckets | 0 | 31 storage policies |
| Super admins | 2, both MFA verified | Weekly scan checks it |
| Plain (non-super) Admins | 0 | |
| Tables with FORCE RLS | 3 | No-op here, see 3.4 |
| Weekly security scan | `security-audit-weekly`, last run 2026-11-08, score 89, 0 critical, 1 high | |
| Login lockout | `max_login_attempts` = 5, V287 | |
| Console IP allowlist | off, 0 entries | |
| Dual control | off | |

## 2. Fix history that defines the current posture

| Area | What was wrong | Fix | Ref |
|---|---|---|---|
| Anonymous role | `anon` held SELECT/INSERT/UPDATE/DELETE/TRUNCATE on 100 tables; `module_permissions` leaked 559 rows | Revoke all + default privileges | V281 (2026-07-19) |
| Anon definer functions | 126 anon-executable definer functions | Grant authenticated, revoke PUBLIC, then revoke anon (order is load-bearing); allowlist from call sites | V500 |
| Company Admin crossing tenants | 45 org policies bypassed via `app_is_org_admin()` | Only `is_super_admin()` crosses orgs | V306, V314 |
| Self escalation | Plain Admin could set `is_super_admin` | Guard trigger rewritten | V307 |
| Last admin lockout | Possible | `guard_last_admin` | V308 |
| Blank scope = see all | New users saw every site | Blank = no access; `ALL` sentinel | V309 |
| Plain Admin crossing countries | 50 country policies | Super admin only | V498 |
| Write path scoping | Country scope covered reads only; KSA Manager could insert UAE rows | FOR ALL with USING + WITH CHECK on 78 + 55 tables | V542 |
| Definer functions ignoring scope | RLS never runs inside definer functions; hundreds of RPCs leaked other countries, other tenants and wrote cross-country (scrap, rebrand, undo deleting price history) | Re-checks inserted by anchored replace with abort guards | V545 to V576 |
| KPI target writes | Blanket FOR ALL annulled write gates | Policy dropped | V501 |
| TRUNCATE | Granted to authenticated on 248 tables | Revoked | V379 |
| PostgREST 40001 retry loop | 8.6M error lines/day | Raise PT409 instead | 20260926090000 |
| Notification relay | `workflow-notify` fell open when secret unset | Mandatory secret, constant-time compare | 2026-07-19 |
| Console | Pre-2FA sessions exposed data; console session shared across tabs | AAL gate, tab-local session, 10 min idle, 8 h absolute, no main-app entry | 2026-07-18, 2026-08-05 |
| Raw errors | ~56 sites rendered Postgres text | `unwrap()` returns `toUserMessage`; original kept on `.cause` | 2026-07-27 |
| Secrets | Full history sweep 1,240 commits | No secret ever leaked; only publishable keys | 2026-08-12 |

## 3. OWASP-aligned review

### 3.1 Authentication (A07)

- Sign-in by username or employee id. `get_email_by_identifier` (anon) now returns only synthetic
  `@users.tyrepulse.app` addresses (20261108130000); real-email accounts and unknown names go through the
  `sign-in` edge function, which never returns the email. The earlier email oracle (memory open item) is
  therefore mitigated, but the function still confirms that a username exists for synthetic accounts.
- Lockout V287: identifier-based, 15-minute window, counts only real accounts; known trade-off: a person who
  knows a valid username can lock it for 15 minutes.
- Password reset by admin request (`request_password_reset`, anon, same reply for any input, 1 per hour).
- MFA enforced for console; `two_factor_required` prompts admins in the main app.
- Leaked-password protection: recorded ON 2026-09-26 in memory; the security scan reports it as `manual`
  (SQL cannot read it). Re-confirm in the Supabase dashboard.
- Public signup: `registration_open` = true live, but every signup lands pending Reporter with no scope
  (`require_approval` = true). Self-serve company creation (V316) deliberately NOT applied. Spec asks for
  public employee signup disabled: owner decision.
- CAPTCHA (Turnstile) wired but inert; enabling it would lock out phones until mobile sends a token.
- QR sign-in hardened (two secrets, number matching, 2FA users refused) and switched OFF until a Flutter build
  ships.

### 3.2 Access control (A01)

Covered in doc 07 and doc 18. Residual: capability enforcement on 45 tables only; export is app-level.

### 3.3 Injection (A03)

- No client SQL. Dynamic SQL in admin RPCs uses fixed safelists (`_admin_db_safelist`, `_dup_scan_spec`,
  `_data_cleanup_spec`, `upload_feeds` validation trigger) with `%I` / bound values.
- Search terms sanitised (`sanitizeSearchTerm`, `escapeLike`); a typed `%` no longer becomes a match-all.
- `safeHref` / `safeImageSrc` / `safeInternalPath` (rejects schemes, `//host`, backslash forms).

### 3.4 Security misconfiguration (A05)

- CSP (`vercel.json`): `default-src 'self'`, no `unsafe-eval`, scripts self + Cloudflare challenges,
  `frame-ancestors 'none'`, `object-src 'none'`. `style-src 'unsafe-inline'` remains.
- FORCE RLS is a no-op because the owner role holds BYPASSRLS (V580, proven by control experiment). Do not
  apply it expecting protection; definer functions must re-check scope themselves.
- Extensions `vector` and `pg_net` in `public` - known, left deliberately.

### 3.5 Error handling (spec mandatory section)

- Web: `src/lib/safeError.js` `toUserMessage` maps codes and blocks DB markers; ErrorBoundary shows a
  reference id, no stack in production; `system_logs` is the error sink; Sentry with JWT redaction.
- Mobile Expo: `mobile/lib/safeError.ts`. Edge functions return generic messages (send-email,
  send-scheduled-reports hardened).
- Gap: one framework per stack rather than one shared contract; Flutter has its own error mapper.

### 3.6 Logging and monitoring (A09)

- `audit_log_v2` (578,281 rows live; actor_type added V499), `access_audit` (4,300 rows), `console_sessions`,
  hash-chained seals (`audit-seal-daily`), 365-day log retention (V288).
- Gap: 571,989 audit rows (98.9 percent) have no country; see doc 18 (V579 decision pending).

### 3.7 Vulnerable components (A06)

From memory (2026-10-25): root web prod npm audit 0 critical/high; marketing prod 0; Expo mobile 14
(build-time expo/metro chain, needs an Expo major, deferred because Expo builds are retired). Not re-run today.

## 4. Open risks, ranked

| # | Risk | Severity | Evidence | Fix | Effort |
|---|---|---|---|---|---|
| R1 | `tyre_one_price_per_tyre()` (trigger fn, 20261109100000) is SECURITY DEFINER and executable by anon/PUBLIC. A trigger function needs no EXECUTE grant. Callable directly it fails (no trigger context), so exposure is surface only; next weekly scan will flag it. | Medium | live catalog | `revoke all on function public.tyre_one_price_per_tyre() from public, anon, authenticated` (same as 20261109200000) | S |
| R2 | Live schema `anum_integration` (tables `readers`, `reader_tables`; functions incl. `pre_request`, `register_reader`, `apply_reader_policies`) adds RESTRICTIVE `anum_reader_*` policies on 447 tables. No migration file in the repo, no `schema_migrations` row, no PROJECT_MEMORY entry. 1 reader row. | High (governance) | live catalog | Identify owner and purpose; export DDL into a migration; review `pre_request` (may be a PostgREST hook) | S to M |
| R3 | `profiles` readable by every active org member (permissive `profiles_select`), including `push_token` and contact fields | Medium | live policy | Directory view without sensitive columns; restrict base read to self + admin | M |
| R4 | Create/edit capability enforced on 45 tables; elsewhere a UI-only gate | Medium | live | Capability registry (doc 07) | L |
| R5 | Export authorization is app-level | Medium | `exportUtils.guardExport` | Server-issued exports for sensitive modules | M |
| R6 | Per-country staging tables (`stg_*_ksa/_uae/_egypt`, 12 tables) readable by any elevated user with no org wall | Low (tables are empty pipes) | live policies | Add org predicate or make deny-all | S |
| R7 | Organisation lock recorded but not enforced on members | Medium for SaaS | memory | Include in `app_is_active()` | S |
| R8 | No Company Admin tier; every change needs a platform super admin | Medium for SaaS | doc 09 | Company Admin console | XL |
| R9 | Username existence observable via anon `get_email_by_identifier` / lockout replies | Low | 20261108130000 | Move all sign-in to the `sign-in` edge fn | M |
| R10 | Mobile (retired Expo) dependency findings | Low | memory | Moot once Expo is removed; keep Flutter pubspec audited | S |
| R11 | Duplicate migration timestamps (`20261109160000` x2, `20261109170000` x2) | Low | repo listing | Renumber; CLI apply order is ambiguous | S |
| R12 | Support sessions authorize/audit only; super admin still reads every org without one | Medium | doc 18 | Retarget `app_current_org()` to the support session for super admins | M |

## Open decisions for the owner

- Disable public employee signup (spec) or keep pending-approval signup?
- What is `anum_integration` and who owns it?
- Should super admins be forced through support sessions to read a tenant?
- Enable Turnstile CAPTCHA once Flutter carries a token?

## Next actions

1. Phase 1, S: revoke EXECUTE on `tyre_one_price_per_tyre`; add the 5 intended anon functions to the security
   scan allowlist so the score reflects real findings.
2. Phase 1, S: document `anum_integration` as a migration; record it in PROJECT_MEMORY.
3. Phase 1, S: renumber colliding migration timestamps.
4. Phase 2, M: profiles directory view; staging org predicate.
5. Phase 3, M: org lock enforcement; support-session retargeting.
6. Phase 3, L: capability registry and server-side exports.
7. Phase 1, S: run OWASP ZAP baseline and `npm audit` on all packages and record results here.
