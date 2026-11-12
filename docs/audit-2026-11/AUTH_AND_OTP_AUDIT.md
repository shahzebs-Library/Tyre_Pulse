# Authentication, OTP / MFA, recovery and session audit - 2026-11-12

Read-only. Database probes ran in rolled-back transactions. No real user was signed in, locked or modified;
anonymous RPCs were called only with a fake identifier. Status words: see [SECURITY_AUDIT.md](SECURITY_AUDIT.md).

## What exists

- Main app is a Vite React SPA on Supabase Auth. Marketing has no auth.
- No OAuth / PKCE in use; 0 SSO connections; Google, Microsoft and QR sign-in flags unset.
- No email OTP or magic-link sign-in for users. The OTPs that exist: (a) TOTP MFA, 2 users, both super
  admins; (b) a custom 6-digit recovery code from edge function `account-recovery` (0 profiles have a recovery
  contact); (c) an internal token minted by `qr-login` (feature disabled).
- 769 profiles (768 approved, 1 locked and unapproved, 2 super admins). 761 use a synthetic login email.
  251 live sessions.
- Live config: max_login_attempts 5, session_timeout_hours 24, two_factor_required true, registration_open
  true, require_approval true, password_min_length 8, console IP allowlist off.

## Findings

### AUTH-1 (P1) MFA enforced only in client code - FIXED / STAGED
- Evidence: 0 of 4,388 policies referenced `aal`. Rolled-back proof as an MFA-enrolled super admin with an
  aal1 JWT: `is_super_admin()` true, 769 profiles and 218,776 expense lines readable, and
  `admin_set_user_password` passed every authorization check. Flutter had no MFA code.
- FIXED: `20261112160000_super_admin_requires_mfa_session.sql`. A super admin with a verified factor is super
  admin only in an aal2 session. Verified: aal1 -> `is_super_admin()` false; aal2 -> true.
- STAGED: Flutter sign-in code step (commit 50b17fa6: `mfa_gate.dart`, `mfa_repository.dart`, tests). Needs a
  Flutter build to reach phones. Until then a super admin acts with ordinary role only in the mobile apps.
- OPEN remainder (stated in later migrations): two older `system_config` policies and `set_sentry_config`
  test the profile flag directly, not `is_super_admin()`; an account with no enrolled factor is unchanged
  (see AUTH-10); non-super accounts have no aal rule (none is MFA-enrolled today).
- NOT VERIFIED: whether Supabase Auth blocks a password change at aal1 for enrolled users; whether edge
  function `admin-revoke-sessions` now refuses an aal1 token (not re-tested).

### AUTH-2 (P1) Locked or unapproved accounts read business tables - FIXED / OPEN
- Evidence: the one locked + unapproved account read sco_costs 672, action_items 161, corrective_actions 161,
  stock_records 36, budgets 12, module_permissions 1,346, system_config 62 and others (27 tables).
  Self-registration is open and a synthetic-email sign-up gets a live session at once.
- FIXED: `20261112144000_active_account_read_gate.sql` (25 tables) and `20261112182000` (system_config).
  Verified: locked account reads 0 on all 25 and 0 config rows; active users' counts identical before / after.
- OPEN: `registration_open` is still checked only in the client (the sign-up trigger ignores it); locking a
  profile does not ban the Auth user or revoke refresh tokens. Reason: needs Auth settings / edge work.
- NOT VERIFIED: the sweep as a brand-new self-registered account (only the existing locked account was used).

### AUTH-3 (P1) Self-rewrite of site scope and login identifiers - FIXED
- Evidence: an approved non-admin changed own `sites`, `web_access`, `username`, `employee_id`, `email`.
- Fix: `20261112141000` (same migration as RLS-1). Verified: each refused with 42501; username remains
  self-editable (the Settings page saves it) but is refused when it equals another person's employee id.

### AUTH-4 (P2) Lockout stops honest users, not attackers - OPEN
- Evidence: `record_login_failure` is callable by anon; five calls with a known identifier lock it for 15
  minutes with no password attempt. A direct call to the Auth token endpoint with the synthetic email is never
  counted. Console sign-in neither checks nor records the lockout. Not exercised against a real account.
- Reason open: fix changes the sign-in path (route all sign-ins through edge function `sign-in`); not done.

### AUTH-5 (P2) Account enumeration oracles - OPEN
- Evidence: `get_email_by_identifier` returns non-null for existing identifiers; `record_login_failure`
  returns `remaining` only for real identifiers; sign-up says "already taken". `account-recovery` timing
  oracle is PLAUSIBLE only. `sign-in` and `request_password_reset` are clean.

### AUTH-6 (P2) Recovery-contact guard was a no-op - FIXED
- Evidence (reproduced live at fix time, rolled back): with JSON claims only, a normal user set own
  `recovery_email` and marked it verified.
