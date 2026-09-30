---
name: auth-testing
description: Test authentication end to end in Tyre Pulse (web app, System Console, Expo app, Flutter app) - sign-up, approval gate, login by username/email, lockout, MFA, password reset, sessions, sign-out, account deletion, protected routes. Use for "test login", "check auth", "session bug", "password reset", "is this route protected".
---

# Auth testing

## How auth works here (read before testing)
- Supabase Auth. Web client `src/lib/supabase.js`; the **console** (`/console`, super-admin only) uses a separate,
  tab-local `sessionStorage` key `tp_console_auth` and ends after 10 min idle / 8 h absolute. The main app keeps
  `tp_auth` in localStorage. Opening `/console` in the main-app tab must NOT carry the session in.
- Sign-in accepts a username or email: `get_email_by_identifier` (anon RPC) resolves the email.
  Lockout: `login_attempt_status` / `record_login_failure` / `reset_login_attempts` (V287), limit
  `system_config.max_login_attempts`, 15-minute window, only real accounts are counted.
- New users land `approved=false`, role Reporter, no site scope; an admin approves in Console -> Users.
  `system_config.registration_open` and `require_approval` gate sign-up.
- MFA: TOTP, enforced by AAL check (`src/lib/authAssurance.js`); a password-only session with an enrolled factor
  must not see data (AAL1 < AAL2).
- Turnstile CAPTCHA code is wired but inert. **Never enable Supabase CAPTCHA** until mobile sends a token - it locks
  every phone login out.
- Mobile: Expo `mobile/contexts/AuthContext.tsx` (8 s restore timeout, SecureStore chunked adapter, offline
  profile cache 90 days); Flutter `tyre_pulse_flutter/lib/core/auth/`.
- Account deletion is a request (`account_deletion_requests`, V317), public page `/data-deletion`.

## Test matrix (each row: expected result, actual result, PASS/FAIL)
Sign-up: valid; duplicate email; duplicate username; invalid email; weak password (below
`password_min_length`); registration closed -> clear message; new user sees "awaiting approval", reads 0 rows.
Login: username; email; wrong password (generic message, counts toward lockout); unknown user (same message, no
count); locked after N failures with minutes remaining; locked user; unapproved user; disabled/deleted user.
Password: forgot password email; reset link works once; used link refused; expired link refused; change password
while signed in; change email.
Sessions: refresh keeps you signed in; token refresh after expiry; sign out clears storage and realtime channels;
sign out in one tab reflects in others (main app); console session isolated; revoke sessions ("Sign out
everywhere", `admin-revoke-sessions`) - access token may live up to ~1 h, note it; multiple devices.
MFA: enrol, challenge, wrong code, AAL1 session blocked from data.
SSO: `sso_connections.enforce_sso` domain forces SSO (super admins exempt).
Protected routes: open each guarded route directly, after refresh, after sign-out + browser Back, with an expired
token, after a role downgrade (realtime `profiles` update) -> must show login or Access Denied, never data.
Mobile: cold start offline with cached profile; locked account signs out on next fetch; offline queue survives
sign-out/in; lockout RPCs used.
Rate limiting / brute force: lockout engages; enumeration - login responses identical for existing vs missing
accounts (note: `get_email_by_identifier` is a known enumeration oracle, owner decision pending).

## Rules
- Use test accounts only. Never change a real user's password, role or lock state. Impersonation via SQL is for
  read checks and must be rolled back.
- Check the backend, not just the screen: after "blocked" in the UI, confirm the API/RPC also refuses.
- A route is protected only if the data request fails without a valid session; hiding the link is not protection.

## Pass / fail
PASS: every matrix row executed with evidence (screenshot, network response, or SQL result). Any row not
executable is listed as NOT RUN with the reason - never counted as PASS.