- Fix: `20261112183000_recovery_contact_guard_both_claim_styles.sql`. Verified: 42501 for an authenticated
  caller under both claim styles; service-role path still allowed; unrelated self edit still works.

### AUTH-7 (P2) Sessions never expire server-side - OPEN
- Evidence: 251 sessions, oldest 156 days, 97 not refreshed for over 30 days, `not_after` set on 0. The 24 h
  timeout is a browser timer in the web app only. Console 10 min idle / 8 h cap is also client code.
- Owner action: set session time-box and inactivity timeout in the Supabase Auth dashboard.

### AUTH-8 (P2) Weak password change and reset controls - OPEN
- Evidence: `/reset-password` works for any existing session with no current password; minimum length
  enforced in the browser only; `admin_set_user_password` enforces length only; `account-recovery` verify step
  does not re-check approved / locked.
- Owner action: "Secure password change", leaked-password protection and password rules in the dashboard.
  Code change for `/reset-password` not written.

### AUTH-9 (P2) No per-IP throttle before password checking - OPEN
- Evidence (source; env not visible, confidence PLAUSIBLE): `sign-in` has no own per-IP counter;
  `account-recovery` keys its limit on a header that may be client-supplied.
- Note: commit d5764687 adds a `Retry-After` header to `sign-in` 429 replies only (STAGED). The throttle
  itself is not built.

### AUTH-10 (P3) Console MFA and network controls optional - OPEN
- A super admin with no enrolled factor is admitted with a password only; IP allowlist is off and fails open.
  Both current super admins are enrolled.

### AUTH-11 (P3) Sign-up trusts client metadata - FIXED / OPEN
- FIXED: `20261112185000_handle_new_user_region_allowlist.sql`. Region limited to KSA / UAE / Egypt, default
  KSA. Verified by reading the live definition and evaluating the expression; no auth user was created.
- OPEN: username and employee id are still client-supplied (uniqueness and approval are the control).

### AUTH-12 (P3) Anonymous information disclosure - OPEN
- `get_login_showcase` returns fleet and user counts; `get_public_config` exposes three policy values.
  Recorded as owner-accepted.

### AUTH-13 (P3) `admin-revoke-sessions` CORS too wide - STAGED
- Commit d5764687 removes the `*.vercel.app` wildcard and the loose localhost test. Not deployed.

## Flow and control matrix (state at audit time)

| Flow | Enumeration | Lockout | MFA |
|---|---|---|---|
| Web password, field account | oracle (AUTH-5) | client-recorded, bypassable (AUTH-4) | client gate; super admin now server-enforced |
| Web password via edge `sign-in` | clean | server-recorded | as above |
| Console | post-auth message only | none | client gate, enrolment optional |
| Flutter | as web | as web | none (step STAGED) |
| Expo (retired) | as web | as web | none |
| QR sign-in | n/a | 10 starts / min / IP | refuses MFA and Admin accounts; DISABLED |
| Sign-up | "taken" message | Auth defaults | n/a |
| Forgot (ask admin) | clean | 1 / hour per user | n/a |
| Recovery code | timing only | 5 requests / 15 min, 5 tries / code, 10 min life | yields aal1 |
| Admin set password | n/a | n/a | super admin path now needs aal2 |

## Checked and clean

- `login_attempts`, `password_recovery_challenges`, `qr_login_requests`: RLS on, no client grants.
- Recovery codes: random, HMAC-stored, constant-time compare, single use, generic errors.
- `sign-in`: body caps, no email in responses, generic refusal, no-store.
- Role escalation by self-update blocked; last-admin guard present.
- Service worker caches no Supabase responses; sign-out clears caches.
- Console session isolated in tab-local storage.
- At audit time: 0 super-admin sessions at aal1; 0 sessions of locked accounts.

## Owner must confirm in Supabase Dashboard > Authentication (all NOT VERIFIED)

1. "Allow new users to sign up", "Confirm email", anonymous sign-ins off.
2. OTP / magic-link and recovery link expiry.
3. Rate limits (emails per hour, sign-in and sign-up per IP, token refresh, OTP and MFA verify).
4. Password minimum length, character classes, leaked-password protection, secure password change.
5. JWT expiry, session time-box, inactivity timeout, single session per user, refresh rotation reuse interval.
6. CAPTCHA stays OFF until the mobile apps send a token.
7. MFA: TOTP enabled; whether password / email change needs aal2 for enrolled users.
8. Site URL and redirect allow-list contain only production hosts.
9. Edge function secrets: client-IP forwarding, allowed origins, recovery HMAC secret, app URL, mail key.

Also NOT VERIFIED: timing behaviour of `sign-in` and `account-recovery` on the live endpoint; on-device token
storage and offline profile cache.
